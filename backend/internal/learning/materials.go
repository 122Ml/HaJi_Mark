package learning

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func validateKnowledgeOriginWithQueries(s *rag.Service, ctx context.Context, q *store.Queries, course, origin, kind string, grading bool, refs []rag.Evidence, visible bool) error {
	if origin == "teacher_example" {
		if kind != "example" || grading || len(refs) != 0 {
			return errors.New("教师自编示例只能用于学习，不附学生作答或来源引用，不用于评分")
		}
		return nil
	}
	if origin != "source" {
		return errors.New("知识来源类型无效")
	}
	return s.ValidateEvidenceWithQueries(ctx, q, course, refs, visible)
}

func validateKnowledgeOrigin(s *rag.Service, ctx context.Context, course, origin, kind string, grading bool, refs []rag.Evidence, visible bool) error {
	return validateKnowledgeOriginWithQueries(s, ctx, s.Q, course, origin, kind, grading, refs, visible)
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
	r.GET("/sources/:sourceID/stream", h.streamSource)
	r.GET("/knowledge", h.knowledge)
	t.POST("/knowledge", auth.RequireCSRF(), h.saveKnowledge)
	t.PUT("/knowledge/:knowledgeID", auth.RequireCSRF(), h.saveKnowledge)
	t.POST("/knowledge/:knowledgeID/state", auth.RequireCSRF(), h.knowledgeState)
	t.POST("/jobs", auth.RequireCSRF(), h.createRAGJob)
	t.GET("/jobs", h.jobs)
	t.GET("/jobs/:jobID", h.job)
	t.POST("/jobs/:jobID/cancel", auth.RequireCSRF(), h.cancelJob)
	t.POST("/jobs/:jobID/retry", auth.RequireCSRF(), h.retryJob)
	t.GET("/sources/:sourceID/sections", h.sections)
	t.POST("/sources/:sourceID/sections/adopt", auth.RequireCSRF(), h.adoptSegments)
	t.PUT("/sources/:sourceID/sections/:sectionID", auth.RequireCSRF(), h.updateSection)
	t.POST("/sources/:sourceID/sections/state", auth.RequireCSRF(), h.sectionsState)
	t.POST("/sources/:sourceID/sections/publish", auth.RequireCSRF(), h.sectionsPublish)
	t.GET("/knowledge-points/:pointID/clips", h.pointClips)
	g.POST("/retrieval", auth.RequireCSRF(), h.retrieval)
	g.GET("/retrieval/status", h.retrievalStatus)
}

func isUserValidationError(e error) bool {
	if e == nil {
		return false
	}
	var pgErr *pgconn.PgError
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	var netErr *net.OpError
	var urlErr *url.Error
	var pathErr *os.PathError
	if errors.As(e, &pgErr) || errors.As(e, &syntaxErr) || errors.As(e, &typeErr) ||
		errors.As(e, &netErr) || errors.As(e, &urlErr) || errors.As(e, &pathErr) ||
		errors.Is(e, pgx.ErrNoRows) || errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
		return false
	}
	msg := e.Error()
	if msg == "" || len(msg) > 500 || strings.ContainsAny(msg, "\r\n") {
		return false
	}
	for _, noise := range []string{"SQLSTATE", "ERROR:", "pq:", "pgx", "dial tcp", "EOF", "panic", "runtime error"} {
		if strings.Contains(msg, noise) {
			return false
		}
	}
	for _, r := range msg {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func ragError(c *gin.Context, e error) {
	if e == nil {
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(e, &pgErr) {
		log.Printf("rag db error (%s): %v", pgErr.Code, e)
		result(c, nil, e)
		return
	}
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 404, "not_found", "记录不存在或状态已改变")
		return
	}
	if errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
		log.Printf("rag context error: %v", e)
		identity.Fail(c, 503, "service_unavailable", "请求超时或已取消，请稍后重试")
		return
	}
	if isUserValidationError(e) {
		identity.Fail(c, 422, "rag_error", e.Error())
		return
	}
	log.Printf("internal rag error: %v", e)
	identity.Fail(c, 503, "service_unavailable", "服务暂时不可用，请稍后重试")
}

func setAttachmentDisposition(c *gin.Context, filename string) {
	base := filepath.Base(strings.TrimSpace(filename))
	base = strings.NewReplacer("\r", "", "\n", "", "\x00", "", "\"", "").Replace(base)
	if base == "" || base == "." || base == "/" || base == "\\" {
		base = "download"
	}
	ext := strings.ToLower(filepath.Ext(base))
	asciiFallback := "download" + ext
	c.Header("Content-Disposition", `attachment; filename="`+asciiFallback+`"; filename*=UTF-8''`+url.PathEscape(base))
}

func (h *Handler) models(c *gin.Context) {
	budget, e := h.q.GetModelBudget(c.Request.Context())
	if e != nil {
		result(c, nil, e)
		return
	}
	calls, e := h.q.ListCourseModelCalls(c.Request.Context(), c.Param("courseID"))
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
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 404, "not_found", "原文片段不存在")
				return
			}
			result(c, nil, e)
			return
		}
		if f.SourceID != src.ID {
			identity.Fail(c, 404, "not_found", "原文片段不存在")
			return
		}
		revision = f.Revision
	}
	fs, e := h.q.ListMaterialFragments(c.Request.Context(), store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: revision})
	result(c, gin.H{"source": src, "fragments": fs, "display_revision": revision}, e)
}

var videoMIMETypes = map[string]string{
	".mp4":  "video/mp4",
	".mov":  "video/quicktime",
	".mkv":  "video/x-matroska",
	".webm": "video/webm",
	".m4v":  "video/mp4",
}

func validVideoMagic(ext string, head []byte) bool {
	switch ext {
	case ".mp4", ".m4v":
		return len(head) >= 8 && string(head[4:8]) == "ftyp"
	case ".mov":
		if len(head) < 8 {
			return false
		}
		switch string(head[4:8]) {
		case "ftyp", "moov", "mdat", "wide", "free", "skip", "pnot":
			return true
		}
		return false
	case ".mkv", ".webm":
		return len(head) >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3
	}
	return false
}

func videoContentType(mediaType, filename string) string {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	if ct, ok := videoMIMETypes[ext]; ok {
		return ct
	}
	mt := strings.ToLower(strings.TrimSpace(mediaType))
	if semi := strings.IndexByte(mt, ';'); semi >= 0 {
		mt = strings.TrimSpace(mt[:semi])
	}
	switch mt {
	case "video/mp4", "video/quicktime", "video/x-matroska", "video/webm":
		return mt
	}
	return "video/mp4"
}

func (h *Handler) uploadSources(c *gin.Context) {
	_ = http.NewResponseController(c.Writer).SetReadDeadline(time.Now().Add(15 * time.Minute))
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 520<<20)
	mr, e := c.Request.MultipartReader()
	if e != nil {
		invalid(c, "请求须为 multipart/form-data（文档每个30MiB最多10个，视频每个512MiB仅限1个）")
		return
	}
	docMIME := map[string]string{
		".pdf":  "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".txt":  "text/plain; charset=utf-8",
		".md":   "text/markdown; charset=utf-8",
		".html": "text/html; charset=utf-8",
		".htm":  "text/html; charset=utf-8",
		".csv":  "text/csv; charset=utf-8",
	}
	base := rag.MaterialsDir()
	if e := os.MkdirAll(base, 0700); e != nil {
		result(c, nil, e)
		return
	}
	type stagedFile struct {
		id           string
		name         string
		path         string
		sha256       string
		size         int64
		ext          string
		baseFilename string
		title        string
		mediaType    string
	}
	staged := make([]stagedFile, 0, 10)
	hasVideo := false
	committed := false
	defer func() {
		if committed {
			return
		}
		for _, item := range staged {
			_ = os.Remove(item.path)
		}
	}()
	formValues := map[string]string{}
	var batchBytes int64
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				identity.Fail(c, http.StatusRequestEntityTooLarge, "payload_too_large", "上传总大小超出限制（上限520MiB）")
				return
			}
			invalid(c, "上传内容格式无效或连接中断")
			return
		}
		fieldName := part.FormName()
		rawFilename := part.FileName()
		if rawFilename == "" {
			switch fieldName {
			case "source_note", "supersedes_id", "title", "allow_derived":
			default:
				_, _ = io.Copy(io.Discard, io.LimitReader(part, 65536))
				_ = part.Close()
				continue
			}
			valBytes, readErr := io.ReadAll(io.LimitReader(part, 8193))
			_ = part.Close()
			if readErr != nil {
				invalid(c, "读取表单字段失败")
				return
			}
			if len(valBytes) > 8192 {
				invalid(c, "表单字段内容过长")
				return
			}
			if _, exists := formValues[fieldName]; !exists {
				formValues[fieldName] = string(valBytes)
			}
			continue
		}
		if fieldName != "files" {
			_ = part.Close()
			continue
		}
		ext := strings.ToLower(filepath.Ext(rawFilename))
		mimeType := docMIME[ext]
		isVideo := false
		maxFileBytes := int64(30 << 20)
		if mimeType == "" {
			mimeType = videoMIMETypes[ext]
			if mimeType == "" {
				_ = part.Close()
				invalid(c, "文件类型不支持")
				return
			}
			isVideo = true
			maxFileBytes = 512 << 20
		}
		if isVideo && len(staged) > 0 {
			_ = part.Close()
			if hasVideo {
				invalid(c, "每次只能上传1个视频文件")
			} else {
				invalid(c, "视频不能与文档在同一批次混合上传")
			}
			return
		}
		if !isVideo && hasVideo {
			_ = part.Close()
			invalid(c, "视频不能与文档在同一批次混合上传")
			return
		}
		if !isVideo && len(staged) >= 10 {
			_ = part.Close()
			invalid(c, "每次请选择1到10个文件")
			return
		}
		var srcReader io.Reader = part
		if isVideo {
			buf := make([]byte, 512)
			hn, readErr := io.ReadFull(part, buf)
			if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
				_ = part.Close()
				var maxErr *http.MaxBytesError
				if errors.As(readErr, &maxErr) {
					identity.Fail(c, http.StatusRequestEntityTooLarge, "payload_too_large", "上传总大小超出限制（上限520MiB）")
					return
				}
				invalid(c, "读取上传视频失败")
				return
			}
			head := buf[:hn]
			if !validVideoMagic(ext, head) {
				_ = part.Close()
				invalid(c, "视频文件头无效或与扩展名不匹配")
				return
			}
			srcReader = io.MultiReader(bytes.NewReader(head), part)
		}
		id := uuid.NewString()
		name := id + ext
		path := filepath.Join(base, name)
		out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			_ = part.Close()
			result(c, nil, err)
			return
		}
		staged = append(staged, stagedFile{id: id, name: name, path: path, ext: ext, baseFilename: strings.ReplaceAll(filepath.Base(strings.ReplaceAll(rawFilename, `\`, `/`)), "\x00", "")})
		if isVideo {
			hasVideo = true
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(out, hash), io.LimitReader(srcReader, maxFileBytes+1))
		_ = part.Close()
		closeErr := out.Close()
		if copyErr != nil {
			var maxErr *http.MaxBytesError
			if errors.As(copyErr, &maxErr) {
				identity.Fail(c, http.StatusRequestEntityTooLarge, "payload_too_large", "上传总大小超出限制（上限520MiB）")
				return
			}
			result(c, nil, copyErr)
			return
		}
		if closeErr != nil {
			result(c, nil, closeErr)
			return
		}
		if n < 1 || n > maxFileBytes {
			if isVideo {
				invalid(c, "视频文件为空或超过512MiB")
			} else {
				invalid(c, "文件为空或超过30MiB")
			}
			return
		}
		batchBytes += n
		last := &staged[len(staged)-1]
		last.size = n
		last.sha256 = hex.EncodeToString(hash.Sum(nil))
		last.mediaType = mimeType
	}
	if len(staged) < 1 || len(staged) > 10 {
		invalid(c, "每次请选择1到10个文件")
		return
	}
	note := strings.TrimSpace(formValues["source_note"])
	if !validText(note, 1000) {
		invalid(c, "请登记资料来源")
		return
	}
	supersedes := strings.TrimSpace(formValues["supersedes_id"])
	if supersedes != "" && len(staged) != 1 {
		invalid(c, "替换原件时一次只能上传一个文件")
		return
	}
	seenHashes := map[string]bool{}
	rawFormTitle := strings.TrimSpace(formValues["title"])
	for i := range staged {
		if supersedes == "" {
			if seenHashes[staged[i].sha256] {
				identity.Fail(c, 409, "duplicate_source", "同一批次包含重复文件内容")
				return
			}
			seenHashes[staged[i].sha256] = true
		}
		title := rawFormTitle
		if title == "" || len(staged) > 1 {
			title = strings.TrimSpace(staged[i].baseFilename)
		}
		title = strings.ReplaceAll(title, "\x00", "")
		if title == "" || title == "." || title == ".." {
			title = staged[i].id + staged[i].ext
		}
		if len(title) > 500 {
			title = string([]rune(title)[:100])
		}
		staged[i].title = title
	}
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	actorID := identity.Current(c).ID
	allowDerived := formValues["allow_derived"] == "true"
	if supersedes == "" {
		for _, item := range staged {
			old, err := h.q.SourceDuplicate(ctx, store.SourceDuplicateParams{CourseID: courseID, Sha256: item.sha256})
			if err == nil {
				identity.Fail(c, 409, "duplicate_source", "内容已导入，请复用原件："+old.Title)
				return
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				result(c, nil, err)
				return
			}
		}
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e := q.LockBusinessCourse(ctx, courseID); e != nil {
		result(c, nil, e)
		return
	}
	existingSources, e := q.ListMaterialSources(ctx, courseID)
	if e != nil {
		result(c, nil, e)
		return
	}
	var usedBytes int64
	for _, s := range existingSources {
		if s.State != "active" {
			continue
		}
		if sp, err := rag.SafeMaterialPath(s.StoragePath); err == nil {
			if st, err := os.Stat(sp); err == nil && !st.IsDir() {
				usedBytes += st.Size()
			}
		}
	}
	if usedBytes+batchBytes > 2<<30 {
		identity.Fail(c, http.StatusRequestEntityTooLarge, "quota_exceeded", "课程有效原件存储空间已达2GiB上限，请归档旧资料后重试")
		return
	}
	version := int32(1)
	if supersedes != "" {
		old, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: supersedes, CourseID: courseID})
		if e != nil {
			result(c, nil, e)
			return
		}
		if old.State != "active" {
			identity.Fail(c, 409, "state_conflict", "只能替换尚未归档的活跃原件")
			return
		}
		version = old.Version + 1
	}
	jobs := make([]store.ProcessingJob, 0, len(staged))
	for _, item := range staged {
		if supersedes == "" {
			old, err := q.SourceDuplicate(ctx, store.SourceDuplicateParams{CourseID: courseID, Sha256: item.sha256})
			if err == nil {
				identity.Fail(c, 409, "duplicate_source", "内容已导入，请复用原件："+old.Title)
				return
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				result(c, nil, err)
				return
			}
		}
		src, e := q.CreateMaterialSource(ctx, store.CreateMaterialSourceParams{
			ID:           item.id,
			CourseID:     courseID,
			CreatedBy:    actorID,
			Title:        item.title,
			Filename:     item.baseFilename,
			MediaType:    item.mediaType,
			StoragePath:  item.name,
			SourceNote:   note,
			Sha256:       item.sha256,
			AllowDerived: allowDerived,
			Version:      version,
			SupersedesID: text(supersedes),
		})
		if e != nil {
			result(c, nil, e)
			return
		}
		jobInput, _ := json.Marshal(rag.JobInput{SourceID: item.id})
		j, e := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{
			ID:        uuid.NewString(),
			CourseID:  src.CourseID,
			CreatedBy: actorID,
			Kind:      "parse",
			Input:     jobInput,
		})
		if e != nil {
			result(c, nil, e)
			return
		}
		jobs = append(jobs, j)
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	committed = true
	for _, j := range jobs {
		h.rag.Enqueue(j.ID)
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
		if e != nil {
			result(c, nil, e)
			return
		}
		if !allowed {
			identity.Fail(c, 403, "forbidden", "当前资料只发布了选中片段，完整原件不可下载")
			return
		}
	}
	path, e := rag.SafeMaterialPath(src.StoragePath)
	if e != nil {
		identity.Fail(c, 404, "not_found", "原始文件不存在")
		return
	}
	info, e := os.Stat(path)
	if e != nil || info.IsDir() {
		identity.Fail(c, 404, "not_found", "原始文件不存在")
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'")
	if rag.IsVideoSource(src.MediaType, src.Filename) {
		c.Header("Content-Type", videoContentType(src.MediaType, src.Filename))
	}
	setAttachmentDisposition(c, src.Filename)
	c.File(path)
}
func (h *Handler) streamSource(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	if !rag.IsVideoSource(src.MediaType, src.Filename) {
		invalid(c, "仅视频原件支持在线流式播放")
		return
	}
	if !teacher(c) {
		allowed, e := h.q.StudentCanStreamVideoSource(c.Request.Context(), store.StudentCanStreamVideoSourceParams{ID: src.ID, CourseID: src.CourseID})
		if e != nil {
			result(c, nil, e)
			return
		}
		if !allowed {
			identity.Fail(c, 403, "forbidden", "该视频尚未发布给学生")
			return
		}
	}
	path, e := rag.SafeMaterialPath(src.StoragePath)
	if e != nil {
		identity.Fail(c, 404, "not_found", "原始文件不存在")
		return
	}
	info, e := os.Stat(path)
	if e != nil || info.IsDir() {
		identity.Fail(c, 404, "not_found", "原始文件不存在")
		return
	}
	c.Header("Content-Type", videoContentType(src.MediaType, src.Filename))
	c.Header("Content-Disposition", "inline")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=3600")
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Now().Add(15 * time.Minute))
	c.File(path)
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
	const insertFragSQL = `INSERT INTO material_fragments(id,source_id,revision,position,heading,body,locator,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`
	fragMap := make(map[string]string, len(in.Fragments))
	batch := &pgx.Batch{}
	nextRevision := src.ParseRevision + 1
	for i, f := range in.Fragments {
		if old[i].ID != f.ID || len(f.Heading) > 500 || strings.ContainsRune(f.Heading, '\x00') || !validText(f.Body, 500000) || (f.Quality != "ready" && f.Quality != "needs_review") {
			invalid(c, "片段顺序、标题、正文或核对状态无效")
			return
		}
		newID := uuid.NewString()
		batch.Queue(insertFragSQL, newID, src.ID, nextRevision, int32(i), f.Heading, f.Body, old[i].Locator, f.Quality)
		fragMap[old[i].ID] = newID
	}
	if e = execBatch(ctx, tx, batch); e != nil {
		result(c, nil, e)
		return
	}
	if e = carryForwardContentSections(ctx, q, src.CourseID, src.ID, src.ParseRevision, src.ParseRevision+1, fragMap); e != nil {
		result(c, nil, e)
		return
	}
	v, e := q.UpdateSourceParse(ctx, store.UpdateSourceParseParams{ID: src.ID, CourseID: src.CourseID, ParseState: "ready", ParseRevision: src.ParseRevision + 1})
	if e != nil {
		result(c, nil, e)
		return
	}
	jobID, e := rag.QueueIndexID(ctx, q, src.CourseID, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	h.enqueueIndex(jobID)
	result(c, v, nil)
}
func (h *Handler) publishFragments(c *gin.Context) {
	var in struct {
		Title            string   `json:"title"`
		FragmentIDs      []string `json:"fragment_ids"`
		FullSource       bool     `json:"full_source"`
		KnowledgePointID string   `json:"knowledge_point_id"`
		ParseRevision    int32    `json:"parse_revision"`
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
	if in.ParseRevision > 0 && in.ParseRevision != src.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "原文版本已改变，请刷新后选择片段发布")
		return
	}
	if src.State != "active" || src.ParseState != "ready" || len(in.FragmentIDs) == 0 || !validText(in.Title, 500) {
		invalid(c, "请填写标题并选择已核对片段")
		return
	}
	if e := h.rag.ValidateLinksWithQueries(ctx, q, src.CourseID, filterID(in.KnowledgePointID), nil, ""); e != nil {
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
	var content strings.Builder
	locators := make([]json.RawMessage, 0, len(in.FragmentIDs))
	for _, f := range fs {
		if selected[f.ID] {
			if f.Quality != "ready" {
				invalid(c, "OCR或异常片段须先人工核对")
				return
			}
			if content.Len()+len(f.Heading)+len(f.Body)+3 > 200000 {
				invalid(c, "片段版本无效、内容过长，或尚未选择全部原文")
				return
			}
			content.WriteString(f.Heading)
			content.WriteByte('\n')
			content.WriteString(f.Body)
			content.WriteString("\n\n")
			locators = append(locators, f.Locator)
			delete(selected, f.ID)
		}
	}
	if len(selected) > 0 || (in.FullSource && len(in.FragmentIDs) != len(fs)) {
		invalid(c, "片段版本无效、内容过长，或尚未选择全部原文")
		return
	}
	loc, _ := json.Marshal(locators)
	r, e := q.CreateBusinessResource(ctx, store.CreateBusinessResourceParams{ID: uuid.NewString(), CourseID: src.CourseID, CreatedBy: identity.Current(c).ID, Title: in.Title, Content: content.String(), SourceUrl: src.SourceUrl, SourceNote: src.SourceNote, Locator: src.Filename + " " + string(loc), KnowledgePointID: text(in.KnowledgePointID)})
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
	jobID, e := rag.QueueIndexID(ctx, q, src.CourseID, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	if jobID != "" && h.rag != nil {
		h.rag.Enqueue(jobID)
	}
	result(c, r, nil)
}
func filterID(s string) []string {
	if s == "" {
		return []string{}
	}
	return []string{s}
}
func (h *Handler) archiveSource(c *gin.Context) {
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	sourceID := c.Param("sourceID")
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: sourceID, CourseID: courseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = q.ArchiveMaterialSource(ctx, store.ArchiveMaterialSourceParams{ID: src.ID, CourseID: src.CourseID}); e != nil {
		result(c, nil, e)
		return
	}
	jobID, e := rag.QueueIndexID(ctx, q, src.CourseID, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	h.enqueueIndex(jobID)
	result(c, gin.H{"state": "archived"}, nil)
}
func (h *Handler) sourceDerivation(c *gin.Context) {
	var in struct {
		Allow bool `json:"allow_derived"`
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
	if src.State != "active" {
		identity.Fail(c, 409, "state_conflict", "原件已归档，不可更改提炼许可")
		return
	}
	v, e := q.SetSourceDerivation(ctx, store.SetSourceDerivationParams{ID: src.ID, CourseID: src.CourseID, AllowDerived: in.Allow})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}
func (h *Handler) knowledge(c *gin.Context) {
	v, e := h.q.ListKnowledgeEntries(c.Request.Context(), store.ListKnowledgeEntriesParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	if e == nil {
		v = filterByID(v, strings.TrimSpace(c.Query("id")), func(k store.KnowledgeEntry) string { return k.ID })
	}
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
	if !validText(in.Title, 500) || !validText(in.Body, 60000) || !rag.ValidContentKind(in.ContentKind) ||
		len(in.Category) > 200 || strings.ContainsRune(in.Category, '\x00') ||
		len(in.Conditions) > 10000 || strings.ContainsRune(in.Conditions, '\x00') ||
		len(in.Evidence) > 30 || len(in.KnowledgePointIDs) > 100 || len(in.RelatedIDs) > 30 {
		invalid(c, "知识标题、正文、类型或关联字段无效")
		return
	}
	if in.Origin == "" {
		in.Origin = "source"
	}
	if in.Evidence == nil {
		in.Evidence = []rag.Evidence{}
	}
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	editID := c.Param("knowledgeID")
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	version := int32(1)
	if editID != "" {
		old, e := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: editID, CourseID: courseID})
		if e != nil {
			result(c, nil, e)
			return
		}
		if old.Origin != in.Origin {
			invalid(c, "知识来源类型不能通过编辑或修订改变")
			return
		}
		if old.State != "draft" || old.EditVersion != in.EditVersion {
			identity.Fail(c, 409, "stale_revision", "知识已被修改或状态已改变，请刷新")
			return
		}
	} else if in.SupersedesID != "" {
		old, e := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: in.SupersedesID, CourseID: courseID})
		if e != nil {
			result(c, nil, e)
			return
		}
		if old.Origin != in.Origin {
			invalid(c, "知识来源类型不能通过编辑或修订改变")
			return
		}
		if old.State == "draft" {
			invalid(c, "草稿请直接修改")
			return
		}
		version = old.Version + 1
	}
	if e := validateKnowledgeOriginWithQueries(h.rag, ctx, q, courseID, in.Origin, in.ContentKind, in.UseForGrading, in.Evidence, in.StudentVisible); e != nil {
		ragError(c, e)
		return
	}
	if e := h.rag.ValidateLinksWithQueries(ctx, q, courseID, in.KnowledgePointIDs, in.RelatedIDs, editID); e != nil {
		ragError(c, e)
		return
	}
	refs, _ := json.Marshal(in.Evidence)
	if editID != "" {
		v, e := q.EditKnowledgeEntry(ctx, store.EditKnowledgeEntryParams{
			ID:                editID,
			CourseID:          courseID,
			Title:             in.Title,
			Body:              in.Body,
			Category:          in.Category,
			ContentKind:       in.ContentKind,
			Conditions:        in.Conditions,
			KnowledgePointIds: nonNilStrings(in.KnowledgePointIDs),
			RelatedIds:        nonNilStrings(in.RelatedIDs),
			Evidence:          refs,
			StudentVisible:    in.StudentVisible,
			UseForLearning:    in.UseForLearning,
			UseForGrading:     in.UseForGrading,
			EditVersion:       in.EditVersion,
		})
		if errors.Is(e, pgx.ErrNoRows) {
			identity.Fail(c, 409, "stale_revision", "知识已被修改，请刷新")
			return
		}
		if e != nil {
			result(c, nil, e)
			return
		}
		jobID, e := rag.QueueIndexID(ctx, q, courseID, identity.Current(c).ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if e = tx.Commit(ctx); e != nil {
			result(c, nil, e)
			return
		}
		if jobID != "" && h.rag != nil {
			h.rag.Enqueue(jobID)
		}
		result(c, v, nil)
		return
	}
	v, e := q.CreateKnowledgeEntry(ctx, store.CreateKnowledgeEntryParams{
		ID:                uuid.NewString(),
		CourseID:          courseID,
		CreatedBy:         identity.Current(c).ID,
		Title:             in.Title,
		Body:              in.Body,
		Category:          in.Category,
		ContentKind:       in.ContentKind,
		Conditions:        in.Conditions,
		KnowledgePointIds: nonNilStrings(in.KnowledgePointIDs),
		RelatedIds:        nonNilStrings(in.RelatedIDs),
		Evidence:          refs,
		StudentVisible:    in.StudentVisible,
		UseForLearning:    in.UseForLearning,
		UseForGrading:     in.UseForGrading,
		Version:           version,
		SupersedesID:      text(in.SupersedesID),
		Origin:            in.Origin,
	})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
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
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	k, e := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: c.Param("knowledgeID"), CourseID: c.Param("courseID")})
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
		if err := json.Unmarshal(k.Evidence, &refs); err != nil {
			result(c, nil, err)
			return
		}
		if e = validateKnowledgeOriginWithQueries(h.rag, ctx, q, k.CourseID, k.Origin, k.ContentKind, k.UseForGrading, refs, k.StudentVisible); e != nil {
			ragError(c, e)
			return
		}
	} else if in.State != "archived" || k.State == "archived" {
		invalid(c, "只允许确认草稿或归档条目")
		return
	}
	v, e := q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: k.ID, CourseID: k.CourseID, State: in.State, State_2: k.State, EditVersion: in.EditVersion})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "stale_revision", "知识已被修改，请刷新并重新审核")
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	if in.State == "confirmed" && k.State == "draft" && k.SupersedesID.Valid && k.SupersedesID.String != "" {
		prev, err := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: k.SupersedesID.String, CourseID: k.CourseID})
		if err == nil && prev.State == "confirmed" {
			if _, err = q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: prev.ID, CourseID: prev.CourseID, State: "archived", State_2: "confirmed", EditVersion: prev.EditVersion}); err != nil {
				result(c, nil, err)
				return
			}
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			result(c, nil, err)
			return
		}
	}
	jobID, e := rag.QueueIndexID(ctx, q, k.CourseID, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	h.enqueueIndex(jobID)
	result(c, v, nil)
}
func (h *Handler) createLockedParseJob(c *gin.Context, courseID, sourceID string, jobInput rag.JobInput, archivedMsg string) {
	ctx := c.Request.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		result(c, nil, err)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, err := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: sourceID, CourseID: courseID})
	if err != nil {
		result(c, nil, err)
		return
	}
	if src.State != "active" {
		invalid(c, archivedMsg)
		return
	}
	activeParse, err := q.HasActiveParseJob(ctx, store.HasActiveParseJobParams{CourseID: src.CourseID, SourceID: src.ID})
	if err != nil {
		result(c, nil, err)
		return
	}
	if activeParse {
		identity.Fail(c, 409, "state_conflict", "此原件已有排队或运行中的解析任务")
		return
	}
	raw, _ := json.Marshal(jobInput)
	job, err := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{
		ID:        uuid.NewString(),
		CourseID:  src.CourseID,
		CreatedBy: identity.Current(c).ID,
		Kind:      "parse",
		Input:     raw,
	})
	if err != nil {
		result(c, nil, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		result(c, nil, err)
		return
	}
	if h.rag != nil {
		h.rag.Enqueue(job.ID)
	}
	result(c, job, nil)
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
	if in.Kind == "source_suggest" || in.Kind == "source_segment" || in.Kind == "knowledge_compare" || in.Kind == "paper_split" || in.Kind == "vision" {
		h.createWorkflowJob(c, in.Kind, in.JobInput)
		return
	}
	if in.Kind == "parse" {
		h.createLockedParseJob(c, c.Param("courseID"), in.SourceID, in.JobInput, "原件已归档")
		return
	}
	if in.Kind == "extract" {
		src, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: in.SourceID, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		if src.State != "active" {
			invalid(c, "原件已归档")
			return
		}
		if !src.AllowDerived || src.ParseState != "ready" || len(in.FragmentIDs) == 0 || len(in.FragmentIDs) > 200 {
			invalid(c, "须先完成解析、允许提炼并选择1至200个已核对片段")
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
		managed, e := h.q.GradingManagedByRegrade(ctx, q.ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if managed {
			identity.Fail(c, 409, "state_conflict", "本题已由整组重评管理，请在重评批次中生成AI评分草稿")
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
	if e != nil && isUserValidationError(e) {
		identity.Fail(c, 409, "state_conflict", e.Error())
		return
	}
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
	ctx := c.Request.Context()
	jobID, courseID := c.Param("jobID"), c.Param("courseID")
	v, e := h.q.CancelProcessingJob(ctx, store.CancelProcessingJobParams{ID: jobID, CourseID: courseID})
	if errors.Is(e, pgx.ErrNoRows) {
		if _, getErr := h.q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: jobID, CourseID: courseID}); errors.Is(getErr, pgx.ErrNoRows) {
			identity.Fail(c, 404, "not_found", "任务不存在")
			return
		} else if getErr != nil {
			result(c, nil, getErr)
			return
		}
		identity.Fail(c, 409, "state_conflict", "任务已结束或无法取消")
		return
	}
	result(c, v, e)
}
func (h *Handler) retryJob(c *gin.Context) {
	ctx := c.Request.Context()
	old, e := h.q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: c.Param("jobID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if old.State != "failed" && old.State != "canceled" {
		invalid(c, "仅失败或已取消的任务可重试")
		return
	}
	if old.Kind == "diagnosis" || old.Kind == "recommendation" {
		invalid(c, "请回到分析历史重新创建报告，保留原失败记录")
		return
	}
	var in rag.JobInput
	if err := json.Unmarshal(old.Input, &in); err != nil {
		invalid(c, "原任务参数损坏，无法重试")
		return
	}
	if old.Kind == "parse" {
		h.createLockedParseJob(c, old.CourseID, in.SourceID, in, "原件已归档，无法重试")
		return
	}
	switch old.Kind {
	case "extract", "source_suggest", "source_segment", "paper_split":
		src, err := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: in.SourceID, CourseID: old.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		if src.State != "active" {
			invalid(c, "原件已归档，无法重试")
			return
		}
		if old.Kind == "extract" && (!src.AllowDerived || src.ParseState != "ready" || len(in.FragmentIDs) == 0) {
			invalid(c, "来源未就绪或未允许知识提炼")
			return
		}
		if (old.Kind == "source_suggest" || old.Kind == "source_segment" || old.Kind == "paper_split") && src.ParseState != "ready" {
			invalid(c, "来源尚未解析完成")
			return
		}
		if old.Kind == "paper_split" && rag.IsVideoSource(src.MediaType, src.Filename) {
			invalid(c, "视频资料不支持试卷拆题")
			return
		}
		if (old.Kind == "extract" || old.Kind == "source_suggest" || old.Kind == "source_segment" || old.Kind == "paper_split") && in.ParseRevision != 0 && src.ParseRevision != in.ParseRevision {
			identity.Fail(c, 409, "stale_revision", "来源版本已改变，请重新发起任务")
			return
		}
		if old.Kind == "extract" {
			fs, err := h.q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
			if err != nil {
				result(c, nil, err)
				return
			}
			activeFrags := make(map[string]bool, len(fs))
			for _, f := range fs {
				activeFrags[f.ID] = true
			}
			for _, fid := range in.FragmentIDs {
				if !activeFrags[fid] {
					identity.Fail(c, 409, "stale_revision", "来源片段版本已更新，请重新选择片段提炼")
					return
				}
			}
		}
	case "rubric":
		question, ok := h.rubricQuestion(c, in.QuestionID)
		if !ok {
			return
		}
		if question.BankQuestionVersionID.Valid {
			invalid(c, "请在题库为该版本起草标准")
			return
		}
	case "grade":
		s, ok := h.submissionRecord(c, in.SubmissionID)
		if !ok {
			return
		}
		r, err := h.q.GetRubricVersion(ctx, in.RubricID)
		if err != nil {
			result(c, nil, err)
			return
		}
		q, err := h.q.GetBusinessQuestion(ctx, s.QuestionID)
		if err != nil {
			result(c, nil, err)
			return
		}
		if !rubricMatches(q, r) {
			invalid(c, "评分标准已改变，请重新发起判分任务")
			return
		}
		managed, err := h.q.GradingManagedByRegrade(ctx, q.ID)
		if err != nil {
			result(c, nil, err)
			return
		}
		if managed {
			identity.Fail(c, 409, "state_conflict", "本题已由整组重评管理，请在重评批次中生成AI评分草稿")
			return
		}
	case "vision":
		a, err := h.q.GetMaterialAsset(ctx, store.GetMaterialAssetParams{ID: in.AssetID, CourseID: old.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		src, err := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: a.SourceID, CourseID: old.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		if src.State != "active" {
			invalid(c, "原件已归档，无法识别图像")
			return
		}
	case "knowledge_compare":
		k, err := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: in.KnowledgeID, CourseID: old.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		if k.State != "draft" || k.Origin == "teacher_example" {
			invalid(c, "知识条目状态已改变或不支持比较")
			return
		}
		if in.EditVersion != 0 && k.EditVersion != in.EditVersion {
			identity.Fail(c, 409, "stale_revision", "知识条目已修订，请重新发起比较")
			return
		}
	}
	if old.Kind != "parse" {
		profileKind := "chat"
		if old.Kind == "index" {
			profileKind = "embedding"
		} else if old.Kind == "vision" {
			profileKind = "vision"
		}
		if _, err := h.rag.Models.Profile(in.ProfileID, profileKind); err != nil {
			ragError(c, err)
			return
		}
	}
	v, e := h.rag.CreateJob(ctx, old.CourseID, identity.Current(c).ID, old.Kind, in)
	if e != nil {
		if isUserValidationError(e) {
			identity.Fail(c, 409, "state_conflict", e.Error())
			return
		}
		result(c, nil, e)
		return
	}
	h.rag.Enqueue(v.ID)
	result(c, v, nil)
}
func (h *Handler) retrievalStatus(c *gin.Context) {
	ctx := c.Request.Context()
	course, e := h.q.GetBusinessCourse(ctx, c.Param("courseID"))
	if !resultIfError(c, e) {
		return
	}
	data := gin.H{"configured": h.rag != nil, "indexed": course.EmbeddingSpaceID.Valid}
	resourceID, sourceID := c.Query("resource_id"), c.Query("source_id")
	if resourceID != "" && sourceID != "" {
		invalid(c, "resource_id 与 source_id 不能同时指定")
		return
	}
	if resourceID != "" {
		r, err := h.q.GetBusinessResource(ctx, resourceID)
		if !resultIfError(c, err) || !scope(c, r.CourseID) {
			return
		}
		if r.Status != "published" {
			if !teacher(c) {
				identity.Fail(c, 403, "forbidden", "资料尚未发布")
				return
			}
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
	result(c, data, nil)
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
	purpose := strings.TrimSpace(in.Purpose)
	if purpose == "" {
		purpose = "learning"
	}
	switch purpose {
	case "learning", "qa", "study", "search":
		// All learning-only purposes map cleanly to learning retrieval scope.
		purpose = "learning"
	case "grading", "comparison", "rubric", "question", "intelligence":
		if !teacher(c) {
			identity.Fail(c, 403, "forbidden", "当前角色无权使用该检索用途")
			return
		}
	default:
		invalid(c, "检索用途无效")
		return
	}
	hits, mode, e := h.scopedSearch(c, in.Query, purpose, in.ResourceID)
	if e != nil {
		ragError(c, e)
		return
	}
	result(c, gin.H{"hits": hits, "mode": mode}, nil)
}

// Used when a teacher explicitly adopts a generated standard or scoring draft.
func (h *Handler) draftJobWithQueries(ctx context.Context, q *store.Queries, courseID, id, kind string) (store.ProcessingJob, rag.JobInput, error) {
	j, e := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: id, CourseID: courseID})
	var in rag.JobInput
	if errors.Is(e, pgx.ErrNoRows) {
		return j, in, errors.New("AI任务不存在或不属于当前课程")
	}
	if e != nil {
		return j, in, e
	}
	if j.Kind != kind || j.State != "succeeded" {
		return j, in, errors.New("AI任务尚未成功完成")
	}
	if err := json.Unmarshal(j.Input, &in); err != nil {
		return j, in, err
	}
	return j, in, nil
}

func (h *Handler) draftJob(c *gin.Context, id, kind string) (store.ProcessingJob, rag.JobInput, error) {
	return h.draftJobWithQueries(c.Request.Context(), h.q, c.Param("courseID"), id, kind)
}
