package learning

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) importURL(c *gin.Context) {
	if h.rag == nil {
		invalid(c, "资料处理未启用")
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
	if !validText(in.Note, 1000) || len(in.URL) > 3000 || len(in.Title) > 500 {
		invalid(c, "请填写来源说明与有效网址")
		return
	}
	snapshot, e := rag.FetchPublic(c.Request.Context(), in.URL)
	if e != nil {
		ragError(c, e)
		return
	}
	sum := sha256.Sum256(snapshot.Data)
	hash := hex.EncodeToString(sum[:])
	old, e := h.q.SourceDuplicate(c.Request.Context(), store.SourceDuplicateParams{CourseID: c.Param("courseID"), Sha256: hash})
	if e == nil {
		c.JSON(409, gin.H{"error": gin.H{"code": "duplicate_source", "message": "内容已导入，请复用已有原件", "source_id": old.ID}})
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		result(c, nil, e)
		return
	}
	id := uuid.NewString()
	name := id + filepath.Ext(snapshot.Filename)
	if in.Title == "" {
		in.Title = snapshot.Filename
	}
	if e = os.MkdirAll(rag.MaterialsDir(), 0700); e == nil {
		e = os.WriteFile(filepath.Join(rag.MaterialsDir(), name), snapshot.Data, 0600)
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = rag.CachePublicImages(c.Request.Context(), snapshot, rag.MaterialsDir(), id); e != nil {
		result(c, nil, e)
		return
	}
	s, e := h.q.CreateMaterialSource(c.Request.Context(), store.CreateMaterialSourceParams{ID: id, CourseID: c.Param("courseID"), CreatedBy: identity.Current(c).ID, Title: in.Title, Filename: snapshot.Filename, MediaType: snapshot.MediaType, StoragePath: name, SourceNote: in.Note, SourceUrl: snapshot.URL, Sha256: hash, AllowDerived: in.Allow, Version: 1})
	if e != nil {
		_ = os.Remove(filepath.Join(rag.MaterialsDir(), name))
		result(c, nil, e)
		return
	}
	j, e := h.rag.CreateJob(c.Request.Context(), s.CourseID, identity.Current(c).ID, "parse", rag.JobInput{SourceID: id})
	result(c, j, e)
}
