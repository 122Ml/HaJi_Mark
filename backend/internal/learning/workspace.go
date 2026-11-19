package learning

import (
	"strconv"
	"strings"

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
	kind := strings.TrimSpace(c.Query("kind"))
	switch kind {
	case "", "homework", "quiz", "subjective", "code":
	default:
		invalid(c, "作业类型筛选无效")
		return
	}
	state := strings.TrimSpace(c.Query("state"))
	switch state {
	case "", "draft", "published", "closed":
	default:
		invalid(c, "作业状态筛选无效")
		return
	}
	sortOrder := strings.TrimSpace(c.Query("sort"))
	switch sortOrder {
	case "", "new", "due", "created":
	default:
		invalid(c, "排序参数无效")
		return
	}
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 200 || strings.ContainsRune(search, '\x00') {
		invalid(c, "搜索词过长或包含非法字符")
		return
	}
	pointID := strings.TrimSpace(c.Query("point"))
	if len(pointID) > 128 || strings.ContainsRune(pointID, '\x00') {
		invalid(c, "知识点筛选参数无效")
		return
	}
	params := store.ListAssignmentWorklistParams{
		CourseID:   c.Param("courseID"),
		ActorID:    identity.Current(c).ID,
		Teacher:    teacher(c),
		Kind:       kind,
		State:      state,
		Search:     escapeLike(search),
		PointID:    pointID,
		SortOrder:  sortOrder,
		PageSize:   size,
		PageOffset: offset,
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
	if e == nil && rows == nil {
		rows = []store.ListAssignmentWorklistRow{}
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
	state := strings.TrimSpace(c.Query("state"))
	switch state {
	case "", "pending", "draft", "confirmed", "released":
	default:
		invalid(c, "批阅状态筛选无效")
		return
	}
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 200 || strings.ContainsRune(search, '\x00') {
		invalid(c, "搜索词过长或包含非法字符")
		return
	}
	params := store.ListSubmissionWorklistParams{
		AssignmentID: a.ID,
		Search:       escapeLike(search),
		State:        state,
		PageSize:     size,
		PageOffset:   offset,
	}
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
	if e == nil && rows == nil {
		rows = []store.ListSubmissionWorklistRow{}
	}
	result(c, gin.H{"rows": rows, "total": total}, e)
}
func (h *Handler) interventionEvidence(c *gin.Context) {
	ctx := c.Request.Context()
	item, e := h.q.GetBusinessIntervention(ctx, c.Param("id"))
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
	learning := []store.ListInterventionLearningMatchesRow{}
	if item.ResourceID.Valid && item.AssignedAt.Valid {
		rows, err := h.q.ListInterventionLearningMatches(ctx, store.ListInterventionLearningMatchesParams{
			ActorID:    item.StudentID,
			ResourceID: item.ResourceID,
			OccurredAt: item.AssignedAt,
		})
		if err != nil {
			result(c, nil, err)
			return
		}
		if rows != nil {
			learning = rows
		}
		learningReady = len(learning) > 0
	}
	submissions := []store.ListInterventionSubmissionMatchesRow{}
	if item.AssignmentID.Valid && item.AssignedAt.Valid {
		practiceReady, e = h.q.HasInterventionSubmission(ctx, store.HasInterventionSubmissionParams{
			StudentID:    item.StudentID,
			AssignmentID: item.AssignmentID.String,
			SubmittedAt:  item.AssignedAt,
		})
		if e != nil {
			result(c, nil, e)
			return
		}
		rows, err := h.q.ListInterventionSubmissionMatches(ctx, store.ListInterventionSubmissionMatchesParams{
			StudentID:    item.StudentID,
			AssignmentID: item.AssignmentID.String,
			SubmittedAt:  item.AssignedAt,
		})
		if err != nil {
			result(c, nil, err)
			return
		}
		if rows != nil {
			submissions = rows
		}
	}
	result(c, gin.H{
		"assigned_at":    item.AssignedAt,
		"learning_ready": learningReady,
		"practice_ready": practiceReady,
		"learning":       learning,
		"submissions":    submissions,
	}, nil)
}
