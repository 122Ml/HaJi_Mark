package learning

import (
	"strconv"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
)

func workspacePage(c *gin.Context) (int32, int32, bool) {
	page, e := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, e2 := strconv.Atoi(c.DefaultQuery("size", "20"))
	if e != nil || e2 != nil || page < 1 || page > 100000 || size < 1 || size > 100 {
		invalid(c, "分页参数无效")
		return 0, 0, false
	}
	return int32(size), int32((page - 1) * size), true
}
func (h *Handler) assignmentWorklist(c *gin.Context) {
	size, offset, ok := workspacePage(c)
	if !ok {
		return
	}
	params := store.ListAssignmentWorklistParams{
		CourseID: c.Param("courseID"), ActorID: identity.Current(c).ID, Teacher: teacher(c), Kind: c.Query("kind"), State: c.Query("state"), Search: c.Query("search"), PointID: c.Query("point"), SortOrder: c.Query("sort"), PageSize: size, PageOffset: offset,
	}
	rows, e := h.q.ListAssignmentWorklist(c.Request.Context(), params)
	var total int32
	if len(rows) > 0 {
		total = rows[0].Total
	} else if e == nil && offset > 0 {
		params.PageOffset, params.PageSize = 0, 1
		first, err := h.q.ListAssignmentWorklist(c.Request.Context(), params)
		e = err
		if len(first) > 0 {
			total = first[0].Total
		}
	}
	result(c, gin.H{"rows": rows, "total": total}, e)
}
func (h *Handler) submissionWorklist(c *gin.Context) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	size, offset, ok := workspacePage(c)
	if !ok {
		return
	}
	params := store.ListSubmissionWorklistParams{AssignmentID: a.ID, Search: c.Query("search"), State: c.Query("state"), PageSize: size, PageOffset: offset}
	rows, e := h.q.ListSubmissionWorklist(c.Request.Context(), params)
	var total int32
	if len(rows) > 0 {
		total = rows[0].Total
	} else if e == nil && offset > 0 {
		params.PageOffset, params.PageSize = 0, 1
		first, err := h.q.ListSubmissionWorklist(c.Request.Context(), params)
		e = err
		if len(first) > 0 {
			total = first[0].Total
		}
	}
	result(c, gin.H{"rows": rows, "total": total}, e)
}
func (h *Handler) interventionEvidence(c *gin.Context) {
	item, e := h.q.GetBusinessIntervention(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, item.CourseID) {
		return
	}
	if !teacher(c) && (item.StudentID != identity.Current(c).ID || item.Status == "draft") {
		identity.Fail(c, 403, "forbidden", "只能查看本人的任务")
		return
	}
	learningReady, practiceReady := !item.ResourceID.Valid, !item.AssignmentID.Valid
	if item.ResourceID.Valid {
		learningReady, e = h.q.HasInterventionLearning(c.Request.Context(), store.HasInterventionLearningParams{ActorID: item.StudentID, ResourceID: item.ResourceID, OccurredAt: item.AssignedAt})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	if item.AssignmentID.Valid {
		practiceReady, e = h.q.HasInterventionSubmission(c.Request.Context(), store.HasInterventionSubmissionParams{StudentID: item.StudentID, AssignmentID: item.AssignmentID.String, SubmittedAt: item.AssignedAt})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	events, e := h.q.ListMyLearningEvents(c.Request.Context(), store.ListMyLearningEventsParams{CourseID: item.CourseID, ActorID: item.StudentID})
	if e != nil {
		result(c, nil, e)
		return
	}
	learning := []gin.H{}
	for _, v := range events {
		if item.AssignedAt.Valid && v.OccurredAt.Time.Compare(item.AssignedAt.Time) >= 0 && v.ResourceID == item.ResourceID && v.Verb == "completed" {
			learning = append(learning, gin.H{"resource_id": v.ResourceID, "occurred_at": v.OccurredAt})
		}
	}
	submissions := []gin.H{}
	if item.AssignmentID.Valid {
		rows, err := h.q.ListBusinessSubmissions(c.Request.Context(), store.ListBusinessSubmissionsParams{AssignmentID: item.AssignmentID.String, ActorID: item.StudentID, Teacher: false})
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, v := range rows {
			if item.AssignedAt.Valid && v.SubmittedAt.Time.Compare(item.AssignedAt.Time) >= 0 {
				submissions = append(submissions, gin.H{"id": v.ID, "question_id": v.QuestionID, "attempt": v.Attempt, "submitted_at": v.SubmittedAt})
			}
		}
	}
	result(c, gin.H{"assigned_at": item.AssignedAt, "learning_ready": learningReady, "practice_ready": practiceReady, "learning": learning, "submissions": submissions}, nil)
}
