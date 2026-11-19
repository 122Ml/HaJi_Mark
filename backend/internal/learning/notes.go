package learning

import (
	"regexp"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9._@-]{3,64}$`)

func (h *Handler) notes(c *gin.Context) {
	v, e := h.q.ListLearningNotes(c.Request.Context(), store.ListLearningNotesParams{ActorID: identity.Current(c).ID, CourseID: c.Param("courseID")})
	if e == nil && v == nil {
		v = []store.LearningNote{}
	}
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
	in.Note = strings.TrimSpace(in.Note)
	if len(in.Note) > 100000 || strings.ContainsRune(in.Note, '\x00') {
		invalid(c, "笔记过长或包含非法字符")
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
	in.Username = strings.TrimSpace(in.Username)
	in.Name = strings.TrimSpace(in.Name)
	if !usernamePattern.MatchString(in.Username) {
		invalid(c, "用户名须为3到64位字母、数字或._@-，不能包含空白字符")
		return
	}
	if !validText(in.Name, 200) {
		invalid(c, "请填写不超过200字节的学生姓名")
		return
	}
	if len(in.Password) < 12 || len(in.Password) > 72 || strings.TrimSpace(in.Password) == "" || strings.ContainsRune(in.Password, '\x00') {
		invalid(c, "初始密码须为12到72字节且不能全为空白")
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
		if isPgCode(e, "23505") {
			identity.Fail(c, 409, "conflict", "用户名已存在")
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
