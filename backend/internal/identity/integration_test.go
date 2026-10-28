package identity_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// TEST_DATABASE_URL creates a unique schema and drops only that schema. It never
// seeds or truncates application tables, and skips when no test DB is supplied.
func TestPostgresSessionsAndAuthorization(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("auth_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	migrations, err := filepath.Glob("../../db/migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range migrations {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		up := strings.Split(strings.Split(string(data), "-- +goose Up")[1], "-- +goose Down")[0]
		if _, err = db.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
	}
	hashed, _ := bcrypt.GenerateFromPassword([]byte("integration-only-pass"), bcrypt.MinCost)
	for _, u := range []struct{ id, role string }{{"teacher", "teacher"}, {"other-teacher", "teacher"}, {"a", "student"}, {"b", "student"}} {
		if _, err = db.Exec(ctx, `INSERT INTO users(id,username,display_name,role,password_hash) VALUES($1,$1,$1,$2,$3)`, u.id, u.role, string(hashed)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(ctx, `INSERT INTO courses(id,title,teacher_id,status) VALUES('owned','one','teacher','published'),('foreign','two','other-teacher','published'),('draft','draft','teacher','draft'); INSERT INTO enrollments(course_id,student_id) VALUES('owned','a'),('owned','b'),('draft','a')`); err != nil {
		t.Fatal(err)
	}
	router := server.New(db, nil, false)
	request := func(method, path, body string, cookie *http.Cookie, csrf, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://localhost:18080/api/v1"+path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	expect := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d: %s", status, w.Code, w.Body.String())
		}
	}
	login := func(name string) (*http.Cookie, string) {
		w := request("POST", "/sessions", `{"username":"`+name+`","password":"integration-only-pass","role":"teacher"}`, nil, "", "http://localhost:18080")
		expect(w, 200)
		var result struct {
			Data struct {
				User identity.Actor `json:"user"`
				CSRF string         `json:"csrf_token"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Data.User.ID != name {
			t.Fatal("identity came from request role instead of DB")
		}
		cookies := w.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Path != "/api/v1" || cookies[0].MaxAge <= 0 {
			t.Fatal("invalid session cookie attributes")
		}
		if strings.Contains(w.Body.String(), "password_hash") || strings.Contains(w.Body.String(), cookies[0].Value) {
			t.Fatal("credential leaked")
		}
		return cookies[0], result.Data.CSRF
	}
	expect(request("GET", "/me", "", nil, "", ""), 401)
	expect(request("POST", "/sessions", `{"username":"a","password":"wrong"}`, nil, "", ""), 401)
	expect(request("POST", "/sessions", `{"username":"unknown","password":"wrong"}`, nil, "", ""), 401)
	expect(request("POST", "/sessions", `{"username":"a","password":"integration-only-pass"}`, nil, "", "http://evil.test"), 403)
	a, csrf := login("a")
	b, bcsrf := login("b")
	teacher, tcsrf := login("teacher")
	me := request("GET", "/me", "", a, "", "")
	expect(me, 200)
	if !strings.Contains(me.Body.String(), `"role":"student"`) {
		t.Fatal("role escalation")
	}
	expect(request("GET", "/student/users/a/context", "", a, "", ""), 200)
	expect(request("GET", "/student/users/a/context", "", b, "", ""), 403)
	expect(request("GET", "/student/courses/owned/context", "", a, "", ""), 200)
	expect(request("GET", "/student/courses/draft/context", "", a, "", ""), 403)
	expect(request("GET", "/student/courses/foreign/context", "", a, "", ""), 403)
	expect(request("GET", "/teacher/courses/owned/context", "", a, "", ""), 403)
	expect(request("GET", "/teacher/courses/foreign/context", "", teacher, "", ""), 403)
	expect(request("GET", "/teacher/courses/owned/context", "", teacher, "", ""), 200)
	expect(request("POST", "/teacher/courses/owned/access-check", "", teacher, tcsrf, "http://localhost:18080"), 200)
	courses := request("GET", "/me/courses", "", a, "", "")
	expect(courses, 200)
	if strings.Contains(courses.Body.String(), "draft") || strings.Contains(courses.Body.String(), "foreign") {
		t.Fatal("unowned course leaked")
	}
	for _, token := range []string{"", "wrong", bcsrf} {
		expect(request("POST", "/student/courses/owned/access-check", "", a, token, ""), 403)
	}
	expect(request("POST", "/student/courses/owned/access-check", "", a, csrf, "http://evil.test"), 403)
	expect(request("POST", "/student/courses/owned/access-check", "", a, csrf, "http://localhost:18080"), 200)
	// A freshly constructed router still accepts the persisted PostgreSQL session.
	router = server.New(db, nil, false)
	expect(request("GET", "/me", "", a, "", ""), 200)
	var hash string
	if err = db.QueryRow(ctx, "SELECT token_hash FROM sessions WHERE user_id='a'").Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash == a.Value || len(hash) != 64 {
		t.Fatal("raw session stored")
	}
	expect(request("DELETE", "/sessions/current", "", a, "", ""), 403)
	expect(request("DELETE", "/sessions/current", "", a, csrf, ""), 204)
	expect(request("GET", "/me", "", a, "", ""), 401)
	expect(request("GET", "/me", "", b, "", ""), 200)
	if _, err = db.Exec(ctx, "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id='b'"); err != nil {
		t.Fatal(err)
	}
	expect(request("GET", "/me", "", b, "", ""), 401)
	old, _ := login("a")
	rotated := request("POST", "/sessions", `{"username":"a","password":"integration-only-pass"}`, old, "", "http://localhost:18080")
	expect(rotated, 200)
	if rotated.Result().Cookies()[0].Value == old.Value {
		t.Fatal("session was not rotated")
	}
	expect(request("GET", "/me", "", old, "", ""), 401)
	expect(request("GET", "/me", "", rotated.Result().Cookies()[0], "", ""), 200)
	// HTTPS-cookie deployment mode is explicit and never inferred from attacker headers.
	router = server.New(db, nil, true)
	secure := request("POST", "/sessions", `{"username":"a","password":"integration-only-pass"}`, nil, "", "")
	expect(secure, 200)
	if !secure.Result().Cookies()[0].Secure {
		t.Fatal("Secure cookie not enabled")
	}
}
