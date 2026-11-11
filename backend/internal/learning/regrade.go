package learning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) regrades(c *gin.Context) {
	v, e := h.q.ListRegradeBatches(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
func (h *Handler) regradeDetail(c *gin.Context) {
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	b, e := q.LockRegradeBatch(ctx, store.LockRegradeBatchParams{ID: c.Param("batchID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	items, e := q.ListRegradeItems(ctx, b.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	var r any
	if b.RubricID.Valid {
		r, e = q.GetRubricVersion(ctx, b.RubricID.String)
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	result(c, gin.H{"batch": b, "items": items, "rubric": r}, tx.Commit(ctx))
}
func sameQuestion(a, b store.Question) bool {
	return a.Prompt == b.Prompt && a.Type == b.Type && a.MaxScore == b.MaxScore && reflect.DeepEqual(a.Options, b.Options)
}
func (h *Handler) createRegrade(c *gin.Context) {
	var in struct {
		QuestionID    string `json:"question_id"`
		RubricID      string `json:"rubric_id"`
		CorrectAnswer string `json:"correct_answer"`
		Reason        string `json:"reason"`
		Preview       bool   `json:"preview"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Reason, 5000) {
		invalid(c, "请填写重评原因")
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
	question, e := q.GetBusinessQuestion(ctx, in.QuestionID)
	if e != nil {
		result(c, nil, e)
		return
	}
	a, e := q.GetAssignmentForUpdate(ctx, question.AssignmentID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, a.CourseID) {
		return
	}
	if a.Status != "closed" {
		invalid(c, "请先关闭作业，再冻结整组有效提交")
		return
	}
	active, e := q.ActiveRegradeForQuestion(ctx, question.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if active {
		identity.Fail(c, 409, "regrade_active", "本题已有活动重评批次")
		return
	}
	var r store.RubricVersion
	if question.Type == "quiz" {
		if in.RubricID != "" || !stringIn(question.Options, in.CorrectAnswer) {
			invalid(c, "请选择原选项中的更正答案")
			return
		}
	} else {
		r, e = q.GetRubricVersion(ctx, in.RubricID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if r.State != "confirmed" {
			invalid(c, "请选择已确认的新标准")
			return
		}
		if r.BankQuestionVersionID.Valid {
			v, e := q.GetBankQuestionVersion(ctx, r.BankQuestionVersionID.String)
			if e != nil {
				result(c, nil, e)
				return
			}
			b, e := q.GetQuestionBank(ctx, store.GetQuestionBankParams{ID: v.BankID, CourseID: a.CourseID})
			if e != nil || b.Archived || v.State != "confirmed" {
				invalid(c, "新标准的题目不可用")
				return
			}
			if v.Prompt != question.Prompt || v.Type != question.Type || v.MaxScore != question.MaxScore || !reflect.DeepEqual(v.Options, question.Options) {
				invalid(c, "题干、题型、选项或满分改变须另建任务")
				return
			}
		} else if r.QuestionID.String != question.ID {
			invalid(c, "标准不属于本题")
			return
		}
		var criteria []criterion
		if json.Unmarshal(r.Criteria, &criteria) != nil {
			invalid(c, "新标准格式无效")
			return
		}
		var sum int32
		for _, p := range criteria {
			sum += p.MaxScore
		}
		if sum != question.MaxScore {
			invalid(c, "新标准满分不符")
			return
		}
		ids, e := rag.EvidenceIDs(r.EvidenceRefs)
		if e == nil {
			_, e = rag.ResolveEvidence(ctx, q, a.CourseID, ids)
		}
		if e != nil {
			ragError(c, e)
			return
		}
	}
	submissions, e := q.EffectiveQuestionSubmissions(ctx, question.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(submissions) == 0 {
		invalid(c, "本题没有有效提交，未交学生不补零分")
		return
	}
	if in.Preview {
		result(c, gin.H{"question": question, "rubric": r, "submissions": submissions, "count": len(submissions)}, nil)
		return
	}
	snapshot, _ := json.Marshal(question)
	b, e := q.CreateRegradeBatch(ctx, store.CreateRegradeBatchParams{ID: uuid.NewString(), CourseID: a.CourseID, QuestionID: question.ID, RubricID: text(in.RubricID), CorrectAnswer: in.CorrectAnswer, Reason: in.Reason, QuestionSnapshot: snapshot, CreatedBy: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	for _, s := range submissions {
		next, e := q.NextBusinessRevision(ctx, s.ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if e = q.CreateRegradeItem(ctx, store.CreateRegradeItemParams{BatchID: b.ID, SubmissionID: s.ID, AnswerSha256: s.AnswerSha256, BaselineRevision: next - 1}); e != nil {
			result(c, nil, e)
			return
		}
	}
	result(c, b, tx.Commit(ctx))
}
func stringIn(values []string, value string) bool {
	for _, s := range values {
		if s == value {
			return true
		}
	}
	return false
}
func regradePoints(criteria []criterion, points []pointScore, answer string) (json.RawMessage, int32, error) {
	if len(criteria) != len(points) {
		return nil, 0, errors.New("请完整填写逐点评分")
	}
	byID := map[string]pointScore{}
	for _, p := range points {
		if _, ok := byID[p.CriterionID]; ok {
			return nil, 0, errors.New("评分点重复")
		}
		byID[p.CriterionID] = p
	}
	out := []pointFeedback{}
	var sum int32
	for _, item := range criteria {
		p, ok := byID[item.ID]
		if !ok || p.Score < 0 || p.Score > item.MaxScore || !validText(p.Feedback, 5000) || len(p.Quote) > 5000 || (p.Quote != "" && !strings.Contains(answer, p.Quote)) {
			return nil, 0, errors.New("分值、评语或原文引用无效")
		}
		sum += p.Score
		out = append(out, pointFeedback{pointScore: p, Title: item.Title, MaxScore: item.MaxScore})
	}
	raw, _ := json.Marshal(out)
	return raw, sum, nil
}
func (h *Handler) saveRegradeItem(c *gin.Context) {
	var in struct {
		Score       int32        `json:"score"`
		Feedback    string       `json:"feedback"`
		Points      []pointScore `json:"points"`
		Confirmed   bool         `json:"confirmed"`
		EditVersion int32        `json:"edit_version"`
		AIJobID     string       `json:"ai_job_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Feedback, 30000) {
		invalid(c, "请填写反馈")
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
	b, e := q.LockRegradeBatch(ctx, store.LockRegradeBatchParams{ID: c.Param("batchID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.State != "active" {
		identity.Fail(c, 409, "state_conflict", "批次已结束")
		return
	}
	items, e := q.ListRegradeItems(ctx, b.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	var item *store.ListRegradeItemsRow
	for i := range items {
		if items[i].SubmissionID == c.Param("submissionID") {
			item = &items[i]
		}
	}
	if item == nil {
		identity.Fail(c, 404, "not_found", "提交不在冻结名单中")
		return
	}
	if item.EditVersion != in.EditVersion {
		identity.Fail(c, 409, "stale_revision", "本份重评已改变，请刷新")
		return
	}
	var question store.Question
	_ = json.Unmarshal(b.QuestionSnapshot, &question)
	if in.Score < 0 || in.Score > question.MaxScore {
		invalid(c, "分数超出满分")
		return
	}
	raw := json.RawMessage("[]")
	if b.RubricID.Valid {
		r, e := q.GetRubricVersion(ctx, b.RubricID.String)
		if e != nil {
			result(c, nil, e)
			return
		}
		var criteria []criterion
		_ = json.Unmarshal(r.Criteria, &criteria)
		var total int32
		raw, total, e = regradePoints(criteria, in.Points, item.AnswerText)
		if e != nil || total != in.Score {
			invalid(c, "逐点给分、引用或总分加和不正确")
			return
		}
	} else {
		score := int32(0)
		if item.AnswerText == b.CorrectAnswer {
			score = question.MaxScore
		}
		if in.Score != score {
			invalid(c, "客观题重评须使用本批固定答案规则")
			return
		}
	}
	if in.AIJobID != "" {
		_, snapshot, e := h.draftJob(c, in.AIJobID, "grade")
		if e != nil || snapshot.SubmissionID != item.SubmissionID || snapshot.AnswerHash != item.AnswerSha256 || snapshot.RubricID != b.RubricID.String {
			invalid(c, "AI草稿与重评输入不符")
			return
		}
	}
	v, e := q.SaveRegradeItem(ctx, store.SaveRegradeItemParams{BatchID: b.ID, SubmissionID: item.SubmissionID, Score: pgtype.Int4{Int32: in.Score, Valid: true}, Feedback: in.Feedback, PointScores: raw, Confirmed: in.Confirmed, AiJobID: text(in.AIJobID), EditVersion: in.EditVersion})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}

func (h *Handler) regradeState(c *gin.Context) {
	var in struct {
		State string `json:"state"`
	}
	if !bind(c, &in) {
		return
	}
	if in.State != "released" && in.State != "canceled" {
		invalid(c, "只允许统一发布或取消批次")
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
	b, e := q.LockRegradeBatch(ctx, store.LockRegradeBatchParams{ID: c.Param("batchID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.State == in.State {
		result(c, b, nil)
		return
	}
	if b.State != "active" {
		identity.Fail(c, 409, "state_conflict", "批次已结束")
		return
	}
	if in.State == "released" {
		if e = h.publishRegrade(ctx, q, b, identity.Current(c).ID); e != nil {
			identity.Fail(c, 409, "regrade_conflict", e.Error())
			return
		}
	}
	v, e := q.RegradeBatchState(ctx, store.RegradeBatchStateParams{ID: b.ID, CourseID: b.CourseID, State: in.State})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}
func (h *Handler) publishRegrade(ctx context.Context, q *store.Queries, b store.RegradeBatch, actor string) error {
	current, e := q.GetBusinessQuestion(ctx, b.QuestionID)
	if e != nil {
		return e
	}
	a, e := q.GetAssignmentForUpdate(ctx, current.AssignmentID)
	if e != nil {
		return e
	}
	var frozen store.Question
	_ = json.Unmarshal(b.QuestionSnapshot, &frozen)
	if a.Status != "closed" || !sameQuestion(current, frozen) {
		return errors.New("作业状态或题目内容已改变，重新预览后建立批次")
	}
	if b.RubricID.Valid {
		r, err := q.GetRubricVersion(ctx, b.RubricID.String)
		if err != nil {
			return err
		}
		ids, err := rag.EvidenceIDs(r.EvidenceRefs)
		if err != nil {
			return err
		}
		if _, err = rag.ResolveEvidence(ctx, q, b.CourseID, ids); err != nil {
			return err
		}
	}
	submissions, e := q.EffectiveQuestionSubmissions(ctx, current.ID)
	if e != nil {
		return e
	}
	items, e := q.ListRegradeItems(ctx, b.ID)
	if e != nil {
		return e
	}
	if len(submissions) != len(items) || len(items) == 0 {
		return errors.New("冻结名单发生变化")
	}
	for i, item := range items {
		s := submissions[i]
		if s.ID != item.SubmissionID || s.AnswerSha256 != item.AnswerSha256 || !item.Confirmed || !item.Score.Valid {
			return errors.New("整组尚未全部确认或提交发生变化")
		}
		if _, e = q.LockBusinessSubmission(ctx, s.ID); e != nil {
			return e
		}
		next, e := q.NextBusinessRevision(ctx, s.ID)
		if e != nil {
			return e
		}
		if next-1 != item.BaselineRevision {
			return errors.New("存在并行评分修订，请重新预览")
		}
		revision, e := q.CreatePointRevision(ctx, store.CreatePointRevisionParams{ID: uuid.NewString(), SubmissionID: s.ID, Revision: next, Score: item.Score.Int32, Feedback: item.Feedback, ReviewerID: actor, RequestID: fmt.Sprintf("regrade:%s:%s", b.ID, s.ID), RubricID: b.RubricID, PointScores: item.PointScores})
		if e != nil {
			return e
		}
		if e = q.AttachRegradeRevision(ctx, store.AttachRegradeRevisionParams{ID: revision.ID, RegradeBatchID: text(b.ID)}); e != nil {
			return e
		}
		if current.Type == "quiz" {
			if e = q.SetRevisionMethod(ctx, store.SetRevisionMethodParams{ID: revision.ID, Method: "rule"}); e != nil {
				return e
			}
		}
		if item.AiJobID.Valid {
			if e = q.AttachGradingJob(ctx, store.AttachGradingJobParams{ID: revision.ID, AiJobID: item.AiJobID}); e != nil {
				return e
			}
		}
		if _, e = q.TransitionBusinessRevision(ctx, store.TransitionBusinessRevisionParams{ID: revision.ID, State: "confirmed", State_2: "draft"}); e != nil {
			return e
		}
		if _, e = q.TransitionBusinessRevision(ctx, store.TransitionBusinessRevisionParams{ID: revision.ID, State: "released", State_2: "confirmed"}); e != nil {
			return e
		}
		if e = q.MarkBusinessSubmissionGraded(ctx, s.ID); e != nil {
			return e
		}
	}
	return nil
}
func (h *Handler) regradeAI(c *gin.Context) {
	if h.rag == nil {
		invalid(c, "模型未启用")
		return
	}
	var in struct {
		ProfileID string `json:"profile_id"`
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
	b, e := q.LockRegradeBatch(ctx, store.LockRegradeBatchParams{ID: c.Param("batchID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.State != "active" || !b.RubricID.Valid {
		invalid(c, "批次不可生成主观评分草稿")
		return
	}
	items, e := q.ListRegradeItems(ctx, b.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	for _, item := range items {
		if item.SubmissionID != c.Param("submissionID") {
			continue
		}
		r, e := q.GetRubricVersion(ctx, b.RubricID.String)
		if e != nil {
			result(c, nil, e)
			return
		}
		var question store.Question
		_ = json.Unmarshal(b.QuestionSnapshot, &question)
		j, e := h.rag.CreateJob(ctx, b.CourseID, identity.Current(c).ID, "grade", rag.JobInput{SubmissionID: item.SubmissionID, QuestionID: question.ID, AnswerHash: item.AnswerSha256, Answer: item.AnswerText, Prompt: question.Prompt, MaxScore: question.MaxScore, RubricID: r.ID, Criteria: r.Criteria, EvidenceRefs: r.EvidenceRefs, ProfileID: in.ProfileID})
		result(c, j, e)
		return
	}
	identity.Fail(c, 404, "not_found", "提交不在冻结名单中")
}
