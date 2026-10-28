package learning

import (
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"net/url"
)

func (h *Handler) profile(c *gin.Context) {
	var in struct {
		Name string `json:"display_name"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Name, 200) {
		invalid(c, "请填写不超过200字节的姓名")
		return
	}
	v, e := h.q.UpdateActorName(c.Request.Context(), store.UpdateActorNameParams{ID: identity.Current(c).ID, DisplayName: in.Name})
	result(c, v, e)
}
func (h *Handler) password(c *gin.Context) {
	var in struct {
		Old string `json:"old_password"`
		New string `json:"new_password"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.New) < 12 || len(in.New) > 72 || len(in.Old) > 72 {
		invalid(c, "新密码须为12到72字节")
		return
	}
	ctx := c.Request.Context()
	hash, e := h.q.GetActorPassword(ctx, identity.Current(c).ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(in.Old)) != nil {
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
	result(c, gin.H{"changed": true, "reauthenticate": true}, e)
}
func (h *Handler) research(c *gin.Context) {
	v, e := h.q.ListResearchRecords(c.Request.Context(), c.Param("courseID"))
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
	u, e := url.Parse(in.SourceURL)
	if !validText(in.Title, 500) || !validText(in.Skills, 30000) || e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		invalid(c, "请填写岗位标题、技能和有效来源链接")
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
