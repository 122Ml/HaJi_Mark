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
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func TestAuditSecurityAndIntegrityFixes(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("REQUIRE_INTEGRATION_TESTS") == "1" {
			t.Fatal("TEST_DATABASE_URL must be set when REQUIRE_INTEGRATION_TESTS=1")
		}
		t.Skip("TEST_DATABASE_URL is not set")
	}
	t.Setenv("AI_ENABLED", "false")
	t.Setenv("PUBLIC_ORIGIN", "")
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("learning_audit_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, cfg)
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
			t.Fatalf("migration %s failed: %v", path, err)
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("audit-test-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []struct{ id, role string }{{"teacher", "teacher"}, {"student", "student"}} {
		if _, err = db.Exec(ctx, `INSERT INTO users(id,username,display_name,role,password_hash) VALUES($1,$1,$1,$2,$3)`, u.id, u.role, string(hash)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(ctx, `INSERT INTO courses(id,title,teacher_id,status) VALUES('course','Audit Course','teacher','published'); INSERT INTO enrollments(course_id,student_id) VALUES('course','student')`); err != nil {
		t.Fatal(err)
	}

	router := server.New(db, nil, false)
	type actor struct {
		cookie *http.Cookie
		csrf   string
	}
	request := func(a actor, method, path string, body any) *httptest.ResponseRecorder {
		var reader *strings.Reader
		if body != nil {
			data, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			reader = strings.NewReader(string(data))
		} else {
			reader = strings.NewReader("")
		}
		req := httptest.NewRequest(method, "http://localhost:18080/api/v1"+path, reader)
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
	login := func(username string) actor {
		w := request(actor{}, http.MethodPost, "/sessions", map[string]string{"username": username, "password": "audit-test-password"})
		if w.Code != http.StatusOK {
			t.Fatalf("login %s failed: %d %s", username, w.Code, w.Body.String())
		}
		var out struct {
			Data struct {
				CSRF string `json:"csrf_token"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return actor{cookie: w.Result().Cookies()[0], csrf: out.Data.CSRF}
	}
	teacher := login("teacher")
	student := login("student")

	// 1. P0: Student must be blocked from teacher-only "comparison" retrieval purpose.
	w := request(student, http.MethodPost, "/learning/courses/course/retrieval", map[string]any{
		"query":   "test",
		"purpose": "comparison",
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("student comparison retrieval expected 403, got %d: %s", w.Code, w.Body.String())
	}

	// 2. Point hierarchy validation + DELETE /edges.
	w = request(teacher, http.MethodPost, "/learning/courses/course/points", map[string]any{
		"title": "第一章", "kind": "chapter", "position": 1,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create chapter failed: %d %s", w.Code, w.Body.String())
	}
	var chResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &chResp)

	// Chapter under chapter must fail 422.
	w = request(teacher, http.MethodPost, "/learning/courses/course/points", map[string]any{
		"title": "嵌套章", "kind": "chapter", "parent_id": chResp.Data.ID, "position": 1,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("nested chapter expected 422, got %d: %s", w.Code, w.Body.String())
	}

	// Create two knowledge points and link + delete edge.
	mkPoint := func(title string, pos int) string {
		r := request(teacher, http.MethodPost, "/learning/courses/course/points", map[string]any{
			"title": title, "kind": "point", "parent_id": chResp.Data.ID, "position": pos,
		})
		if r.Code != http.StatusOK {
			t.Fatalf("create point %s failed: %d %s", title, r.Code, r.Body.String())
		}
		var out struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(r.Body.Bytes(), &out)
		return out.Data.ID
	}
	p1 := mkPoint("基础概念", 1)
	p2 := mkPoint("进阶应用", 2)

	w = request(teacher, http.MethodPost, "/learning/courses/course/edges", map[string]any{
		"from_id": p1, "to_id": p2,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create edge failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodDelete, "/learning/courses/course/edges", map[string]any{
		"from_point_id": p1, "to_point_id": p2,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("delete edge failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodDelete, "/learning/courses/course/edges", map[string]any{
		"from_point_id": p1, "to_point_id": p2,
	})
	if w.Code != http.StatusNotFound {
		t.Fatalf("second delete edge expected 404, got %d: %s", w.Code, w.Body.String())
	}

	// 3. P0: PUT /assignments/:id preserves existing draft question IDs and attached rubric_versions.
	w = request(teacher, http.MethodPost, "/learning/courses/course/assignments", map[string]any{
		"title": "草稿作业",
		"type":  "subjective",
		"questions": []map[string]any{
			{"prompt": "第一版题干", "type": "subjective", "max_score": 100, "rubric": "按要点评分", "knowledge_point_id": p1},
		},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create assignment failed: %d %s", w.Code, w.Body.String())
	}
	var createdAsgn struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &createdAsgn)
	asgnID := createdAsgn.Data.ID
	w = request(teacher, http.MethodGet, "/learning/courses/course/assignments/"+asgnID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get assignment failed: %d %s", w.Code, w.Body.String())
	}
	var asgnDetail struct {
		Data struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &asgnDetail)
	if len(asgnDetail.Data.Questions) != 1 {
		t.Fatalf("expected 1 question, got %d: %s", len(asgnDetail.Data.Questions), w.Body.String())
	}
	qID := asgnDetail.Data.Questions[0].ID

	w = request(teacher, http.MethodPost, "/learning/courses/course/questions/"+qID+"/rubrics", map[string]any{
		"criteria": []map[string]any{
			{"id": "D1", "title": "核心要点", "max_score": 100, "rule": "答出核心要点得满分"},
		},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create rubric failed: %d %s", w.Code, w.Body.String())
	}

	// Edit draft assignment preserving question id.
	w = request(teacher, http.MethodPut, "/learning/courses/course/assignments/"+asgnID, map[string]any{
		"title": "草稿作业（修改后）",
		"type":  "subjective",
		"questions": []map[string]any{
			{"id": qID, "prompt": "第二版题干", "type": "subjective", "max_score": 100, "rubric": "按修订后要点评分", "knowledge_point_id": p1},
		},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("update draft assignment failed: %d %s", w.Code, w.Body.String())
	}

	// Verify rubric_versions STILL attached to qID!
	w = request(teacher, http.MethodGet, "/learning/courses/course/questions/"+qID+"/rubrics", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "核心要点") {
		t.Fatalf("expected rubric to survive PUT /assignments/:id, got %d: %s", w.Code, w.Body.String())
	}

	// 4. Student creation rejects invalid username characters and trims valid username.
	w = request(teacher, http.MethodPost, "/learning/courses/course/students", map[string]any{
		"username": "bad user name!", "display_name": "测试", "password": "strong-password-123",
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid username expected 422, got %d: %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, "/learning/courses/course/students", map[string]any{
		"username": "  trimmed_stu  ", "display_name": " 张三 ", "password": "audit-test-password",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("trimmed student create failed: %d %s", w.Code, w.Body.String())
	}
	login("trimmed_stu")

	// 5. adoptPaper saves quiz drafts with missing answer, while confirmBankPart requires options + answer.
	if _, err = db.Exec(ctx, `
		INSERT INTO material_sources(id,course_id,created_by,title,filename,media_type,storage_path,source_note,sha256,parse_state,parse_revision)
		VALUES('paper-src','course','teacher','样卷','paper.md','text/markdown','paper-src.md','样卷','sha-paper','ready',1);
		INSERT INTO material_fragments(id,source_id,revision,position,heading,body,locator,quality)
		VALUES('pf-1','paper-src',1,0,'第1题','1. 选择题\nA.1\nB.2','{"page":1}','ready');
		INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input,output)
		VALUES('paper-job','course','teacher','paper_split','succeeded','{"source_id":"paper-src","parse_revision":1}',
		       '{"questions":[{"title":"第1题","prompt":"1. 选择题","type":"quiz","max_score":5,"options":["A.1","B.2"],"correct_answer":"","reference_answer":"","answer_origin":"missing","source_fragment_ids":["pf-1"],"asset_ids":[],"uncertain":[]}],"excluded":[],"review_status":"pending_teacher_review"}');
	`); err != nil {
		t.Fatalf("seed paper fixture failed: %v", err)
	}
	w = request(teacher, http.MethodPost, "/learning/courses/course/sources/paper-src/paper/adopt", map[string]any{
		"job_id":        "paper-job",
		"review_status": "pending_teacher_review",
		"excluded":      []any{},
		"questions": []map[string]any{
			{
				"title":               "第1题",
				"prompt":              "1. 选择题",
				"type":                "quiz",
				"max_score":           5,
				"options":             []string{"A.1", "B.2"},
				"correct_answer":      "",
				"reference_answer":    "",
				"answer_origin":       "missing",
				"source_fragment_ids": []string{"pf-1"},
				"asset_ids":           []string{},
				"uncertain":           []string{},
			},
		},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("adoptPaper blank quiz draft expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var adoptResp struct {
		Data struct {
			Versions []struct {
				ID     string `json:"id"`
				BankID string `json:"bank_id"`
			} `json:"versions"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &adoptResp)
	if len(adoptResp.Data.Versions) != 1 {
		t.Fatalf("expected 1 adopted version, got %s", w.Body.String())
	}
	draftBankID := adoptResp.Data.Versions[0].BankID
	draftVerID := adoptResp.Data.Versions[0].ID
	w = request(teacher, http.MethodPost, "/learning/courses/course/question-bank/versions/"+draftVerID+"/confirm", nil)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("confirm incomplete quiz expected 422, got %d: %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, "/learning/courses/course/question-bank/"+draftBankID+"/versions", map[string]any{
		"title":          "第1题",
		"prompt":         "1. 选择题",
		"type":           "quiz",
		"max_score":      5,
		"options":        []string{"A.1", "B.2"},
		"correct_answer": "B.2",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create completed quiz version failed: %d %s", w.Code, w.Body.String())
	}
	var fixedVer struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &fixedVer)
	w = request(teacher, http.MethodPost, "/learning/courses/course/question-bank/versions/"+fixedVer.Data.ID+"/confirm", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("confirm completed quiz expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
