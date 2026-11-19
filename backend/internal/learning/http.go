package learning

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db   *pgxpool.Pool
	q    *store.Queries
	auth *identity.Handler
	rag  *rag.Service
}

func Register(api *gin.RouterGroup, db *pgxpool.Pool, auth *identity.Handler) {
	var models *rag.Models
	if rag.Enabled() && db != nil {
		loaded, err := rag.LoadModels(db)
		if err != nil {
			log.Printf("load model profiles failed: %v", err)
		} else {
			models = loaded
		}
	}
	RegisterWithModels(api, db, auth, models)
}

func RegisterWithModels(api *gin.RouterGroup, db *pgxpool.Pool, auth *identity.Handler, models *rag.Models) {
	h := &Handler{db: db, q: store.New(db), auth: auth}
	if models != nil {
		h.rag = rag.New(models)
	}
	base := api.Group("/learning", auth.RequireSession())
	base.POST("/courses", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createCourse)
	base.PUT("/profile", auth.RequireCSRF(), h.profile)
	base.PUT("/password", auth.RequireCSRF(), h.password)
	g := base.Group("/courses/:courseID", auth.RequireCourse("courseID"))
	g.GET("", h.context)
	h.registerRAG(g, auth)
	h.registerQuestionBank(g, auth)
	h.registerMaterialWorkflows(g, auth)
	h.registerIntelligence(g, auth)
	g.POST("/publish", identity.RequireRole("teacher"), auth.RequireCSRF(), h.publishCourse)
	g.PUT("", identity.RequireRole("teacher"), auth.RequireCSRF(), h.renameCourse)
	g.POST("/curriculum", identity.RequireRole("teacher"), auth.RequireCSRF(), h.importCurriculum)
	g.POST("/points", identity.RequireRole("teacher"), auth.RequireCSRF(), h.createPoint)
	g.GET("/graph", h.graph)
	g.POST("/edges", identity.RequireRole("teacher"), auth.RequireCSRF(), h.edge)
	g.DELETE("/edges", identity.RequireRole("teacher"), auth.RequireCSRF(), h.deleteEdge)
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
	g.GET("/assignments/:id/imports", identity.RequireRole("teacher"), h.submissionImports)
	g.POST("/assignments/:id/import/:operation", identity.RequireRole("teacher"), auth.RequireCSRF(), h.importSubmissions)
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
	g.GET("/assist/history", h.assistHistory)
	g.GET("/assist/history/:id", h.assistTurn)
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
func isPgCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
func result(c *gin.Context, v any, err error) bool {
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.Is(err, pgx.ErrNoRows) {
			identity.Fail(c, 404, "not_found", "记录不存在或状态已改变")
		} else if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			identity.Fail(c, 409, "conflict", "记录已存在，请勿重复提交")
		} else if errors.As(err, &pgErr) && (pgErr.Code == "22021" || pgErr.Code == "22P02") {
			identity.Fail(c, 422, "invalid_input", "输入内容包含非法字符或格式无效")
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
	if err := c.ShouldBindJSON(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			identity.Fail(c, http.StatusRequestEntityTooLarge, "payload_too_large", "请求体过大（上限1MB）")
			return false
		}
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
func validText(s string, max int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= max && !strings.ContainsRune(s, '\x00')
}
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
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
	in.Title = strings.TrimSpace(in.Title)
	if !validText(in.Title, 200) {
		invalid(c, "请填写课程名称（不超过200字节）")
		return
	}
	v, e := h.q.CreateBusinessCourse(c.Request.Context(), store.CreateBusinessCourseParams{ID: uuid.NewString(), Title: in.Title, TeacherID: identity.Current(c).ID})
	result(c, v, e)
}
func (h *Handler) publishCourse(c *gin.Context) {
	v, e := h.q.PublishBusinessCourse(c.Request.Context(), store.PublishBusinessCourseParams{ID: c.Param("courseID"), TeacherID: identity.Current(c).ID})
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "课程已发布或状态已变化")
		return
	}
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
	in.Title = strings.TrimSpace(in.Title)
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
	if len(in.Description) > 10000 || strings.ContainsRune(in.Description, '\x00') {
		invalid(c, "说明过长或包含非法字符")
		return
	}
	if in.Kind == "chapter" && in.ParentID != "" {
		invalid(c, "章必须位于课程顶层，不能嵌套在父节点下")
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
		if in.Kind == "section" && p.Kind != "chapter" {
			invalid(c, "节只能挂在章下")
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
	in.Username = strings.TrimSpace(in.Username)
	if !validText(in.Username, 64) {
		invalid(c, "请输入有效的学生用户名")
		return
	}
	v, e := h.q.EnrollByUsername(c.Request.Context(), store.EnrollByUsernameParams{CourseID: c.Param("courseID"), Username: text(in.Username)})
	if errors.Is(e, pgx.ErrNoRows) {
		u, uErr := h.q.GetLoginUser(c.Request.Context(), text(in.Username))
		if uErr == nil && u.Role == "student" {
			identity.Fail(c, 409, "already_enrolled", "该学生已加入本课程")
			return
		}
		identity.Fail(c, 404, "not_found", "未找到该学生账号")
		return
	}
	result(c, gin.H{"student_id": v}, e)
}
