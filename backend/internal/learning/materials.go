package learning

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func validateKnowledgeOrigin(s *rag.Service, ctx context.Context, course, origin, kind string, grading bool, refs []rag.Evidence, visible bool) error {
	if origin == "teacher_example" {
		if kind != "example" || grading || len(refs) != 0 {
			return errors.New("教师自编示例只能用于学习，不附学生作答或来源引用，不用于评分")
		}
		return nil
	}
	if origin != "source" {
		return errors.New("知识来源类型无效")
	}
	return s.ValidateEvidence(ctx, course, refs, visible)
}

func (h *Handler) registerRAG(g *gin.RouterGroup, auth *identity.Handler) {
	r := g.Group("", func(c *gin.Context) {
		if h.rag == nil {
			identity.Fail(c, 503, "rag_not_configured", "资料智能处理尚未启用")
			c.Abort()
			return
		}
		c.Next()
	})
	t := r.Group("", identity.RequireRole("teacher"))
	t.GET("/models", h.models)
	t.GET("/sources", h.sources)
	t.GET("/sources/:sourceID", h.sourceDetail)
	t.POST("/sources", auth.RequireCSRF(), h.uploadSources)
	t.PUT("/sources/:sourceID/fragments", auth.RequireCSRF(), h.correctFragments)
	t.POST("/sources/:sourceID/publish", auth.RequireCSRF(), h.publishFragments)
	t.POST("/sources/:sourceID/archive", auth.RequireCSRF(), h.archiveSource)
	t.PUT("/sources/:sourceID/derivation", auth.RequireCSRF(), h.sourceDerivation)
	r.GET("/sources/:sourceID/download", h.downloadSource)
	r.GET("/knowledge", h.knowledge)
	t.POST("/knowledge", auth.RequireCSRF(), h.saveKnowledge)
	t.PUT("/knowledge/:knowledgeID", auth.RequireCSRF(), h.saveKnowledge)
	t.POST("/knowledge/:knowledgeID/state", auth.RequireCSRF(), h.knowledgeState)
	t.POST("/jobs", auth.RequireCSRF(), h.createRAGJob)
	t.GET("/jobs", h.jobs)
	t.GET("/jobs/:jobID", h.job)
	t.POST("/jobs/:jobID/cancel", auth.RequireCSRF(), h.cancelJob)
	t.POST("/jobs/:jobID/retry", auth.RequireCSRF(), h.retryJob)
	g.POST("/retrieval", auth.RequireCSRF(), h.retrieval)
	g.GET("/retrieval/status", h.retrievalStatus)
}
func ragError(c *gin.Context, e error) { identity.Fail(c, 422, "rag_error", e.Error()) }
func (h *Handler) models(c *gin.Context) {
	budget, e := h.q.GetModelBudget(c.Request.Context())
	calls, err := h.q.ListCourseModelCalls(c.Request.Context(), c.Param("courseID"))
	if e == nil {
		e = err
	}
	result(c, gin.H{"profiles": h.rag.Models.Public(), "budget": budget, "calls": calls}, e)
}
func (h *Handler) sources(c *gin.Context) {
	v, e := h.q.ListMaterialSources(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
func (h *Handler) sourceRecord(c *gin.Context) (store.MaterialSource, bool) {
	v, e := h.q.GetMaterialSource(c.Request.Context(), store.GetMaterialSourceParams{ID: c.Param("sourceID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return v, false
	}
	return v, true
}
func (h *Handler) sourceDetail(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	revision := src.ParseRevision
	if id := c.Query("fragment_id"); id != "" {
		f, e := h.q.GetMaterialFragment(c.Request.Context(), store.GetMaterialFragmentParams{ID: id, CourseID: src.CourseID})
		if e != nil || f.SourceID != src.ID {
			identity.Fail(c, 404, "not_found", "原文片段不存在")
			return
		}
		revision = f.Revision
	}
	fs, e := h.q.ListMaterialFragments(c.Request.Context(), store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: revision})
	result(c, gin.H{"source": src, "fragments": fs, "display_revision": revision}, e)
}
func (h *Handler) uploadSources(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 310<<20)
	if e := c.Request.ParseMultipartForm(8 << 20); e != nil {
		invalid(c, "上传内容过大或格式无效（每个文件30MiB，每批最多10个）")
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	files := c.Request.MultipartForm.File["files"]
	if len(files) < 1 || len(files) > 10 {
		invalid(c, "每次请选择1到10个文件")
		return
	}
	note := c.PostForm("source_note")
	if !validText(note, 1000) {
		invalid(c, "请登记资料来源")
		return
	}
	allowed := map[string]bool{".pdf": true, ".docx": true, ".pptx": true, ".txt": true, ".md": true, ".html": true, ".htm": true, ".csv": true}
	for _, f := range files {
		if f.Size > 30<<20 || f.Size < 1 || !allowed[strings.ToLower(filepath.Ext(f.Filename))] {
			invalid(c, "文件为空、超过30MiB或类型不支持")
			return
		}
	}
	supersedes := c.PostForm("supersedes_id")
	version := int32(1)
	if supersedes != "" {
		if len(files) != 1 {
			invalid(c, "替换原件时一次只能上传一个文件")
			return
		}
		old, e := h.q.GetMaterialSource(c.Request.Context(), store.GetMaterialSourceParams{ID: supersedes, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		version = old.Version + 1
	}
	base := rag.MaterialsDir()
	if e := os.MkdirAll(base, 0700); e != nil {
		result(c, nil, e)
		return
	}
	jobs := []store.ProcessingJob{}
	for _, file := range files {
		id := uuid.NewString()
		name := id + strings.ToLower(filepath.Ext(file.Filename))
		path := filepath.Join(base, name)
		in, e := file.Open()
		if e != nil {
			result(c, nil, e)
			return
		}
		out, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			in.Close()
			result(c, nil, e)
			return
		}
		hash := sha256.New()
		_, e = io.Copy(io.MultiWriter(out, hash), io.LimitReader(in, 30<<20+1))
		in.Close()
		out.Close()
		if e != nil {
			_ = os.Remove(path)
			result(c, nil, e)
			return
		}
		if supersedes == "" {
			old, err := h.q.SourceDuplicate(c.Request.Context(), store.SourceDuplicateParams{CourseID: c.Param("courseID"), Sha256: hex.EncodeToString(hash.Sum(nil))})
			if err == nil {
				_ = os.Remove(path)
				identity.Fail(c, 409, "duplicate_source", "内容已导入，请复用原件："+old.Title)
				return
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				result(c, nil, err)
				return
			}
		}
		title := c.PostForm("title")
		if title == "" || len(files) > 1 {
			title = file.Filename
		}
		if len(title) > 500 {
			title = string([]rune(title)[:100])
		}
		src, e := h.q.CreateMaterialSource(c.Request.Context(), store.CreateMaterialSourceParams{ID: id, CourseID: c.Param("courseID"), CreatedBy: identity.Current(c).ID, Title: title, Filename: filepath.Base(file.Filename), MediaType: "application/octet-stream", StoragePath: name, SourceNote: note, Sha256: hex.EncodeToString(hash.Sum(nil)), AllowDerived: c.PostForm("allow_derived") == "true", Version: version, SupersedesID: text(supersedes)})
		if e != nil {
			_ = os.Remove(path)
			result(c, nil, e)
			return
		}
		j, e := h.rag.CreateJob(c.Request.Context(), src.CourseID, identity.Current(c).ID, "parse", rag.JobInput{SourceID: id})
		if e != nil {
			result(c, nil, e)
			return
		}
		jobs = append(jobs, j)
	}
	result(c, jobs, nil)
}
func (h *Handler) downloadSource(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	if !teacher(c) {
		allowed, e := h.q.StudentCanDownloadSource(c.Request.Context(), store.StudentCanDownloadSourceParams{ID: src.ID, CourseID: src.CourseID})
		if e != nil || !allowed {
			identity.Fail(c, 403, "forbidden", "当前资料只发布了选中片段，完整原件不可下载")
			return
		}
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.FileAttachment(filepath.Join(rag.MaterialsDir(), src.StoragePath), src.Filename)
}
func (h *Handler) correctFragments(c *gin.Context) {
	var in struct {
		Revision  int32 `json:"revision"`
		Fragments []struct {
			ID      string `json:"id"`
			Heading string `json:"heading"`
			Body    string `json:"body"`
			Quality string `json:"quality"`
		} `json:"fragments"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 24<<20)
	if c.ShouldBindJSON(&in) != nil {
		identity.Fail(c, 400, "invalid_input", "片段内容格式不正确或超过24MiB")
		return
	}
	if len(in.Fragments) == 0 || len(in.Fragments) > 10000 {
		invalid(c, "片段列表无效")
		return
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: c.Param("sourceID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if src.State != "active" || src.ParseState != "ready" || src.ParseRevision != in.Revision {
		identity.Fail(c, 409, "stale_revision", "原文版本已改变，请刷新后核对")
		return
	}
	old, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(old) != len(in.Fragments) {
		invalid(c, "请完整提交当前版本片段，不删除原文")
		return
	}
	for i, f := range in.Fragments {
		if old[i].ID != f.ID || !validText(f.Body, 500000) || (f.Quality != "ready" && f.Quality != "needs_review") {
			invalid(c, "片段顺序、正文或核对状态无效")
			return
		}
		_, e = q.InsertMaterialFragment(ctx, store.InsertMaterialFragmentParams{ID: uuid.NewString(), SourceID: src.ID, Revision: src.ParseRevision + 1, Position: int32(i), Heading: f.Heading, Body: f.Body, Locator: old[i].Locator, Quality: f.Quality})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	v, e := q.UpdateSourceParse(ctx, store.UpdateSourceParseParams{ID: src.ID, CourseID: src.CourseID, ParseState: "ready", ParseRevision: src.ParseRevision + 1})
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = rag.QueueIndex(ctx, q, src.CourseID, identity.Current(c).ID); e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, nil)
}
func (h *Handler) publishFragments(c *gin.Context) {
	var in struct {
		Title            string   `json:"title"`
		FragmentIDs      []string `json:"fragment_ids"`
		FullSource       bool     `json:"full_source"`
		KnowledgePointID string   `json:"knowledge_point_id"`
	}
	if !bind(c, &in) {
		return
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: c.Param("sourceID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if src.State != "active" || src.ParseState != "ready" || len(in.FragmentIDs) == 0 || !validText(in.Title, 500) {
		invalid(c, "请填写标题并选择已核对片段")
		return
	}
	if e := h.rag.ValidateLinks(c.Request.Context(), src.CourseID, filterID(in.KnowledgePointID), nil); e != nil {
		ragError(c, e)
		return
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	selected := map[string]bool{}
	for _, id := range in.FragmentIDs {
		if selected[id] {
			invalid(c, "片段不能重复，发布完整原件须包含全部已核对片段")
			return
		}
		selected[id] = true
	}
	content := ""
	locators := []json.RawMessage{}
	for _, f := range fs {
		if selected[f.ID] {
			if f.Quality != "ready" {
				invalid(c, "OCR或异常片段须先人工核对")
				return
			}
			content += f.Heading + "\n" + f.Body + "\n\n"
			locators = append(locators, f.Locator)
			delete(selected, f.ID)
		}
	}
	if len(selected) > 0 || len(content) > 200000 || in.FullSource && len(in.FragmentIDs) != len(fs) {
		invalid(c, "片段版本无效、内容过长，或尚未选择全部原文")
		return
	}
	loc, _ := json.Marshal(locators)
	r, e := q.CreateBusinessResource(ctx, store.CreateBusinessResourceParams{ID: uuid.NewString(), CourseID: src.CourseID, CreatedBy: identity.Current(c).ID, Title: in.Title, Content: content, SourceUrl: src.SourceUrl, SourceNote: src.SourceNote, Locator: src.Filename + " " + string(loc), KnowledgePointID: text(in.KnowledgePointID)})
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = q.BindResourceFragments(ctx, store.BindResourceFragmentsParams{ID: r.ID, SourceID: text(src.ID), FragmentIds: in.FragmentIDs, FullSource: in.FullSource}); e != nil {
		result(c, nil, e)
		return
	}
	r, e = q.PublishBusinessResource(ctx, store.PublishBusinessResourceParams{ID: r.ID, ReviewedBy: text(identity.Current(c).ID)})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, r, tx.Commit(ctx))
}
func filterID(s string) []string {
	if s == "" {
		return []string{}
	}
	return []string{s}
}
func (h *Handler) archiveSource(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	e := h.q.ArchiveMaterialSource(c.Request.Context(), store.ArchiveMaterialSourceParams{ID: src.ID, CourseID: src.CourseID})
	result(c, gin.H{"state": "archived"}, e)
}
func (h *Handler) sourceDerivation(c *gin.Context) {
	var in struct {
		Allow bool `json:"allow_derived"`
	}
	if !bind(c, &in) {
		return
	}
	v, e := h.q.SetSourceDerivation(c.Request.Context(), store.SetSourceDerivationParams{ID: c.Param("sourceID"), CourseID: c.Param("courseID"), AllowDerived: in.Allow})
	result(c, v, e)
}
func (h *Handler) knowledge(c *gin.Context) {
	v, e := h.q.ListKnowledgeEntries(c.Request.Context(), store.ListKnowledgeEntriesParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	result(c, v, e)
}
func (h *Handler) saveKnowledge(c *gin.Context) {
	var in struct {
		rag.Candidate
		StudentVisible bool   `json:"student_visible"`
		UseForLearning bool   `json:"use_for_learning"`
		UseForGrading  bool   `json:"use_for_grading"`
		EditVersion    int32  `json:"edit_version"`
		SupersedesID   string `json:"supersedes_id"`
		Origin         string `json:"origin"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Title, 500) || !validText(in.Body, 60000) || !rag.ValidContentKind(in.ContentKind) {
		invalid(c, "知识标题、正文或类型无效")
		return
	}
	ctx := c.Request.Context()
	if in.Origin == "" {
		in.Origin = "source"
	}
	if in.Evidence == nil {
		in.Evidence = []rag.Evidence{}
	}
	previous := c.Param("knowledgeID")
	if previous == "" {
		previous = in.SupersedesID
	}
	if previous != "" {
		old, e := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: previous, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		if old.Origin != in.Origin {
			invalid(c, "知识来源类型不能通过编辑或修订改变")
			return
		}
	}
	if e := validateKnowledgeOrigin(h.rag, ctx, c.Param("courseID"), in.Origin, in.ContentKind, in.UseForGrading, in.Evidence, in.StudentVisible); e != nil {
		ragError(c, e)
		return
	}
	if e := h.rag.ValidateLinks(c.Request.Context(), c.Param("courseID"), in.KnowledgePointIDs, in.RelatedIDs); e != nil {
		ragError(c, e)
		return
	}
	refs, _ := json.Marshal(in.Evidence)
	if id := c.Param("knowledgeID"); id != "" {
		v, e := h.q.EditKnowledgeEntry(ctx, store.EditKnowledgeEntryParams{ID: id, CourseID: c.Param("courseID"), Title: in.Title, Body: in.Body, Category: in.Category, ContentKind: in.ContentKind, Conditions: in.Conditions, KnowledgePointIds: nonNilStrings(in.KnowledgePointIDs), RelatedIds: nonNilStrings(in.RelatedIDs), Evidence: refs, StudentVisible: in.StudentVisible, UseForLearning: in.UseForLearning, UseForGrading: in.UseForGrading, EditVersion: in.EditVersion})
		result(c, v, e)
		return
	}
	version := int32(1)
	if in.SupersedesID != "" {
		old, e := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: in.SupersedesID, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		if old.State == "draft" {
			invalid(c, "草稿请直接修改")
			return
		}
		version = old.Version + 1
	}
	v, e := h.q.CreateKnowledgeEntry(ctx, store.CreateKnowledgeEntryParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), CreatedBy: identity.Current(c).ID, Title: in.Title, Body: in.Body, Category: in.Category, ContentKind: in.ContentKind, Conditions: in.Conditions, KnowledgePointIds: nonNilStrings(in.KnowledgePointIDs), RelatedIds: nonNilStrings(in.RelatedIDs), Evidence: refs, StudentVisible: in.StudentVisible, UseForLearning: in.UseForLearning, UseForGrading: in.UseForGrading, Version: version, SupersedesID: text(in.SupersedesID), Origin: in.Origin})
	result(c, v, e)
}
func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}
func (h *Handler) knowledgeState(c *gin.Context) {
	var in struct {
		State       string `json:"state"`
		EditVersion int32  `json:"edit_version"`
	}
	if !bind(c, &in) {
		return
	}
	k, e := h.q.GetKnowledgeEntry(c.Request.Context(), store.GetKnowledgeEntryParams{ID: c.Param("knowledgeID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if in.EditVersion != k.EditVersion {
		identity.Fail(c, 409, "stale_revision", "知识已被修改，请刷新并重新审核")
		return
	}
	if in.State == "confirmed" && k.State == "draft" {
		var refs []rag.Evidence
		_ = json.Unmarshal(k.Evidence, &refs)
		if e = validateKnowledgeOrigin(h.rag, c.Request.Context(), k.CourseID, k.Origin, k.ContentKind, k.UseForGrading, refs, k.StudentVisible); e != nil {
			ragError(c, e)
			return
		}
	} else if in.State != "archived" || k.State == "archived" {
		invalid(c, "只允许确认草稿或归档条目")
		return
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	v, e := q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: k.ID, CourseID: k.CourseID, State: in.State, State_2: k.State, EditVersion: in.EditVersion})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "stale_revision", "知识已被修改，请刷新并重新审核")
		return
	}
	if e == nil {
		e = rag.QueueIndex(ctx, q, k.CourseID, identity.Current(c).ID)
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}
func (h *Handler) createRAGJob(c *gin.Context) {
	var in struct {
		Kind string `json:"kind"`
		rag.JobInput
	}
	if !bind(c, &in) {
		return
	}
	ctx := c.Request.Context()
	if in.Kind == "source_suggest" || in.Kind == "knowledge_compare" || in.Kind == "paper_split" || in.Kind == "vision" {
		h.createWorkflowJob(c, in.Kind, in.JobInput)
		return
	}
	if in.Kind == "parse" || in.Kind == "extract" {
		src, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: in.SourceID, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		if src.State != "active" {
			invalid(c, "原件已归档")
			return
		}
		if in.Kind == "extract" && (!src.AllowDerived || len(in.FragmentIDs) == 0) {
			invalid(c, "须先允许提炼并选择已核对片段")
			return
		}
	}
	if in.Kind == "rubric" {
		question, ok := h.rubricQuestion(c, in.QuestionID)
		if !ok {
			return
		}
		if question.BankQuestionVersionID.Valid {
			invalid(c, "请在题库为该版本起草标准")
			return
		}
		in.JobInput = rag.JobInput{QuestionID: question.ID, Prompt: question.Prompt, MaxScore: question.MaxScore, ProfileID: in.ProfileID}
	}
	if in.Kind == "grade" {
		s, ok := h.submissionRecord(c, in.SubmissionID)
		if !ok {
			return
		}
		r, e := h.q.GetRubricVersion(ctx, in.RubricID)
		if e != nil {
			result(c, nil, e)
			return
		}
		q, e := h.q.GetBusinessQuestion(ctx, s.QuestionID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !rubricMatches(q, r) {
			invalid(c, "请选择本次任务固定的确认标准")
			return
		}
		in.JobInput = rag.JobInput{QuestionID: q.ID, SubmissionID: s.ID, AnswerHash: s.AnswerSha256, Answer: s.AnswerText, Prompt: q.Prompt, MaxScore: q.MaxScore, RubricID: r.ID, Criteria: r.Criteria, EvidenceRefs: r.EvidenceRefs, ProfileID: in.ProfileID}
	}
	if in.Kind != "parse" && in.Kind != "index" && in.Kind != "extract" && in.Kind != "rubric" && in.Kind != "grade" {
		invalid(c, "任务类型无效")
		return
	}
	if in.Kind != "parse" {
		kind := "chat"
		if in.Kind == "index" {
			kind = "embedding"
		}
		if _, e := h.rag.Models.Profile(in.ProfileID, kind); e != nil {
			ragError(c, e)
			return
		}
	}
	j, e := h.rag.CreateJob(ctx, c.Param("courseID"), identity.Current(c).ID, in.Kind, in.JobInput)
	result(c, j, e)
}
func (h *Handler) jobs(c *gin.Context) {
	size, e := strconv.Atoi(c.DefaultQuery("size", "60"))
	offset, e2 := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if e != nil || e2 != nil || size < 1 || size > 200 || offset < 0 || offset > 1000000 {
		invalid(c, "任务分页参数无效")
		return
	}
	v, e := h.q.ListProcessingJobPage(c.Request.Context(), store.ListProcessingJobPageParams{CourseID: c.Param("courseID"), Kind: c.Query("kind"), QuestionID: c.Query("question_id"), SubmissionID: c.Query("submission_id"), RubricID: c.Query("rubric_id"), SourceID: c.Query("source_id"), KnowledgeID: c.Query("knowledge_id"), AssetID: c.Query("asset_id"), PageSize: int32(size), PageOffset: int32(offset)})
	result(c, v, e)
}
func (h *Handler) job(c *gin.Context) {
	v, e := h.q.GetProcessingJob(c.Request.Context(), store.GetProcessingJobParams{ID: c.Param("jobID"), CourseID: c.Param("courseID")})
	result(c, v, e)
}
func (h *Handler) cancelJob(c *gin.Context) {
	v, e := h.q.CancelProcessingJob(c.Request.Context(), store.CancelProcessingJobParams{ID: c.Param("jobID"), CourseID: c.Param("courseID")})
	result(c, v, e)
}
func (h *Handler) retryJob(c *gin.Context) {
	old, e := h.q.GetProcessingJob(c.Request.Context(), store.GetProcessingJobParams{ID: c.Param("jobID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if old.State != "failed" {
		invalid(c, "仅失败任务可重试")
		return
	}
	if old.Kind == "diagnosis" || old.Kind == "recommendation" {
		invalid(c, "请回到分析历史重新创建报告，保留原失败记录")
		return
	}
	var in rag.JobInput
	_ = json.Unmarshal(old.Input, &in)
	v, e := h.rag.CreateJob(c.Request.Context(), old.CourseID, identity.Current(c).ID, old.Kind, in)
	result(c, v, e)
}
func (h *Handler) retrievalStatus(c *gin.Context) {
	ctx := c.Request.Context()
	course, e := h.q.GetBusinessCourse(ctx, c.Param("courseID"))
	if !resultIfError(c, e) {
		return
	}
	data := gin.H{"configured": h.rag != nil, "indexed": course.EmbeddingSpaceID.Valid}
	resourceID, sourceID := c.Query("resource_id"), c.Query("source_id")
	if resourceID != "" {
		r, err := h.q.GetBusinessResource(ctx, resourceID)
		if !resultIfError(c, err) || !scope(c, r.CourseID) {
			return
		}
		if r.Status != "published" {
			invalid(c, "仅已发布学习资料可检查检索状态")
			return
		}
	}
	if sourceID != "" {
		if !teacher(c) {
			identity.Fail(c, 403, "forbidden", "原件索引状态仅教师可见")
			return
		}
		_, err := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: sourceID, CourseID: course.ID})
		if !resultIfError(c, err) {
			return
		}
	}
	if resourceID != "" || sourceID != "" {
		counts, err := h.q.ObjectRetrievalStatus(ctx, store.ObjectRetrievalStatusParams{CourseID: course.ID, ResourceID: resourceID, SourceID: sourceID})
		if !resultIfError(c, err) {
			return
		}
		data["object_index"] = counts
	}
	if teacher(c) {
		jobs, err := h.q.ListProcessingJobPage(ctx, store.ListProcessingJobPageParams{CourseID: course.ID, Kind: "index", PageSize: 1})
		if !resultIfError(c, err) {
			return
		}
		if len(jobs) > 0 {
			data["latest_index_job"] = gin.H{"state": jobs[0].State, "error": jobs[0].Error, "created_at": jobs[0].CreatedAt}
		}
	}
	result(c, data, e)
}
func (h *Handler) retrieval(c *gin.Context) {
	var in struct {
		Query      string `json:"query"`
		Purpose    string `json:"purpose"`
		ResourceID string `json:"resource_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Query, 4000) {
		invalid(c, "请输入不超过4000字节的检索内容")
		return
	}
	if in.Purpose == "grading" && !teacher(c) {
		identity.Fail(c, 403, "forbidden", "学生不能检索评分内部依据")
		return
	}
	hits, mode, e := h.scopedSearch(c, in.Query, in.Purpose, in.ResourceID)
	if e != nil {
		ragError(c, e)
		return
	}
	result(c, gin.H{"hits": hits, "mode": mode}, nil)
}

// Used when a teacher explicitly adopts a generated standard or scoring draft.
func (h *Handler) draftJob(c *gin.Context, id, kind string) (store.ProcessingJob, rag.JobInput, error) {
	j, e := h.q.GetProcessingJob(c.Request.Context(), store.GetProcessingJobParams{ID: id, CourseID: c.Param("courseID")})
	var in rag.JobInput
	if e == nil && (j.Kind != kind || j.State != "succeeded") {
		e = errors.New("AI任务尚未成功完成")
	}
	if e == nil {
		e = json.Unmarshal(j.Input, &in)
	}
	return j, in, e
}
