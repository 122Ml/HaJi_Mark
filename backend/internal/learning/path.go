package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"sort"
)

func (h *Handler) graph(c *gin.Context) {
	points, e := h.q.ListBusinessPoints(c.Request.Context(), c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	edges, e := h.q.ListCourseEdges(c.Request.Context(), c.Param("courseID"))
	result(c, gin.H{"nodes": points, "edges": edges}, e)
}
func (h *Handler) edge(c *gin.Context) {
	var in struct {
		From string `json:"from_id"`
		To   string `json:"to_id"`
	}
	if !bind(c, &in) {
		return
	}
	if in.From == in.To {
		invalid(c, "依赖知识点不能相同")
		return
	}
	tx, e := h.db.Begin(c.Request.Context())
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(c.Request.Context())
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessCourse(c.Request.Context(), c.Param("courseID")); e != nil {
		result(c, nil, e)
		return
	}
	for _, id := range []string{in.From, in.To} {
		p, e := h.q.GetKnowledgePoint(c.Request.Context(), id)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, p.CourseID) {
			return
		}
		if p.Kind != "point" {
			invalid(c, "依赖关系只连接知识点")
			return
		}
	}
	edges, e := q.ListCourseEdges(c.Request.Context(), c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	adj := map[string][]string{}
	for _, edge := range edges {
		adj[edge.FromID] = append(adj[edge.FromID], edge.ToID)
	}
	seen := map[string]bool{}
	var reaches func(string) bool
	reaches = func(id string) bool {
		if id == in.From {
			return true
		}
		if seen[id] {
			return false
		}
		seen[id] = true
		for _, next := range adj[id] {
			if reaches(next) {
				return true
			}
		}
		return false
	}
	if reaches(in.To) {
		invalid(c, "依赖关系会形成循环")
		return
	}
	v, e := q.AddCourseEdge(c.Request.Context(), store.AddCourseEdgeParams{CourseID: c.Param("courseID"), FromID: in.From, ToID: in.To})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "edge_exists", "依赖关系已存在")
		return
	}
	if e == nil {
		e = tx.Commit(c.Request.Context())
	}
	result(c, v, e)
}
func (h *Handler) path(c *gin.Context) {
	p, e := h.q.LatestStudyPath(c.Request.Context(), store.LatestStudyPathParams{CourseID: c.Param("courseID"), StudentID: identity.Current(c).ID})
	if errors.Is(e, pgx.ErrNoRows) {
		c.JSON(200, gin.H{"data": nil})
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	items, e := h.q.ListStudyPathItems(c.Request.Context(), p.ID)
	result(c, gin.H{"path": p, "items": items}, e)
}
func (h *Handler) planPath(c *gin.Context) {
	ctx := c.Request.Context()
	points, e := h.q.ListBusinessPoints(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	edges, e := h.q.ListCourseEdges(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	evidence, e := h.q.CourseReleasedEvidence(ctx, store.CourseReleasedEvidenceParams{CourseID: c.Param("courseID"), Teacher: false, ActorID: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	score, max := map[string]int{}, map[string]int{}
	for _, r := range evidence {
		if r.KnowledgePointID.Valid {
			score[r.KnowledgePointID.String] += int(r.Score)
			max[r.KnowledgePointID.String] += int(r.MaxScore)
		}
	}
	selected := map[string]store.KnowledgePoint{}
	for _, p := range points {
		if p.Kind == "point" && (max[p.ID] == 0 || float64(score[p.ID])/float64(max[p.ID]) < 0.6) {
			selected[p.ID] = p
		}
	}
	// Include prerequisites even if their latest result is adequate; preserve order.
	byID := map[string]store.KnowledgePoint{}
	for _, p := range points {
		byID[p.ID] = p
	}
	changed := true
	for changed {
		changed = false
		for _, edge := range edges {
			if _, ok := selected[edge.ToID]; ok {
				if _, exists := selected[edge.FromID]; !exists {
					selected[edge.FromID] = byID[edge.FromID]
					changed = true
				}
			}
		}
	}
	ordered := []store.KnowledgePoint{}
	remaining := map[string]bool{}
	for id := range selected {
		remaining[id] = true
	}
	for len(remaining) > 0 {
		ready := []store.KnowledgePoint{}
		for id := range remaining {
			blocked := false
			for _, edge := range edges {
				if edge.ToID == id && remaining[edge.FromID] {
					blocked = true
				}
			}
			if !blocked {
				ready = append(ready, selected[id])
			}
		}
		if len(ready) == 0 {
			invalid(c, "知识点依赖存在循环，请教师修正")
			return
		}
		sort.Slice(ready, func(i, j int) bool {
			if ready[i].Position == ready[j].Position {
				return ready[i].ID < ready[j].ID
			}
			return ready[i].Position < ready[j].Position
		})
		for _, p := range ready {
			ordered = append(ordered, p)
			delete(remaining, p.ID)
		}
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	p, e := q.CreateStudyPath(ctx, store.CreateStudyPathParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), StudentID: identity.Current(c).ID, RuleVersion: "released-performance-prerequisite-v1"})
	if e != nil {
		result(c, nil, e)
		return
	}
	for i, k := range ordered {
		reason := "尚无正式评分证据，建议补充学习与测验"
		if max[k.ID] > 0 {
			reason = "正式评分表现低于60%，建议复习"
			if float64(score[k.ID])/float64(max[k.ID]) >= 0.6 {
				reason = "作为后续薄弱点的前置知识复习"
			}
		}
		if e = q.AddStudyPathItem(ctx, store.AddStudyPathItemParams{PathID: p.ID, KnowledgePointID: k.ID, Position: int32(i), Reason: reason}); e != nil {
			result(c, nil, e)
			return
		}
	}
	e = tx.Commit(ctx)
	result(c, p, e)
}
