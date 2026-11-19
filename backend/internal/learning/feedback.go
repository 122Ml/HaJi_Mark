package learning

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func isDBInfraError(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	var netErr net.Error
	return errors.As(err, &pgErr) || errors.As(err, &netErr) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, pgx.ErrTxClosed) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

func samePointScores(raw json.RawMessage, in []pointScore) bool {
	var oldPoints []pointFeedback
	if json.Unmarshal(raw, &oldPoints) != nil || len(oldPoints) != len(in) {
		return false
	}
	byID := make(map[string]pointScore, len(in))
	for _, p := range in {
		if _, dup := byID[p.CriterionID]; dup {
			return false
		}
		byID[p.CriterionID] = p
	}
	for _, op := range oldPoints {
		p, ok := byID[op.CriterionID]
		if !ok || op.Score != p.Score || op.Feedback != p.Feedback || op.Quote != p.Quote {
			return false
		}
	}
	return true
}

func (h *Handler) grade(c *gin.Context) {
	var in struct {
		Score     int32        `json:"score"`
		Feedback  string       `json:"feedback"`
		RequestID string       `json:"request_id"`
		RubricID  string       `json:"rubric_id"`
		Points    []pointScore `json:"points"`
		AIJobID   string       `json:"ai_job_id"`
	}
	if !bind(c, &in) {
		return
	}
	in.Feedback = strings.TrimSpace(in.Feedback)
	s, ok := h.submissionRecord(c, c.Param("id"))
	if !ok {
		return
	}
	ctx := c.Request.Context()
	question, e := h.q.GetBusinessQuestion(ctx, s.QuestionID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if in.Score < 0 || in.Score > question.MaxScore || !validText(in.Feedback, 30000) || !validText(in.RequestID, 128) {
		invalid(c, "分数须在本题满分范围内，并填写反馈")
		return
	}
	if question.Type == "quiz" {
		invalid(c, "客观测验使用固定答案规则判分")
		return
	}
	if in.AIJobID != "" {
		_, snapshot, err := h.draftJob(c, in.AIJobID, "grade")
		if err != nil {
			ragError(c, err)
			return
		}
		if snapshot.SubmissionID != s.ID || snapshot.AnswerHash != s.AnswerSha256 || snapshot.RubricID != in.RubricID {
			invalid(c, "AI草稿与本次作答或标准版本不一致")
			return
		}
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessAssignmentShare(ctx, s.AssignmentID); e != nil {
		result(c, nil, e)
		return
	}
	active, err := q.GradingManagedByRegrade(ctx, s.QuestionID)
	if err != nil {
		result(c, nil, err)
		return
	}
	if active {
		identity.Fail(c, 409, "regrade_active", "本题已进入整组重评，请通过重评批次修订结果")
		return
	}
	if _, e = q.LockBusinessSubmission(ctx, s.ID); e != nil {
		result(c, nil, e)
		return
	}
	actorID := identity.Current(c).ID
	old, e := q.GetRevisionByRequest(ctx, store.GetRevisionByRequestParams{ReviewerID: actorID, RequestID: in.RequestID})
	if e == nil {
		if old.SubmissionID != s.ID || old.Score != in.Score || old.Feedback != in.Feedback || old.RubricID.String != in.RubricID || old.AiJobID.String != in.AIJobID || !samePointScores(old.PointScores, in.Points) {
			identity.Fail(c, 409, "request_conflict", "相同请求号不能改变评分")
			return
		}
		result(c, old, nil)
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		result(c, nil, e)
		return
	}
	raw := []byte("[]")
	if in.RubricID != "" {
		var total int32
		var valid bool
		raw, total, valid = h.scorePointsTx(c, q, in.RubricID, in.Points, s)
		if !valid {
			return
		}
		if in.Score != total {
			invalid(c, "总分必须等于逐点分数之和")
			return
		}
	} else {
		versions, err := q.ListRubricVersions(ctx, text(question.ID))
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, v := range versions {
			if v.State == "confirmed" {
				invalid(c, "本题已有逐点标准，请选择标准版本并逐点给分")
				return
			}
		}
		if len(in.Points) > 0 {
			invalid(c, "逐点给分必须指定标准版本")
			return
		}
	}
	revision, e := q.NextBusinessRevision(ctx, s.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	v, e := q.CreatePointRevision(ctx, store.CreatePointRevisionParams{ID: uuid.NewString(), SubmissionID: s.ID, Revision: revision, Score: in.Score, Feedback: in.Feedback, ReviewerID: actorID, RequestID: in.RequestID, RubricID: text(in.RubricID), PointScores: raw})
	if e != nil {
		if isPgCode(e, "23505") {
			_ = tx.Rollback(ctx)
			existing, err := h.q.GetRevisionByRequest(ctx, store.GetRevisionByRequestParams{ReviewerID: actorID, RequestID: in.RequestID})
			if err == nil {
				var oldPoints []pointFeedback
				if json.Unmarshal(existing.PointScores, &oldPoints) == nil {
					if canonical, merr := json.Marshal(oldPoints); merr == nil && existing.SubmissionID == s.ID && existing.Score == in.Score && existing.Feedback == in.Feedback && existing.RubricID.String == in.RubricID && existing.AiJobID.String == in.AIJobID && bytes.Equal(canonical, raw) {
						result(c, existing, nil)
						return
					}
				}
				identity.Fail(c, 409, "request_conflict", "相同请求号不能改变评分")
				return
			}
			identity.Fail(c, 409, "request_conflict", "评分提交冲突，请重试")
			return
		}
		result(c, nil, e)
		return
	}
	if in.AIJobID != "" {
		if e = q.AttachGradingJob(ctx, store.AttachGradingJobParams{ID: v.ID, AiJobID: text(in.AIJobID)}); e != nil {
			result(c, nil, e)
			return
		}
		v.AiJobID = text(in.AIJobID)
	}
	e = tx.Commit(ctx)
	result(c, v, e)
}
func (h *Handler) gradeState(c *gin.Context) {
	var in struct {
		State string `json:"state"`
	}
	if !bind(c, &in) {
		return
	}
	previous := "draft"
	if in.State == "released" {
		previous = "confirmed"
	} else if in.State != "confirmed" {
		invalid(c, "只允许确认或发布评分")
		return
	}
	ctx := c.Request.Context()
	r, e := h.q.GetBusinessRevision(ctx, c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	s, ok := h.submissionRecord(c, r.SubmissionID)
	if !ok {
		return
	}
	if r.State != previous {
		identity.Fail(c, 409, "state_conflict", "评分状态已改变")
		return
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessAssignmentShare(ctx, s.AssignmentID); e != nil {
		result(c, nil, e)
		return
	}
	active, err := q.GradingManagedByRegrade(ctx, s.QuestionID)
	if err != nil {
		result(c, nil, err)
		return
	}
	if active {
		identity.Fail(c, 409, "regrade_active", "本题已进入整组重评，请通过重评批次修订结果")
		return
	}
	if _, e = q.LockBusinessSubmission(ctx, s.ID); e != nil {
		result(c, nil, e)
		return
	}
	latest, e := q.NextBusinessRevision(ctx, s.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if r.Revision != latest-1 {
		msg := "仅允许发布最新评分修订"
		if in.State == "confirmed" {
			msg = "仅允许确认最新评分修订"
		}
		identity.Fail(c, 409, "stale_revision", msg)
		return
	}
	v, e := q.TransitionBusinessRevision(ctx, store.TransitionBusinessRevisionParams{ID: r.ID, State: in.State, State_2: previous})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "评分状态已改变")
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	if in.State == "released" {
		if e = q.MarkBusinessSubmissionGraded(ctx, s.ID); e != nil {
			result(c, nil, e)
			return
		}
	}
	e = tx.Commit(ctx)
	result(c, v, e)
}
func (h *Handler) interventions(c *gin.Context) {
	v, e := h.q.ListBusinessInterventions(c.Request.Context(), store.ListBusinessInterventionsParams{CourseID: c.Param("courseID"), Teacher: teacher(c), ActorID: identity.Current(c).ID})
	if e == nil && v == nil {
		v = []store.ListBusinessInterventionsRow{}
	}
	result(c, v, e)
}
func (h *Handler) createIntervention(c *gin.Context) {
	var in struct {
		StudentID          string `json:"student_id"`
		Title              string `json:"title"`
		Description        string `json:"description"`
		ResourceID         string `json:"resource_id"`
		AssignmentID       string `json:"assignment_id"`
		SourceSubmissionID string `json:"source_submission_id"`
		DiagnosisReportID  string `json:"diagnosis_report_id"`
		DiagnosisLabelID   string `json:"diagnosis_label_id"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if !validText(in.Title, 500) || !validText(in.Description, 30000) {
		invalid(c, "请填写任务名称与执行要求")
		return
	}
	ctx := c.Request.Context()
	enrolled, e := h.q.IsEnrolled(ctx, store.IsEnrolledParams{CourseID: c.Param("courseID"), StudentID: in.StudentID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if !enrolled {
		identity.Fail(c, 403, "forbidden", "学生未加入当前课程")
		return
	}
	if in.ResourceID != "" {
		r, e := h.q.GetBusinessResource(ctx, in.ResourceID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, r.CourseID) {
			return
		}
		if r.Status != "published" {
			invalid(c, "补学资料尚未发布")
			return
		}
	}
	if in.AssignmentID != "" {
		a, ok := h.assignmentRecord(c, in.AssignmentID)
		if !ok {
			return
		}
		if a.Status != "published" {
			invalid(c, "补练作业尚未发布")
			return
		}
	}
	tx, e := h.db.Begin(ctx)
	if !resultIfError(c, e) {
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if in.SourceSubmissionID != "" {
		submission, err := q.GetBusinessSubmission(ctx, in.SourceSubmissionID)
		if !resultIfError(c, err) {
			return
		}
		if !scope(c, submission.CourseID) {
			return
		}
		if submission.StudentID != in.StudentID {
			invalid(c, "关联作答与指定学生不一致")
			return
		}
		if in.DiagnosisReportID != "" {
			if _, err = q.LockBusinessAssignmentShare(ctx, submission.AssignmentID); !resultIfError(c, err) {
				return
			}
			r, err := q.IntelligenceReport(ctx, store.IntelligenceReportParams{ID: in.DiagnosisReportID, CourseID: c.Param("courseID")})
			if !resultIfError(c, err) {
				return
			}
			if r.OwnerID != identity.Current(c).ID || r.Kind != "diagnosis" || r.State != "confirmed" || r.JobState != "succeeded" || r.QuestionID.String != submission.QuestionID {
				invalid(c, "请从已确认且匹配的诊断建立任务")
				return
			}
			var snapshot rag.IntelligenceInput
			var output rag.IntelligenceOutput
			if json.Unmarshal(r.Input, &snapshot) != nil || json.Unmarshal(r.Output, &output) != nil {
				invalid(c, "诊断快照无效")
				return
			}
			current, err := h.diagnosisSnapshot(ctx, q, r.CourseID, r.QuestionID.String, snapshot.RubricID)
			if err != nil {
				if isDBInfraError(err) {
					result(c, nil, err)
					return
				}
				identity.Fail(c, 409, "stale_evidence", "正式结果已变化，请重新分析后安排任务")
				return
			}
			if !sameDiagnosisEvidence(snapshot, current) {
				identity.Fail(c, 409, "stale_evidence", "正式结果已变化，请重新分析后安排任务")
				return
			}
			found := false
			for _, f := range output.Findings {
				if f.LabelID == in.DiagnosisLabelID {
					for _, evidence := range f.Evidence {
						if evidence.SubmissionID == submission.ID {
							found = true
						}
					}
				}
			}
			if !found {
				invalid(c, "所选作答不属于该已确认诊断问题")
				return
			}
		}
	} else if in.DiagnosisReportID != "" || in.DiagnosisLabelID != "" {
		invalid(c, "诊断任务必须指定原始作答")
		return
	}
	if in.DiagnosisReportID == "" && in.DiagnosisLabelID != "" {
		invalid(c, "诊断标签缺少报告")
		return
	}
	v, e := q.CreateBusinessIntervention(ctx, store.CreateBusinessInterventionParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), StudentID: in.StudentID, Title: in.Title, Description: in.Description, TeacherID: identity.Current(c).ID, ResourceID: text(in.ResourceID), AssignmentID: text(in.AssignmentID), SourceSubmissionID: text(in.SourceSubmissionID), DiagnosisReportID: text(in.DiagnosisReportID), DiagnosisLabelID: text(in.DiagnosisLabelID)})
	if e == nil {
		e = tx.Commit(ctx)
	}
	result(c, v, e)
}
func (h *Handler) interventionState(c *gin.Context) {
	var in struct {
		State   string `json:"state"`
		Content string `json:"content"`
	}
	if !bind(c, &in) {
		return
	}
	in.State = strings.TrimSpace(in.State)
	in.Content = strings.TrimSpace(in.Content)
	if in.State != "assigned" && in.State != "submitted" && in.State != "reviewed" {
		invalid(c, "任务目标状态无效")
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
	item, e := q.LockBusinessIntervention(ctx, c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, item.CourseID) {
		return
	}
	var previous string
	if teacher(c) {
		switch in.State {
		case "assigned":
			previous = "draft"
		case "reviewed":
			if !validText(in.Content, 30000) {
				invalid(c, "请填写不超过30000字节的复查意见")
				return
			}
			previous = "submitted"
		default:
			identity.Fail(c, 403, "forbidden", "该任务动作仅限学生执行")
			return
		}
	} else {
		if item.StudentID != identity.Current(c).ID || in.State != "submitted" {
			identity.Fail(c, 403, "forbidden", "无权执行该任务动作")
			return
		}
		if !validText(in.Content, 200000) {
			invalid(c, "请填写不超过200000字节的任务完成说明")
			return
		}
		previous = "assigned"
	}
	if item.Status != previous {
		identity.Fail(c, 409, "state_conflict", "任务状态已改变")
		return
	}
	if teacher(c) && in.State == "assigned" {
		if item.ResourceID.Valid {
			res, err := q.GetBusinessResource(ctx, item.ResourceID.String)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					identity.Fail(c, 409, "stale_target", "关联资料已不存在，无法分配任务")
					return
				}
				result(c, nil, err)
				return
			}
			if res.CourseID != item.CourseID || res.Status != "published" {
				identity.Fail(c, 409, "stale_target", "关联资料已归档或未发布，无法分配任务")
				return
			}
		}
		if item.AssignmentID.Valid {
			asg, err := q.GetBusinessAssignment(ctx, item.AssignmentID.String)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					identity.Fail(c, 409, "stale_target", "关联补练作业已不存在，无法分配任务")
					return
				}
				result(c, nil, err)
				return
			}
			if asg.CourseID != item.CourseID || asg.Status != "published" {
				identity.Fail(c, 409, "stale_target", "关联补练作业已关闭或未发布，无法分配任务")
				return
			}
		}
		if item.DiagnosisReportID.Valid {
			rep, err := q.IntelligenceReport(ctx, store.IntelligenceReportParams{ID: item.DiagnosisReportID.String, CourseID: item.CourseID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					identity.Fail(c, 409, "stale_target", "关联诊断报告已不存在，无法分配任务")
					return
				}
				result(c, nil, err)
				return
			}
			if rep.State != "confirmed" || rep.JobState != "succeeded" {
				identity.Fail(c, 409, "stale_target", "关联诊断报告未确认或无效，无法分配任务")
				return
			}
		}
	}
	if !teacher(c) && in.State == "submitted" {
		if item.ResourceID.Valid {
			ok, e := q.HasInterventionLearning(ctx, store.HasInterventionLearningParams{ActorID: item.StudentID, ResourceID: item.ResourceID, OccurredAt: item.AssignedAt})
			if e != nil {
				result(c, nil, e)
				return
			}
			if !ok {
				invalid(c, "请先完成本任务关联资料的学习")
				return
			}
		}
		if item.AssignmentID.Valid {
			ok, e := q.HasInterventionSubmission(ctx, store.HasInterventionSubmissionParams{StudentID: item.StudentID, AssignmentID: item.AssignmentID.String, SubmittedAt: item.AssignedAt})
			if e != nil {
				result(c, nil, e)
				return
			}
			if !ok {
				invalid(c, "请先提交本任务关联的补练作业")
				return
			}
		}
	}
	v, e := q.TransitionBusinessIntervention(ctx, store.TransitionBusinessInterventionParams{ID: item.ID, Status: in.State, Status_2: previous, AnswerText: in.Content})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "任务状态已改变")
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	e = tx.Commit(ctx)
	result(c, v, e)
}
func (h *Handler) interactions(c *gin.Context) {
	v, e := h.q.ListBusinessInteractions(c.Request.Context(), c.Param("courseID"))
	if e == nil && v == nil {
		v = []store.ListBusinessInteractionsRow{}
	}
	result(c, v, e)
}
func (h *Handler) createInteraction(c *gin.Context) {
	var in struct {
		Kind         string          `json:"kind"`
		Title        string          `json:"title"`
		Content      string          `json:"content"`
		ParentID     string          `json:"parent_id"`
		EvidenceRefs json.RawMessage `json:"evidence_refs"`
	}
	if !bind(c, &in) {
		return
	}
	in.Kind = strings.TrimSpace(in.Kind)
	in.Title = strings.TrimSpace(in.Title)
	in.Content = strings.TrimSpace(in.Content)
	in.ParentID = strings.TrimSpace(in.ParentID)
	switch in.Kind {
	case "question", "reply", "announcement", "discussion":
	default:
		invalid(c, "互动类型无效")
		return
	}
	if !validText(in.Content, 30000) || len(in.Title) > 500 || strings.ContainsRune(in.Title, '\x00') {
		invalid(c, "内容不能为空且不超过30000字节，标题不超过500字节")
		return
	}
	evidenceRefs := []byte("[]")
	if trimmed := bytes.TrimSpace(in.EvidenceRefs); len(trimmed) > 0 && string(trimmed) != "null" {
		if len(trimmed) > 100000 || strings.ContainsRune(string(trimmed), '\x00') {
			invalid(c, "evidence_refs 过大或包含非法字符")
			return
		}
		var refs []json.RawMessage
		if json.Unmarshal(trimmed, &refs) != nil {
			invalid(c, "evidence_refs 必须是有效的 JSON 数组")
			return
		}
		evidenceRefs = trimmed
	}
	if !teacher(c) && (in.Kind == "announcement" || in.Kind == "discussion") {
		identity.Fail(c, 403, "forbidden", "无权发布该类型内容")
		return
	}
	if in.Kind == "reply" {
		if in.ParentID == "" {
			invalid(c, "回复必须指定原帖")
			return
		}
		p, e := h.q.GetBusinessInteraction(c.Request.Context(), in.ParentID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, p.CourseID) {
			return
		}
		if (p.ParentID.Valid && p.ParentID.String != "") || p.Kind == "reply" {
			invalid(c, "暂不支持对回复继续嵌套回复")
			return
		}
	} else if in.ParentID != "" {
		invalid(c, "只有回复可以关联原帖")
		return
	}
	v, e := h.q.CreateBusinessInteraction(c.Request.Context(), store.CreateBusinessInteractionParams{
		ID:           uuid.NewString(),
		CourseID:     c.Param("courseID"),
		ActorID:      identity.Current(c).ID,
		Kind:         in.Kind,
		Title:        in.Title,
		Content:      in.Content,
		ParentID:     text(in.ParentID),
		EvidenceRefs: evidenceRefs,
	})
	result(c, v, e)
}
