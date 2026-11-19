package learning

import (
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	maxCropImagePixels = 24_000_000
	maxCropImageDim    = 16384
)

func (h *Handler) cropAsset(c *gin.Context) {
	var in struct {
		X             float64 `json:"x"`
		Y             float64 `json:"y"`
		Width         float64 `json:"width"`
		Height        float64 `json:"height"`
		Kind          string  `json:"kind"`
		ParseRevision int32   `json:"parse_revision"`
	}
	if !bind(c, &in) {
		return
	}
	if math.IsNaN(in.X) || math.IsInf(in.X, 0) ||
		math.IsNaN(in.Y) || math.IsInf(in.Y, 0) ||
		math.IsNaN(in.Width) || math.IsInf(in.Width, 0) ||
		math.IsNaN(in.Height) || math.IsInf(in.Height, 0) ||
		in.X < 0 || in.Y < 0 || in.Width <= 0 || in.Height <= 0 ||
		in.X+in.Width > 1+1e-6 || in.Y+in.Height > 1+1e-6 ||
		(in.Kind != "image" && in.Kind != "formula" && in.Kind != "chart" && in.Kind != "diagram") {
		invalid(c, "请选择图像内的有效区域与类型")
		return
	}
	ctx := c.Request.Context()
	a, e := h.q.GetMaterialAsset(ctx, store.GetMaterialAssetParams{ID: c.Param("assetID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	preSrc, e := h.q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: a.SourceID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if preSrc.State != "active" || preSrc.ParseState != "ready" || preSrc.ParseRevision != in.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "来源已变化，请刷新后裁剪")
		return
	}
	srcPath, e := rag.SafeMaterialPath(a.StoragePath)
	if e != nil {
		invalid(c, "图像路径无效")
		return
	}
	f, e := os.Open(srcPath)
	if e != nil {
		if errors.Is(e, os.ErrNotExist) {
			identity.Fail(c, 404, "not_found", "原始图像不存在")
			return
		}
		result(c, nil, e)
		return
	}
	cfg, _, e := image.DecodeConfig(f)
	if e != nil {
		_ = f.Close()
		invalid(c, "图像无法解码")
		return
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > maxCropImageDim || cfg.Height > maxCropImageDim || int64(cfg.Width)*int64(cfg.Height) > maxCropImagePixels {
		_ = f.Close()
		invalid(c, "图片分辨率过大，无法裁剪")
		return
	}
	if _, e = f.Seek(0, io.SeekStart); e != nil {
		_ = f.Close()
		result(c, nil, e)
		return
	}
	img, _, e := image.Decode(f)
	_ = f.Close()
	if e != nil {
		invalid(c, "图像无法解码")
		return
	}
	b := img.Bounds()
	w, hg := float64(b.Dx()), float64(b.Dy())
	box := image.Rect(b.Min.X+int(in.X*w), b.Min.Y+int(in.Y*hg), b.Min.X+int(math.Ceil((in.X+in.Width)*w)), b.Min.Y+int(math.Ceil((in.Y+in.Height)*hg))).Intersect(b)
	if box.Dx() < 10 || box.Dy() < 10 {
		invalid(c, "裁剪区域太小")
		return
	}
	sub, ok := img.(interface {
		SubImage(image.Rectangle) image.Image
	})
	if !ok {
		invalid(c, "图像不支持裁剪")
		return
	}
	id := uuid.NewString()
	name := id + ".png"
	path := filepath.Join(rag.MaterialsDir(), name)
	out, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		result(c, nil, e)
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(path)
		}
	}()
	encErr := png.Encode(out, sub.SubImage(box))
	closeErr := out.Close()
	if encErr != nil {
		result(c, nil, encErr)
		return
	}
	if closeErr != nil {
		result(c, nil, closeErr)
		return
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	s, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: a.SourceID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if s.State != "active" || s.ParseState != "ready" || s.ParseRevision != in.ParseRevision {
		identity.Fail(c, 409, "stale_revision", "来源已变化，请刷新后裁剪")
		return
	}
	var loc map[string]any
	_ = json.Unmarshal(a.Locator, &loc)
	if loc == nil {
		loc = map[string]any{}
	}
	loc["parent_asset_id"] = a.ID
	loc["crop"] = []float64{in.X, in.Y, in.Width, in.Height}
	loc["asset_id"] = id
	raw, _ := json.Marshal(loc)
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: s.ID, Revision: s.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	for _, f := range fs {
		if _, e = q.InsertMaterialFragment(ctx, store.InsertMaterialFragmentParams{ID: uuid.NewString(), SourceID: s.ID, Revision: s.ParseRevision + 1, Position: f.Position, Heading: f.Heading, Body: f.Body, Locator: f.Locator, Quality: f.Quality}); e != nil {
			result(c, nil, e)
			return
		}
	}
	fragment, e := q.InsertMaterialFragment(ctx, store.InsertMaterialFragmentParams{ID: uuid.NewString(), SourceID: s.ID, Revision: s.ParseRevision + 1, Position: int32(len(fs)), Heading: "裁剪区域", Body: "[图文资产待核对]", Locator: raw, Quality: "needs_review"})
	if e != nil {
		result(c, nil, e)
		return
	}
	asset, e := q.InsertMaterialAsset(ctx, store.InsertMaterialAssetParams{ID: id, SourceID: s.ID, FragmentID: fragment.ID, StoragePath: name, MediaType: "image/png", Kind: in.Kind, Locator: raw, NativeData: []byte("{}")})
	if e != nil {
		result(c, nil, e)
		return
	}
	_, e = q.UpdateSourceParse(ctx, store.UpdateSourceParseParams{ID: s.ID, CourseID: s.CourseID, ParseState: "ready", ParseRevision: s.ParseRevision + 1})
	if e != nil {
		result(c, nil, e)
		return
	}
	_, e = recordDecision(ctx, q, s.CourseID, identity.Current(c).ID, "asset_crop", id, "教师选择题图／公式区域", in, asset)
	if e != nil {
		result(c, nil, e)
		return
	}
	e = tx.Commit(ctx)
	committed = e == nil
	result(c, asset, e)
}
