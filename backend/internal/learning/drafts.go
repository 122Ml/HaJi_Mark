package learning

import (
	"errors"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) draftQuestion(c *gin.Context) (store.Assignment, store.Question, bool) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return store.Assignment{}, store.Question{}, false
	}
	q, e := h.q.GetBusinessQuestion(c.Request.Context(), c.Param("questionID"))
	if e != nil {
		result(c, nil, e)
		return a, q, false
	}
	if q.AssignmentID != a.ID {
		identity.Fail(c, 403, "forbidden", "题目不属于当前作业")
		return a, q, false
	}
	return a, q, true
}
func (h *Handler) draft(c *gin.Context) {
	_, q, ok := h.draftQuestion(c)
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
	a, q, ok := h.draftQuestion(c)
	if !ok {
		return
	}
	if a.Status != "published" {
		identity.Fail(c, 409, "assignment_closed", "作业未发布或已关闭")
		return
	}
	if a.DueAt.Valid && time.Now().After(a.DueAt.Time) {
		identity.Fail(c, 409, "assignment_closed", "作业已过截止时间，无法保存草稿")
		return
	}
	var in struct {
		Answer string `json:"answer_text"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Answer) > 200000 || strings.ContainsRune(in.Answer, '\x00') {
		invalid(c, "草稿过长或包含非法字符")
		return
	}
	v, e := h.q.SaveAnswerDraft(c.Request.Context(), store.SaveAnswerDraftParams{StudentID: identity.Current(c).ID, QuestionID: q.ID, AnswerText: in.Answer})
	result(c, v, e)
}
func (h *Handler) evidence(c *gin.Context) {
	studentID := strings.TrimSpace(c.Query("student_id"))
	if len(studentID) > 128 || strings.ContainsRune(studentID, '\x00') {
		invalid(c, "学生编号无效")
		return
	}
	if !teacher(c) {
		if studentID != "" && studentID != identity.Current(c).ID {
			identity.Fail(c, 403, "forbidden", "只能查看本人的评分证据")
			return
		}
		v, e := h.q.CourseReleasedEvidence(c.Request.Context(), store.CourseReleasedEvidenceParams{CourseID: c.Param("courseID"), Teacher: false, ActorID: identity.Current(c).ID})
		if e == nil && v == nil {
			v = []store.CourseReleasedEvidenceRow{}
		}
		result(c, v, e)
		return
	}
	if studentID != "" {
		v, e := h.q.CourseReleasedEvidenceForStudent(c.Request.Context(), store.CourseReleasedEvidenceForStudentParams{CourseID: c.Param("courseID"), StudentID: studentID})
		if e == nil && v == nil {
			v = []store.CourseReleasedEvidenceForStudentRow{}
		}
		result(c, v, e)
		return
	}
	v, e := h.q.CourseReleasedEvidence(c.Request.Context(), store.CourseReleasedEvidenceParams{CourseID: c.Param("courseID"), Teacher: true, ActorID: identity.Current(c).ID})
	if e == nil && v == nil {
		v = []store.CourseReleasedEvidenceRow{}
	}
	result(c, v, e)
}
