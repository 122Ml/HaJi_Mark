package learning

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
	s, ok := h.submissionRecord(c, c.Param("id"))
	if !ok {
		return
	}
	question, e := h.q.GetBusinessQuestion(c.Request.Context(), s.QuestionID)
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
	raw := []byte("[]")
	if in.RubricID != "" {
		var total int32
		var valid bool
		raw, total, valid = h.scorePoints(c, in.RubricID, in.Points, s)
		if !valid {
			return
		}
		if in.Score != total {
			invalid(c, "总分必须等于逐点分数之和")
			return
		}
	} else {
		versions, err := h.q.ListRubricVersions(c.Request.Context(), text(question.ID))
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
	ctx := c.Request.Context()
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
	if _, e = q.GetAssignmentForUpdate(ctx, s.AssignmentID); e != nil {
		result(c, nil, e)
		return
	}
	if active, err := q.GradingManagedByRegrade(ctx, s.QuestionID); err != nil || active {
		identity.Fail(c, 409, "regrade_active", "本题已进入整组重评，请通过重评批次修订结果")
		return
	}
	if _, e = q.LockBusinessSubmission(ctx, s.ID); e != nil {
		result(c, nil, e)
		return
	}
	old, e := q.GetRevisionByRequest(ctx, store.GetRevisionByRequestParams{ReviewerID: identity.Current(c).ID, RequestID: in.RequestID})
	if e == nil {
		var oldPoints []pointFeedback
		if e = json.Unmarshal(old.PointScores, &oldPoints); e != nil {
			result(c, nil, e)
			return
		}
		canonical, _ := json.Marshal(oldPoints)
		if old.SubmissionID != s.ID || old.Score != in.Score || old.Feedback != in.Feedback || old.RubricID.String != in.RubricID || old.AiJobID.String != in.AIJobID || !bytes.Equal(canonical, raw) {
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
	revision, e := q.NextBusinessRevision(ctx, s.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	v, e := q.CreatePointRevision(ctx, store.CreatePointRevisionParams{ID: uuid.NewString(), SubmissionID: s.ID, Revision: revision, Score: in.Score, Feedback: in.Feedback, ReviewerID: identity.Current(c).ID, RequestID: in.RequestID, RubricID: text(in.RubricID), PointScores: raw})
	if e != nil {
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
	r, e := h.q.GetBusinessRevision(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	s, ok := h.submissionRecord(c, r.SubmissionID)
	if !ok {
		return
	}
	previous := "draft"
	if in.State == "released" {
		previous = "confirmed"
	} else if in.State != "confirmed" {
		invalid(c, "只允许确认或发布评分")
		return
	}
	if r.State != previous {
		identity.Fail(c, 409, "state_conflict", "评分状态已改变")
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
	if _, e = q.GetAssignmentForUpdate(ctx, s.AssignmentID); e != nil {
		result(c, nil, e)
		return
	}
	if active, err := q.GradingManagedByRegrade(ctx, s.QuestionID); err != nil || active {
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
		identity.Fail(c, 409, "stale_revision", "仅允许发布最新评分修订")
		return
	}
	v, e := q.TransitionBusinessRevision(ctx, store.TransitionBusinessRevisionParams{ID: r.ID, State: in.State, State_2: previous})
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
	if !validText(in.Title, 500) || !validText(in.Description, 30000) {
		invalid(c, "请填写任务名称与执行要求")
		return
	}
	enrolled, e := h.q.IsEnrolled(c.Request.Context(), store.IsEnrolledParams{CourseID: c.Param("courseID"), StudentID: in.StudentID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if !enrolled {
		identity.Fail(c, 403, "forbidden", "学生未加入当前课程")
		return
	}
	if in.ResourceID != "" {
		r, e := h.q.GetBusinessResource(c.Request.Context(), in.ResourceID)
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
	ctx := c.Request.Context()
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
			if _, err = q.GetAssignmentForUpdate(ctx, submission.AssignmentID); !resultIfError(c, err) {
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
			local := *h
			local.q = q
			current, err := local.diagnosisSnapshot(ctx, r.CourseID, r.OwnerID, r.QuestionID.String, snapshot.RubricID)
			if err != nil || !sameDiagnosisEvidence(snapshot, current) {
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
	item, e := h.q.GetBusinessIntervention(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, item.CourseID) {
		return
	}
	previous := ""
	if teacher(c) {
		if in.State == "assigned" {
			previous = "draft"
		}
		if in.State == "reviewed" && validText(in.Content, 30000) {
			previous = "submitted"
		}
	} else if item.StudentID == identity.Current(c).ID && in.State == "submitted" && validText(in.Content, 200000) {
		previous = "assigned"
	}
	if previous == "" {
		identity.Fail(c, 403, "forbidden", "无权执行该任务动作，或未填写内容")
		return
	}
	if item.Status != previous {
		identity.Fail(c, 409, "state_conflict", "任务状态已改变")
		return
	}
	if !teacher(c) && in.State == "submitted" {
		if item.ResourceID.Valid {
			ok, e := h.q.HasInterventionLearning(c.Request.Context(), store.HasInterventionLearningParams{ActorID: item.StudentID, ResourceID: item.ResourceID, OccurredAt: item.AssignedAt})
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
			ok, e := h.q.HasInterventionSubmission(c.Request.Context(), store.HasInterventionSubmissionParams{StudentID: item.StudentID, AssignmentID: item.AssignmentID.String, SubmittedAt: item.AssignedAt})
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
	v, e := h.q.TransitionBusinessIntervention(c.Request.Context(), store.TransitionBusinessInterventionParams{ID: item.ID, Status: in.State, Status_2: previous, AnswerText: in.Content})
	result(c, v, e)
}
func (h *Handler) interactions(c *gin.Context) {
	v, e := h.q.ListBusinessInteractions(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
func (h *Handler) createInteraction(c *gin.Context) {
	var in struct {
		Kind     string `json:"kind"`
		Title    string `json:"title"`
		Content  string `json:"content"`
		ParentID string `json:"parent_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Content, 30000) || len(in.Title) > 500 {
		invalid(c, "内容不能为空，且不超过30000字节")
		return
	}
	allowed := in.Kind == "question" || in.Kind == "reply" || (teacher(c) && (in.Kind == "announcement" || in.Kind == "discussion"))
	if !allowed {
		identity.Fail(c, 403, "forbidden", "无权发布该类型内容")
		return
	}
	if in.Kind == "reply" {
		p, e := h.q.GetBusinessInteraction(c.Request.Context(), in.ParentID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, p.CourseID) {
			return
		}
	} else if in.ParentID != "" {
		invalid(c, "只有回复可以关联原帖")
		return
	}
	v, e := h.q.CreateBusinessInteraction(c.Request.Context(), store.CreateBusinessInteractionParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), ActorID: identity.Current(c).ID, Kind: in.Kind, Title: in.Title, Content: in.Content, ParentID: text(in.ParentID)})
	result(c, v, e)
}
