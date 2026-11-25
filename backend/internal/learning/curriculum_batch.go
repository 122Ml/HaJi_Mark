package learning

import (
	"errors"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type batchPointInput struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Position    int32  `json:"position"`
	Description string `json:"description"`
	ParentKey   string `json:"parent_key"`
	ParentID    string `json:"parent_id"`
}

type batchEdgeInput struct {
	FromKey string `json:"from_key"`
	ToKey   string `json:"to_key"`
	FromID  string `json:"from_id"`
	ToID    string `json:"to_id"`
}

func (h *Handler) createPointsBatch(c *gin.Context) {
	var in struct {
		Nodes []batchPointInput `json:"nodes"`
		Edges []batchEdgeInput  `json:"edges"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Nodes) == 0 || len(in.Nodes) > 120 {
		invalid(c, "nodes须包含1到120个目录节点")
		return
	}
	if len(in.Edges) > 200 {
		invalid(c, "edges最多支持200条前置依赖")
		return
	}

	keyToIdx := map[string]int{}
	for i := range in.Nodes {
		n := &in.Nodes[i]
		n.Key = strings.TrimSpace(n.Key)
		n.Title = strings.TrimSpace(n.Title)
		n.Kind = strings.TrimSpace(n.Kind)
		n.ParentKey = strings.TrimSpace(n.ParentKey)
		n.ParentID = strings.TrimSpace(n.ParentID)
		if n.Kind == "" {
			n.Kind = "point"
		}
		if n.Kind != "chapter" && n.Kind != "section" && n.Kind != "point" {
			invalid(c, "目录类型无效")
			return
		}
		if !validText(n.Title, 500) || n.Position < 0 {
			invalid(c, "知识点名称或顺序无效")
			return
		}
		if len(n.Description) > 10000 || strings.ContainsRune(n.Description, '\x00') {
			invalid(c, "说明过长或包含非法字符")
			return
		}
		if len(n.Key) > 128 || strings.ContainsRune(n.Key, '\x00') {
			invalid(c, "节点key无效")
			return
		}
		if n.Key != "" {
			if _, dup := keyToIdx[n.Key]; dup {
				invalid(c, "节点key不能重复")
				return
			}
			keyToIdx[n.Key] = i
		}
		if n.ParentKey != "" && n.ParentID != "" {
			invalid(c, "parent_key与parent_id不能同时指定")
			return
		}
		if n.Kind == "chapter" && (n.ParentKey != "" || n.ParentID != "") {
			invalid(c, "章必须位于课程顶层，不能嵌套在父节点下")
			return
		}
		if n.Kind == "section" && n.ParentKey == "" && n.ParentID == "" {
			invalid(c, "节必须挂在章下")
			return
		}
		if n.ParentKey != "" && n.ParentKey == n.Key {
			invalid(c, "父节点不能指向自身")
			return
		}
	}

	// Resolve creation order so parents referenced by parent_key are inserted before children.
	order := make([]int, 0, len(in.Nodes))
	state := make([]int, len(in.Nodes)) // 0=unvisited, 1=visiting, 2=done
	var visitNode func(int) error
	visitNode = func(idx int) error {
		if state[idx] == 2 {
			return nil
		}
		if state[idx] == 1 {
			return errors.New("目录父子引用不能形成循环")
		}
		state[idx] = 1
		if pk := in.Nodes[idx].ParentKey; pk != "" {
			pIdx, ok := keyToIdx[pk]
			if !ok {
				return errors.New("parent_key未在nodes中定义")
			}
			parentKind := in.Nodes[pIdx].Kind
			if parentKind == "point" {
				return errors.New("知识点不能包含子目录")
			}
			if in.Nodes[idx].Kind == "section" && parentKind != "chapter" {
				return errors.New("节只能挂在章下")
			}
			if err := visitNode(pIdx); err != nil {
				return err
			}
		}
		state[idx] = 2
		order = append(order, idx)
		return nil
	}
	for i := range in.Nodes {
		if err := visitNode(i); err != nil {
			invalid(c, err.Error())
			return
		}
	}

	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessCourse(ctx, courseID); e != nil {
		result(c, nil, e)
		return
	}

	keyToID := make(map[string]string, len(in.Nodes))
	pointKinds := map[string]string{}
	createdByIdx := make([]store.KnowledgePoint, len(in.Nodes))

	for _, idx := range order {
		n := in.Nodes[idx]
		resolvedParentID := n.ParentID
		if n.ParentKey != "" {
			resolvedParentID = keyToID[n.ParentKey]
		} else if resolvedParentID != "" {
			p, err := q.GetKnowledgePoint(ctx, resolvedParentID)
			if err != nil {
				result(c, nil, err)
				return
			}
			if p.CourseID != courseID {
				identity.Fail(c, 403, "forbidden", "父节点不属于当前课程")
				return
			}
			if p.Kind == "point" {
				invalid(c, "知识点不能包含子目录")
				return
			}
			if n.Kind == "section" && p.Kind != "chapter" {
				invalid(c, "节只能挂在章下")
				return
			}
		}
		id := uuid.NewString()
		v, err := q.AddBusinessPoint(ctx, store.AddBusinessPointParams{
			ID:          id,
			CourseID:    courseID,
			Title:       n.Title,
			Position:    n.Position,
			ParentID:    text(resolvedParentID),
			Kind:        n.Kind,
			Description: n.Description,
		})
		if err != nil {
			result(c, nil, err)
			return
		}
		createdByIdx[idx] = v
		pointKinds[v.ID] = v.Kind
		if n.Key != "" {
			keyToID[n.Key] = v.ID
		}
	}

	type resolvedEdge struct{ fromID, toID string }
	resolvedEdges := make([]resolvedEdge, 0, len(in.Edges))
	seenEdges := map[resolvedEdge]bool{}
	resolveEndpoint := func(key, id string) (string, error) {
		key = strings.TrimSpace(key)
		id = strings.TrimSpace(id)
		if (key == "") == (id == "") {
			return "", errors.New("每条依赖端点须二选一指定key或id")
		}
		if key != "" {
			mapped, ok := keyToID[key]
			if !ok {
				return "", errors.New("依赖引用的节点key不存在")
			}
			return mapped, nil
		}
		if kind, ok := pointKinds[id]; ok {
			if kind != "point" {
				return "", errors.New("依赖关系只连接知识点")
			}
			return id, nil
		}
		p, err := q.GetKnowledgePoint(ctx, id)
		if err != nil {
			return "", err
		}
		if p.CourseID != courseID {
			return "", errors.New("依赖知识点不属于当前课程")
		}
		if p.Kind != "point" {
			return "", errors.New("依赖关系只连接知识点")
		}
		pointKinds[p.ID] = p.Kind
		return p.ID, nil
	}
	for _, edge := range in.Edges {
		fromID, err := resolveEndpoint(edge.FromKey, edge.FromID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				result(c, nil, err)
			} else {
				invalid(c, err.Error())
			}
			return
		}
		toID, err := resolveEndpoint(edge.ToKey, edge.ToID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				result(c, nil, err)
			} else {
				invalid(c, err.Error())
			}
			return
		}
		if fromID == toID {
			invalid(c, "依赖知识点不能相同")
			return
		}
		if pointKinds[fromID] != "point" || pointKinds[toID] != "point" {
			invalid(c, "依赖关系只连接知识点")
			return
		}
		pair := resolvedEdge{fromID, toID}
		if !seenEdges[pair] {
			seenEdges[pair] = true
			resolvedEdges = append(resolvedEdges, pair)
		}
	}

	if len(resolvedEdges) > 0 {
		existingEdges, err := q.ListCourseEdges(ctx, courseID)
		if err != nil {
			result(c, nil, err)
			return
		}
		adj := map[string][]string{}
		for _, edge := range existingEdges {
			adj[edge.FromID] = append(adj[edge.FromID], edge.ToID)
		}
		for _, pair := range resolvedEdges {
			adj[pair.fromID] = append(adj[pair.fromID], pair.toID)
		}
		color := map[string]int{} // 0=unvisited, 1=visiting, 2=done
		var hasCycle func(string) bool
		hasCycle = func(node string) bool {
			if color[node] == 1 {
				return true
			}
			if color[node] == 2 {
				return false
			}
			color[node] = 1
			for _, next := range adj[node] {
				if hasCycle(next) {
					return true
				}
			}
			color[node] = 2
			return false
		}
		for node := range adj {
			if hasCycle(node) {
				invalid(c, "依赖关系会形成循环")
				return
			}
		}
	}

	createdEdges := make([]store.CourseEdge, 0, len(resolvedEdges))
	for _, pair := range resolvedEdges {
		edgeRow, err := q.AddCourseEdge(ctx, store.AddCourseEdgeParams{
			CourseID: courseID,
			FromID:   pair.fromID,
			ToID:     pair.toID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			result(c, nil, err)
			return
		}
		createdEdges = append(createdEdges, edgeRow)
	}

	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	result(c, gin.H{
		"nodes":         createdByIdx,
		"edges":         createdEdges,
		"created_nodes": len(createdByIdx),
		"created_edges": len(createdEdges),
	}, nil)
}
