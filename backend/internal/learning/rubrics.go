package learning

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Rules stay teacher-only. A revision contains only the point labels, scores,
// comments and answer quotations that may become student feedback.
type criterion = rag.Criterion
type pointScore struct {
	CriterionID string `json:"criterion_id"`
	Score       int32  `json:"score"`
	Feedback    string `json:"feedback"`
	Quote       string `json:"quote"`
}
type pointFeedback struct {
	pointScore
	Title    string `json:"title"`
	MaxScore int32  `json:"max_score"`
}

func normalizeLineEndings(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

func (h *Handler) rubricQuestion(c *gin.Context, id string) (store.Question, bool) {
	return h.rubricQuestionTx(c, h.q, id)
}
func (h *Handler) rubricQuestionTx(c *gin.Context, q *store.Queries, id string) (store.Question, bool) {
	question, err := q.GetBusinessQuestion(c.Request.Context(), id)
	if err != nil {
		result(c, nil, err)
		return question, false
	}
	a, ok := h.assignmentRecordTx(c, q, question.AssignmentID)
	if !ok {
		return question, false
	}
	if a.Type == "quiz" {
		invalid(c, "客观题使用已发布的答案规则判分")
		return question, false
	}
	return question, true
}
func (h *Handler) rubrics(c *gin.Context) {
	question, ok := h.rubricQuestion(c, c.Param("id"))
	if !ok {
		return
	}
	v, err := h.q.ListRubricVersions(c.Request.Context(), text(question.ID))
	if err == nil && v == nil {
		v = []store.ListRubricVersionsRow{}
	}
	result(c, v, err)
}
func (h *Handler) createRubric(c *gin.Context) {
	var in struct {
		Criteria []criterion `json:"criteria"`
		AIJobID  string      `json:"ai_job_id"`
	}
	if !bind(c, &in) {
		return
	}
	question, ok := h.rubricQuestion(c, c.Param("id"))
	if !ok {
		return
	}
	if question.BankQuestionVersionID.Valid {
		invalid(c, "题库题目的标准在题库维护，本次作业使用固定版本")
		return
	}
	if len(in.Criteria) < 1 || len(in.Criteria) > 30 {
		invalid(c, "请填写1到30个评分点")
		return
	}
	var sum int32
	seen := map[string]bool{}
	for i := range in.Criteria {
		in.Criteria[i].ID = strings.TrimSpace(in.Criteria[i].ID)
		in.Criteria[i].Title = strings.TrimSpace(in.Criteria[i].Title)
		in.Criteria[i].Rule = strings.TrimSpace(in.Criteria[i].Rule)
		p := in.Criteria[i]
		if !validText(p.ID, 100) || seen[p.ID] || !validText(p.Title, 300) || !validText(p.Rule, 5000) || p.MaxScore < 1 || p.MaxScore > question.MaxScore {
			invalid(c, "评分点编号须唯一，名称、规则及正数分值须完整")
			return
		}
		seen[p.ID] = true
		sum += p.MaxScore
	}
	if sum != question.MaxScore {
		invalid(c, "各评分点满分之和必须等于本题满分")
		return
	}
	raw, err := json.Marshal(in.Criteria)
	if err != nil {
		result(c, nil, err)
		return
	}
	evidence := []byte("[]")
	if in.AIJobID != "" {
		j, snapshot, err := h.draftJob(c, in.AIJobID, "rubric")
		if err != nil {
			ragError(c, err)
			return
		}
		if snapshot.QuestionID != question.ID || snapshot.Prompt != question.Prompt || snapshot.MaxScore != question.MaxScore {
			invalid(c, "题目已改变，请重新起草标准")
			return
		}
		var out struct {
			Evidence json.RawMessage `json:"evidence_refs"`
		}
		if json.Unmarshal(j.Output, &out) != nil {
			invalid(c, "AI依据无效")
			return
		}
		if trimmed := bytes.TrimSpace(out.Evidence); len(trimmed) > 0 && string(trimmed) != "null" {
			var refs []json.RawMessage
			if json.Unmarshal(trimmed, &refs) != nil {
				invalid(c, "AI依据格式无效")
				return
			}
			evidence = trimmed
		}
	}
	ctx := c.Request.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		result(c, nil, err)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, err = q.LockRubricQuestion(ctx, question.ID); err != nil {
		result(c, nil, err)
		return
	}
	if ids, idErr := rag.EvidenceIDs(evidence); idErr != nil {
		ragError(c, idErr)
		return
	} else if len(ids) > 0 {
		if _, rErr := rag.ResolveEvidence(ctx, q, c.Param("courseID"), ids); rErr != nil {
			ragError(c, rErr)
			return
		}
	}
	v, err := q.CreateRubricVersion(ctx, store.CreateRubricVersionParams{ID: uuid.NewString(), QuestionID: text(question.ID), Criteria: raw, CreatedBy: identity.Current(c).ID})
	if err != nil {
		result(c, nil, err)
		return
	}
	if len(evidence) > 0 {
		if err = q.AttachRubricEvidence(ctx, store.AttachRubricEvidenceParams{ID: v.ID, EvidenceRefs: evidence}); err != nil {
			result(c, nil, err)
			return
		}
		v.EvidenceRefs = evidence
	}
	result(c, v, tx.Commit(ctx))
}
func (h *Handler) confirmRubric(c *gin.Context) {
	ctx := c.Request.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		result(c, nil, err)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	r, err := q.GetRubricVersion(ctx, c.Param("id"))
	if err != nil {
		result(c, nil, err)
		return
	}
	if r.BankQuestionVersionID.Valid {
		v, e := q.GetBankQuestionVersion(ctx, r.BankQuestionVersionID.String)
		if e != nil {
			result(c, nil, e)
			return
		}
		b, e := q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: v.BankID, CourseID: c.Param("courseID")})
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 403, "forbidden", "题目不属于当前课程")
				return
			}
			result(c, nil, e)
			return
		}
		if b.Archived {
			invalid(c, "题目已停用")
			return
		}
		// Read confirmation states after acquiring the shared bank lock.
		v, e = q.GetBankQuestionVersion(ctx, v.ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if v.State != "confirmed" || (v.ReferenceAnswer != "" && v.ReferenceState != "confirmed") {
			invalid(c, "请先确认题目和参考解答")
			return
		}
		ids, e := rag.EvidenceIDs(r.EvidenceRefs)
		if e == nil {
			_, e = rag.ResolveEvidence(ctx, q, c.Param("courseID"), ids)
		}
		if e != nil {
			ragError(c, e)
			return
		}
	} else {
		question, ok := h.rubricQuestionTx(c, q, r.QuestionID.String)
		if !ok {
			return
		}
		if _, err = q.LockRubricQuestion(ctx, question.ID); err != nil {
			result(c, nil, err)
			return
		}
		r, err = q.GetRubricVersion(ctx, r.ID)
		if err != nil {
			result(c, nil, err)
			return
		}
		if ids, idErr := rag.EvidenceIDs(r.EvidenceRefs); idErr != nil {
			ragError(c, idErr)
			return
		} else if len(ids) > 0 {
			if _, rErr := rag.ResolveEvidence(ctx, q, c.Param("courseID"), ids); rErr != nil {
				ragError(c, rErr)
				return
			}
		}
	}
	if r.State != "draft" {
		identity.Fail(c, 409, "state_conflict", "标准已确认，修改请另建版本")
		return
	}
	v, err := q.ConfirmRubricVersion(ctx, r.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			identity.Fail(c, 409, "state_conflict", "标准状态已改变，请刷新")
			return
		}
		result(c, nil, err)
		return
	}
	result(c, v, tx.Commit(ctx))
}

func (h *Handler) scorePoints(c *gin.Context, rubricID string, points []pointScore, s store.Submission) ([]byte, int32, bool) {
	return h.scorePointsTx(c, h.q, rubricID, points, s)
}

func (h *Handler) scorePointsTx(c *gin.Context, q *store.Queries, rubricID string, points []pointScore, s store.Submission) ([]byte, int32, bool) {
	r, err := q.GetRubricVersion(c.Request.Context(), rubricID)
	if err != nil {
		result(c, nil, err)
		return nil, 0, false
	}
	question, err := q.GetBusinessQuestion(c.Request.Context(), s.QuestionID)
	if err != nil {
		result(c, nil, err)
		return nil, 0, false
	}
	if !rubricMatches(question, r) {
		invalid(c, "请选择本题已确认的标准版本")
		return nil, 0, false
	}
	var criteria []criterion
	if err = json.Unmarshal(r.Criteria, &criteria); err != nil {
		result(c, nil, err)
		return nil, 0, false
	}
	var criteriaMax int32
	for _, item := range criteria {
		criteriaMax += item.MaxScore
	}
	if criteriaMax != question.MaxScore {
		invalid(c, "评分标准满分之和与题目满分不一致")
		return nil, 0, false
	}
	if len(points) != len(criteria) {
		invalid(c, "请完整填写每个评分点")
		return nil, 0, false
	}
	byID := map[string]pointScore{}
	for _, p := range points {
		if _, exists := byID[p.CriterionID]; exists {
			invalid(c, "评分点不能重复")
			return nil, 0, false
		}
		byID[p.CriterionID] = p
	}
	normalizedAnswer := normalizeLineEndings(s.AnswerText)
	var sum int32
	feedback := make([]pointFeedback, 0, len(criteria))
	for _, item := range criteria {
		p, ok := byID[item.ID]
		if !ok || p.Score < 0 || p.Score > item.MaxScore || !validText(p.Feedback, 5000) || len(p.Quote) > 5000 || strings.ContainsRune(p.Quote, '\x00') || (p.Quote != "" && !strings.Contains(normalizedAnswer, normalizeLineEndings(p.Quote))) {
			invalid(c, "逐点分数、评语或原文引用不符合标准")
			return nil, 0, false
		}
		sum += p.Score
		feedback = append(feedback, pointFeedback{pointScore: p, Title: item.Title, MaxScore: item.MaxScore})
	}
	raw, err := json.Marshal(feedback)
	if err != nil {
		result(c, nil, err)
		return nil, 0, false
	}
	return raw, sum, true
}
