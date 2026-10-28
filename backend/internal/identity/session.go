package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const CookieName = "haji_session"
const sessionLifetime = 8 * time.Hour
const actorKey = "haji.actor"

type Actor struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type Handler struct {
	db           *pgxpool.Pool
	queries      *store.Queries
	secureCookie bool
}

func New(db *pgxpool.Pool, secureCookie bool) *Handler {
	return &Handler{db: db, queries: store.New(db), secureCookie: secureCookie}
}

func Fail(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func csrfToken(raw string) string { return hashToken("haji-csrf:" + raw) }
func randomToken() (string, error) {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", err
	}
	return hex.EncodeToString(token), nil
}

func Current(c *gin.Context) Actor { return c.MustGet(actorKey).(Actor) }

// Same-origin JSON is required even at login, before a session/CSRF token exists.
func SameOrigin(c *gin.Context) bool {
	origin := c.GetHeader("Origin")
	if origin == "" {
		return true
	} // Non-browser clients still need CSRF for authenticated writes.
	parsed, err := url.Parse(origin)
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if err != nil || parsed.User != nil || parsed.Host != c.Request.Host || parsed.Scheme != scheme || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		Fail(c, http.StatusForbidden, "origin_forbidden", "请求来源不匹配")
		return false
	}
	return true
}

func (h *Handler) cookie(c *gin.Context, raw string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: CookieName, Value: raw, Path: "/api/v1", MaxAge: maxAge, HttpOnly: true, Secure: h.secureCookie, SameSite: http.SameSiteStrictMode})
}

func (h *Handler) Register(api *gin.RouterGroup) {
	api.POST("/sessions", h.login)
	protected := api.Group("")
	protected.Use(h.RequireSession())
	protected.GET("/me", func(c *gin.Context) {
		raw, _ := c.Cookie(CookieName)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"user": Current(c), "csrf_token": csrfToken(raw)}})
	})
	protected.GET("/me/courses", h.myCourses)
	protected.DELETE("/sessions/current", h.RequireCSRF(), h.logout)
}

func (h *Handler) login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !SameOrigin(c) {
		return
	}
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		Fail(c, http.StatusUnsupportedMediaType, "json_required", "请使用JSON登录请求")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Username) == "" || len(input.Username) > 64 || len(input.Password) < 1 || len(input.Password) > 72 {
		Fail(c, http.StatusBadRequest, "invalid_input", "请输入有效的用户名和密码（密码不超过72字节）")
		return
	}
	if h.db == nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "身份服务暂不可用")
		return
	}
	user, err := h.queries.GetLoginUser(c.Request.Context(), pgtype.Text{String: strings.TrimSpace(input.Username), Valid: true})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "身份服务暂不可用")
		return
	}
	// Unknown users perform the same bcrypt work and receive the same error.
	passwordHash := user.PasswordHash.String
	if errors.Is(err, pgx.ErrNoRows) {
		passwordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
	}
	mismatch := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password))
	if err != nil || mismatch != nil {
		Fail(c, http.StatusUnauthorized, "invalid_credentials", "用户名或密码错误")
		return
	}
	raw, err := randomToken()
	if err != nil {
		Fail(c, http.StatusInternalServerError, "session_failed", "无法建立会话")
		return
	}
	ctx := c.Request.Context()
	// Rotate an existing session rather than adopting any supplied cookie value.
	tx, err := h.db.Begin(ctx)
	if err != nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "会话保存失败")
		return
	}
	defer tx.Rollback(ctx)
	q := h.queries.WithTx(tx)
	if err = q.DeleteExpiredSessions(ctx); err == nil {
		if old, e := c.Cookie(CookieName); e == nil {
			err = q.DeleteSession(ctx, hashToken(old))
		}
	}
	if err == nil {
		err = q.CreateSession(ctx, store.CreateSessionParams{TokenHash: hashToken(raw), UserID: user.ID, ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(sessionLifetime), Valid: true}})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "会话保存失败")
		return
	}
	h.cookie(c, raw, int(sessionLifetime.Seconds()))
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"user": Actor{ID: user.ID, Username: user.Username.String, DisplayName: user.DisplayName, Role: user.Role}, "csrf_token": csrfToken(raw)}})
}

func (h *Handler) RequireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		raw, err := c.Cookie(CookieName)
		if err != nil || len(raw) != 64 {
			Fail(c, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		if _, err := hex.DecodeString(raw); err != nil {
			Fail(c, http.StatusUnauthorized, "unauthorized", "会话无效，请重新登录")
			return
		}
		if h.db == nil {
			Fail(c, http.StatusServiceUnavailable, "service_unavailable", "身份服务暂不可用")
			return
		}
		row, err := h.queries.GetSessionUser(c.Request.Context(), hashToken(raw))
		if errors.Is(err, pgx.ErrNoRows) {
			h.cookie(c, "", -1)
			Fail(c, http.StatusUnauthorized, "unauthorized", "会话已失效，请重新登录")
			return
		}
		if err != nil {
			Fail(c, http.StatusServiceUnavailable, "service_unavailable", "身份服务暂不可用")
			return
		}
		c.Set(actorKey, Actor{ID: row.ID, Username: row.Username.String, DisplayName: row.DisplayName, Role: row.Role})
		c.Next()
	}
}

func (h *Handler) RequireCSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !SameOrigin(c) {
			return
		}
		raw, _ := c.Cookie(CookieName)
		expected := csrfToken(raw)
		if raw == "" || subtle.ConstantTimeCompare([]byte(c.GetHeader("X-CSRF-Token")), []byte(expected)) != 1 {
			Fail(c, http.StatusForbidden, "csrf_failed", "请求校验失败，请刷新后重试")
			return
		}
		c.Next()
	}
}

func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if Current(c).Role != role {
			Fail(c, http.StatusForbidden, "forbidden", "当前账户无权访问该角色接口")
			return
		}
		c.Next()
	}
}

// Use after RequireSession. Object lookups must obtain course_id from stored data,
// never from an untrusted request body when guarding submissions/resources.
func (h *Handler) RequireCourse(param string) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor := Current(c)
		allowed, err := h.queries.CanAccessCourse(c.Request.Context(), store.CanAccessCourseParams{CourseID: c.Param(param), ActorRole: actor.Role, ActorID: actor.ID})
		if err != nil {
			Fail(c, http.StatusServiceUnavailable, "service_unavailable", "课程归属查询失败")
			return
		}
		if !allowed {
			Fail(c, http.StatusForbidden, "forbidden", "无权访问该课程")
			return
		}
		c.Next()
	}
}

// A student may read only their own row. Teacher access needs a separate course /
// enrollment check in the owning business module, not a generic teacher bypass.
func RequireSelf(param string) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor := Current(c)
		if actor.Role != "student" || actor.ID != c.Param(param) {
			Fail(c, http.StatusForbidden, "forbidden", "无权访问其他学生的数据")
			return
		}
		c.Next()
	}
}

func (h *Handler) myCourses(c *gin.Context) {
	actor := Current(c)
	rows, err := h.queries.ListActorCourses(c.Request.Context(), store.ListActorCoursesParams{ActorRole: actor.Role, ActorID: actor.ID})
	if err != nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "课程查询失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

func (h *Handler) logout(c *gin.Context) {
	raw, _ := c.Cookie(CookieName)
	if err := h.queries.DeleteSession(c.Request.Context(), hashToken(raw)); err != nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "退出失败，请重试")
		return
	}
	h.cookie(c, "", -1)
	c.Status(http.StatusNoContent)
}
