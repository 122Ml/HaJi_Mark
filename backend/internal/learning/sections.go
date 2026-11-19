package learning

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
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

func carryForwardContentSections(ctx context.Context, q *store.Queries, courseID, sourceID string, oldRev, newRev int32, fragMap map[string]string) error {
	sections, err := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: courseID, SourceID: sourceID, Revision: oldRev})
	if err != nil {
		return err
	}
	for _, s := range sections {
		mapped := make([]string, 0, len(s.FragmentIds))
		for _, oldID := range s.FragmentIds {
			if newID, ok := fragMap[oldID]; ok && newID != "" {
				mapped = append(mapped, newID)
			} else if len(fragMap) == 0 {
				mapped = append(mapped, oldID)
			}
		}
		if len(mapped) == 0 {
			continue
		}
		if _, err := q.CreateContentSection(ctx, store.CreateContentSectionParams{
			ID:               uuid.NewString(),
			CourseID:         courseID,
			SourceID:         sourceID,
			Revision:         newRev,
			Position:         s.Position,
			Title:            s.Title,
			Relation:         s.Relation,
			FragmentIds:      mapped,
			KnowledgePointID: s.KnowledgePointID,
			Reason:           s.Reason,
			State:            s.State,
		}); err != nil {
			return err
		}
	}
	return nil
}

// Teacher-facing view of the proposed split for the current parse revision.
func (h *Handler) sections(c *gin.Context) {
	src, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	v, e := h.q.ListContentSections(c.Request.Context(), store.ListContentSectionsParams{CourseID: src.CourseID, SourceID: src.ID, Revision: src.ParseRevision})
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
	old, e := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: locked.CourseID, SourceID: locked.ID, Revision: locked.ParseRevision})
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
		if e = q.DeleteContentSections(ctx, store.DeleteContentSectionsParams{CourseID: locked.CourseID, SourceID: locked.ID, Revision: locked.ParseRevision}); e != nil {
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
			State:            "proposed",
		}); e != nil {
			result(c, nil, e)
			return
		}
	}
	rows, e := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: locked.CourseID, SourceID: locked.ID, Revision: locked.ParseRevision})
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
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	sourceID := c.Param("sourceID")
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: sourceID, CourseID: courseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if src.State != "active" || src.ParseState != "ready" {
		identity.Fail(c, 409, "state_conflict", "原件已归档或尚未解析就绪")
		return
	}
	current, e := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: src.CourseID, SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(current) == 0 {
		identity.Fail(c, 404, "not_found", "当前修订版尚无切分方案")
		return
	}
	n, e := q.SetContentSectionsState(ctx, store.SetContentSectionsStateParams{CourseID: src.CourseID, SourceID: src.ID, Revision: src.ParseRevision, State: in.State})
	if e != nil {
		result(c, nil, e)
		return
	}
	if n == 0 {
		identity.Fail(c, 409, "state_conflict", "当前切分方案状态不允许此变更，请刷新")
		return
	}
	v, e := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: src.CourseID, SourceID: src.ID, Revision: src.ParseRevision})
	if e == nil {
		e = tx.Commit(ctx)
	}
	result(c, v, e)
}

func (h *Handler) sectionsPublish(c *gin.Context) {
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	sourceID := c.Param("sourceID")
	actorID := identity.Current(c).ID
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: sourceID, CourseID: courseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if src.State != "active" || src.ParseState != "ready" {
		identity.Fail(c, 409, "state_conflict", "原件已归档或尚未解析就绪")
		return
	}
	sections, e := q.ListContentSections(ctx, store.ListContentSectionsParams{CourseID: src.CourseID, SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	accepted := make([]store.ContentSection, 0, len(sections))
	for _, s := range sections {
		if s.State == "accepted" {
			accepted = append(accepted, s)
		}
	}
	if len(accepted) == 0 {
		identity.Fail(c, 409, "state_conflict", "没有已接受的切分段可批量发布，请先接受切分方案")
		return
	}
	parts := make([]string, len(accepted))
	for i, sec := range accepted {
		parts[i] = fmt.Sprintf("%s:%d", sec.ID, sec.EditVersion)
	}
	slices.Sort(parts)
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d|%s", src.ID, src.ParseRevision, strings.Join(parts, "|"))))
	fp := hex.EncodeToString(sum[:])
	targetID := fmt.Sprintf("sections_publish:%s:%d:%s", src.ID, src.ParseRevision, fp[:16])
	prev, err := q.ContentDecisions(ctx, store.ContentDecisionsParams{CourseID: src.CourseID, ObjectID: targetID})
	if err != nil {
		result(c, nil, err)
		return
	}
	for _, d := range prev {
		if d.Kind == "sections_publish" {
			identity.Fail(c, 409, "state_conflict", "当前切分方案已发布，如需重新发布请调整切分后重试")
			return
		}
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	fragByID := make(map[string]store.MaterialFragment, len(fs))
	for _, f := range fs {
		fragByID[f.ID] = f
	}
	published := make([]store.Resource, 0, len(accepted))
	for _, sec := range accepted {
		var content strings.Builder
		locators := make([]json.RawMessage, 0, len(sec.FragmentIds))
		for _, fid := range sec.FragmentIds {
			f, ok := fragByID[fid]
			if !ok {
				identity.Fail(c, 409, "stale_revision", "切分引用的原文片段不存在，请重新切分")
				return
			}
			if f.Quality != "ready" {
				invalid(c, "存在待人工核对片段，请先完成原文核对")
				return
			}
			if content.Len()+len(f.Heading)+len(f.Body)+3 > 200000 {
				invalid(c, "单个切分段正文超出200000字节上限")
				return
			}
			content.WriteString(f.Heading)
			content.WriteByte('\n')
			content.WriteString(f.Body)
			content.WriteString("\n\n")
			locators = append(locators, f.Locator)
		}
		if sec.KnowledgePointID.Valid {
			if e := h.rag.ValidateLinksWithQueries(ctx, q, src.CourseID, []string{sec.KnowledgePointID.String}, nil, ""); e != nil {
				ragError(c, e)
				return
			}
		}
		loc, _ := json.Marshal(locators)
		r, e := q.CreateBusinessResource(ctx, store.CreateBusinessResourceParams{
			ID:               uuid.NewString(),
			CourseID:         src.CourseID,
			CreatedBy:        actorID,
			Title:            sec.Title,
			Content:          content.String(),
			SourceUrl:        src.SourceUrl,
			SourceNote:       src.SourceNote,
			Locator:          src.Filename + " " + string(loc),
			KnowledgePointID: sec.KnowledgePointID,
		})
		if e != nil {
			result(c, nil, e)
			return
		}
		if e = q.BindResourceFragments(ctx, store.BindResourceFragmentsParams{ID: r.ID, SourceID: text(src.ID), FragmentIds: sec.FragmentIds, FullSource: false}); e != nil {
			result(c, nil, e)
			return
		}
		r, e = q.PublishBusinessResource(ctx, store.PublishBusinessResourceParams{ID: r.ID, ReviewedBy: text(actorID)})
		if e != nil {
			result(c, nil, e)
			return
		}
		published = append(published, r)
	}
	if _, e = recordDecision(ctx, q, src.CourseID, actorID, "sections_publish", targetID, "按已接受切分批量发布学习资料", map[string]any{"source_id": src.ID, "revision": src.ParseRevision, "fingerprint": fp}, published); e != nil {
		result(c, nil, e)
		return
	}
	jobID, e := rag.QueueIndexID(ctx, q, src.CourseID, actorID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	h.enqueueIndex(jobID)
	result(c, published, nil)
}
