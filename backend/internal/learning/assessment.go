package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"time"
)

func (h *Handler) assignments(c *gin.Context) {
	v, e := h.q.ListBusinessAssignments(c.Request.Context(), store.ListBusinessAssignmentsParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	result(c, v, e)
}
func (h *Handler) assignmentRecord(c *gin.Context, id string) (store.Assignment, bool) {
	a, e := h.q.GetBusinessAssignment(c.Request.Context(), id)
	if e != nil {
		result(c, nil, e)
		return a, false
	}
	if !scope(c, a.CourseID) {
		return a, false
	}
	if !teacher(c) && a.Status == "draft" {
		identity.Fail(c, 403, "forbidden", "作业尚未发布")
		return a, false
	}
	return a, true
}
func (h *Handler) assignment(c *gin.Context) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	qs, e := h.q.ListBusinessQuestions(c.Request.Context(), a.ID)
	if !teacher(c) {
		for i := range qs {
			qs[i].Rubric = ""
			qs[i].CorrectAnswer = ""
			qs[i].BoundRubricID = pgtype.Text{}
			qs[i].BankQuestionVersionID = pgtype.Text{}
		}
	}
	result(c, gin.H{"assignment": a, "questions": qs}, e)
}
func (h *Handler) createAssignment(c *gin.Context) {
	var in struct {
		Title       string     `json:"title"`
		Description string     `json:"description"`
		Type        string     `json:"type"`
		DueAt       *time.Time `json:"due_at"`
		Questions   []struct {
			Prompt                string   `json:"prompt"`
			MaxScore              int32    `json:"max_score"`
			Rubric                string   `json:"rubric"`
			Options               []string `json:"options"`
			CorrectAnswer         string   `json:"correct_answer"`
			KnowledgePointID      string   `json:"knowledge_point_id"`
			ResourceID            string   `json:"resource_id"`
			BankQuestionVersionID string   `json:"bank_question_version_id"`
			BoundRubricID         string   `json:"bound_rubric_id"`
		} `json:"questions"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Title, 500) || len(in.Questions) < 1 || len(in.Questions) > 50 {
		invalid(c, "请填写作业名称及1到50道题")
		return
	}
	if in.Type == "" {
		in.Type = "subjective"
	}
	for i := range in.Questions {
		item := &in.Questions[i]
		if item.BankQuestionVersionID == "" {
			if item.BoundRubricID != "" {
				invalid(c, "标准绑定缺少题目版本")
				return
			}
			continue
		}
		v, _, e := h.bankSelection(c.Request.Context(), h.q, c.Param("courseID"), item.BankQuestionVersionID, item.BoundRubricID)
		if e != nil {
			ragError(c, e)
			return
		}
		if v.Type != in.Type {
			invalid(c, "题库题型与本次作业类型不一致")
			return
		}
		item.Prompt = v.Prompt
		item.MaxScore = v.MaxScore
		item.Options = v.Options
		item.CorrectAnswer = v.CorrectAnswer
		item.KnowledgePointID = v.KnowledgePointID.String
		item.ResourceID = ""
		item.Rubric = "按题库确认的固定标准逐点给分，具体规则见绑定版本。"
		if v.Type == "quiz" {
			item.Rubric = "按教师确认的固定选项与答案规则判分"
		}
	}
	total := int32(0)
	points, err := h.q.ListBusinessPoints(c.Request.Context(), c.Param("courseID"))
	if err != nil {
		result(c, nil, err)
		return
	}
	pointIDs := map[string]bool{}
	for _, p := range points {
		if p.Kind == "point" {
			pointIDs[p.ID] = true
		}
	}
	for _, q := range in.Questions {
		if q.KnowledgePointID != "" && !pointIDs[q.KnowledgePointID] {
			identity.Fail(c, 403, "forbidden", "题目知识点不属于当前课程")
			return
		}
		if q.ResourceID != "" {
			r, e := h.q.GetBusinessResource(c.Request.Context(), q.ResourceID)
			if e != nil {
				result(c, nil, e)
				return
			}
			if !scope(c, r.CourseID) {
				return
			}
			if r.Status != "published" {
				invalid(c, "题目只能绑定已审核发布的资料")
				return
			}
		}
		if !validText(q.Prompt, 30000) || q.MaxScore < 1 || q.MaxScore > 10000 || !validText(q.Rubric, 30000) {
			invalid(c, "每题须填写题目、正数满分和教师评分标准")
			return
		}
		total += q.MaxScore
		if in.Type == "quiz" {
			found := false
			seen := map[string]bool{}
			for _, option := range q.Options {
				if !validText(option, 1000) || seen[option] {
					invalid(c, "测验选项不能为空、重复或超过1000字节")
					return
				}
				seen[option] = true
				if option == q.CorrectAnswer && validText(option, 1000) {
					found = true
				}
			}
			if len(q.Options) < 2 || len(q.Options) > 8 || !found {
				invalid(c, "测验须有2到8个选项且正确答案属于选项")
				return
			}
		}
	}
	if in.Type == "" {
		in.Type = "subjective"
	}
	if in.Type != "subjective" && in.Type != "code" && in.Type != "quiz" {
		invalid(c, "此入口支持文本或代码主观作业；客观测验通过测验入口创建")
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
	due := pgtype.Timestamptz{}
	if in.DueAt != nil {
		due = pgtype.Timestamptz{Time: *in.DueAt, Valid: true}
	}
	var a store.Assignment
	if c.Param("id") != "" {
		old, ok := h.assignmentRecord(c, c.Param("id"))
		if !ok {
			return
		}
		if _, e = q.LockBusinessAssignment(ctx, old.ID); e != nil {
			result(c, nil, e)
			return
		}
		a, e = q.UpdateAssignmentDraft(ctx, store.UpdateAssignmentDraftParams{ID: old.ID, Title: in.Title, Description: in.Description, Type: in.Type, MaxScore: total, DueAt: due})
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 409, "immutable_assignment", "已发布题目不可修改，请新建作业")
			} else {
				result(c, nil, e)
			}
			return
		}
		if e = q.DeleteDraftQuestions(ctx, a.ID); e != nil {
			result(c, nil, e)
			return
		}
	} else {
		a, e = q.CreateBusinessAssignment(ctx, store.CreateBusinessAssignmentParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: in.Title, Description: in.Description, Type: in.Type, MaxScore: total, DueAt: due, CreatedBy: identity.Current(c).ID})
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	for i, item := range in.Questions {
		options := item.Options
		if options == nil {
			options = []string{}
		}
		if item.BankQuestionVersionID != "" {
			if _, _, e = h.bankSelection(ctx, q, a.CourseID, item.BankQuestionVersionID, item.BoundRubricID); e != nil {
				ragError(c, e)
				return
			}
		}
		created, err := q.CreateBusinessQuestion(ctx, store.CreateBusinessQuestionParams{ID: uuid.NewString(), AssignmentID: a.ID, Prompt: item.Prompt, Type: in.Type, MaxScore: item.MaxScore, Rubric: item.Rubric, Position: int32(i), Options: options, CorrectAnswer: item.CorrectAnswer, KnowledgePointID: text(item.KnowledgePointID), ResourceID: text(item.ResourceID)})
		e = err
		if e != nil {
			result(c, nil, e)
			return
		}
		if item.BankQuestionVersionID != "" {
			if e = q.BindBankQuestion(ctx, store.BindBankQuestionParams{ID: created.ID, BankQuestionVersionID: text(item.BankQuestionVersionID), BoundRubricID: text(item.BoundRubricID)}); e != nil {
				result(c, nil, e)
				return
			}
		}
	}
	e = tx.Commit(ctx)
	result(c, a, e)
}
func (h *Handler) assignmentState(c *gin.Context) {
	var in struct {
		State string `json:"state"`
	}
	if !bind(c, &in) {
		return
	}
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	previous := "draft"
	if in.State == "closed" {
		previous = "published"
	} else if in.State != "published" {
		invalid(c, "只允许发布或关闭作业")
		return
	}
	if a.Status != previous {
		identity.Fail(c, 409, "state_conflict", "作业状态已改变")
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
	if _, e = q.LockBusinessAssignment(ctx, a.ID); e != nil {
		result(c, nil, e)
		return
	}
	if in.State == "published" {
		qs, e := q.ListBusinessQuestions(ctx, a.ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		for _, item := range qs {
			if item.BankQuestionVersionID.Valid {
				if _, _, e = h.bankSelection(ctx, q, a.CourseID, item.BankQuestionVersionID.String, item.BoundRubricID.String); e != nil {
					ragError(c, e)
					return
				}
			}
		}
	}
	v, e := q.UpdateBusinessAssignmentState(ctx, store.UpdateBusinessAssignmentStateParams{ID: a.ID, Status: in.State, Status_2: previous})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}
func (h *Handler) submissions(c *gin.Context) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	v, e := h.q.ListBusinessSubmissions(c.Request.Context(), store.ListBusinessSubmissionsParams{AssignmentID: a.ID, Teacher: teacher(c), ActorID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) submit(c *gin.Context) {
	var in struct {
		QuestionID string `json:"question_id"`
		Answer     string `json:"answer_text"`
		RequestID  string `json:"request_id"`
	}
	if !bind(c, &in) {
		return
	}
	if blank(in.Answer) || len(in.Answer) > 200000 || !validText(in.RequestID, 128) {
		invalid(c, "请填写答案和有效请求号")
		return
	}
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
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
	if _, e = q.LockBusinessAssignment(ctx, a.ID); e != nil {
		result(c, nil, e)
		return
	}
	old, e := q.GetSubmissionByRequest(ctx, store.GetSubmissionByRequestParams{StudentID: identity.Current(c).ID, RequestID: in.RequestID})
	if e == nil {
		if old.AssignmentID != a.ID || old.QuestionID != in.QuestionID || old.AnswerText != in.Answer {
			identity.Fail(c, 409, "request_conflict", "相同请求号不能改变答案")
			return
		}
		result(c, old, nil)
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		result(c, nil, e)
		return
	}
	a, e = q.GetBusinessAssignment(ctx, a.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if a.Status != "published" || (a.DueAt.Valid && time.Now().After(a.DueAt.Time)) {
		identity.Fail(c, 409, "assignment_closed", "作业已关闭或已过截止时间")
		return
	}
	question, e := q.GetBusinessQuestion(ctx, in.QuestionID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if question.AssignmentID != a.ID {
		identity.Fail(c, 403, "forbidden", "题目不属于当前作业")
		return
	}
	attempt, e := q.NextSubmissionAttempt(ctx, store.NextSubmissionAttemptParams{StudentID: identity.Current(c).ID, QuestionID: question.ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	v, e := q.CreateBusinessSubmission(ctx, store.CreateBusinessSubmissionParams{ID: uuid.NewString(), AssignmentID: a.ID, AssignmentVersion: a.Version, QuestionID: question.ID, CourseID: a.CourseID, StudentID: identity.Current(c).ID, Attempt: attempt, AnswerText: in.Answer, AnswerSha256: hashAnswer(in.Answer), RequestID: in.RequestID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = q.AddSubmissionEvent(ctx, store.AddSubmissionEventParams{ID: uuid.NewString(), CourseID: a.CourseID, ActorID: v.StudentID, SubmissionID: text(v.ID), RequestID: "submission:" + v.ID, ObjectVersion: a.Version, OccurredAt: v.SubmittedAt}); e != nil {
		result(c, nil, e)
		return
	}
	if question.Type == "quiz" {
		score := int32(0)
		if in.Answer == question.CorrectAnswer {
			score = question.MaxScore
		}
		_, e = q.CreateRuleRevision(ctx, store.CreateRuleRevisionParams{ID: uuid.NewString(), SubmissionID: v.ID, Score: score, ReviewerID: a.CreatedBy, RequestID: uuid.NewString()})
		if e != nil {
			result(c, nil, e)
			return
		}
		if e = q.MarkBusinessSubmissionGraded(ctx, v.ID); e != nil {
			result(c, nil, e)
			return
		}
		v.Status = "graded"
	}
	e = tx.Commit(ctx)
	result(c, v, e)
}
func (h *Handler) submissionRecord(c *gin.Context, id string) (store.Submission, bool) {
	s, e := h.q.GetBusinessSubmission(c.Request.Context(), id)
	if e != nil {
		result(c, nil, e)
		return s, false
	}
	if !scope(c, s.CourseID) {
		return s, false
	}
	if !teacher(c) && s.StudentID != identity.Current(c).ID {
		identity.Fail(c, 403, "forbidden", "只能查看本人提交")
		return s, false
	}
	return s, true
}
func (h *Handler) submission(c *gin.Context) {
	s, ok := h.submissionRecord(c, c.Param("id"))
	if !ok {
		return
	}
	question, e := h.q.GetBusinessQuestion(c.Request.Context(), s.QuestionID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if !teacher(c) {
		question.Rubric = ""
		question.CorrectAnswer = ""
		question.BoundRubricID = pgtype.Text{}
		question.BankQuestionVersionID = pgtype.Text{}
	}
	revisions, e := h.q.ListBusinessRevisions(c.Request.Context(), store.ListBusinessRevisionsParams{SubmissionID: s.ID, Teacher: teacher(c)})
	var origin any
	if e == nil {
		v, err := h.q.GetSubmissionImportOrigin(c.Request.Context(), s.ID)
		if err == nil {
			origin = v
		} else if !errors.Is(err, pgx.ErrNoRows) {
			e = err
		}
	}
	result(c, gin.H{"submission": s, "question": question, "revisions": revisions, "import_origin": origin}, e)
}
