package learning

import (
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var allowedAssetMIMEs = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

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
		if e != nil {
			result(c, nil, e)
			return
		}
		if !ok {
			identity.Fail(c, 403, "forbidden", "该图像未向学生开放")
			return
		}
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(a.MediaType, ";")[0]))
	if !allowedAssetMIMEs[mimeType] {
		identity.Fail(c, 415, "unsupported_media_type", "不支持的图像类型")
		return
	}
	path, e := rag.SafeMaterialPath(a.StoragePath)
	if e != nil {
		identity.Fail(c, 404, "not_found", "图像文件不存在")
		return
	}
	info, e := os.Stat(path)
	if e != nil || info.IsDir() {
		identity.Fail(c, 404, "not_found", "图像文件不存在")
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", mimeType)
	c.File(path)
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
	var latest int32
	if lastRev, err := q.GetLatestAssetRevision(ctx, a.ID); err == nil {
		latest = lastRev.Revision
	} else if !errors.Is(err, pgx.ErrNoRows) {
		result(c, nil, err)
		return
	}
	if latest != in.BaseRevision {
		identity.Fail(c, 409, "stale_revision", "图像转写已改变，请刷新")
		return
	}
	if in.ModelJobID != "" {
		j, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: in.ModelJobID, CourseID: src.CourseID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				invalid(c, "视觉任务与原图不匹配")
				return
			}
			result(c, nil, err)
			return
		}
		var input rag.JobInput
		if json.Unmarshal(j.Input, &input) != nil || j.State != "succeeded" || j.Kind != "vision" || input.AssetID != a.ID {
			invalid(c, "视觉任务与原图不匹配")
			return
		}
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	matched := make([]bool, len(fs))
	found := false
	for i, f := range fs {
		var loc map[string]any
		if json.Unmarshal(f.Locator, &loc) == nil && loc["asset_id"] == a.ID {
			matched[i] = true
			found = true
		}
	}
	if !found {
		identity.Fail(c, 409, "stale_revision", "原图属于旧解析版本，请在当前原图上重新核对")
		return
	}
	r, e := q.CreateAssetRevision(ctx, store.CreateAssetRevisionParams{ID: uuid.NewString(), AssetID: a.ID, Body: in.Body, Structured: in.Structured, State: "confirmed", ModelJobID: text(in.ModelJobID), CreatedBy: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	for i, f := range fs {
		locator := f.Locator
		body := f.Body
		quality := f.Quality
		if matched[i] {
			var loc map[string]any
			_ = json.Unmarshal(f.Locator, &loc)
			if loc == nil {
				loc = map[string]any{}
			}
			loc["asset_revision_id"] = r.ID
			loc["transcription"] = true
			locator, _ = json.Marshal(loc)
			body = in.Body
			quality = "ready"
		}
		if _, e = q.InsertMaterialFragment(ctx, store.InsertMaterialFragmentParams{ID: uuid.NewString(), SourceID: src.ID, Revision: src.ParseRevision + 1, Position: f.Position, Heading: f.Heading, Body: body, Locator: locator, Quality: quality}); e != nil {
			result(c, nil, e)
			return
		}
	}
	if _, e = q.UpdateSourceParse(ctx, store.UpdateSourceParseParams{ID: src.ID, CourseID: src.CourseID, ParseState: "ready", ParseRevision: src.ParseRevision + 1}); e != nil {
		result(c, nil, e)
		return
	}
	jobID, e := rag.QueueIndexID(ctx, q, src.CourseID, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	if jobID != "" && h.rag != nil {
		h.rag.Enqueue(jobID)
	}
	result(c, r, nil)
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
	if !r.SourceID.Valid || len(r.FragmentIds) == 0 {
		result(c, []store.MaterialAsset{}, nil)
		return
	}
	out, e := h.q.ListResourceAssetsBatch(c.Request.Context(), store.ListResourceAssetsBatchParams{SourceID: r.SourceID.String, FragmentIds: r.FragmentIds})
	result(c, out, e)
}
func (h *Handler) questionAssets(c *gin.Context) {
	q, e := h.q.GetBusinessQuestion(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if _, ok := h.assignmentRecord(c, q.AssignmentID); !ok {
		return
	}
	if !q.BankQuestionVersionID.Valid {
		result(c, []store.MaterialAsset{}, nil)
		return
	}
	v, e := h.q.BankAssets(c.Request.Context(), q.BankQuestionVersionID.String)
	result(c, v, e)
}
