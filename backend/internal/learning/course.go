package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"net/url"
)

func text(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
func (h *Handler) resources(c *gin.Context) {
	v, e := h.q.ListBusinessResources(c.Request.Context(), store.ListBusinessResourcesParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	result(c, v, e)
}
func (h *Handler) createResource(c *gin.Context) {
	var in struct {
		Title            string `json:"title"`
		Content          string `json:"content"`
		SourceURL        string `json:"source_url"`
		Locator          string `json:"locator"`
		KnowledgePointID string `json:"knowledge_point_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Title, 500) || !validText(in.Content, 200000) || !validText(in.Locator, 500) {
		invalid(c, "请填写资料标题、原文与段落定位")
		return
	}
	if in.SourceURL != "" {
		u, e := url.Parse(in.SourceURL)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			invalid(c, "资料来源必须是http或https链接")
			return
		}
	}
	if in.KnowledgePointID != "" {
		points, e := h.q.ListBusinessPoints(c.Request.Context(), c.Param("courseID"))
		if e != nil {
			result(c, nil, e)
			return
		}
		found := false
		for _, p := range points {
			if p.ID == in.KnowledgePointID {
				found = true
			}
		}
		if !found {
			identity.Fail(c, 403, "forbidden", "知识点不属于当前课程")
			return
		}
	}
	if c.Param("id") != "" {
		old, e := h.q.GetBusinessResource(c.Request.Context(), c.Param("id"))
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, old.CourseID) {
			return
		}
		v, e := h.q.CreateResourceRevision(c.Request.Context(), store.CreateResourceRevisionParams{ID: uuid.NewString(), Title: in.Title, Content: in.Content, SourceUrl: in.SourceURL, Locator: in.Locator, CreatedBy: identity.Current(c).ID, ID_2: old.ID})
		if e != nil {
			var pgErr *pgconn.PgError
			if errors.As(e, &pgErr) && pgErr.Code == "23505" {
				identity.Fail(c, 409, "revision_exists", "此资料已有后续修订，请在最新版本继续修订")
				return
			}
		}
		result(c, v, e)
		return
	}
	v, e := h.q.CreateBusinessResource(c.Request.Context(), store.CreateBusinessResourceParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: in.Title, Content: in.Content, SourceUrl: in.SourceURL, Locator: in.Locator, CreatedBy: identity.Current(c).ID, KnowledgePointID: text(in.KnowledgePointID)})
	result(c, v, e)
}
func (h *Handler) publishResource(c *gin.Context) {
	r, e := h.q.GetBusinessResource(c.Request.Context(), c.Param("id"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if !scope(c, r.CourseID) {
		return
	}
	v, e := h.q.PublishBusinessResource(c.Request.Context(), store.PublishBusinessResourceParams{ID: r.ID, ReviewedBy: text(identity.Current(c).ID)})
	result(c, v, e)
}
func (h *Handler) event(c *gin.Context) {
	var in struct {
		Verb      string `json:"verb"`
		RequestID string `json:"request_id"`
	}
	if !bind(c, &in) {
		return
	}
	if (in.Verb != "opened" && in.Verb != "completed") || !validText(in.RequestID, 128) {
		invalid(c, "学习动作或request_id无效")
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
		identity.Fail(c, 403, "forbidden", "资料未发布")
		return
	}
	v, e := h.q.AddLearningEvent(c.Request.Context(), store.AddLearningEventParams{ID: uuid.NewString(), CourseID: r.CourseID, ActorID: identity.Current(c).ID, ResourceID: text(r.ID), Verb: in.Verb, RequestID: in.RequestID})
	if errors.Is(e, pgx.ErrNoRows) {
		v, e = h.q.GetLearningEventByRequest(c.Request.Context(), store.GetLearningEventByRequestParams{ActorID: identity.Current(c).ID, RequestID: in.RequestID})
		if e == nil && (v.ResourceID.String != r.ID || v.Verb != in.Verb) {
			identity.Fail(c, 409, "request_conflict", "相同请求号不能用于不同学习记录")
			return
		}
	}
	result(c, v, e)
}
func (h *Handler) events(c *gin.Context) {
	v, e := h.q.ListMyLearningEvents(c.Request.Context(), store.ListMyLearningEventsParams{CourseID: c.Param("courseID"), ActorID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) overview(c *gin.Context) {
	v, e := h.q.BusinessOverview(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
