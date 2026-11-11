package learning

import (
	"errors"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strings"
)

type Handler struct {
	db  *pgxpool.Pool
	q   *store.Queries
	rag *rag.Service
}

func Register(api *gin.RouterGroup, db *pgxpool.Pool, auth *identity.Handler) {
	h := &Handler{db: db, q: store.New(db)}
	if rag.Enabled() {
		if models, err := rag.LoadModels(db); err == nil {
			h.rag = rag.New(models)
		}
	}
	base := api.Group("/learning", auth.RequireSession())
	base.POST("/courses", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createCourse)
	base.PUT("/profile", auth.RequireCSRF(), h.profile)
	base.PUT("/password", auth.RequireCSRF(), h.password)
	g := base.Group("/courses/:courseID", auth.RequireCourse("courseID"))
	g.GET("", h.context)
	h.registerRAG(g, auth)
	h.registerQuestionBank(g, auth)
	g.POST("/publish", identity.RequireRole("teacher"), auth.RequireCSRF(), h.publishCourse)
	g.PUT("", identity.RequireRole("teacher"), auth.RequireCSRF(), h.renameCourse)
	g.POST("/curriculum", identity.RequireRole("teacher"), auth.RequireCSRF(), h.importCurriculum)
	g.POST("/points", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createPoint)
	g.GET("/graph", h.graph)
	g.POST("/edges", identity.RequireRole("teacher"), auth.RequireCSRF(), h.edge)
	g.GET("/path", identity.RequireRole("student"), h.path)
	g.POST("/path", identity.RequireRole("student"), auth.RequireCSRF(), h.planPath)
	g.GET("/members", identity.RequireRole("teacher"), h.members)
	g.POST("/members", identity.RequireRole("teacher"), auth.RequireCSRF(), h.enroll)
	g.POST("/students", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createStudent)
	g.GET("/resources", h.resources)
	g.POST("/resources", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createResource)
	g.POST("/resources/:id/revisions", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createResource)
	g.POST("/resources/:id/publish", identity.RequireRole("teacher"), auth.RequireCSRF(), h.publishResource)
	g.POST("/resources/:id/events", identity.RequireRole("student"), auth.RequireCSRF(), h.event)
	g.GET("/events", h.events)
	g.GET("/activity", h.activity)
	g.GET("/notes", identity.RequireRole("student"), h.notes)
	g.PUT("/resources/:id/note", identity.RequireRole("student"), auth.RequireCSRF(), h.note)
	g.GET("/assignments", h.assignments)
	g.GET("/assignment-worklist", h.assignmentWorklist)
	g.GET("/assignments/:id/worklist", identity.RequireRole("teacher"), h.submissionWorklist)
	g.GET("/interventions/:id/evidence", h.interventionEvidence)
	g.POST("/assignments", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createAssignment)
	g.PUT("/assignments/:id", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createAssignment)
	g.GET("/assignments/:id", h.assignment)
	g.POST("/assignments/:id/state", identity.RequireRole("teacher"), auth.RequireCSRF(), h.assignmentState)
	g.GET("/assignments/:id/submissions", h.submissions)
	g.GET("/assignments/:id/roster", identity.RequireRole("teacher"), h.roster)
	g.POST("/assignments/:id/submissions", identity.RequireRole("student"), auth.RequireCSRF(), h.submit)
	g.GET("/assignments/:id/questions/:questionID/draft", identity.RequireRole("student"), h.draft)
	g.PUT("/assignments/:id/questions/:questionID/draft", identity.RequireRole("student"), auth.RequireCSRF(), h.saveDraft)
	g.GET("/submissions/:id", h.submission)
	g.GET("/questions/:id/rubrics", identity.RequireRole("teacher"), h.rubrics)
	g.POST("/questions/:id/rubrics", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createRubric)
	g.POST("/rubrics/:id/confirm", identity.RequireRole("teacher"), auth.RequireCSRF(), h.confirmRubric)
	g.POST("/submissions/:id/revisions", identity.RequireRole("teacher"), auth.RequireCSRF(), h.grade)
	g.POST("/revisions/:id/state", identity.RequireRole("teacher"), auth.RequireCSRF(), h.gradeState)
	g.GET("/interventions", h.interventions)
	g.POST("/interventions", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createIntervention)
	g.POST("/interventions/:id/state", auth.RequireCSRF(), h.interventionState)
	g.GET("/interactions", h.interactions)
	g.POST("/interactions", auth.RequireCSRF(), h.createInteraction)
	g.GET("/overview", identity.RequireRole("teacher"), h.overview)
	g.GET("/evidence", h.evidence)
	g.GET("/assist", h.assistStatus)
	g.POST("/assist", auth.RequireCSRF(), h.assist)
	g.GET("/research", identity.RequireRole("teacher"), h.research)
	g.POST("/research", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createResearch)
	g.PUT("/research/:id", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createResearch)
	g.DELETE("/research/:id", identity.RequireRole("teacher"), auth.RequireCSRF(), h.deleteResearch)
	g.GET("/industry", identity.RequireRole("teacher"), h.industry)
	g.POST("/industry", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createIndustry)
	g.PUT("/industry/:id", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createIndustry)
	g.DELETE("/industry/:id", identity.RequireRole("teacher"), auth.RequireCSRF(), h.deleteIndustry)
}
func teacher(c *gin.Context) bool { return identity.Current(c).Role == "teacher" }
func result(c *gin.Context, v any, err error) bool {
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			identity.Fail(c, 404, "not_found", "记录不存在或状态已改变")
		} else {
			identity.Fail(c, 503, "service_unavailable", "数据操作失败，请重试")
		}
		return false
	}
	c.JSON(200, gin.H{"data": v})
	return true
}
func bind(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
	if c.ShouldBindJSON(v) != nil {
		identity.Fail(c, 400, "invalid_input", "请求内容格式不正确")
		return false
	}
	return true
}
func invalid(c *gin.Context, msg string) { identity.Fail(c, 422, "invalid_input", msg) }
func scope(c *gin.Context, id string) bool {
	if id != c.Param("courseID") {
		identity.Fail(c, 403, "forbidden", "记录不属于当前课程")
		return false
	}
	return true
}
func validText(s string, max int) bool { return strings.TrimSpace(s) != "" && len(s) <= max }
func (h *Handler) context(c *gin.Context) {
	course, err := h.q.GetBusinessCourse(c.Request.Context(), c.Param("courseID"))
	if err != nil {
		result(c, nil, err)
		return
	}
	points, err := h.q.ListBusinessPoints(c.Request.Context(), course.ID)
	result(c, gin.H{"course": course, "points": points}, err)
}
func (h *Handler) createCourse(c *gin.Context) {
	var in struct {
		Title string `json:"title"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Title, 200) {
		invalid(c, "请填写课程名称（不超过200字节）")
		return
	}
	v, e := h.q.CreateBusinessCourse(c.Request.Context(), store.CreateBusinessCourseParams{ID: uuid.NewString(), Title: in.Title, TeacherID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) publishCourse(c *gin.Context) {
	v, e := h.q.PublishBusinessCourse(c.Request.Context(), store.PublishBusinessCourseParams{ID: c.Param("courseID"), TeacherID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) createPoint(c *gin.Context) {
	var in struct {
		Title       string `json:"title"`
		Position    int32  `json:"position"`
		ParentID    string `json:"parent_id"`
		Kind        string `json:"kind"`
		Description string `json:"description"`
	}
	if !bind(c, &in) {
		return
	}
	if !validText(in.Title, 500) || in.Position < 0 {
		invalid(c, "知识点名称或顺序无效")
		return
	}
	if in.Kind == "" {
		in.Kind = "point"
	}
	if in.Kind != "point" && in.Kind != "chapter" && in.Kind != "section" {
		invalid(c, "目录类型无效")
		return
	}
	if len(in.Description) > 10000 {
		invalid(c, "说明过长")
		return
	}
	if in.ParentID != "" {
		p, e := h.q.GetKnowledgePoint(c.Request.Context(), in.ParentID)
		if e != nil {
			result(c, nil, e)
			return
		}
		if !scope(c, p.CourseID) {
			return
		}
		if p.Kind == "point" {
			invalid(c, "知识点不能包含子目录")
			return
		}
	}
	v, e := h.q.AddBusinessPoint(c.Request.Context(), store.AddBusinessPointParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), Title: in.Title, Position: in.Position, ParentID: text(in.ParentID), Kind: in.Kind, Description: in.Description})
	result(c, v, e)
}
func (h *Handler) members(c *gin.Context) {
	v, e := h.q.ListBusinessMembers(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
func (h *Handler) enroll(c *gin.Context) {
	var in struct {
		Username string `json:"username"`
	}
	if !bind(c, &in) {
		return
	}
	v, e := h.q.EnrollByUsername(c.Request.Context(), store.EnrollByUsernameParams{CourseID: c.Param("courseID"), Username: text(in.Username)})
	result(c, gin.H{"student_id": v}, e)
}
