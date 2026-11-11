package learning

import (
	"encoding/json"
	"path/filepath"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (h *Handler) sourceAssets(c *gin.Context) {
	s, ok := h.sourceRecord(c)
	if !ok {
		return
	}
	a, e := h.q.ListMaterialAssets(c.Request.Context(), s.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	r, e := h.q.AssetRevisions(c.Request.Context(), s.ID)
	result(c, gin.H{"assets": a, "revisions": r}, e)
}
func (h *Handler) assetFile(c *gin.Context) {
	a, e := h.q.GetMaterialAsset(c.Request.Context(), store.GetMaterialAssetParams{ID: c.Param("assetID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if !teacher(c) {
		ok, e := h.q.StudentAssetAccess(c.Request.Context(), store.StudentAssetAccessParams{ID: a.ID, CourseID: c.Param("courseID")})
		if e != nil || !ok {
			identity.Fail(c, 403, "forbidden", "该图像未向学生开放")
			return
		}
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", a.MediaType)
	c.File(filepath.Join(rag.MaterialsDir(), a.StoragePath))
}
func (h *Handler) saveAssetRevision(c *gin.Context) {
	var in struct {
		Body         string          `json:"body"`
		Structured   json.RawMessage `json:"structured"`
		BaseRevision int32           `json:"base_revision"`
		ModelJobID   string          `json:"model_job_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Body, 60000) {
		invalid(c, "请填写核对后的转写")
		return
	}
	if len(in.Structured) == 0 {
		in.Structured = []byte("{}")
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	a, e := q.LockMaterialAsset(ctx, store.LockMaterialAssetParams{ID: c.Param("assetID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: a.SourceID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if src.State != "active" || src.ParseState != "ready" {
		invalid(c, "来源已归档或正在解析")
		return
	}
	revisions, e := q.AssetRevisions(ctx, src.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	var latest int32
	for _, r := range revisions {
		if r.AssetID == a.ID && r.Revision > latest {
			latest = r.Revision
		}
	}
	if latest != in.BaseRevision {
		identity.Fail(c, 409, "stale_revision", "图像转写已改变，请刷新")
		return
	}
	if in.ModelJobID != "" {
		j, e := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: in.ModelJobID, CourseID: src.CourseID})
		var input rag.JobInput
		_ = json.Unmarshal(j.Input, &input)
		if e != nil || j.State != "succeeded" || j.Kind != "vision" || input.AssetID != a.ID {
			invalid(c, "视觉任务与原图不匹配")
			return
		}
	}
	r, e := q.CreateAssetRevision(ctx, store.CreateAssetRevisionParams{ID: uuid.NewString(), AssetID: a.ID, Body: in.Body, Structured: in.Structured, State: "confirmed", ModelJobID: text(in.ModelJobID), CreatedBy: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	found := false
	for _, f := range fs {
		var loc map[string]any
		_ = json.Unmarshal(f.Locator, &loc)
		if loc["asset_id"] == a.ID {
			loc["asset_revision_id"] = r.ID
			loc["transcription"] = true
			f.Body = in.Body
			f.Quality = "ready"
			found = true
		}
		b, _ := json.Marshal(loc)
		if _, e = q.InsertMaterialFragment(ctx, store.InsertMaterialFragmentParams{ID: uuid.NewString(), SourceID: src.ID, Revision: src.ParseRevision + 1, Position: f.Position, Heading: f.Heading, Body: f.Body, Locator: b, Quality: f.Quality}); e != nil {
			result(c, nil, e)
			return
		}
	}
	if !found {
		identity.Fail(c, 409, "stale_revision", "原图属于旧解析版本，请在当前原图上重新核对")
		return
	}
	if _, e = q.UpdateSourceParse(ctx, store.UpdateSourceParseParams{ID: src.ID, CourseID: src.CourseID, ParseState: "ready", ParseRevision: src.ParseRevision + 1}); e != nil {
		result(c, nil, e)
		return
	}
	if e = rag.QueueIndex(ctx, q, src.CourseID, identity.Current(c).ID); e != nil {
		result(c, nil, e)
		return
	}
	result(c, r, tx.Commit(ctx))
}
func (h *Handler) resourceAssets(c *gin.Context) {
	r, e := h.q.GetBusinessResource(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, r.CourseID) {
		return
	}
	if !teacher(c) && r.Status != "published" {
		identity.Fail(c, 403, "forbidden", "资料尚未发布")
		return
	}
	out := []store.MaterialAsset{}
	for _, id := range r.FragmentIds {
		f, e := h.q.GetMaterialFragment(c.Request.Context(), store.GetMaterialFragmentParams{ID: id, CourseID: r.CourseID})
		if e != nil {
			result(c, nil, e)
			return
		}
		var loc map[string]any
		_ = json.Unmarshal(f.Locator, &loc)
		if id, ok := loc["asset_id"].(string); ok {
			a, e := h.q.GetMaterialAsset(c.Request.Context(), store.GetMaterialAssetParams{ID: id, CourseID: r.CourseID})
			if e == nil && a.Kind != "page" {
				out = append(out, a)
			}
		}
	}
	result(c, out, nil)
}
func (h *Handler) questionAssets(c *gin.Context) {
	q, e := h.q.GetBusinessQuestion(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	a, ok := h.assignmentRecord(c, q.AssignmentID)
	if !ok {
		return
	}
	if !teacher(c) && a.Status == "draft" {
		identity.Fail(c, 403, "forbidden", "作业尚未发布")
		return
	}
	if !q.BankQuestionVersionID.Valid {
		result(c, []store.MaterialAsset{}, nil)
		return
	}
	v, e := h.q.BankAssets(c.Request.Context(), q.BankQuestionVersionID.String)
	result(c, v, e)
}
