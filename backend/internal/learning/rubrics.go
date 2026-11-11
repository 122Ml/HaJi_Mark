package learning

import (
	"encoding/json"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Rules stay teacher-only. A revision contains only the point labels, scores,
// comments and answer quotations that may become student feedback.
type criterion struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	MaxScore int32  `json:"max_score"`
	Rule     string `json:"rule"`
}
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

func (h *Handler) rubricQuestion(c *gin.Context, id string) (store.Question, bool) {
	question, err := h.q.GetBusinessQuestion(c.Request.Context(), id)
	if err != nil {
		result(c, nil, err)
		return question, false
	}
	a, ok := h.assignmentRecord(c, question.AssignmentID)
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
	v, err := h.q.ListRubricVersions(c.Request.Context(), question.ID)
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
	if len(in.Criteria) < 1 || len(in.Criteria) > 30 {
		invalid(c, "请填写1到30个评分点")
		return
	}
	var sum int32
	seen := map[string]bool{}
	for _, p := range in.Criteria {
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
	raw, _ := json.Marshal(in.Criteria)
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
		evidence = out.Evidence
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
	v, err := q.CreateRubricVersion(ctx, store.CreateRubricVersionParams{ID: uuid.NewString(), QuestionID: question.ID, Criteria: raw, CreatedBy: identity.Current(c).ID})
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
	r, err := h.q.GetRubricVersion(c.Request.Context(), c.Param("id"))
	if err != nil {
		result(c, nil, err)
		return
	}
	if _, ok := h.rubricQuestion(c, r.QuestionID); !ok {
		return
	}
	if r.State != "draft" {
		identity.Fail(c, 409, "state_conflict", "标准已确认，修改请另建版本")
		return
	}
	v, err := h.q.ConfirmRubricVersion(c.Request.Context(), r.ID)
	result(c, v, err)
}

func (h *Handler) scorePoints(c *gin.Context, rubricID string, points []pointScore, s store.Submission) ([]byte, int32, bool) {
	r, err := h.q.GetRubricVersion(c.Request.Context(), rubricID)
	if err != nil {
		result(c, nil, err)
		return nil, 0, false
	}
	if r.QuestionID != s.QuestionID || r.State != "confirmed" {
		invalid(c, "请选择本题已确认的标准版本")
		return nil, 0, false
	}
	var criteria []criterion
	if err = json.Unmarshal(r.Criteria, &criteria); err != nil {
		result(c, nil, err)
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
	var sum int32
	feedback := make([]pointFeedback, 0, len(criteria))
	for _, item := range criteria {
		p, ok := byID[item.ID]
		if !ok || p.Score < 0 || p.Score > item.MaxScore || !validText(p.Feedback, 5000) || len(p.Quote) > 5000 || (p.Quote != "" && !strings.Contains(s.AnswerText, p.Quote)) {
			invalid(c, "逐点分数、评语或原文引用不符合标准")
			return nil, 0, false
		}
		sum += p.Score
		feedback = append(feedback, pointFeedback{pointScore: p, Title: item.Title, MaxScore: item.MaxScore})
	}
	raw, _ := json.Marshal(feedback)
	return raw, sum, true
}
