package learning

import (
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
)

func (h *Handler) activity(c *gin.Context) {
	studentID := c.Query("student_id")
	if !teacher(c) {
		if studentID != "" && studentID != identity.Current(c).ID {
			identity.Fail(c, 403, "forbidden", "只能查看本人学习记录")
			return
		}
		studentID = identity.Current(c).ID
	}
	if teacher(c) && studentID != "" {
		enrolled, e := h.q.IsEnrolled(c.Request.Context(), store.IsEnrolledParams{CourseID: c.Param("courseID"), StudentID: studentID})
		if e != nil {
			result(c, nil, e)
			return
		}
		if !enrolled {
			identity.Fail(c, 403, "forbidden", "学生不属于当前课程")
			return
		}
	}
	v, e := h.q.ListCourseActivity(c.Request.Context(), store.ListCourseActivityParams{CourseID: c.Param("courseID"), StudentID: studentID})
	if e == nil && v == nil {
		v = []store.ListCourseActivityRow{}
	}
	result(c, v, e)
}

// AS-01's enrollment-left-join roster, adapted to the current multi-question schema.
func (h *Handler) roster(c *gin.Context) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	rows, e := h.q.AssignmentSubmissionRoster(c.Request.Context(), store.AssignmentSubmissionRosterParams{AssignmentID: a.ID, CourseID: a.CourseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if rows == nil {
		rows = []store.AssignmentSubmissionRosterRow{}
	}
	submitted, partial, pending := 0, 0, 0
	for _, row := range rows {
		switch {
		case row.SubmittedQuestions == 0:
			pending++
		case row.SubmittedQuestions == row.TotalQuestions:
			submitted++
		default:
			partial++
		}
	}
	result(c, gin.H{"total": len(rows), "submitted": submitted, "partial": partial, "not_submitted": pending, "rows": rows}, nil)
}
