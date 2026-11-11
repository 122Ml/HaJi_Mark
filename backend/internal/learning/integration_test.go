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
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
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
	t.Setenv("PUBLIC_ORIGIN", "")
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
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
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
	t.Run("bank_evidence_reads_indexed_source", func(t *testing.T) {
		if _, err := db.Exec(ctx, `INSERT INTO material_sources(id,course_id,created_by,title,sha256,parse_state,parse_revision) VALUES('bank-source','course','teacher','bank source','hash','ready',1);
INSERT INTO retrieval_chunks(id,course_id,source_id,title,body,locator,input_hash,search_tokens) VALUES('bank-chunk','course','bank-source','boundary','18 to 60','{}','bank-hash','boundary')`); err != nil {
			t.Fatal(err)
		}
		if _, err := store.New(db).GetBankEvidence(ctx, store.GetBankEvidenceParams{ID: "bank-chunk", CourseID: "course"}); err != nil {
			t.Fatal(err)
		}
		call(teacher, "POST", base+"/question-bank/evidence", map[string]string{"source_id": "bank-source"}, 200)
	})
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
	t.Run("AS01_submission_roster_activity_and_exact_text", func(t *testing.T) {
		var snapshot struct {
			Submission struct {
				AnswerText string `json:"answer_text"`
				Hash       string `json:"answer_sha256"`
			} `json:"submission"`
		}
		if e := json.Unmarshal(call(teacher, "GET", sp, nil, 200), &snapshot); e != nil {
			t.Fatal(e)
		}
		if snapshot.Submission.AnswerText != input["answer_text"] || len(snapshot.Submission.Hash) != 64 {
			t.Fatal("original answer or hash lost")
		}
		changed := map[string]string{"question_id": input["question_id"], "answer_text": "changed", "request_id": input["request_id"]}
		call(student, "POST", ap+"/submissions", changed, 409)
		secondID := id(call(teacher, "POST", base+"/assignments", map[string]any{"title": "second", "questions": []any{map[string]any{"prompt": "other question", "max_score": 10, "rubric": "evidence"}}}, 200))
		secondPath := base + "/assignments/" + secondID
		call(teacher, "POST", secondPath+"/state", map[string]string{"state": "published"}, 200)
		var second struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		}
		if e := json.Unmarshal(call(student, "GET", secondPath, nil, 200), &second); e != nil {
			t.Fatal(e)
		}
		changed["question_id"] = second.Questions[0].ID
		call(student, "POST", secondPath+"/submissions", changed, 409)
		var roster struct {
			Total, Submitted int
			Pending          int `json:"not_submitted"`
			Rows             []struct {
				StudentID    string `json:"student_id"`
				SubmissionID string `json:"submission_id"`
			} `json:"rows"`
		}
		if e := json.Unmarshal(call(teacher, "GET", ap+"/roster", nil, 200), &roster); e != nil {
			t.Fatal(e)
		}
		if roster.Total != 2 || roster.Submitted != 1 || roster.Pending != 1 {
			t.Fatalf("incorrect roster: %+v", roster)
		}
		call(student, "GET", ap+"/roster", nil, 403)
		var activity []struct {
			SubmissionID *string `json:"submission_id"`
			Verb         string  `json:"verb"`
			ActorID      string  `json:"actor_id"`
		}
		if e := json.Unmarshal(call(teacher, "GET", base+"/activity?student_id=student", nil, 200), &activity); e != nil {
			t.Fatal(e)
		}
		if len(activity) != 1 || activity[0].SubmissionID == nil || *activity[0].SubmissionID != sid || activity[0].Verb != "submission.submitted" {
			t.Fatalf("retry created duplicate or missing event: %+v", activity)
		}
		call(peer, "GET", base+"/activity?student_id=student", nil, 403)
		if e := json.Unmarshal(call(peer, "GET", base+"/activity", nil, 200), &activity); e != nil || len(activity) != 0 {
			t.Fatal("peer activity leaked")
		}
	})
	t.Run("CO01_sources_versions_and_learning_events", func(t *testing.T) {
		missing := map[string]string{"title": "notes", "content": "original", "locator": "paragraph-1"}
		call(teacher, "POST", base+"/resources", missing, 422)
		missing["source_note"] = "教师自编讲义，验收构造资料"
		rid := id(call(teacher, "POST", base+"/resources", missing, 200))
		path := base + "/resources/" + rid
		call(teacher, "POST", path+"/publish", map[string]string{}, 200)
		call(teacher, "POST", path+"/publish", map[string]string{}, 409)
		missing["content"] = "revised"
		v2 := id(call(teacher, "POST", path+"/revisions", missing, 200))
		call(teacher, "POST", base+"/resources/"+v2+"/publish", map[string]string{}, 200)
		call(teacher, "POST", path+"/publish", map[string]string{}, 409)
		call(student, "POST", path+"/events", map[string]string{"verb": "opened", "request_id": "learn"}, 200)
		call(student, "POST", path+"/events", map[string]string{"verb": "completed", "request_id": "learn"}, 409)
		for _, key := range []string{"complete-1", "complete-1", "complete-2"} {
			call(student, "POST", path+"/events", map[string]string{"verb": "completed", "request_id": key}, 200)
		}
		var overview []struct {
			ID        string `json:"id"`
			Completed int    `json:"completed_events"`
		}
		if e := json.Unmarshal(call(teacher, "GET", base+"/overview", nil, 200), &overview); e != nil {
			t.Fatal(e)
		}
		for _, row := range overview {
			if row.ID == "student" && row.Completed != 1 {
				t.Fatal("completion count duplicated")
			}
		}
		if _, e := db.Exec(ctx, `INSERT INTO courses(id,title,teacher_id,status) VALUES('draft-course','draft','teacher','draft'); INSERT INTO enrollments(course_id,student_id) VALUES('draft-course','student')`); e != nil {
			t.Fatal(e)
		}
		call(student, "GET", "/learning/courses/draft-course/resources", nil, 403)
		call(student, "GET", "/learning/courses/draft-course/assignments", nil, 403)
	})
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
	t.Run("AI_adoption_returns_persisted_provenance", func(t *testing.T) {
		questionID := detail.Questions[0].ID
		jobInput, _ := json.Marshal(map[string]any{"question_id": questionID, "prompt": "Explain", "max_score": 10})
		if _, err := db.Exec(ctx, `INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input,output) VALUES('rubric-job','course','teacher','rubric','succeeded',$1,'{"evidence_refs":[{"id":"frozen-reference","body":"fixture"}]}')`, jobInput); err != nil {
			t.Fatal(err)
		}
		created := call(teacher, "POST", base+"/questions/"+questionID+"/rubrics", map[string]any{"ai_job_id": "rubric-job", "criteria": []any{map[string]any{"id": "D1", "title": "Evidence", "max_score": 10, "rule": "Explain using evidence"}}}, 200)
		var rubric struct {
			ID       string            `json:"id"`
			Evidence []json.RawMessage `json:"evidence_refs"`
		}
		if err := json.Unmarshal(created, &rubric); err != nil || len(rubric.Evidence) != 1 {
			t.Fatal("POST omitted the evidence it persisted", string(created), err)
		}
		var versions []struct {
			Evidence []json.RawMessage `json:"evidence_refs"`
		}
		if err := json.Unmarshal(call(teacher, "GET", base+"/questions/"+questionID+"/rubrics", nil, 200), &versions); err != nil || len(versions) != 1 || len(versions[0].Evidence) != 1 {
			t.Fatal("rubric evidence did not persist", err)
		}
		call(teacher, "POST", base+"/rubrics/"+rubric.ID+"/confirm", map[string]string{}, 200)
		var answerHash string
		if err := db.QueryRow(ctx, `SELECT answer_sha256 FROM submissions WHERE id=$1`, sid).Scan(&answerHash); err != nil {
			t.Fatal(err)
		}
		jobInput, _ = json.Marshal(map[string]any{"submission_id": sid, "rubric_id": rubric.ID, "answer_hash": answerHash})
		if _, err := db.Exec(ctx, `INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input) VALUES('grading-job','course','teacher','grade','succeeded',$1)`, jobInput); err != nil {
			t.Fatal(err)
		}
		request := map[string]any{"score": 6, "feedback": "reviewed draft", "request_id": "adopt-ai", "rubric_id": rubric.ID, "ai_job_id": "grading-job", "points": []any{map[string]any{"criterion_id": "D1", "score": 6, "feedback": "partial evidence", "quote": "原文😀"}}}
		var revision struct {
			ID    string `json:"id"`
			JobID string `json:"ai_job_id"`
		}
		if err := json.Unmarshal(call(teacher, "POST", sp+"/revisions", request, 200), &revision); err != nil || revision.JobID != "grading-job" {
			t.Fatal("POST omitted its AI job link", revision.JobID, err)
		}
		if got := id(call(teacher, "POST", sp+"/revisions", request, 200)); got != revision.ID {
			t.Fatal("same provenance retry was not idempotent")
		}
		request["ai_job_id"] = ""
		call(teacher, "POST", sp+"/revisions", request, 409)
	})
	t.Run("RAG_publication_rejects_duplicate_and_unreviewed_fragments", func(t *testing.T) {
		t.Setenv("RAG_ENABLED", "true")
		t.Setenv("MODEL_PROFILES_PATH", "../../config/models.json")
		router = server.New(db, nil, false)
		if _, err := db.Exec(ctx, `INSERT INTO material_sources(id,course_id,created_by,title,sha256,parse_state,parse_revision,allow_derived) VALUES('publication-source','course','teacher','source','hash','ready',1,true);
INSERT INTO material_fragments(id,source_id,revision,position,body,locator,quality) VALUES('publication-public','publication-source',1,0,'公开内容','{}','ready'),('publication-private','publication-source',1,1,'未核对的内部内容','{}','needs_review')`); err != nil {
			t.Fatal(err)
		}
		path := base + "/sources/publication-source/publish"
		call(teacher, "POST", path, map[string]any{"title": "duplicate", "fragment_ids": []string{"publication-public", "publication-public"}, "full_source": true}, 422)
		call(teacher, "POST", path, map[string]any{"title": "unreviewed", "fragment_ids": []string{"publication-public", "publication-private"}, "full_source": true}, 422)
		call(teacher, "POST", path, map[string]any{"title": "partial", "fragment_ids": []string{"publication-public"}, "full_source": false}, 200)
		t.Run("answer_markers_must_match_verified_citations", func(t *testing.T) {
			if _, err := db.Exec(ctx, `INSERT INTO retrieval_chunks(id,course_id,source_id,fragment_ids,title,body,locator,input_hash,search_tokens) VALUES('qa-public','course','publication-source',ARRAY['publication-public'],'公开内容','公开内容','{}','qa','公开 内容')`); err != nil {
				t.Fatal(err)
			}
			modelText := "依据公开内容回答[R1]。"
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				content, _ := json.Marshal(map[string]any{"text": modelText, "citations": []map[string]string{{"id": "R1", "quote": "公开内容"}}})
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(content)}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 8, "completion_tokens": 8}})
			}))
			defer provider.Close()
			t.Setenv("QA_TEST_BASE", provider.URL)
			t.Setenv("QA_TEST_KEY", "test-only-key")
			profiles := filepath.Join(t.TempDir(), "models.json")
			if err := os.WriteFile(profiles, []byte(`[{"id":"test","kind":"chat","protocol":"openai","base_url_env":"QA_TEST_BASE","key_env":"QA_TEST_KEY","model":"test","batch_size":1,"input_micro_cny_per_token":1,"output_micro_cny_per_token":1}]`), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("MODEL_PROFILES_PATH", profiles)
			router = server.New(db, nil, false)
			for _, test := range []struct {
				text   string
				status int
			}{{"依据公开内容回答[R1]。", 200}, {"依据公开内容回答[R99]。", 422}, {"依据公开内容回答。", 422}, {"依据公开内容回答[R1]和[R99]。", 422}} {
				modelText = test.text
				call(student, "POST", base+"/assist", map[string]string{"topic": "公开内容"}, test.status)
			}
		})
		call(student, "GET", base+"/sources/publication-source/download", nil, 403)
		call(peer, "POST", path, map[string]any{"title": "student", "fragment_ids": []string{"publication-public"}}, 403)
		call(teacher, "POST", "/learning/courses/foreign/sources/publication-source/publish", map[string]any{"title": "foreign", "fragment_ids": []string{"publication-public"}}, 403)
		call(teacher, "POST", base+"/knowledge", map[string]any{"title": "invalid kind", "body": "content", "content_kind": "concept|method"}, 422)
		knowledge := map[string]any{"title": "knowledge", "body": "公开内容", "content_kind": "concept", "evidence": []any{map[string]string{"source_id": "publication-source", "fragment_id": "publication-public", "quote": "公开内容"}}, "student_visible": true, "use_for_learning": true}
		kid := id(call(teacher, "POST", base+"/knowledge", knowledge, 200))
		knowledge["edit_version"] = 1
		knowledge["body"] = "修改后的公开内容"
		call(teacher, "PUT", base+"/knowledge/"+kid, knowledge, 200)
		call(teacher, "POST", base+"/knowledge/"+kid+"/state", map[string]any{"state": "confirmed", "edit_version": 1}, 409)
		call(teacher, "POST", base+"/knowledge/"+kid+"/state", map[string]any{"state": "confirmed", "edit_version": 2}, 200)
		var queued int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM processing_jobs WHERE course_id='course' AND kind='index' AND state='queued'`).Scan(&queued); err != nil || queued != 1 {
			t.Fatal("knowledge confirmation did not persist its index job", queued, err)
		}
		if _, err := db.Exec(ctx, `UPDATE material_fragments SET quality='ready' WHERE id='publication-private'`); err != nil {
			t.Fatal(err)
		}
		call(teacher, "POST", path, map[string]any{"title": "complete", "fragment_ids": []string{"publication-public", "publication-private"}, "full_source": true}, 200)
		call(teacher, "POST", base+"/sources/publication-source/archive", map[string]string{}, 200)
		call(teacher, "POST", path, map[string]any{"title": "archived", "fragment_ids": []string{"publication-public"}}, 422)
		if _, err := db.Exec(ctx, `INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input) VALUES('history-rubric','course','teacher','rubric','succeeded','{"question_id":"recovery-question"}'),('history-other','course','teacher','grade','succeeded','{"question_id":"recovery-question"}')`); err != nil {
			t.Fatal(err)
		}
		var jobs []struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(call(teacher, "GET", base+"/jobs?kind=rubric&question_id=recovery-question", nil, 200), &jobs); err != nil || len(jobs) != 1 || jobs[0].Kind != "rubric" {
			t.Fatal("draft history did not filter by target", string(call(teacher, "GET", base+"/jobs", nil, 200)), err)
		}
		call(student, "GET", base+"/jobs?kind=rubric", nil, 403)
	})
}
