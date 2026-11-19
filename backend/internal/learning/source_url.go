package learning

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) importURL(c *gin.Context) {
	if h.rag == nil {
		identity.Fail(c, 503, "rag_not_configured", "资料处理未启用")
		return
	}
	var in struct {
		URL   string `json:"url"`
		Title string `json:"title"`
		Note  string `json:"source_note"`
		Allow bool   `json:"allow_derived"`
	}
	if !bind(c, &in) {
		return
	}
	in.URL = strings.TrimSpace(in.URL)
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	if !validText(in.Note, 1000) || !validText(in.URL, 3000) || len(in.Title) > 500 || strings.ContainsRune(in.Title, '\x00') {
		invalid(c, "请填写来源说明与有效网址")
		return
	}
	ctx := c.Request.Context()
	snapshot, e := rag.FetchPublic(ctx, in.URL)
	if e != nil {
		ragError(c, e)
		return
	}
	sum := sha256.Sum256(snapshot.Data)
	hash := hex.EncodeToString(sum[:])
	courseID := c.Param("courseID")
	old, e := h.q.SourceDuplicate(ctx, store.SourceDuplicateParams{CourseID: courseID, Sha256: hash})
	if e == nil {
		identity.Fail(c, 409, "duplicate_source", "内容已导入，请复用原件："+old.Title)
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		result(c, nil, e)
		return
	}
	id := uuid.NewString()
	ext := strings.ToLower(filepath.Ext(snapshot.Filename))
	name := id + ext
	if in.Title == "" {
		in.Title = strings.TrimSpace(snapshot.Filename)
	}
	if len(in.Title) > 500 {
		in.Title = string([]rune(in.Title)[:100])
	}
	dir := rag.MaterialsDir()
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = os.Remove(filepath.Join(dir, name))
		_ = os.Remove(filepath.Join(dir, id+"_images.json"))
		if matches, err := filepath.Glob(filepath.Join(dir, id+"_web_*")); err == nil {
			for _, m := range matches {
				_ = os.Remove(m)
			}
		}
	}()
	if e = os.MkdirAll(dir, 0700); e != nil {
		result(c, nil, e)
		return
	}
	if e = os.WriteFile(filepath.Join(dir, name), snapshot.Data, 0600); e != nil {
		result(c, nil, e)
		return
	}
	if e = rag.CachePublicImages(ctx, snapshot, dir, id); e != nil {
		result(c, nil, e)
		return
	}
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if dup, err := q.SourceDuplicate(ctx, store.SourceDuplicateParams{CourseID: courseID, Sha256: hash}); err == nil {
		identity.Fail(c, 409, "duplicate_source", "内容已导入，请复用原件："+dup.Title)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		result(c, nil, err)
		return
	}
	s, e := q.CreateMaterialSource(ctx, store.CreateMaterialSourceParams{
		ID:           id,
		CourseID:     courseID,
		CreatedBy:    identity.Current(c).ID,
		Title:        in.Title,
		Filename:     filepath.Base(snapshot.Filename),
		MediaType:    snapshot.MediaType,
		StoragePath:  name,
		SourceNote:   in.Note,
		SourceUrl:    snapshot.URL,
		Sha256:       hash,
		AllowDerived: in.Allow,
		Version:      1,
	})
	if e != nil {
		result(c, nil, e)
		return
	}
	jobInput, _ := json.Marshal(rag.JobInput{SourceID: id})
	j, e := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{
		ID:        uuid.NewString(),
		CourseID:  s.CourseID,
		CreatedBy: identity.Current(c).ID,
		Kind:      "parse",
		Input:     jobInput,
	})
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		result(c, nil, e)
		return
	}
	committed = true
	h.rag.Enqueue(j.ID)
	result(c, j, nil)
}
