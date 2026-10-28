package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

func (h *Handler) notes(c *gin.Context) {
	v, e := h.q.ListLearningNotes(c.Request.Context(), store.ListLearningNotesParams{ActorID: identity.Current(c).ID, CourseID: c.Param("courseID")})
	result(c, v, e)
}
func (h *Handler) note(c *gin.Context) {
	var in struct {
		Note     string `json:"note"`
		Favorite bool   `json:"favorite"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Note) > 100000 {
		invalid(c, "笔记过长")
		return
	}
	r, e := h.q.GetBusinessResource(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, r.CourseID) {
		return
	}
	if r.Status != "published" {
		identity.Fail(c, 403, "forbidden", "资料尚未发布")
		return
	}
	v, e := h.q.SaveLearningNote(c.Request.Context(), store.SaveLearningNoteParams{ActorID: identity.Current(c).ID, ResourceID: r.ID, Note: in.Note, Favorite: in.Favorite})
	result(c, v, e)
}
func (h *Handler) createStudent(c *gin.Context) {
	var in struct {
		Username string `json:"username"`
		Name     string `json:"display_name"`
		Password string `json:"password"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Username, 64) || !validText(in.Name, 200) || len(in.Password) < 12 || len(in.Password) > 72 {
		invalid(c, "请填写用户名、姓名及12到72字节初始密码")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if e != nil {
		result(c, nil, e)
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
	id := uuid.NewString()
	e = q.CreateLocalUser(ctx, store.CreateLocalUserParams{ID: id, Username: text(in.Username), DisplayName: in.Name, Role: "student", PasswordHash: text(string(hash))})
	if e != nil {
		var pgErr *pgconn.PgError
		if errors.As(e, &pgErr) && pgErr.Code == "23505" {
			identity.Fail(c, 409, "username_exists", "用户名已存在，请使用加入课程")
			return
		}
		result(c, nil, e)
		return
	}
	e = q.CreateLocalEnrollment(ctx, store.CreateLocalEnrollmentParams{CourseID: c.Param("courseID"), StudentID: id})
	if e == nil {
		e = tx.Commit(ctx)
	}
	result(c, gin.H{"id": id, "username": in.Username, "display_name": in.Name, "role": "student"}, e)
}
