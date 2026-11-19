package learning

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

func (h *Handler) profile(c *gin.Context) {
	var in struct {
		Name string `json:"display_name"`
	}
	if !bind(c, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if !validText(in.Name, 100) {
		invalid(c, "请填写不超过100字节的姓名")
		return
	}
	v, e := h.q.UpdateActorName(c.Request.Context(), store.UpdateActorNameParams{ID: identity.Current(c).ID, DisplayName: in.Name})
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, identity.Actor{ID: v.ID, Username: v.Username.String, DisplayName: v.DisplayName, Role: v.Role}, nil)
}
func (h *Handler) password(c *gin.Context) {
	if h.auth != nil {
		if ok, retry := h.auth.AllowPasswordChange(identity.Current(c).ID); !ok {
			c.Header("Retry-After", strconv.Itoa(retry))
			identity.Fail(c, http.StatusTooManyRequests, "too_many_requests", "修改密码请求过于频繁，请稍后重试")
			return
		}
	}
	var in struct {
		Old string `json:"old_password"`
		New string `json:"new_password"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Old) < 1 || len(in.Old) > 72 || strings.ContainsRune(in.Old, '\x00') {
		invalid(c, "请输入有效的原密码")
		return
	}
	if len(in.New) < 12 || len(in.New) > 72 || strings.TrimSpace(in.New) == "" || strings.ContainsRune(in.New, '\x00') {
		invalid(c, "新密码须为12到72字节且不能全为空白")
		return
	}
	if in.New == in.Old {
		invalid(c, "新密码不能与原密码相同")
		return
	}
	ctx := c.Request.Context()
	hash, e := h.q.GetActorPassword(ctx, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if !hash.Valid || hash.String == "" || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(in.Old)) != nil {
		identity.Fail(c, 401, "invalid_credentials", "原密码错误")
		return
	}
	next, e := bcrypt.GenerateFromPassword([]byte(in.New), bcrypt.DefaultCost)
	if e != nil {
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
	e = q.UpdateActorPassword(ctx, store.UpdateActorPasswordParams{ID: identity.Current(c).ID, PasswordHash: pgtype.Text{String: string(next), Valid: true}})
	if e == nil {
		e = q.DeleteActorSessions(ctx, identity.Current(c).ID)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e == nil && h.auth != nil {
		h.auth.ClearSessionCookie(c)
	}
	result(c, gin.H{"changed": true, "reauthenticate": true}, e)
}
func (h *Handler) research(c *gin.Context) {
	v, e := h.q.ListResearchRecords(c.Request.Context(), c.Param("courseID"))
	if e == nil && v == nil {
		v = []store.ResearchRecord{}
	}
	result(c, v, e)
}
func (h *Handler) createResearch(c *gin.Context) {
	var in struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Content = strings.TrimSpace(in.Content)
	if !validText(in.Title, 500) || !validText(in.Content, 30000) {
		invalid(c, "请填写教研标题与内容")
		return
	}
	if c.Param("id") != "" {
		v, e := h.q.EditResearchRecord(c.Request.Context(), store.EditResearchRecordParams{ID: c.Param("id"), CourseID: c.Param("courseID"), Title: in.Title, Content: in.Content})
		result(c, v, e)
		return
	}
	v, e := h.q.CreateResearchRecord(c.Request.Context(), store.CreateResearchRecordParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), TeacherID: identity.Current(c).ID, Title: in.Title, Content: in.Content})
	result(c, v, e)
}
func (h *Handler) industry(c *gin.Context) {
	v, e := h.q.ListIndustryRecords(c.Request.Context(), c.Param("courseID"))
	if e == nil && v == nil {
		v = []store.IndustryRecord{}
	}
	result(c, v, e)
}
func (h *Handler) createIndustry(c *gin.Context) {
	var in struct {
		Title     string `json:"title"`
		SourceURL string `json:"source_url"`
		Skills    string `json:"skills"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.SourceURL = strings.TrimSpace(in.SourceURL)
	in.Skills = strings.TrimSpace(in.Skills)
	if !validText(in.Title, 500) || !validText(in.Skills, 30000) || !validHTTPURL(in.SourceURL, 2000) {
		invalid(c, "请填写岗位标题、技能和有效来源链接（http/https且不超过2000字节）")
		return
	}
	if c.Param("id") != "" {
		v, e := h.q.EditIndustryRecord(c.Request.Context(), store.EditIndustryRecordParams{ID: c.Param("id"), CourseID: c.Param("courseID"), Title: in.Title, SourceUrl: in.SourceURL, Skills: in.Skills})
		result(c, v, e)
		return
	}
	v, e := h.q.CreateIndustryRecord(c.Request.Context(), store.CreateIndustryRecordParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: in.Title, SourceUrl: in.SourceURL, Skills: in.Skills, TeacherID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) deleteResearch(c *gin.Context) {
	v, e := h.q.DeleteResearchRecord(c.Request.Context(), store.DeleteResearchRecordParams{ID: c.Param("id"), CourseID: c.Param("courseID")})
	result(c, gin.H{"deleted": v}, e)
}
func (h *Handler) deleteIndustry(c *gin.Context) {
	v, e := h.q.DeleteIndustryRecord(c.Request.Context(), store.DeleteIndustryRecordParams{ID: c.Param("id"), CourseID: c.Param("courseID")})
	result(c, gin.H{"deleted": v}, e)
}
