package learning

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
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

var urlMimeToExt = map[string]string{
	"text/html":               ".html",
	"application/xhtml+xml":   ".html",
	"application/pdf":         ".pdf",
	"text/markdown":           ".md",
	"text/x-markdown":         ".md",
	"text/csv":                ".csv",
	"application/csv":         ".csv",
	"application/vnd.ms-excel": ".csv",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   ".docx",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}

func safeURLSnapshotFilename(snapshot rag.WebSnapshot) (string, string, bool) {
	base := filepath.Base(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(snapshot.Filename), `\`, `/`), "\x00", ""))
	origExt := strings.ToLower(filepath.Ext(base))
	mt := strings.ToLower(strings.TrimSpace(snapshot.MediaType))
	var ext string
	if mapped, ok := urlMimeToExt[mt]; ok {
		ext = mapped
	} else if mt == "text/plain" {
		switch origExt {
		case ".md", ".csv", ".txt":
			ext = origExt
		default:
			ext = ".txt"
		}
	} else if mt == "" || mt == "application/octet-stream" {
		switch origExt {
		case ".pdf", ".docx", ".pptx", ".txt", ".md", ".csv":
			ext = origExt
		default:
			return "", "", false
		}
	} else {
		return "", "", false
	}
	if base == "" || base == "." || base == ".." || base == "/" {
		base = "snapshot" + ext
	}
	if strings.ToLower(filepath.Ext(base)) != ext {
		stem := strings.TrimSuffix(base, filepath.Ext(base))
		if stem == "" || stem == "." || stem == ".." {
			stem = "snapshot"
		}
		base = stem + ext
	}
	return ext, base, true
}

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
	ext, baseName, ok := safeURLSnapshotFilename(snapshot)
	if !ok {
		invalid(c, "网页或直链文件 MIME 类型不支持")
		return
	}
	id := uuid.NewString()
	name := id + ext
	if in.Title == "" || in.Title == "." || in.Title == ".." {
		in.Title = baseName
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
	if _, e := q.LockBusinessCourse(ctx, courseID); e != nil {
		result(c, nil, e)
		return
	}
	existingSources, e := q.ListMaterialSources(ctx, courseID)
	if e != nil {
		result(c, nil, e)
		return
	}
	var usedBytes int64
	for _, s := range existingSources {
		if s.State != "active" {
			continue
		}
		if sp, err := rag.SafeMaterialPath(s.StoragePath); err == nil {
			if st, err := os.Stat(sp); err == nil && !st.IsDir() {
				usedBytes += st.Size()
			}
		}
	}
	if usedBytes+int64(len(snapshot.Data)) > 500<<20 {
		identity.Fail(c, http.StatusRequestEntityTooLarge, "quota_exceeded", "课程有效原件存储空间已达500MiB上限，请归档旧资料后重试")
		return
	}
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
		Filename:     baseName,
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
