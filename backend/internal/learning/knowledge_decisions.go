package learning

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) knowledgeDecision(c *gin.Context) {
	if h.rag == nil {
		identity.Fail(c, 503, "rag_not_configured", "知识处理尚未启用")
		return
	}
	var in struct {
		Action       string   `json:"action"`
		EditVersion  int32    `json:"edit_version"`
		CompareJobID string   `json:"compare_job_id"`
		Reason       string   `json:"reason"`
		Title        string   `json:"title"`
		Body         string   `json:"body"`
		Conditions   string   `json:"conditions"`
		RelatedIDs   []string `json:"related_ids"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Reason, 5000) || len(in.RelatedIDs) > 12 {
		invalid(c, "请填写处理原因，比较范围最多12条")
		return
	}
	if in.Action != "discard" && in.Action != "merge" && in.Action != "coexist" && in.Action != "replace" && in.Action != "defer" {
		invalid(c, "知识处理方式无效")
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
	ids := append([]string{c.Param("knowledgeID")}, in.RelatedIDs...)
	sort.Strings(ids)
	locked := map[string]store.KnowledgeEntry{}
	for _, id := range ids {
		if _, ok := locked[id]; ok {
			invalid(c, "处理对象不能重复")
			return
		}
		k, e := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: id, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		locked[id] = k
	}
	k := locked[c.Param("knowledgeID")]
	for _, entry := range locked {
		if entry.Origin == "teacher_example" {
			invalid(c, "自编示例请直接编辑、建立版本或归档，不与资料提炼条目合并")
			return
		}
	}
	if k.State != "draft" || k.EditVersion != in.EditVersion {
		identity.Fail(c, 409, "stale_revision", "候选已改变，请重新核对")
		return
	}
	if in.CompareJobID != "" {
		j, input, e := h.draftJobWithQueries(ctx, q, c.Param("courseID"), in.CompareJobID, "knowledge_compare")
		if e != nil {
			ragError(c, e)
			return
		}
		if input.KnowledgeID != k.ID || input.EditVersion != k.EditVersion {
			identity.Fail(c, 409, "stale_revision", "比较任务与候选版本不符，请重新比较")
			return
		}
		var out struct {
			Snapshot struct {
				Existing []store.KnowledgeEntry `json:"existing"`
			} `json:"input_snapshot"`
		}
		if err := json.Unmarshal(j.Output, &out); err != nil {
			result(c, nil, err)
			return
		}
		for _, id := range in.RelatedIDs {
			found := false
			for _, old := range out.Snapshot.Existing {
				current := locked[id]
				if old.ID == id && old.EditVersion == current.EditVersion && old.State == current.State {
					found = true
				}
			}
			if !found {
				identity.Fail(c, 409, "stale_revision", "比较对象已变化或不在本次比较范围")
				return
			}
		}
	}
	refs := []rag.Evidence{}
	if err := json.Unmarshal(k.Evidence, &refs); err != nil {
		result(c, nil, err)
		return
	}
	student, learning, grading := k.StudentVisible, k.UseForLearning, k.UseForGrading
	for _, id := range in.RelatedIDs {
		old := locked[id]
		if old.State != "confirmed" {
			invalid(c, "关联对象必须是确认知识")
			return
		}
		student = student && old.StudentVisible
		learning = learning && old.UseForLearning
		grading = grading && old.UseForGrading
		var ev []rag.Evidence
		if err := json.Unmarshal(old.Evidence, &ev); err != nil {
			result(c, nil, err)
			return
		}
		refs = append(refs, ev...)
	}
	if (in.Action == "merge" || in.Action == "replace" || in.Action == "coexist") && len(in.RelatedIDs) == 0 {
		invalid(c, "请选择需要处理的已有知识")
		return
	}
	var output any = k
	if in.Action == "merge" {
		if !validText(in.Title, 500) || !validText(in.Body, 60000) || len(in.Conditions) > 10000 || strings.ContainsRune(in.Conditions, '\x00') {
			invalid(c, "请核对合并后的标题、正文和适用条件")
			return
		}
		if e = h.rag.ValidateEvidenceWithQueries(ctx, q, k.CourseID, refs, student); e != nil {
			ragError(c, e)
			return
		}
		related := append(append([]string{}, in.RelatedIDs...), k.ID)
		if e = h.rag.ValidateLinksWithQueries(ctx, q, k.CourseID, k.KnowledgePointIds, related, ""); e != nil {
			ragError(c, e)
			return
		}
		raw, _ := json.Marshal(refs)
		v, e := q.CreateKnowledgeEntry(ctx, store.CreateKnowledgeEntryParams{ID: uuid.NewString(), CourseID: k.CourseID, CreatedBy: identity.Current(c).ID, Title: in.Title, Body: in.Body, Category: k.Category, ContentKind: k.ContentKind, Conditions: in.Conditions, KnowledgePointIds: nonNilStrings(k.KnowledgePointIds), Evidence: raw, RelatedIds: related, StudentVisible: student, UseForLearning: learning, UseForGrading: grading, Version: 1})
		if e != nil {
			result(c, nil, e)
			return
		}
		v, e = q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: v.ID, CourseID: k.CourseID, State: "confirmed", State_2: "draft", EditVersion: 1})
		if e != nil {
			result(c, nil, e)
			return
		}
		output = v
		n, e := q.RejectKnowledgeDraft(ctx, store.RejectKnowledgeDraftParams{ID: k.ID, CourseID: k.CourseID, EditVersion: k.EditVersion})
		if e != nil {
			result(c, nil, e)
			return
		}
		if n == 0 {
			identity.Fail(c, 409, "stale_revision", "候选已改变，请重新核对")
			return
		}
	} else if in.Action == "discard" {
		n, e := q.RejectKnowledgeDraft(ctx, store.RejectKnowledgeDraftParams{ID: k.ID, CourseID: k.CourseID, EditVersion: k.EditVersion})
		if e != nil {
			result(c, nil, e)
			return
		}
		if n == 0 {
			identity.Fail(c, 409, "stale_revision", "候选已改变，请重新核对")
			return
		}
	} else if in.Action == "replace" || in.Action == "coexist" {
		originalRefs := []rag.Evidence{}
		if err := json.Unmarshal(k.Evidence, &originalRefs); err != nil {
			result(c, nil, err)
			return
		}
		if e = h.rag.ValidateEvidenceWithQueries(ctx, q, k.CourseID, originalRefs, k.StudentVisible); e != nil {
			ragError(c, e)
			return
		}
		if e = h.rag.ValidateLinksWithQueries(ctx, q, k.CourseID, k.KnowledgePointIds, in.RelatedIDs, k.ID); e != nil {
			ragError(c, e)
			return
		}
		v, e := q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: k.ID, CourseID: k.CourseID, State: "confirmed", State_2: "draft", EditVersion: k.EditVersion})
		if errors.Is(e, pgx.ErrNoRows) {
			identity.Fail(c, 409, "stale_revision", "候选已改变，请重新核对")
			return
		}
		if e != nil {
			result(c, nil, e)
			return
		}
		output = v
		v, e = q.LinkKnowledgeRelations(ctx, store.LinkKnowledgeRelationsParams{ID: k.ID, CourseID: k.CourseID, RelatedIds: in.RelatedIDs})
		if e != nil {
			result(c, nil, e)
			return
		}
		output = v
		if in.Action == "replace" {
			for _, id := range in.RelatedIDs {
				old := locked[id]
				if _, e = q.TransitionKnowledgeEntry(ctx, store.TransitionKnowledgeEntryParams{ID: id, CourseID: k.CourseID, State: "archived", State_2: "confirmed", EditVersion: old.EditVersion}); e != nil {
					if errors.Is(e, pgx.ErrNoRows) {
						identity.Fail(c, 409, "stale_revision", "关联知识已改变，请刷新后重试")
						return
					}
					result(c, nil, e)
					return
				}
			}
		}
	}
	decision, e := recordDecision(ctx, q, k.CourseID, identity.Current(c).ID, "knowledge_"+in.Action, k.ID, in.Reason, map[string]any{"request": in, "locked": locked}, output)
	if e != nil {
		result(c, nil, e)
		return
	}
	var jobID string
	if in.Action != "defer" && in.Action != "discard" {
		jobID, e = rag.QueueIndexID(ctx, q, k.CourseID, identity.Current(c).ID)
		if e != nil {
			result(c, nil, e)
			return
		}
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	if jobID != "" && h.rag != nil {
		h.rag.Enqueue(jobID)
	}
	result(c, gin.H{"decision": decision, "knowledge": output}, nil)
}

func (h *Handler) adoptSuggestions(c *gin.Context) {
	var in struct {
		JobID     string   `json:"job_id"`
		TopicIDs  []string `json:"topic_ids"`
		Tags      []string `json:"tags"`
		NewTopics []string `json:"new_topics"`
		Outline   []string `json:"outline"`
		NewPoints []struct {
			Title       string `json:"title"`
			ParentID    string `json:"parent_id"`
			DuplicateOf string `json:"duplicate_of"`
		} `json:"new_points"`
		Reason   string   `json:"reason"`
		PointIDs []string `json:"knowledge_point_ids"`
	}
	if !bind(c, &in) {
		return
	}
	j, input, e := h.draftJob(c, in.JobID, "source_suggest")
	if e != nil {
		ragError(c, e)
		return
	}
	if input.SourceID != c.Param("sourceID") {
		invalid(c, "建议不属于此资料")
		return
	}
	if len(in.NewTopics) > 10 || len(in.Outline) > 30 || len(in.NewPoints) > 10 || len(in.Reason) > 5000 {
		invalid(c, "采纳范围过大")
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
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: input.SourceID, CourseID: j.CourseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if old, err := q.DecisionByJob(ctx, store.DecisionByJobParams{CourseID: j.CourseID, Kind: "source_suggestions", JobID: j.ID}); err == nil {
		result(c, old, nil)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		result(c, nil, err)
		return
	}
	if src.State != "active" || src.ParseRevision != input.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "资料已修订，请重新生成建议")
		return
	}
	seenNewTopics := map[string]bool{}
	for _, rawName := range in.NewTopics {
		name := strings.TrimSpace(rawName)
		if !validText(name, 300) {
			invalid(c, "新专题名称无效")
			return
		}
		if seenNewTopics[name] {
			continue
		}
		seenNewTopics[name] = true
		t, e := q.CreateTopic(ctx, store.CreateTopicParams{ID: uuid.NewString(), CourseID: src.CourseID, Title: name})
		if e != nil {
			if isPgCode(e, "23505") {
				identity.Fail(c, 409, "duplicate_topic", "专题名称已存在，请直接选择已有专题："+name)
				return
			}
			result(c, nil, e)
			return
		}
		in.TopicIDs = append(in.TopicIDs, t.ID)
	}
	if len(in.NewPoints) > 0 {
		points, e := q.ListBusinessPoints(ctx, src.CourseID)
		if e != nil {
			result(c, nil, e)
			return
		}
		kinds := map[string]string{}
		byTitle := map[string]string{}
		maxPos := int32(0)
		for _, p := range points {
			kinds[p.ID] = p.Kind
			if p.Kind == "point" {
				byTitle[pointTitleKey(p.Title)] = p.ID
			}
			if p.Position > maxPos {
				maxPos = p.Position
			}
		}
		selected := map[string]bool{}
		for _, id := range in.PointIDs {
			selected[id] = true
		}
		for _, np := range in.NewPoints {
			title := strings.TrimSpace(np.Title)
			if !validText(title, 200) {
				invalid(c, "新知识点名称不能为空且不超过200字节")
				return
			}
			if np.ParentID != "" && kinds[np.ParentID] != "chapter" && kinds[np.ParentID] != "section" {
				invalid(c, "新知识点的上级目录须为本课程的章或节")
				return
			}
			target := ""
			if np.DuplicateOf != "" {
				if kinds[np.DuplicateOf] != "point" {
					invalid(c, "合并目标须为本课程知识点")
					return
				}
				target = np.DuplicateOf
			} else if id, ok := byTitle[pointTitleKey(title)]; ok {
				target = id
			} else {
				maxPos++
				v, e := q.AddBusinessPoint(ctx, store.AddBusinessPointParams{
					ID:       uuid.NewString(),
					CourseID: src.CourseID,
					Title:    title,
					Position: maxPos,
					ParentID: text(np.ParentID),
					Kind:     "point",
				})
				if e != nil {
					result(c, nil, e)
					return
				}
				byTitle[pointTitleKey(title)] = v.ID
				kinds[v.ID] = "point"
				target = v.ID
			}
			if !selected[target] {
				selected[target] = true
				in.PointIDs = append(in.PointIDs, target)
			}
		}
	}
	if e = replaceLinks(ctx, q, src.CourseID, "source", src.ID, in.TopicIDs, in.Tags, in.PointIDs); e != nil {
		ragError(c, e)
		return
	}
	// Only explicitly selected new sections are appended after existing max position; existing curriculum is untouched.
	if len(in.Outline) > 0 {
		existingPoints, e := q.ListBusinessPoints(ctx, src.CourseID)
		if e != nil {
			result(c, nil, e)
			return
		}
		var basePos int32
		if len(existingPoints) > 0 {
			maxPos := existingPoints[0].Position
			for _, p := range existingPoints[1:] {
				if p.Position > maxPos {
					maxPos = p.Position
				}
			}
			basePos = maxPos + 1
		}
		for i, rawTitle := range in.Outline {
			title := strings.TrimSpace(rawTitle)
			if !validText(title, 500) {
				invalid(c, "目录标题无效")
				return
			}
			if _, e = q.AddBusinessPoint(ctx, store.AddBusinessPointParams{ID: uuid.NewString(), CourseID: src.CourseID, Title: title, Kind: "chapter", Position: basePos + int32(i)}); e != nil {
				result(c, nil, e)
				return
			}
		}
	}
	decision, e := recordDecision(ctx, q, src.CourseID, identity.Current(c).ID, "source_suggestions", src.ID, in.Reason, map[string]any{"job_id": j.ID, "suggestions": json.RawMessage(j.Output)}, in)
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, decision, tx.Commit(ctx))
}

func pointTitleKey(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), "")
}
