package learning

import (
	"container/heap"
	"errors"
	"net/http"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type pathSortKey struct {
	chapterPos int32
	sectionPos int32
	pointPos   int32
	id         string
}

type pathHeapItem struct {
	point store.KnowledgePoint
	key   pathSortKey
}

type pathNodeHeap []pathHeapItem

func (h pathNodeHeap) Len() int { return len(h) }
func (h pathNodeHeap) Less(i, j int) bool {
	a, b := h[i].key, h[j].key
	if a.chapterPos != b.chapterPos {
		return a.chapterPos < b.chapterPos
	}
	if a.sectionPos != b.sectionPos {
		return a.sectionPos < b.sectionPos
	}
	if a.pointPos != b.pointPos {
		return a.pointPos < b.pointPos
	}
	return a.id < b.id
}
func (h pathNodeHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *pathNodeHeap) Push(x any)   { *h = append(*h, x.(pathHeapItem)) }
func (h *pathNodeHeap) Pop() any {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

func computePathSortKey(p store.KnowledgePoint, byID map[string]store.KnowledgePoint) pathSortKey {
	key := pathSortKey{chapterPos: p.Position, sectionPos: -1, pointPos: p.Position, id: p.ID}
	if !p.ParentID.Valid || p.ParentID.String == "" {
		return key
	}
	parent, ok := byID[p.ParentID.String]
	if !ok {
		return key
	}
	if parent.Kind == "chapter" {
		key.chapterPos = parent.Position
		return key
	}
	if parent.Kind == "section" {
		key.sectionPos = parent.Position
		if parent.ParentID.Valid {
			if gp, ok := byID[parent.ParentID.String]; ok {
				key.chapterPos = gp.Position
				return key
			}
		}
		key.chapterPos = parent.Position
	}
	return key
}

func (h *Handler) graph(c *gin.Context) {
	points, e := h.q.ListBusinessPoints(c.Request.Context(), c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	edges, e := h.q.ListCourseEdges(c.Request.Context(), c.Param("courseID"))
	if e == nil {
		if points == nil {
			points = []store.KnowledgePoint{}
		}
		if edges == nil {
			edges = []store.CourseEdge{}
		}
	}
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
	in.From = strings.TrimSpace(in.From)
	in.To = strings.TrimSpace(in.To)
	if !validText(in.From, 128) || !validText(in.To, 128) {
		invalid(c, "请提供有效的知识点编号")
		return
	}
	if in.From == in.To {
		invalid(c, "依赖知识点不能相同")
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
	if _, e = q.LockBusinessCourse(ctx, c.Param("courseID")); e != nil {
		result(c, nil, e)
		return
	}
	for _, id := range []string{in.From, in.To} {
		p, e := q.GetKnowledgePoint(ctx, id)
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
	edges, e := q.ListCourseEdges(ctx, c.Param("courseID"))
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
	v, e := q.AddCourseEdge(ctx, store.AddCourseEdgeParams{CourseID: c.Param("courseID"), FromID: in.From, ToID: in.To})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "edge_exists", "依赖关系已存在")
		return
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	result(c, v, e)
}
func (h *Handler) deleteEdge(c *gin.Context) {
	fromID := strings.TrimSpace(c.Query("from_point_id"))
	if fromID == "" {
		fromID = strings.TrimSpace(c.Query("from_id"))
	}
	toID := strings.TrimSpace(c.Query("to_point_id"))
	if toID == "" {
		toID = strings.TrimSpace(c.Query("to_id"))
	}
	if fromID == "" && toID == "" && c.Request.Body != nil && c.Request.Body != http.NoBody && c.Request.ContentLength != 0 {
		var in struct {
			FromPointID string `json:"from_point_id"`
			ToPointID   string `json:"to_point_id"`
			FromID      string `json:"from_id"`
			ToID        string `json:"to_id"`
		}
		if !bind(c, &in) {
			return
		}
		fromID = strings.TrimSpace(in.FromPointID)
		if fromID == "" {
			fromID = strings.TrimSpace(in.FromID)
		}
		toID = strings.TrimSpace(in.ToPointID)
		if toID == "" {
			toID = strings.TrimSpace(in.ToID)
		}
	}
	if !validText(fromID, 128) || !validText(toID, 128) {
		invalid(c, "请提供待删除依赖关系的起始与目标知识点")
		return
	}
	_, e := h.q.DeleteCourseEdge(c.Request.Context(), store.DeleteCourseEdgeParams{
		CourseID: c.Param("courseID"),
		FromID:   fromID,
		ToID:     toID,
	})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, gin.H{"deleted": true, "from_point_id": fromID, "to_point_id": toID}, nil)
}
func (h *Handler) path(c *gin.Context) {
	ctx := c.Request.Context()
	p, e := h.q.LatestStudyPath(ctx, store.LatestStudyPathParams{CourseID: c.Param("courseID"), StudentID: identity.Current(c).ID})
	if errors.Is(e, pgx.ErrNoRows) {
		c.JSON(200, gin.H{"data": nil})
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	items, e := h.q.ListStudyPathItems(ctx, p.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if items == nil {
		items = []store.ListStudyPathItemsRow{}
	}
	points, e := h.q.ListBusinessPoints(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	totalPoints := 0
	for _, pt := range points {
		if pt.Kind == "point" {
			totalPoints++
		}
	}
	result(c, gin.H{"path": p, "items": items, "total_points": totalPoints}, nil)
}
func (h *Handler) planPath(c *gin.Context) {
	ctx := c.Request.Context()
	tx, e := h.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	points, e := q.ListBusinessPoints(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	edges, e := q.ListCourseEdges(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	summary, e := q.CoursePointScoreSummary(ctx, store.CoursePointScoreSummaryParams{CourseID: c.Param("courseID"), StudentID: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	score, maxScore := map[string]int{}, map[string]int{}
	for _, r := range summary {
		if r.KnowledgePointID.Valid {
			score[r.KnowledgePointID.String] += int(r.Score)
			maxScore[r.KnowledgePointID.String] += int(r.MaxScore)
		}
	}
	selected := map[string]store.KnowledgePoint{}
	byID := make(map[string]store.KnowledgePoint, len(points))
	totalPoints := 0
	for _, p := range points {
		byID[p.ID] = p
		if p.Kind == "point" {
			totalPoints++
			if maxScore[p.ID] == 0 || float64(score[p.ID])/float64(maxScore[p.ID]) < 0.6 {
				selected[p.ID] = p
			}
		}
	}
	// Include prerequisites even if their latest result is adequate; O(V+E) reverse BFS.
	revAdj := make(map[string][]string, len(edges))
	for _, edge := range edges {
		revAdj[edge.ToID] = append(revAdj[edge.ToID], edge.FromID)
	}
	queue := make([]string, 0, len(selected))
	for id := range selected {
		queue = append(queue, id)
	}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, pre := range revAdj[cur] {
			if _, exists := selected[pre]; !exists {
				if kp, ok := byID[pre]; ok {
					selected[pre] = kp
					queue = append(queue, pre)
				}
			}
		}
	}
	// Deterministic min-heap Kahn topological sort preserving hierarchical (chapter, section, point, id) order.
	adj := make(map[string][]string, len(selected))
	inDegree := make(map[string]int, len(selected))
	for id := range selected {
		inDegree[id] = 0
	}
	for _, edge := range edges {
		if _, okFrom := selected[edge.FromID]; !okFrom {
			continue
		}
		if _, okTo := selected[edge.ToID]; !okTo {
			continue
		}
		adj[edge.FromID] = append(adj[edge.FromID], edge.ToID)
		inDegree[edge.ToID]++
	}
	ready := &pathNodeHeap{}
	heap.Init(ready)
	for id, deg := range inDegree {
		if deg == 0 {
			pt := selected[id]
			heap.Push(ready, pathHeapItem{point: pt, key: computePathSortKey(pt, byID)})
		}
	}
	ordered := make([]store.KnowledgePoint, 0, len(selected))
	for ready.Len() > 0 {
		item := heap.Pop(ready).(pathHeapItem)
		ordered = append(ordered, item.point)
		for _, nextID := range adj[item.point.ID] {
			inDegree[nextID]--
			if inDegree[nextID] == 0 {
				pt := selected[nextID]
				heap.Push(ready, pathHeapItem{point: pt, key: computePathSortKey(pt, byID)})
			}
		}
	}
	if len(ordered) != len(selected) {
		invalid(c, "知识点依赖存在循环，请教师修正")
		return
	}
	p, e := q.CreateStudyPath(ctx, store.CreateStudyPathParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), StudentID: identity.Current(c).ID, RuleVersion: "released-performance-prerequisite-v1"})
	if e != nil {
		result(c, nil, e)
		return
	}
	items := make([]store.ListStudyPathItemsRow, 0, len(ordered))
	for i, k := range ordered {
		reason := "尚无正式评分证据，建议补充学习与测验"
		if maxScore[k.ID] > 0 {
			reason = "正式评分表现低于60%，建议复习"
			if float64(score[k.ID])/float64(maxScore[k.ID]) >= 0.6 {
				reason = "作为后续薄弱点的前置知识复习"
			}
		}
		if e = q.AddStudyPathItem(ctx, store.AddStudyPathItemParams{PathID: p.ID, KnowledgePointID: k.ID, Position: int32(i), Reason: reason}); e != nil {
			result(c, nil, e)
			return
		}
		items = append(items, store.ListStudyPathItemsRow{
			PathID:           p.ID,
			KnowledgePointID: k.ID,
			Position:         int32(i),
			Reason:           reason,
			Title:            k.Title,
			Description:      k.Description,
		})
	}
	e = tx.Commit(ctx)
	result(c, gin.H{"path": p, "items": items, "total_points": totalPoints}, e)
}
