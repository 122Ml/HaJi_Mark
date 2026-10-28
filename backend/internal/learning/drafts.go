package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) draftQuestion(c *gin.Context) (store.Question, bool) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return store.Question{}, false
	}
	q, e := h.q.GetBusinessQuestion(c.Request.Context(), c.Param("questionID"))
	if e != nil {
		result(c, nil, e)
		return q, false
	}
	if q.AssignmentID != a.ID {
		identity.Fail(c, 403, "forbidden", "题目不属于当前作业")
		return q, false
	}
	return q, true
}
func (h *Handler) draft(c *gin.Context) {
	q, ok := h.draftQuestion(c)
	if !ok {
		return
	}
	v, e := h.q.GetAnswerDraft(c.Request.Context(), store.GetAnswerDraftParams{StudentID: identity.Current(c).ID, QuestionID: q.ID})
	if errors.Is(e, pgx.ErrNoRows) {
		c.JSON(200, gin.H{"data": nil})
		return
	}
	result(c, v, e)
}
func (h *Handler) saveDraft(c *gin.Context) {
	q, ok := h.draftQuestion(c)
	if !ok {
		return
	}
	var in struct {
		Answer string `json:"answer_text"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Answer) > 200000 {
		invalid(c, "草稿过长")
		return
	}
	v, e := h.q.SaveAnswerDraft(c.Request.Context(), store.SaveAnswerDraftParams{StudentID: identity.Current(c).ID, QuestionID: q.ID, AnswerText: in.Answer})
	result(c, v, e)
}
func (h *Handler) evidence(c *gin.Context) {
	v, e := h.q.CourseReleasedEvidence(c.Request.Context(), store.CourseReleasedEvidenceParams{CourseID: c.Param("courseID"), Teacher: teacher(c), ActorID: identity.Current(c).ID})
	result(c, v, e)
}
