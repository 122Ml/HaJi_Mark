package learning

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) assignments(c *gin.Context) {
	v, e := h.q.ListBusinessAssignments(c.Request.Context(), store.ListBusinessAssignmentsParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	if e == nil && v == nil {
		v = []store.Assignment{}
	}
	result(c, v, e)
}
func (h *Handler) assignmentRecord(c *gin.Context, id string) (store.Assignment, bool) {
	return h.assignmentRecordTx(c, h.q, id)
}
func (h *Handler) assignmentRecordTx(c *gin.Context, q *store.Queries, id string) (store.Assignment, bool) {
	a, e := q.GetBusinessAssignment(c.Request.Context(), id)
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
	if e == nil && qs == nil {
		qs = []store.Question{}
	}
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
			ID                    string   `json:"id"`
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
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.Type = strings.TrimSpace(in.Type)
	if in.Type == "" {
		in.Type = "subjective"
	}
	if in.Type != "subjective" && in.Type != "code" && in.Type != "quiz" {
		invalid(c, "作业类型须为subjective、code或quiz")
		return
	}
	if !validText(in.Title, 500) || len(in.Questions) < 1 || len(in.Questions) > 50 {
		invalid(c, "请填写作业名称及1到50道题")
		return
	}
	if len(in.Description) > 30000 || strings.ContainsRune(in.Description, '\x00') {
		invalid(c, "任务说明过长或包含非法字符")
		return
	}
	seenQuestionIDs := map[string]bool{}
	for i := range in.Questions {
		item := &in.Questions[i]
		item.ID = strings.TrimSpace(item.ID)
		item.BankQuestionVersionID = strings.TrimSpace(item.BankQuestionVersionID)
		item.BoundRubricID = strings.TrimSpace(item.BoundRubricID)
		if item.ID != "" {
			if len(item.ID) > 128 || strings.ContainsRune(item.ID, '\x00') || seenQuestionIDs[item.ID] {
				invalid(c, "题目编号无效或重复")
				return
			}
			seenQuestionIDs[item.ID] = true
		}
		if item.BankQuestionVersionID == "" && item.BoundRubricID != "" {
			invalid(c, "标准绑定缺少题目版本")
			return
		}
	}
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	updating := c.Param("id") != ""
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	var old store.Assignment
	if updating {
		var ok bool
		old, ok = h.assignmentRecordTx(c, q, c.Param("id"))
		if !ok {
			return
		}
		if _, e = q.LockBusinessAssignment(ctx, old.ID); e != nil {
			result(c, nil, e)
			return
		}
	}
	points, err := q.ListBusinessPoints(ctx, courseID)
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
	total := int32(0)
	for i := range in.Questions {
		item := &in.Questions[i]
		if item.BankQuestionVersionID != "" {
			v, _, e := h.bankSelection(ctx, q, courseID, item.BankQuestionVersionID, item.BoundRubricID)
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
		} else {
			item.Prompt = strings.TrimSpace(item.Prompt)
			item.Rubric = strings.TrimSpace(item.Rubric)
			item.KnowledgePointID = strings.TrimSpace(item.KnowledgePointID)
			item.ResourceID = strings.TrimSpace(item.ResourceID)
			if in.Type == "quiz" {
				item.CorrectAnswer = strings.TrimSpace(item.CorrectAnswer)
				for j := range item.Options {
					item.Options[j] = strings.TrimSpace(item.Options[j])
				}
			}
		}
		if item.KnowledgePointID != "" && !pointIDs[item.KnowledgePointID] {
			identity.Fail(c, 403, "forbidden", "题目知识点不属于当前课程")
			return
		}
		if item.ResourceID != "" {
			r, e := q.GetBusinessResource(ctx, item.ResourceID)
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
		if !validText(item.Prompt, 30000) || item.MaxScore < 1 || item.MaxScore > 10000 || !validText(item.Rubric, 30000) {
			invalid(c, "每题须填写题目、正数满分和教师评分标准")
			return
		}
		if in.Type == "quiz" {
			found := false
			seen := map[string]bool{}
			for _, option := range item.Options {
				if !validText(option, 1000) || seen[option] {
					invalid(c, "测验选项不能为空、重复或超过1000字节")
					return
				}
				seen[option] = true
				if option == item.CorrectAnswer {
					found = true
				}
			}
			if len(item.Options) < 2 || len(item.Options) > 8 || !found {
				invalid(c, "测验须有2到8个选项且正确答案属于选项")
				return
			}
		} else {
			item.Options = []string{}
			item.CorrectAnswer = ""
		}
		total += item.MaxScore
	}
	due := pgtype.Timestamptz{}
	if in.DueAt != nil {
		due = pgtype.Timestamptz{Time: *in.DueAt, Valid: true}
	}
	var a store.Assignment
	existingIDs := map[string]bool{}
	existingByID := map[string]store.Question{}
	if updating {
		a, e = q.UpdateAssignmentDraft(ctx, store.UpdateAssignmentDraftParams{ID: old.ID, Title: in.Title, Description: in.Description, Type: in.Type, MaxScore: total, DueAt: due})
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 409, "immutable_assignment", "已发布题目不可修改，请新建作业")
			} else {
				result(c, nil, e)
			}
			return
		}
		existingQuestions, err := q.ListBusinessQuestions(ctx, a.ID)
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, eq := range existingQuestions {
			existingIDs[eq.ID] = true
			existingByID[eq.ID] = eq
		}
	} else {
		a, e = q.CreateBusinessAssignment(ctx, store.CreateBusinessAssignmentParams{ID: uuid.NewString(), CourseID: courseID, Title: in.Title, Description: in.Description, Type: in.Type, MaxScore: total, DueAt: due, CreatedBy: identity.Current(c).ID})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	keepIDs := make([]string, 0, len(in.Questions))
	keepSet := make(map[string]bool, len(in.Questions))
	for i, item := range in.Questions {
		options := item.Options
		if options == nil {
			options = []string{}
		}
		var qID string
		if updating && item.ID != "" && existingIDs[item.ID] {
			if _, err := q.LockRubricQuestion(ctx, item.ID); err != nil {
				result(c, nil, err)
				return
			}
			oldQ := existingByID[item.ID]
			rubrics, err := q.ListRubricVersions(ctx, text(item.ID))
			if err != nil {
				result(c, nil, err)
				return
			}
			var ownRubrics []store.ListRubricVersionsRow
			for _, rv := range rubrics {
				if rv.Origin == "assignment" {
					ownRubrics = append(ownRubrics, rv)
				}
			}
			contentUnchanged := oldQ.Prompt == item.Prompt && oldQ.Type == in.Type && oldQ.MaxScore == item.MaxScore && oldQ.Rubric == item.Rubric && slices.Equal(oldQ.Options, options) && oldQ.CorrectAnswer == item.CorrectAnswer
			for _, rv := range ownRubrics {
				if rv.State == "confirmed" && !contentUnchanged {
					identity.Fail(c, 409, "state_conflict", "题目已有已确认评分标准，不能直接修改原题内容")
					return
				}
			}
			if len(ownRubrics) > 0 && (oldQ.MaxScore != item.MaxScore || oldQ.Type != in.Type) {
				identity.Fail(c, 409, "state_conflict", "题目已有评分标准草稿，不能变更满分或题型")
				return
			}
			updated, err := q.UpdateDraftQuestion(ctx, store.UpdateDraftQuestionParams{
				ID:               item.ID,
				AssignmentID:     a.ID,
				Prompt:           item.Prompt,
				Type:             in.Type,
				MaxScore:         item.MaxScore,
				Rubric:           item.Rubric,
				Position:         int32(i),
				Options:          options,
				CorrectAnswer:    item.CorrectAnswer,
				KnowledgePointID: text(item.KnowledgePointID),
				ResourceID:       text(item.ResourceID),
			})
			if err != nil {
				result(c, nil, err)
				return
			}
			qID = updated.ID
			if e = q.BindBankQuestion(ctx, store.BindBankQuestionParams{ID: qID, BankQuestionVersionID: text(item.BankQuestionVersionID), BoundRubricID: text(item.BoundRubricID)}); e != nil {
				result(c, nil, e)
				return
			}
		} else {
			created, err := q.CreateBusinessQuestion(ctx, store.CreateBusinessQuestionParams{
				ID:               uuid.NewString(),
				AssignmentID:     a.ID,
				Prompt:           item.Prompt,
				Type:             in.Type,
				MaxScore:         item.MaxScore,
				Rubric:           item.Rubric,
				Position:         int32(i),
				Options:          options,
				CorrectAnswer:    item.CorrectAnswer,
				KnowledgePointID: text(item.KnowledgePointID),
				ResourceID:       text(item.ResourceID),
			})
			if err != nil {
				result(c, nil, err)
				return
			}
			qID = created.ID
			if item.BankQuestionVersionID != "" {
				if e = q.BindBankQuestion(ctx, store.BindBankQuestionParams{ID: qID, BankQuestionVersionID: text(item.BankQuestionVersionID), BoundRubricID: text(item.BoundRubricID)}); e != nil {
					result(c, nil, e)
					return
				}
			}
		}
		keepIDs = append(keepIDs, qID)
		keepSet[qID] = true
	}
	if updating {
		for eqID := range existingByID {
			if keepSet[eqID] {
				continue
			}
			if _, err := q.LockRubricQuestion(ctx, eqID); err != nil {
				result(c, nil, err)
				return
			}
			rubrics, err := q.ListRubricVersions(ctx, text(eqID))
			if err != nil {
				result(c, nil, err)
				return
			}
			hasOwnRubric := false
			for _, rv := range rubrics {
				if rv.Origin == "assignment" {
					hasOwnRubric = true
					break
				}
			}
			if hasOwnRubric {
				identity.Fail(c, 409, "state_conflict", "已关联评分标准的草稿题目不可直接删除")
				return
			}
		}
		if e = q.DeleteDraftQuestionsExcept(ctx, store.DeleteDraftQuestionsExceptParams{AssignmentID: a.ID, KeepIds: keepIDs}); e != nil {
			result(c, nil, e)
			return
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
	previous := "draft"
	if in.State == "closed" {
		previous = "published"
	} else if in.State != "published" {
		invalid(c, "只允许发布或关闭作业")
		return
	}
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
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
	a, e = q.GetBusinessAssignment(ctx, a.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if a.Status != previous {
		identity.Fail(c, 409, "state_conflict", "作业状态已改变")
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
			} else {
				versions, err := q.ListRubricVersions(ctx, text(item.ID))
				if err != nil {
					result(c, nil, err)
					return
				}
				for _, rv := range versions {
					if rv.State != "confirmed" {
						continue
					}
					var criteria []criterion
					if json.Unmarshal(rv.Criteria, &criteria) != nil {
						invalid(c, "题目确认的评分标准格式无效")
						return
					}
					var sum int32
					for _, cr := range criteria {
						sum += cr.MaxScore
					}
					if sum != item.MaxScore {
						invalid(c, "题目确认评分标准满分之和与题目满分不一致")
						return
					}
				}
			}
		}
	}
	v, e := q.UpdateBusinessAssignmentState(ctx, store.UpdateBusinessAssignmentStateParams{ID: a.ID, Status: in.State, Status_2: previous})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "作业状态已改变")
		return
	}
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
	if e == nil && v == nil {
		v = []store.ListBusinessSubmissionsRow{}
	}
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
	if blank(in.Answer) || len(in.Answer) > 200000 || strings.ContainsRune(in.Answer, '\x00') || !validText(in.RequestID, 128) || !validText(in.QuestionID, 128) {
		invalid(c, "请填写答案和有效请求号")
		return
	}
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	ctx := c.Request.Context()
	actorID := identity.Current(c).ID
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessAssignmentShare(ctx, a.ID); e != nil {
		result(c, nil, e)
		return
	}
	// Serialize concurrent submissions from the same student without blocking other students.
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('submit'), hashtext($1))", actorID); e != nil {
		result(c, nil, e)
		return
	}
	old, e := q.GetSubmissionByRequest(ctx, store.GetSubmissionByRequestParams{StudentID: actorID, RequestID: in.RequestID})
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
	if question.Type == "quiz" && len(question.Options) > 0 && !slices.Contains(question.Options, in.Answer) {
		invalid(c, "测验答案必须为本题选项之一")
		return
	}
	attempt, e := q.NextSubmissionAttempt(ctx, store.NextSubmissionAttemptParams{StudentID: actorID, QuestionID: question.ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if attempt > 1 && question.Type == "quiz" {
		allowedRetry, err := q.HasAssignedQuizIntervention(ctx, store.HasAssignedQuizInterventionParams{
			CourseID:     a.CourseID,
			StudentID:    actorID,
			AssignmentID: text(a.ID),
			QuestionID:   question.ID,
		})
		if err != nil {
			result(c, nil, err)
			return
		}
		if !allowedRetry {
			identity.Fail(c, 409, "attempt_limit", "客观题默认限提交一次，需教师分配补练任务后方可重做")
			return
		}
	}
	v, e := q.CreateBusinessSubmission(ctx, store.CreateBusinessSubmissionParams{ID: uuid.NewString(), AssignmentID: a.ID, AssignmentVersion: a.Version, QuestionID: question.ID, CourseID: a.CourseID, StudentID: actorID, Attempt: attempt, AnswerText: in.Answer, AnswerSha256: hashAnswer(in.Answer), RequestID: in.RequestID})
	if e != nil {
		if isPgCode(e, "23505") {
			_ = tx.Rollback(ctx)
			existing, err := h.q.GetSubmissionByRequest(ctx, store.GetSubmissionByRequestParams{StudentID: actorID, RequestID: in.RequestID})
			if err == nil {
				if existing.AssignmentID != a.ID || existing.QuestionID != in.QuestionID || existing.AnswerText != in.Answer {
					identity.Fail(c, 409, "request_conflict", "相同请求号不能改变答案")
					return
				}
				result(c, existing, nil)
				return
			}
			identity.Fail(c, 409, "request_conflict", "提交冲突，请重试")
			return
		}
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
	ctx := c.Request.Context()
	s, e := h.q.GetBusinessSubmissionWithStudent(ctx, c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, s.CourseID) {
		return
	}
	if !teacher(c) && s.StudentID != identity.Current(c).ID {
		identity.Fail(c, 403, "forbidden", "只能查看本人提交")
		return
	}
	question, e := h.q.GetBusinessQuestion(ctx, s.QuestionID)
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
	revisions, e := h.q.ListBusinessRevisions(ctx, store.ListBusinessRevisionsParams{SubmissionID: s.ID, Teacher: teacher(c)})
	if e == nil && revisions == nil {
		revisions = []store.GradingRevision{}
	}
	var origin any
	if e == nil {
		v, err := h.q.GetSubmissionImportOrigin(ctx, s.ID)
		if err == nil {
			if teacher(c) {
				origin = v
			} else {
				origin = gin.H{"id": v.ID, "created_at": v.CreatedAt, "imported": true}
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			e = err
		}
	}
	var activeRegradeBatch *string
	if e == nil && teacher(c) {
		batchID, err := h.q.GetActiveRegradeBatchForQuestion(ctx, s.QuestionID)
		if err == nil {
			activeRegradeBatch = &batchID
		} else if !errors.Is(err, pgx.ErrNoRows) {
			e = err
		}
	}
	result(c, gin.H{
		"submission":           s,
		"question":             question,
		"revisions":            revisions,
		"import_origin":        origin,
		"active_regrade_batch": activeRegradeBatch,
	}, e)
}
