package learning_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Use a private schema, so CI can exercise transactions without changing local courses.
func TestTeachingLoop(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	t.Setenv("AI_ENABLED", "false")
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("learning_test_%d", time.Now().UnixNano())
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
	hash, err := bcrypt.GenerateFromPassword([]byte("integration-only-pass"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []struct{ id, role string }{{"teacher", "teacher"}, {"student", "student"}, {"peer", "student"}, {"other", "teacher"}} {
		if _, err = db.Exec(ctx, `INSERT INTO users(id,username,display_name,role,password_hash) VALUES($1,$1,$1,$2,$3)`, u.id, u.role, string(hash)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(ctx, `INSERT INTO courses(id,title,teacher_id,status) VALUES('course','one','teacher','published'),('foreign','two','other','published'); INSERT INTO enrollments(course_id,student_id) VALUES('course','student'),('course','peer')`); err != nil {
		t.Fatal(err)
	}
	router := server.New(db, nil, false)
	type actor struct {
		cookie *http.Cookie
		csrf   string
	}
	request := func(a actor, method, path string, body any) *httptest.ResponseRecorder {
		data, err := json.Marshal(body)
		if err != nil {
			t.Error(err)
		}
		req := httptest.NewRequest(method, "http://localhost:18080/api/v1"+path, strings.NewReader(string(data)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:18080")
		req.Header.Set("X-CSRF-Token", a.csrf)
		if a.cookie != nil {
			req.AddCookie(a.cookie)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	call := func(a actor, method, path string, body any, status int) json.RawMessage {
		t.Helper()
		w := request(a, method, path, body)
		if w.Code != status {
			t.Fatalf("%s %s: want %d got %d: %s", method, path, status, w.Code, w.Body.String())
		}
		var response struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Data
	}
	id := func(raw json.RawMessage) string {
		t.Helper()
		var v struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &v); err != nil || v.ID == "" {
			t.Fatalf("missing ID: %s", raw)
		}
		return v.ID
	}
	login := func(name string) actor {
		t.Helper()
		w := request(actor{}, "POST", "/sessions", map[string]string{"username": name, "password": "integration-only-pass"})
		if w.Code != 200 {
			t.Fatalf("login: %d", w.Code)
		}
		var response struct {
			Data struct {
				CSRF string `json:"csrf_token"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return actor{w.Result().Cookies()[0], response.Data.CSRF}
	}
	teacher, student, peer, other := login("teacher"), login("student"), login("peer"), login("other")
	base := "/learning/courses/course"
	call(other, "GET", base, nil, 403)
	call(student, "POST", base+"/assignments", map[string]string{}, 403)
	call(actor{teacher.cookie, ""}, "POST", base+"/points", map[string]string{"title": "blocked"}, 403)
	aid := id(call(teacher, "POST", base+"/assignments", map[string]any{"title": "Essay", "questions": []any{map[string]any{"prompt": "Explain", "max_score": 10, "rubric": "Reasoning and evidence"}}}, 200))
	ap := base + "/assignments/" + aid
	call(student, "GET", ap, nil, 403)
	call(teacher, "POST", ap+"/state", map[string]string{"state": "published"}, 200)
	var detail struct {
		Questions []struct {
			ID     string `json:"id"`
			Rubric string `json:"rubric"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(call(student, "GET", ap, nil, 200), &detail); err != nil {
		t.Fatal(err)
	}
	if len(detail.Questions) != 1 || detail.Questions[0].Rubric != "" {
		t.Fatal("private rubric leaked")
	}
	input := map[string]string{"question_id": detail.Questions[0].ID, "answer_text": "原文😀\n保留换行", "request_id": "concurrent-submit"}
	// The same network retry must create exactly one attempt, even concurrently.
	responses := make(chan *httptest.ResponseRecorder, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); responses <- request(student, "POST", ap+"/submissions", input) }()
	}
	wg.Wait()
	close(responses)
	sid := ""
	for w := range responses {
		if w.Code != 200 {
			t.Fatalf("concurrent submit: %d %s", w.Code, w.Body.String())
		}
		var v struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		current := id(v.Data)
		if sid != "" && current != sid {
			t.Fatal("retry created multiple submissions")
		}
		sid = current
	}
	sp := base + "/submissions/" + sid
	call(peer, "GET", sp, nil, 403)
	call(teacher, "GET", "/learning/courses/foreign/submissions/"+sid, nil, 403)
	call(teacher, "POST", sp+"/revisions", map[string]any{"score": 11, "feedback": "too high", "request_id": "bad"}, 422)
	r1 := id(call(teacher, "POST", sp+"/revisions", map[string]any{"score": 8, "feedback": "first", "request_id": "grade-1"}, 200))
	r2 := id(call(teacher, "POST", sp+"/revisions", map[string]any{"score": 9, "feedback": "second", "request_id": "grade-2"}, 200))
	call(teacher, "POST", base+"/revisions/"+r1+"/state", map[string]string{"state": "confirmed"}, 409)
	if strings.Contains(string(call(student, "GET", sp, nil, 200)), "second") {
		t.Fatal("draft feedback leaked")
	}
	call(teacher, "POST", base+"/revisions/"+r2+"/state", map[string]string{"state": "released"}, 409)
	call(teacher, "POST", base+"/revisions/"+r2+"/state", map[string]string{"state": "confirmed"}, 200)
	call(teacher, "POST", base+"/revisions/"+r2+"/state", map[string]string{"state": "released"}, 200)
	if !strings.Contains(string(call(student, "GET", sp, nil, 200)), "second") {
		t.Fatal("released feedback missing")
	}
	var evidence []json.RawMessage
	if err := json.Unmarshal(call(student, "GET", base+"/evidence", nil, 200), &evidence); err != nil || len(evidence) != 1 {
		t.Fatal("released evidence not deduplicated")
	}
	call(teacher, "POST", ap+"/state", map[string]string{"state": "closed"}, 200)
	input["request_id"] = "after-close"
	call(student, "POST", ap+"/submissions", input, 409)
	call(student, "POST", base+"/assist", map[string]string{"topic": "Explain"}, 503)
}
