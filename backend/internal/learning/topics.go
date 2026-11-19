package learning

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) registerMaterialWorkflows(g *gin.RouterGroup, auth *identity.Handler) {
	t := g.Group("", identity.RequireRole("teacher"))
	t.GET("/topics", h.topics)
	t.POST("/topics", auth.RequireCSRF(), h.saveTopic)
	t.PUT("/topics/:topicID", auth.RequireCSRF(), h.saveTopic)
	t.PUT("/content-links", auth.RequireCSRF(), h.contentLinks)
	t.GET("/decisions", h.decisions)
	t.GET("/question-bank/search", h.searchBank)
	t.POST("/sources/url", auth.RequireCSRF(), h.importURL)
	t.GET("/sources/:sourceID/assets", h.sourceAssets)
	t.POST("/assets/:assetID/revisions", auth.RequireCSRF(), h.saveAssetRevision)
	t.POST("/assets/:assetID/crop", auth.RequireCSRF(), h.cropAsset)
	t.POST("/knowledge/:knowledgeID/decision", auth.RequireCSRF(), h.knowledgeDecision)
	t.POST("/sources/:sourceID/suggestions/adopt", auth.RequireCSRF(), h.adoptSuggestions)
	t.POST("/sources/:sourceID/paper/adopt", auth.RequireCSRF(), h.adoptPaper)
	t.GET("/impact", h.impact)
	t.POST("/impact/decisions", auth.RequireCSRF(), h.impactDecision)
	t.GET("/regrades", h.regrades)
	t.POST("/regrades", auth.RequireCSRF(), h.createRegrade)
	t.GET("/regrades/:batchID", h.regradeDetail)
	t.PUT("/regrades/:batchID/items/:submissionID", auth.RequireCSRF(), h.saveRegradeItem)
	t.POST("/regrades/:batchID/state", auth.RequireCSRF(), h.regradeState)
	t.POST("/regrades/:batchID/items/:submissionID/ai", auth.RequireCSRF(), h.regradeAI)
	g.GET("/assets/:assetID/file", h.assetFile)
	g.GET("/resources/:id/assets", h.resourceAssets)
	g.GET("/questions/:id/assets", h.questionAssets)
}

func (h *Handler) topics(c *gin.Context) {
	ctx := c.Request.Context()
	course := c.Param("courseID")
	topics, e := h.q.ListTopics(ctx, course)
	if e != nil {
		result(c, nil, e)
		return
	}
	links, e := h.q.TopicLinks(ctx, course)
	if e != nil {
		result(c, nil, e)
		return
	}
	tags, e := h.q.ListContentTags(ctx, course)
	result(c, gin.H{"topics": topics, "links": links, "tags": tags}, e)
}
func (h *Handler) saveTopic(c *gin.Context) {
	var in struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Active      bool   `json:"active"`
		EditVersion int32  `json:"edit_version"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if !validText(in.Title, 300) || len(in.Description) > 5000 || strings.ContainsRune(in.Description, '\x00') {
		invalid(c, "请填写专题名称，说明不超过5000字节")
		return
	}
	ctx := c.Request.Context()
	courseID := c.Param("courseID")
	if c.Param("topicID") == "" {
		v, e := h.q.CreateTopic(ctx, store.CreateTopicParams{ID: uuid.NewString(), CourseID: courseID, Title: in.Title, Description: in.Description})
		if isPgCode(e, "23505") {
			identity.Fail(c, 409, "duplicate_topic", "课程内已存在同名专题")
			return
		}
		result(c, v, e)
		return
	}
	topicID := c.Param("topicID")
	v, e := h.q.UpdateTopic(ctx, store.UpdateTopicParams{ID: topicID, CourseID: courseID, Title: in.Title, Description: in.Description, Active: in.Active, EditVersion: in.EditVersion})
	if isPgCode(e, "23505") {
		identity.Fail(c, 409, "duplicate_topic", "课程内已存在同名专题")
		return
	}
	if errors.Is(e, pgx.ErrNoRows) {
		if _, getErr := h.q.GetTopicByID(ctx, store.GetTopicByIDParams{ID: topicID, CourseID: courseID}); errors.Is(getErr, pgx.ErrNoRows) {
			identity.Fail(c, 404, "not_found", "专题不存在")
			return
		} else if getErr != nil {
			result(c, nil, getErr)
			return
		}
		identity.Fail(c, 409, "stale_revision", "专题已改变，请刷新")
		return
	}
	result(c, v, e)
}

func (h *Handler) validateContentObject(ctx context.Context, q *store.Queries, course, kind, id string) error {
	switch kind {
	case "source":
		_, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: id, CourseID: course})
		return e
	case "knowledge":
		_, e := q.LockKnowledgeEntry(ctx, store.LockKnowledgeEntryParams{ID: id, CourseID: course})
		return e
	case "question":
		v, e := q.GetBankQuestionVersion(ctx, id)
		if e != nil {
			return e
		}
		_, e = q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: v.BankID, CourseID: course})
		return e
	}
	return errors.New("内容类型无效")
}
func replaceLinks(ctx context.Context, q *store.Queries, course, kind, id string, ids, tags, points []string) error {
	if len(ids) > 30 || len(tags) > 30 {
		return errors.New("专题与标签最多30项")
	}
	if len(points) > 100 {
		return errors.New("关联知识点最多100项")
	}
	p := store.ClearTopicLinksParams{}
	switch kind {
	case "source":
		p.SourceID = text(id)
	case "knowledge":
		p.KnowledgeID = text(id)
	case "question":
		p.BankVersionID = text(id)
	}
	if e := q.ClearTopicLinks(ctx, p); e != nil {
		return e
	}
	seen := map[string]bool{}
	for _, topic := range ids {
		if seen[topic] {
			return errors.New("专题不能重复")
		}
		seen[topic] = true
		n, e := q.LinkTopic(ctx, store.LinkTopicParams{ID: topic, CourseID: course, SourceID: p.SourceID, KnowledgeID: p.KnowledgeID, BankVersionID: p.BankVersionID})
		if e != nil {
			return e
		}
		if n != 1 {
			return errors.New("专题不存在、已停用或不属于本课程")
		}
	}
	cleanTags := make([]string, 0, len(tags))
	seenTags := map[string]bool{}
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if !validText(tag, 100) {
			return errors.New("标签为空或过长")
		}
		if !seenTags[tag] {
			seenTags[tag] = true
			cleanTags = append(cleanTags, tag)
		}
	}
	cleanPoints := make([]string, 0, len(points))
	seenPoints := map[string]bool{}
	for _, pid := range points {
		if seenPoints[pid] {
			continue
		}
		seenPoints[pid] = true
		kp, e := q.GetKnowledgePoint(ctx, pid)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return errors.New("知识点不属于本课程")
			}
			return e
		}
		if kp.CourseID != course || kp.Kind != "point" {
			return errors.New("知识点不属于本课程")
		}
		cleanPoints = append(cleanPoints, pid)
	}
	return q.PutContentTags(ctx, store.PutContentTagsParams{CourseID: course, ObjectKind: kind, ObjectID: id, Tags: cleanTags, KnowledgePointIds: cleanPoints})
}
func (h *Handler) contentLinks(c *gin.Context) {
	var in struct {
		Kind     string   `json:"kind"`
		ID       string   `json:"id"`
		TopicIDs []string `json:"topic_ids"`
		Tags     []string `json:"tags"`
		PointIDs []string `json:"knowledge_point_ids"`
	}
	if !bind(c, &in) {
		return
	}
	if in.Kind != "source" && in.Kind != "knowledge" && in.Kind != "question" {
		invalid(c, "内容类型无效")
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
	if e = h.validateContentObject(ctx, q, c.Param("courseID"), in.Kind, in.ID); e != nil {
		result(c, nil, e)
		return
	}
	if e = replaceLinks(ctx, q, c.Param("courseID"), in.Kind, in.ID, in.TopicIDs, in.Tags, in.PointIDs); e != nil {
		ragError(c, e)
		return
	}
	result(c, gin.H{"saved": true}, tx.Commit(ctx))
}
func recordDecision(ctx context.Context, q *store.Queries, course, actor, kind, id, reason string, input, output any) (store.ContentDecision, error) {
	a, _ := json.Marshal(input)
	b, _ := json.Marshal(output)
	return q.CreateContentDecision(ctx, store.CreateContentDecisionParams{ID: uuid.NewString(), CourseID: course, ActorID: actor, Kind: kind, ObjectID: id, Reason: reason, Inputs: a, Output: b})
}
func (h *Handler) decisions(c *gin.Context) {
	v, e := h.q.ContentDecisions(c.Request.Context(), store.ContentDecisionsParams{CourseID: c.Param("courseID"), ObjectID: c.Query("object_id")})
	result(c, v, e)
}
func (h *Handler) searchBank(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 || page > 100000 || size < 1 || size > 100 {
		invalid(c, "分页参数无效")
		return
	}
	p := store.SearchQuestionBankParams{CourseID: c.Param("courseID"), Search: c.Query("search"), State: c.Query("state"), QuestionType: c.Query("type"), PointID: c.Query("point_id"), TopicID: c.Query("topic_id"), PageLimit: int32(size), PageOffset: int32((page - 1) * size)}
	rows, e := h.q.SearchQuestionBank(c.Request.Context(), p)
	if e != nil {
		result(c, nil, e)
		return
	}
	total, e := h.q.CountSearchQuestionBank(c.Request.Context(), store.CountSearchQuestionBankParams{CourseID: p.CourseID, Search: p.Search, State: p.State, QuestionType: p.QuestionType, PointID: p.PointID, TopicID: p.TopicID})
	result(c, gin.H{"items": rows, "total": total, "page": page, "page_size": size}, e)
}
