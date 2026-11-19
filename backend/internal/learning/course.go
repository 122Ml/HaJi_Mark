package learning

import (
	"errors"
	"net/url"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func text(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

func validHTTPURL(raw string, max int) bool {
	if len(raw) == 0 || len(raw) > max || strings.ContainsRune(raw, '\x00') {
		return false
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (h *Handler) resources(c *gin.Context) {
	v, e := h.q.ListBusinessResources(c.Request.Context(), store.ListBusinessResourcesParams{CourseID: c.Param("courseID"), Teacher: teacher(c)})
	if e == nil && v == nil {
		v = []store.Resource{}
	}
	result(c, v, e)
}
func (h *Handler) createResource(c *gin.Context) {
	var in struct {
		Title            string `json:"title"`
		Content          string `json:"content"`
		SourceURL        string `json:"source_url"`
		SourceNote       string `json:"source_note"`
		Locator          string `json:"locator"`
		KnowledgePointID string `json:"knowledge_point_id"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Locator = strings.TrimSpace(in.Locator)
	in.SourceURL = strings.TrimSpace(in.SourceURL)
	in.SourceNote = strings.TrimSpace(in.SourceNote)
	in.KnowledgePointID = strings.TrimSpace(in.KnowledgePointID)
	if !validText(in.Title, 500) || !validText(in.Content, 200000) || !validText(in.Locator, 500) {
		invalid(c, "请填写资料标题、原文与段落定位")
		return
	}
	if strings.ContainsRune(in.SourceNote, '\x00') || strings.ContainsRune(in.SourceURL, '\x00') {
		invalid(c, "资料来源包含非法字符")
		return
	}
	if (in.SourceURL == "" && in.SourceNote == "") || len([]rune(in.SourceNote)) > 200 || len(in.SourceURL) > 2000 {
		invalid(c, "请登记资料来源说明或原始链接；来源说明不超过200字，链接不超过2000字节")
		return
	}
	if in.SourceURL != "" && !validHTTPURL(in.SourceURL, 2000) {
		invalid(c, "资料来源必须是http或https链接")
		return
	}
	if in.KnowledgePointID != "" {
		if len(in.KnowledgePointID) > 128 || strings.ContainsRune(in.KnowledgePointID, '\x00') {
			invalid(c, "知识点编号无效")
			return
		}
		p, e := h.q.GetKnowledgePoint(c.Request.Context(), in.KnowledgePointID)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 403, "forbidden", "知识点不属于当前课程")
				return
			}
			result(c, nil, e)
			return
		}
		if !scope(c, p.CourseID) {
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
		if old.Status != "published" {
			identity.Fail(c, 409, "state_conflict", "只能基于已发布资料创建新版本")
			return
		}
		v, e := h.q.CreateResourceRevision(c.Request.Context(), store.CreateResourceRevisionParams{
			ID:               uuid.NewString(),
			Title:            in.Title,
			Content:          in.Content,
			SourceUrl:        in.SourceURL,
			SourceNote:       in.SourceNote,
			Locator:          in.Locator,
			CreatedBy:        identity.Current(c).ID,
			ID_2:             old.ID,
			KnowledgePointID: text(in.KnowledgePointID),
		})
		if e != nil {
			if isPgCode(e, "23505") {
				identity.Fail(c, 409, "revision_exists", "此资料已有后续修订，请在最新版本继续修订")
				return
			}
			if errors.Is(e, pgx.ErrNoRows) {
				identity.Fail(c, 409, "state_conflict", "只能基于已发布资料创建新版本")
				return
			}
		}
		result(c, v, e)
		return
	}
	v, e := h.q.CreateBusinessResource(c.Request.Context(), store.CreateBusinessResourceParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: in.Title, Content: in.Content, SourceUrl: in.SourceURL, SourceNote: in.SourceNote, Locator: in.Locator, CreatedBy: identity.Current(c).ID, KnowledgePointID: text(in.KnowledgePointID)})
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
	if r.Status != "draft" {
		identity.Fail(c, 409, "state_conflict", "资料已发布，修改须另存新版本")
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
	v, e := q.PublishBusinessResource(ctx, store.PublishBusinessResourceParams{ID: r.ID, ReviewedBy: text(identity.Current(c).ID)})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "资料已发布或状态已变化")
		return
	}
	if e == nil {
		e = rag.QueueIndex(ctx, q, r.CourseID, identity.Current(c).ID)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
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
	v, e := h.q.AddLearningEvent(c.Request.Context(), store.AddLearningEventParams{ID: uuid.NewString(), CourseID: r.CourseID, ActorID: identity.Current(c).ID, ResourceID: text(r.ID), Verb: in.Verb, RequestID: in.RequestID, ObjectVersion: r.Version})
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
	if e == nil && v == nil {
		v = []store.LearningEvent{}
	}
	result(c, v, e)
}
func (h *Handler) overview(c *gin.Context) {
	v, e := h.q.BusinessOverview(c.Request.Context(), c.Param("courseID"))
	if e == nil && v == nil {
		v = []store.BusinessOverviewRow{}
	}
	result(c, v, e)
}
