package learning

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func collectLineage(startID string, parentOf map[string]string, childrenOf map[string][]string) []string {
	if startID == "" {
		return []string{}
	}
	seen := map[string]bool{startID: true}
	out := []string{startID}
	cur := startID
	for len(seen) < 64 {
		parent := parentOf[cur]
		if parent == "" || seen[parent] {
			break
		}
		seen[parent] = true
		out = append(out, parent)
		cur = parent
	}
	queue := append([]string{}, out...)
	for len(queue) > 0 && len(seen) < 64 {
		id := queue[0]
		queue = queue[1:]
		for _, child := range childrenOf[id] {
			if !seen[child] {
				seen[child] = true
				out = append(out, child)
				queue = append(queue, child)
			}
		}
	}
	return out
}

func sourceLineageIDs(ctx context.Context, q *store.Queries, course, sourceID string) ([]string, []store.ListMaterialSourcesRow, error) {
	sources, err := q.ListMaterialSources(ctx, course)
	if err != nil {
		return nil, nil, err
	}
	if sourceID == "" {
		return []string{}, sources, nil
	}
	parentOf := make(map[string]string, len(sources))
	childrenOf := make(map[string][]string)
	for _, s := range sources {
		if s.SupersedesID.Valid && s.SupersedesID.String != "" {
			parentOf[s.ID] = s.SupersedesID.String
			childrenOf[s.SupersedesID.String] = append(childrenOf[s.SupersedesID.String], s.ID)
		}
	}
	return collectLineage(sourceID, parentOf, childrenOf), sources, nil
}

func knowledgeLineageIDs(ctx context.Context, q *store.Queries, course, knowledgeID string) ([]string, []store.KnowledgeEntry, error) {
	entries, err := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: course, Teacher: true})
	if err != nil {
		return nil, nil, err
	}
	if knowledgeID == "" {
		return []string{}, entries, nil
	}
	parentOf := make(map[string]string, len(entries))
	childrenOf := make(map[string][]string)
	for _, k := range entries {
		if k.SupersedesID.Valid && k.SupersedesID.String != "" {
			parentOf[k.ID] = k.SupersedesID.String
			childrenOf[k.SupersedesID.String] = append(childrenOf[k.SupersedesID.String], k.ID)
		}
	}
	return collectLineage(knowledgeID, parentOf, childrenOf), entries, nil
}

func (h *Handler) createWorkflowJob(c *gin.Context, kind string, in rag.JobInput) {
	ctx := c.Request.Context()
	course := c.Param("courseID")
	if kind == "knowledge_compare" {
		k, e := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: in.KnowledgeID, CourseID: course})
		if e != nil {
			result(c, nil, e)
			return
		}
		if k.State != "draft" {
			invalid(c, "请选择待核对知识候选")
			return
		}
		if k.Origin == "teacher_example" {
			invalid(c, "自编示例不参与资料知识比较")
			return
		}
		if len(in.RelatedIDs) > 12 {
			invalid(c, "最多选择12条已有知识；留空则检索相关知识")
			return
		}
		in.EditVersion = k.EditVersion
		seen := map[string]bool{}
		for _, id := range in.RelatedIDs {
			if seen[id] {
				invalid(c, "比较对象不能重复")
				return
			}
			seen[id] = true
			if id == k.ID {
				invalid(c, "比较对象须为本课程已确认知识")
				return
			}
			v, e := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: id, CourseID: course})
			if e != nil {
				if errors.Is(e, pgx.ErrNoRows) {
					invalid(c, "比较对象须为本课程已确认知识")
					return
				}
				result(c, nil, e)
				return
			}
			if v.State != "confirmed" || v.Origin == "teacher_example" {
				invalid(c, "比较对象须为本课程已确认的非自编示例知识")
				return
			}
		}
	} else if kind == "vision" {
		a, e := h.q.GetMaterialAsset(ctx, store.GetMaterialAssetParams{ID: in.AssetID, CourseID: course})
		if e != nil {
			result(c, nil, e)
			return
		}
		src, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: a.SourceID, CourseID: course})
		if e != nil {
			result(c, nil, e)
			return
		}
		if src.State != "active" {
			invalid(c, "原件已归档，无法识别图像")
			return
		}
		in.SourceID = a.SourceID
	} else {
		src, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: in.SourceID, CourseID: course})
		if e != nil {
			result(c, nil, e)
			return
		}
		if src.State != "active" || src.ParseState != "ready" {
			invalid(c, "来源须为已解析的有效版本")
			return
		}
		if kind == "paper_split" && rag.IsVideoSource(src.MediaType, src.Filename) {
			invalid(c, "视频资料不支持试卷拆题")
			return
		}
		in.ParseRevision = src.ParseRevision
	}
	profileKind := "chat"
	if kind == "vision" {
		profileKind = "vision"
	}
	if _, e := h.rag.Models.Profile(in.ProfileID, profileKind); e != nil {
		ragError(c, e)
		return
	}
	// Never accept client-supplied student answers, criteria or evidence in these jobs.
	clean := rag.JobInput{SourceID: in.SourceID, KnowledgeID: in.KnowledgeID, RelatedIDs: in.RelatedIDs, AssetID: in.AssetID, ProfileID: in.ProfileID, ParseRevision: in.ParseRevision, EditVersion: in.EditVersion}
	j, e := h.rag.CreateJob(ctx, course, identity.Current(c).ID, kind, clean)
	result(c, j, e)
}
func (h *Handler) impact(c *gin.Context) {
	ctx := c.Request.Context()
	course := c.Param("courseID")
	srcID, kID := c.Query("source_id"), c.Query("knowledge_id")
	if srcID != "" {
		if _, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: srcID, CourseID: course}); e != nil {
			result(c, nil, e)
			return
		}
	}
	if kID != "" {
		if _, e := h.q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: kID, CourseID: course}); e != nil {
			result(c, nil, e)
			return
		}
	}
	srcIDs, sources, e := sourceLineageIDs(ctx, h.q, course, srcID)
	if e != nil {
		result(c, nil, e)
		return
	}
	kIDs, knowledge, e := knowledgeLineageIDs(ctx, h.q, course, kID)
	if e != nil {
		result(c, nil, e)
		return
	}
	rows := []store.ContentImpactRow{}
	if srcID != "" || kID != "" {
		if srcIDs == nil {
			srcIDs = []string{}
		}
		if kIDs == nil {
			kIDs = []string{}
		}
		rows, e = h.q.ContentImpact(ctx, store.ContentImpactParams{CourseID: course, SourceIds: srcIDs, KnowledgeIds: kIDs})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	derivedSources := map[string]bool{}
	for _, k := range knowledge {
		var refs []rag.Evidence
		if json.Unmarshal(k.Evidence, &refs) == nil {
			for _, ref := range refs {
				if ref.SourceID != "" {
					derivedSources[ref.SourceID] = true
				}
			}
		}
	}
	changes := []gin.H{}
	for _, s := range sources {
		if s.SupersedesID.Valid || s.State == "archived" || (!s.AllowDerived && derivedSources[s.ID]) {
			changes = append(changes, gin.H{"kind": "source", "id": s.ID, "previous_id": s.SupersedesID, "title": s.Title, "version": s.Version, "state": s.State, "allow_derived": s.AllowDerived})
		}
	}
	for _, k := range knowledge {
		if k.SupersedesID.Valid || k.State == "archived" {
			changes = append(changes, gin.H{"kind": "knowledge", "id": k.ID, "previous_id": k.SupersedesID, "title": k.Title, "version": k.Version, "state": k.State})
		}
	}
	result(c, gin.H{"changes": changes, "items": rows}, nil)
}
func (h *Handler) impactDecision(c *gin.Context) {
	var in struct {
		Kind   string `json:"kind"`
		ID     string `json:"id"`
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if !bind(c, &in) {
		return
	}
	if in.Kind != "source" && in.Kind != "knowledge" {
		invalid(c, "影响决定仅支持来源或知识")
		return
	}
	if !validText(in.Reason, 5000) || (in.Action != "no_action" && in.Action != "future_version" && in.Action != "regrade") {
		invalid(c, "请选择处理方式并填写原因")
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
	params := store.ContentImpactParams{CourseID: c.Param("courseID"), SourceIds: []string{}, KnowledgeIds: []string{}}
	// Walk the full supersedes lineage so consumers of either predecessors or successors
	// are captured in the frozen impact snapshot.
	if in.Kind == "source" {
		if _, err := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: in.ID, CourseID: params.CourseID}); err != nil {
			result(c, nil, err)
			return
		}
		ids, _, err := sourceLineageIDs(ctx, q, params.CourseID, in.ID)
		if err != nil {
			result(c, nil, err)
			return
		}
		params.SourceIds = ids
	} else {
		if _, err := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: in.ID, CourseID: params.CourseID}); err != nil {
			result(c, nil, err)
			return
		}
		ids, _, err := knowledgeLineageIDs(ctx, q, params.CourseID, in.ID)
		if err != nil {
			result(c, nil, err)
			return
		}
		params.KnowledgeIds = ids
	}
	snapshot, e := q.ContentImpact(ctx, params)
	if e != nil {
		result(c, nil, e)
		return
	}
	b, _ := json.Marshal(snapshot)
	v, e := recordDecision(ctx, q, c.Param("courseID"), identity.Current(c).ID, "impact_"+in.Action, in.ID, in.Reason, in, json.RawMessage(b))
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}
