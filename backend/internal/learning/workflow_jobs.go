package learning

import (
	"encoding/json"
	"errors"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

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
	rows := []store.ContentImpactRow{}
	if srcID != "" || kID != "" {
		var e error
		rows, e = h.q.ContentImpact(ctx, store.ContentImpactParams{CourseID: course, SourceID: srcID, KnowledgeID: kID})
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	sources, e := h.q.ListMaterialSources(ctx, course)
	if e != nil {
		result(c, nil, e)
		return
	}
	knowledge, e := h.q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: course, Teacher: true})
	if e != nil {
		result(c, nil, e)
		return
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
	params := store.ContentImpactParams{CourseID: c.Param("courseID")}
	// A new version's impact refers to consumers of its predecessor, matching
	// the displayed preview. Keep the decision itself attached to the new version.
	if in.Kind == "source" {
		src, err := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: in.ID, CourseID: params.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		params.SourceID = src.ID
		if src.SupersedesID.Valid {
			params.SourceID = src.SupersedesID.String
		}
	} else {
		k, err := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: in.ID, CourseID: params.CourseID})
		if err != nil {
			result(c, nil, err)
			return
		}
		params.KnowledgeID = k.ID
		if k.SupersedesID.Valid {
			params.KnowledgeID = k.SupersedesID.String
		}
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
