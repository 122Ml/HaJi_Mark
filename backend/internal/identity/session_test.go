package identity

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCSRFAndOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := New(nil, false)
	for _, tc := range []struct {
		name, origin, csrf string
		status             int
	}{
		{"valid", "http://localhost:18080", csrfToken(strings.Repeat("a", 64)), 200},
		{"non_browser", "", csrfToken(strings.Repeat("a", 64)), 200},
		{"missing", "http://localhost:18080", "", 403},
		{"wrong", "http://localhost:18080", "invented", 403},
		{"foreign_origin", "http://evil.example", csrfToken(strings.Repeat("a", 64)), 403},
		{"scheme_mismatch", "https://localhost:18080", csrfToken(strings.Repeat("a", 64)), 403},
		{"null_origin", "null", csrfToken(strings.Repeat("a", 64)), 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.POST("/", h.RequireCSRF(), func(c *gin.Context) { c.Status(200) })
			req := httptest.NewRequest("POST", "http://localhost:18080/", nil)
			req.AddCookie(&http.Cookie{Name: CookieName, Value: strings.Repeat("a", 64)})
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-CSRF-Token", tc.csrf)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestIdentityGuards(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, role, id, path string
		teacher              bool
		status               int
	}{
		{"student_own", "student", "a", "/student/a", false, 200},
		{"student_other", "student", "a", "/student/b", false, 403},
		{"teacher_not_self", "teacher", "t", "/student/a", false, 403},
		{"teacher_role", "teacher", "t", "/teacher", true, 200},
		{"student_teacher", "student", "a", "/teacher", true, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(func(c *gin.Context) { c.Set(actorKey, Actor{ID: tc.id, Role: tc.role}) })
			if tc.teacher {
				r.GET("/teacher", RequireRole("teacher"), func(c *gin.Context) { c.Status(200) })
			} else {
				r.GET("/student/:studentID", RequireSelf("studentID"), func(c *gin.Context) { c.Status(200) })
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestAnonymousAndUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := New(nil, false)
	h.Register(r.Group("/api/v1"))
	for _, path := range []string{"/api/v1/me", "/api/v1/me/courses"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatalf("anonymous got %d", w.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/v1/sessions", strings.NewReader(`{"username":"a","password":"b"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 503 {
		t.Fatalf("unavailable got %d", w.Code)
	}
}
