package learning

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type sectionRow struct {
	Title       string   `json:"title"`
	Relation    string   `json:"relation"`
	FragmentIDs []string `json:"fragment_ids"`
	PointID     string   `json:"knowledge_point_id"`
	Reason      string   `json:"reason"`
}

// Teacher-facing view of the proposed split for the current parse revision.
func (h *Handler) sections(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	v, e := h.q.ListContentSections(c.Request.Context(), store.ListContentSectionsParams{SourceID: src.ID, Revision: src.ParseRevision})
	result(c, v, e)
}

// Persist the AI proposal as proposed rows. Existing proposed/rejected rows for the same revision are replaced cleanly.
func (h *Handler) adoptSegments(c *gin.Context) {
	var in struct {
		JobID string `json:"job_id"`
	}
	if !bind(c, &in) {
		return
	}
	j, input, e := h.draftJob(c, in.JobID, "source_segment")
	if e != nil {
		ragError(c, e)
		return
	}
	if input.SourceID != c.Param("sourceID") {
		invalid(c, "切分结果不属于此资料")
		return
	}
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	if src.State != "active" || src.ParseRevision != input.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "资料已修订，请重新切分")
		return
	}
	var out struct {
		Segments []sectionRow `json:"segments"`
	}
	if json.Unmarshal(j.Output, &out) != nil || len(out.Segments) == 0 {
		ragError(c, errors.New("切分结果为空，请重新生成"))
		return
	}
	if err := validateSectionRows(out.Segments); err != nil {
		ragError(c, err)
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
	locked, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: src.ID, CourseID: src.CourseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if locked.State != "active" || locked.ParseRevision != input.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "资料已修订，请重新切分")
		return
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: locked.ID, Revision: locked.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	validFrags := make(map[string]bool, len(fs))
	for _, f := range fs {
		validFrags[f.ID] = true
	}
	pts, e := q.ListBusinessPoints(ctx, locked.CourseID)
	if e != nil {
		result(c, nil, e)
		return
	}
	validPoints := map[string]bool{}
	for _, p := range pts {
		if p.Kind == "point" {
			validPoints[p.ID] = true
		}
	}
	seenFrags := map[string]bool{}
	for _, s := range out.Segments {
		if s.Relation == "point" && !validPoints[s.PointID] {
			ragError(c, errors.New("切分段引用的知识点不存在或不属于本课程"))
			return
		}
		for _, fid := range s.FragmentIDs {
			if !validFrags[fid] || seenFrags[fid] {
				ragError(c, errors.New("切分片段重复或不属于当前原件版本"))
				return
			}
			seenFrags[fid] = true
		}
	}
	old, e := q.ListContentSections(ctx, store.ListContentSectionsParams{SourceID: locked.ID, Revision: locked.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	for _, item := range old {
		if item.State == "accepted" {
			identity.Fail(c, 409, "state_conflict", "当前版本已有已接受的切分方案，如需替换请先驳回")
			return
		}
	}
	if len(old) > 0 {
		if e = q.DeleteContentSections(ctx, store.DeleteContentSectionsParams{SourceID: locked.ID, Revision: locked.ParseRevision}); e != nil {
			result(c, nil, e)
			return
		}
	}
	for i, s := range out.Segments {
		if _, e = q.CreateContentSection(ctx, store.CreateContentSectionParams{
			ID:               uuid.NewString(),
			CourseID:         locked.CourseID,
			SourceID:         locked.ID,
			Revision:         locked.ParseRevision,
			Position:         int32(i),
			Title:            strings.TrimSpace(s.Title),
			Relation:         s.Relation,
			FragmentIds:      s.FragmentIDs,
			KnowledgePointID: text(s.PointID),
			Reason:           strings.TrimSpace(s.Reason),
		}); e != nil {
			result(c, nil, e)
			return
		}
	}
	rows, e := q.ListContentSections(ctx, store.ListContentSectionsParams{SourceID: locked.ID, Revision: locked.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, rows, tx.Commit(ctx))
}

func validateSectionRows(rows []sectionRow) error {
	if len(rows) > 50 {
		return errors.New("切分段数超限")
	}
	for _, r := range rows {
		if !validText(r.Title, 200) || len(r.FragmentIDs) == 0 {
			return errors.New("切分段缺少标题或片段")
		}
		if len(r.Reason) > 1000 || strings.ContainsRune(r.Reason, '\x00') {
			return errors.New("切分依据过长或包含非法字符")
		}
		if r.Relation != "point" && r.Relation != "sequence" {
			return errors.New("切分段关联方式无效")
		}
		if r.Relation == "point" && r.PointID == "" {
			return errors.New("挂知识点的切分段必须选择知识点")
		}
		if r.Relation == "sequence" && r.PointID != "" {
			return errors.New("顺序切分段不能指定知识点")
		}
	}
	return nil
}

// Bulk teacher decision. AI proposals stay proposed until a teacher accepts them.
func (h *Handler) sectionsState(c *gin.Context) {
	var in struct {
		State string `json:"state"`
	}
	if !bind(c, &in) {
		return
	}
	if in.State != "accepted" && in.State != "rejected" && in.State != "proposed" {
		invalid(c, "切分状态无效")
		return
	}
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	current, e := h.q.ListContentSections(ctx, store.ListContentSectionsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(current) == 0 {
		identity.Fail(c, 404, "not_found", "当前修订版尚无切分方案")
		return
	}
	if e := h.q.SetContentSectionsState(ctx, store.SetContentSectionsStateParams{SourceID: src.ID, Revision: src.ParseRevision, State: in.State}); e != nil {
		result(c, nil, e)
		return
	}
	v, e := h.q.ListContentSections(ctx, store.ListContentSectionsParams{SourceID: src.ID, Revision: src.ParseRevision})
	result(c, v, e)
}
