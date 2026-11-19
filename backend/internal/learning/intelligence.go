package learning

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	errNoDiagnosisAnswers      = errors.New("本题、本标准下尚无正式失分作答可分析")
	errTooManyDiagnosisAnswers = errors.New("本次最多分析40份失分作答，请按题目及标准缩小范围")
	errNoStudyPath             = errors.New("请先生成规则学习路径")
	errNoRecommendCandidates   = errors.New("当前规则路径没有尚待学习的可见候选")
	errTooManyRecommendCands   = errors.New("规则候选超过40条，请先完成部分路径学习再排序")
)

func (h *Handler) registerIntelligence(g *gin.RouterGroup, a *identity.Handler) {
	g.GET("/intelligence", h.intelligenceList)
	g.POST("/intelligence", a.RequireCSRF(), h.intelligenceCreate)
	g.GET("/intelligence/:reportID", h.intelligenceRead)
	g.PUT("/intelligence/:reportID", identity.RequireRole("teacher"), a.RequireCSRF(), h.diagnosisEdit(false))
	g.POST("/intelligence/:reportID/confirm", identity.RequireRole("teacher"), a.RequireCSRF(), h.diagnosisEdit(true))
	g.PUT("/intelligence/:reportID/choice", identity.RequireRole("student"), a.RequireCSRF(), h.recommendationChoice)
	g.POST("/intelligence/:reportID/cancel", a.RequireCSRF(), h.intelligenceCancel)
	g.GET("/diagnosis-labels", identity.RequireRole("teacher"), h.diagnosisLabels)
	g.POST("/diagnosis-labels", identity.RequireRole("teacher"), a.RequireCSRF(), h.diagnosisLabelSave)
	g.PUT("/diagnosis-labels/:labelID", identity.RequireRole("teacher"), a.RequireCSRF(), h.diagnosisLabelSave)
}
func (h *Handler) intelligenceList(c *gin.Context) {
	kind := c.DefaultQuery("kind", "recommendation")
	if kind != "recommendation" && kind != "diagnosis" {
		invalid(c, "报告类型无效")
		return
	}
	if kind == "diagnosis" && !teacher(c) {
		identity.Fail(c, 403, "forbidden", "诊断草稿仅教师可见")
		return
	}
	v, e := h.q.ListIntelligenceReports(c.Request.Context(), store.ListIntelligenceReportsParams{CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID, Kind: kind})
	if e == nil && v == nil {
		v = []store.ListIntelligenceReportsRow{}
	}
	result(c, v, e)
}
func (h *Handler) intelligenceRecord(c *gin.Context) (store.IntelligenceReportRow, bool) {
	r, e := h.q.IntelligenceReport(c.Request.Context(), store.IntelligenceReportParams{ID: c.Param("reportID"), CourseID: c.Param("courseID")})
	if e == nil && (r.OwnerID != identity.Current(c).ID || r.Kind == "diagnosis" && !teacher(c)) {
		e = pgx.ErrNoRows
	}
	return r, resultIfError(c, e)
}
func resultIfError(c *gin.Context, e error) bool {
	if e != nil {
		result(c, nil, e)
		return false
	}
	return true
}

func diagnosisActiveLabels(ctx context.Context, q *store.Queries, course string) ([]rag.DiagnosisLabel, error) {
	out := append([]rag.DiagnosisLabel{}, rag.BaseDiagnosisLabels...)
	labels, e := q.ListDiagnosisLabels(ctx, course)
	if e != nil {
		return nil, e
	}
	for _, l := range labels {
		if l.Active {
			out = append(out, rag.DiagnosisLabel{ID: l.ID, Title: l.Title})
		}
	}
	return out, nil
}

func (h *Handler) diagnosisSnapshot(ctx context.Context, q *store.Queries, course, question, rubric string) (rag.IntelligenceInput, error) {
	labels, e := diagnosisActiveLabels(ctx, q, course)
	in := rag.IntelligenceInput{RubricID: rubric, Labels: labels, Answers: []rag.DiagnosisAnswer{}}
	if e != nil {
		return in, e
	}
	evidence, e := q.QuestionReleasedEvidence(ctx, store.QuestionReleasedEvidenceParams{CourseID: course, QuestionID: question, RubricID: rubric})
	if e != nil {
		return in, e
	}
	for _, v := range evidence {
		if v.QuestionID != question || v.RubricID.String != rubric {
			continue
		}
		in.Eligible++
		in.Prompt = v.Prompt
		if v.Score < v.MaxScore {
			in.Answers = append(in.Answers, rag.DiagnosisAnswer{SubmissionID: v.SubmissionID, RevisionID: v.RevisionID, Answer: v.AnswerText, Feedback: v.Feedback, Score: v.Score, MaxScore: v.MaxScore, Points: v.PointScores})
		}
	}
	sort.Slice(in.Answers, func(i, j int) bool { return in.Answers[i].SubmissionID < in.Answers[j].SubmissionID })
	if len(in.Answers) == 0 {
		return in, errNoDiagnosisAnswers
	}
	if len(in.Answers) > 40 {
		return in, errTooManyDiagnosisAnswers
	}
	return in, nil
}

func (h *Handler) listRecommendationCandidates(ctx context.Context, q *store.Queries, course, student string) (rag.IntelligenceInput, error) {
	in := rag.IntelligenceInput{Candidates: []rag.LearningCandidate{}}
	path, e := q.LatestStudyPath(ctx, store.LatestStudyPathParams{CourseID: course, StudentID: student})
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return in, errNoStudyPath
		}
		return in, e
	}
	in.PathID = path.ID
	items, e := q.ListStudyPathItems(ctx, path.ID)
	if e != nil {
		return in, e
	}
	resources, e := q.ListBusinessResources(ctx, store.ListBusinessResourcesParams{CourseID: course, Teacher: false})
	if e != nil {
		return in, e
	}
	superseded := map[string]bool{}
	for _, r := range resources {
		if r.SupersedesID.Valid && r.SupersedesID.String != "" {
			superseded[r.SupersedesID.String] = true
		}
	}
	sources, e := q.ListMaterialSources(ctx, course)
	if e != nil {
		return in, e
	}
	activeSources := make(map[string]bool, len(sources))
	for _, s := range sources {
		if s.State == "active" {
			activeSources[s.ID] = true
		}
	}
	knowledge, e := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: course, Teacher: false})
	if e != nil {
		return in, e
	}
	events, e := q.ListMyLearningEvents(ctx, store.ListMyLearningEventsParams{CourseID: course, ActorID: student})
	if e != nil {
		return in, e
	}
	completed := map[string]bool{}
	for _, ev := range events {
		if ev.Verb == "completed" {
			completed[ev.ResourceID.String] = true
		}
	}
	seen := map[string]bool{}
	for _, p := range items {
		add := func(kind, id, title string) {
			key := kind + ":" + id
			if !seen[key] {
				seen[key] = true
				in.Candidates = append(in.Candidates, rag.LearningCandidate{ID: key, Kind: kind, ObjectID: id, Title: title, PointID: p.KnowledgePointID, Group: int(p.Position), RuleReason: p.Reason})
			}
		}
		for _, r := range resources {
			if superseded[r.ID] {
				continue
			}
			if r.KnowledgePointID.String == p.KnowledgePointID && !completed[r.ID] {
				if r.SourceID.Valid && !activeSources[r.SourceID.String] {
					continue
				}
				add("resource", r.ID, r.Title)
			}
		}
		for _, k := range knowledge {
			for _, id := range k.KnowledgePointIds {
				if id == p.KnowledgePointID {
					add("knowledge", k.ID, k.Title)
					break
				}
			}
		}
	}
	rag.SortCandidates(in.Candidates)
	in.Eligible = len(in.Candidates)
	return in, nil
}

func (h *Handler) recommendationCandidates(ctx context.Context, q *store.Queries, course, student string) (rag.IntelligenceInput, error) {
	in, e := h.listRecommendationCandidates(ctx, q, course, student)
	if e != nil {
		return in, e
	}
	if len(in.Candidates) == 0 {
		return in, errNoRecommendCandidates
	}
	if len(in.Candidates) > 40 {
		return in, errTooManyRecommendCands
	}
	return in, nil
}

func (h *Handler) intelligenceCreate(c *gin.Context) {
	var req struct {
		Kind       string `json:"kind"`
		QuestionID string `json:"question_id"`
		RubricID   string `json:"rubric_id"`
		ProfileID  string `json:"profile_id"`
		RequestID  string `json:"request_id"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Kind != "diagnosis" && req.Kind != "recommendation" {
		invalid(c, "报告类型无效")
		return
	}
	if (req.Kind == "diagnosis") != teacher(c) {
		identity.Fail(c, 403, "forbidden", "教师创建诊断，学生创建本人的推荐")
		return
	}
	if !validText(req.RequestID, 128) {
		invalid(c, "缺少有效请求号")
		return
	}
	if req.Kind == "recommendation" && (req.QuestionID != "" || req.RubricID != "") {
		invalid(c, "学习推荐不接受指定他人的题目或标准")
		return
	}
	ctx := c.Request.Context()
	actor := identity.Current(c).ID
	course := c.Param("courseID")
	request, _ := json.Marshal(req)
	hash := rag.Hash(string(request))

	replyExisting := func() bool {
		prior, err := h.q.IntelligenceRequest(ctx, store.IntelligenceRequestParams{CourseID: course, OwnerID: actor, RequestID: req.RequestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return false
		}
		if err != nil {
			result(c, nil, err)
			return true
		}
		v, err := h.q.IntelligenceReport(ctx, store.IntelligenceReportParams{ID: prior, CourseID: course})
		if !resultIfError(c, err) {
			return true
		}
		if v.InputHash != hash {
			identity.Fail(c, 409, "request_conflict", "同一请求号不能改变分析范围或模型")
			return true
		}
		result(c, v, nil)
		return true
	}
	if replyExisting() {
		return
	}
	if h.rag == nil {
		identity.Fail(c, 503, "model_not_configured", "尚未配置模型，规则路径与人工分析仍可使用")
		return
	}
	if _, e := h.rag.Models.Profile(req.ProfileID, "chat"); e != nil {
		ragError(c, e)
		return
	}
	var in rag.IntelligenceInput
	var e error
	if req.Kind == "diagnosis" {
		in, e = h.diagnosisSnapshot(ctx, h.q, course, req.QuestionID, req.RubricID)
	} else {
		in, e = h.recommendationCandidates(ctx, h.q, course, actor)
	}
	if e != nil {
		ragError(c, e)
		return
	}
	raw, _ := json.Marshal(in)
	if len(raw) > 100000 {
		invalid(c, "分析输入过长，请缩小范围")
		return
	}
	tx, e := h.db.Begin(ctx)
	if !resultIfError(c, e) {
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	id := uuid.NewString()
	jobRaw, _ := json.Marshal(rag.JobInput{ReportID: id, ProfileID: req.ProfileID})
	job, e := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{ID: uuid.NewString(), CourseID: course, CreatedBy: actor, Kind: req.Kind, Input: jobRaw})
	if !resultIfError(c, e) {
		return
	}
	r, e := q.CreateIntelligenceReport(ctx, store.CreateIntelligenceReportParams{ID: id, CourseID: course, OwnerID: actor, Kind: req.Kind, QuestionID: text(req.QuestionID), JobID: job.ID, RequestID: req.RequestID, InputHash: hash, Input: raw})
	if e != nil {
		if isPgCode(e, "23505") {
			_ = tx.Rollback(ctx)
			if !replyExisting() {
				identity.Fail(c, 409, "request_conflict", "同一请求号已存在")
			}
			return
		}
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); !resultIfError(c, e) {
		return
	}
	h.rag.Enqueue(job.ID)
	row := store.IntelligenceReportRow{
		ID:          r.ID,
		CourseID:    r.CourseID,
		OwnerID:     r.OwnerID,
		Kind:        r.Kind,
		QuestionID:  r.QuestionID,
		JobID:       r.JobID,
		RequestID:   r.RequestID,
		InputHash:   r.InputHash,
		Input:       r.Input,
		Output:      r.Output,
		State:       r.State,
		EditVersion: r.EditVersion,
		CreatedAt:   r.CreatedAt,
		JobState:    job.State,
		JobError:    job.Error,
	}
	result(c, row, nil)
}
func (h *Handler) intelligenceRead(c *gin.Context) {
	r, ok := h.intelligenceRecord(c)
	if !ok {
		return
	}
	if r.JobState != "succeeded" {
		if r.Kind == "recommendation" {
			result(c, gin.H{"report": r, "choices": []store.RecommendationChoice{}, "unavailable": []string{}}, nil)
			return
		}
		result(c, gin.H{"report": r, "stale": false}, nil)
		return
	}
	ctx := c.Request.Context()
	var in rag.IntelligenceInput
	_ = json.Unmarshal(r.Input, &in)
	if r.Kind == "recommendation" {
		current, e := h.listRecommendationCandidates(ctx, h.q, r.CourseID, r.OwnerID)
		if e != nil && !errors.Is(e, errNoStudyPath) {
			result(c, nil, e)
			return
		}
		allowed := map[string]bool{}
		if e == nil {
			for _, v := range current.Candidates {
				allowed[v.ID] = true
			}
		}
		unavailable := []string{}
		for i := range in.Candidates {
			if !allowed[in.Candidates[i].ID] {
				unavailable = append(unavailable, in.Candidates[i].ID)
				in.Candidates[i].Title = "内容已不可用或已完成"
			}
		}
		r.Input, _ = json.Marshal(in)
		var output rag.IntelligenceOutput
		_ = json.Unmarshal(r.Output, &output)
		for i := range output.Ranking {
			if !allowed[output.Ranking[i].ID] {
				output.Ranking[i].Reason = "内容已不可用或已完成，请以当前学习路径为准。"
			}
		}
		r.Output, _ = json.Marshal(output)
		choices, e := h.q.RecommendationChoices(ctx, r.ID)
		if e == nil && choices == nil {
			choices = []store.RecommendationChoice{}
		}
		result(c, gin.H{"report": r, "choices": choices, "unavailable": unavailable}, e)
		return
	}
	current, e := h.diagnosisSnapshot(ctx, h.q, r.CourseID, r.QuestionID.String, in.RubricID)
	stale := false
	if e != nil {
		if errors.Is(e, errNoDiagnosisAnswers) || errors.Is(e, errTooManyDiagnosisAnswers) {
			stale = true
		} else {
			result(c, nil, e)
			return
		}
	} else {
		stale = !sameDiagnosisEvidence(in, current)
	}
	result(c, gin.H{"report": r, "stale": stale}, nil)
}
func sameDiagnosisEvidence(a, b rag.IntelligenceInput) bool {
	a.Labels = nil
	b.Labels = nil
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
func (h *Handler) diagnosisEdit(confirming bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		r, ok := h.intelligenceRecord(c)
		if !ok {
			return
		}
		if r.Kind != "diagnosis" || r.State != "draft" || r.JobState != "succeeded" {
			identity.Fail(c, 409, "report_state", "只能编辑已完成的诊断草稿")
			return
		}
		var req struct {
			Output      rag.IntelligenceOutput `json:"output"`
			EditVersion int32                  `json:"edit_version"`
		}
		if !bind(c, &req) {
			return
		}
		ctx := c.Request.Context()
		question, e := h.q.GetBusinessQuestion(ctx, r.QuestionID.String)
		if !resultIfError(c, e) {
			return
		}
		tx, e := h.db.Begin(ctx)
		if !resultIfError(c, e) {
			return
		}
		defer tx.Rollback(ctx)
		q := h.q.WithTx(tx)
		// Formal grading and group regrades hold this same lock through release.
		if _, e = q.GetAssignmentForUpdate(ctx, question.AssignmentID); !resultIfError(c, e) {
			return
		}
		var (
			lockedKind        string
			lockedOwner       string
			lockedQuestionID  pgtype.Text
			lockedInput       json.RawMessage
			lockedState       string
			lockedEditVersion int32
			lockedJobState    string
		)
		e = tx.QueryRow(ctx,
			`SELECT r.kind, r.owner_id, r.question_id, r.input, r.state, r.edit_version, j.state
			 FROM intelligence_reports r JOIN processing_jobs j ON j.id=r.job_id
			 WHERE r.id=$1 AND r.course_id=$2 FOR UPDATE OF r`,
			r.ID, r.CourseID,
		).Scan(&lockedKind, &lockedOwner, &lockedQuestionID, &lockedInput, &lockedState, &lockedEditVersion, &lockedJobState)
		if !resultIfError(c, e) {
			return
		}
		if lockedOwner != identity.Current(c).ID || lockedKind != "diagnosis" || lockedState != "draft" || lockedJobState != "succeeded" {
			identity.Fail(c, 409, "report_state", "只能编辑已完成的诊断草稿")
			return
		}
		if req.EditVersion != lockedEditVersion {
			identity.Fail(c, 409, "stale_revision", "诊断已修改，请刷新后再处理")
			return
		}
		var in rag.IntelligenceInput
		if err := json.Unmarshal(lockedInput, &in); err != nil {
			result(c, nil, err)
			return
		}
		labels, e := diagnosisActiveLabels(ctx, q, r.CourseID)
		if !resultIfError(c, e) {
			return
		}
		if confirming {
			current, err := h.diagnosisSnapshot(ctx, q, r.CourseID, lockedQuestionID.String, in.RubricID)
			if err != nil {
				if errors.Is(err, errNoDiagnosisAnswers) || errors.Is(err, errTooManyDiagnosisAnswers) {
					identity.Fail(c, 409, "stale_evidence", "正式结果已变化，请重新分析后确认；原草稿保留")
					return
				}
				result(c, nil, err)
				return
			}
			if !sameDiagnosisEvidence(in, current) {
				identity.Fail(c, 409, "stale_evidence", "正式结果已变化，请重新分析后确认；原草稿保留")
				return
			}
		}
		in.Labels = labels
		if e = rag.ValidateIntelligence("diagnosis", in, req.Output, confirming); e != nil {
			ragError(c, e)
			return
		}
		if req.Output.Findings == nil {
			req.Output.Findings = []rag.DiagnosisFinding{}
		}
		for i := range req.Output.Findings {
			if req.Output.Findings[i].Evidence == nil {
				req.Output.Findings[i].Evidence = []rag.DiagnosisQuote{}
			}
		}
		if req.Output.Unclassified == nil {
			req.Output.Unclassified = []string{}
		}
		if req.Output.Ranking == nil {
			req.Output.Ranking = []rag.RankedCandidate{}
		}
		raw, _ := json.Marshal(req.Output)
		var v store.IntelligenceReport
		if confirming {
			v, e = q.ConfirmDiagnosis(ctx, store.ConfirmDiagnosisParams{ID: r.ID, OwnerID: lockedOwner, Output: raw, EditVersion: req.EditVersion})
		} else {
			v, e = q.SaveDiagnosis(ctx, store.SaveDiagnosisParams{ID: r.ID, OwnerID: lockedOwner, Output: raw, EditVersion: req.EditVersion})
		}
		if errors.Is(e, pgx.ErrNoRows) {
			identity.Fail(c, 409, "stale_revision", "诊断已修改，请刷新后再处理")
			return
		}
		if !resultIfError(c, e) {
			return
		}
		result(c, v, tx.Commit(ctx))
	}
}
func (h *Handler) recommendationChoice(c *gin.Context) {
	r, ok := h.intelligenceRecord(c)
	if !ok {
		return
	}
	var req struct {
		CandidateID string `json:"candidate_id"`
		Choice      string `json:"choice"`
	}
	if !bind(c, &req) {
		return
	}
	if r.Kind != "recommendation" || r.JobState != "succeeded" || req.Choice != "saved" && req.Choice != "later" && req.Choice != "dismissed" {
		invalid(c, "推荐状态或选择无效")
		return
	}
	var in rag.IntelligenceInput
	_ = json.Unmarshal(r.Input, &in)
	present := false
	for _, v := range in.Candidates {
		if v.ID == req.CandidateID {
			present = true
		}
	}
	ctx := c.Request.Context()
	current, e := h.listRecommendationCandidates(ctx, h.q, r.CourseID, r.OwnerID)
	if e != nil && !errors.Is(e, errNoStudyPath) {
		result(c, nil, e)
		return
	}
	allowed := false
	if e == nil {
		for _, v := range current.Candidates {
			if v.ID == req.CandidateID {
				allowed = true
			}
		}
	}
	if !present || !allowed {
		identity.Fail(c, 409, "candidate_unavailable", "该内容已不在当前可用候选中，请重新规划")
		return
	}
	e = h.q.PutRecommendationChoice(ctx, store.PutRecommendationChoiceParams{ReportID: r.ID, CandidateID: req.CandidateID, Choice: req.Choice})
	result(c, req, e)
}
func (h *Handler) intelligenceCancel(c *gin.Context) {
	r, ok := h.intelligenceRecord(c)
	if !ok {
		return
	}
	v, e := h.q.CancelProcessingJob(c.Request.Context(), store.CancelProcessingJobParams{ID: r.JobID, CourseID: r.CourseID})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "任务已结束或无法取消")
		return
	}
	result(c, v, e)
}
func (h *Handler) diagnosisLabels(c *gin.Context) {
	v, e := h.q.ListDiagnosisLabels(c.Request.Context(), c.Param("courseID"))
	if e == nil && v == nil {
		v = []store.DiagnosisLabel{}
	}
	result(c, gin.H{"built_in": rag.BaseDiagnosisLabels, "custom": v}, e)
}
func (h *Handler) diagnosisLabelSave(c *gin.Context) {
	var req struct {
		Title       string `json:"title"`
		Active      bool   `json:"active"`
		EditVersion int32  `json:"edit_version"`
	}
	if !bind(c, &req) {
		return
	}
	ctx := c.Request.Context()
	if labelID := c.Param("labelID"); labelID != "" {
		v, e := h.q.SetDiagnosisLabel(ctx, store.SetDiagnosisLabelParams{ID: labelID, CourseID: c.Param("courseID"), Active: req.Active, EditVersion: req.EditVersion})
		if errors.Is(e, pgx.ErrNoRows) {
			labels, lErr := h.q.ListDiagnosisLabels(ctx, c.Param("courseID"))
			if lErr != nil {
				result(c, nil, lErr)
				return
			}
			for _, l := range labels {
				if l.ID == labelID {
					identity.Fail(c, 409, "stale_revision", "标签已修改，请刷新")
					return
				}
			}
			identity.Fail(c, 404, "not_found", "诊断标签不存在")
			return
		}
		result(c, v, e)
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if !validText(req.Title, 180) {
		invalid(c, "标签名须为1—180字节")
		return
	}
	for _, l := range rag.BaseDiagnosisLabels {
		if strings.EqualFold(strings.TrimSpace(l.Title), req.Title) {
			identity.Fail(c, 409, "duplicate_label", "已有同名预设标签")
			return
		}
	}
	existing, lErr := h.q.ListDiagnosisLabels(ctx, c.Param("courseID"))
	if lErr != nil {
		result(c, nil, lErr)
		return
	}
	for _, l := range existing {
		if strings.EqualFold(strings.TrimSpace(l.Title), req.Title) {
			identity.Fail(c, 409, "duplicate_label", "课程内已存在同名诊断标签")
			return
		}
	}
	v, e := h.q.PutDiagnosisLabel(ctx, store.PutDiagnosisLabelParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: req.Title})
	result(c, v, e)
}
