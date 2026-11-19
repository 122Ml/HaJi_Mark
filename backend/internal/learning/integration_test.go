package learning_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Use a private schema, so CI can exercise transactions without changing local courses.
func TestTeachingLoop(t *testing.T) {
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
	decode := func(data json.RawMessage, target any) {
		t.Helper()
		if err := json.Unmarshal(data, target); err != nil {
			t.Fatal(err)
		}
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
		var queued int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM processing_jobs WHERE course_id='course' AND kind='index' AND state='queued'`).Scan(&queued); err != nil || queued != 1 {
			t.Fatalf("manual publication must durably queue one course index: %d %v", queued, err)
		}
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
		if _, err := db.Exec(ctx, `INSERT INTO retrieval_chunks(id,course_id,source_id,title,body,locator,input_hash,search_tokens) VALUES('frozen-reference','course','bank-source','frozen','fixture','{}','frozen-ref-hash','frozen') ON CONFLICT DO NOTHING`); err != nil {
			t.Fatal(err)
		}
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
		partialID := id(call(teacher, "POST", path, map[string]any{"title": "partial", "fragment_ids": []string{"publication-public"}, "full_source": false}, 200))
		t.Run("resource_scope_never_expands_partial_publication", func(t *testing.T) {
			var response struct {
				Hits []rag.Hit `json:"hits"`
				Mode string    `json:"mode"`
			}
			decode(call(student, "POST", base+"/retrieval", map[string]string{"query": "公开内容", "purpose": "learning", "resource_id": partialID}, 200), &response)
			if response.Mode != "resource_keyword" || len(response.Hits) != 1 || response.Hits[0].ResourceID != partialID || strings.Contains(response.Hits[0].Body, "内部") {
				t.Fatal("scoped search expanded into private source", response)
			}
			decode(call(student, "POST", base+"/retrieval", map[string]string{"query": "未核对的内部内容", "purpose": "learning", "resource_id": partialID}, 200), &response)
			for _, hit := range response.Hits {
				if strings.Contains(hit.Body, "内部") {
					t.Fatal("private source fragment leaked")
				}
			}
			draftID := id(call(teacher, "POST", base+"/resources", map[string]string{"title": "private draft", "content": "公开内容", "source_note": "fixture", "locator": "1"}, 200))
			call(student, "POST", base+"/retrieval", map[string]string{"query": "公开", "resource_id": draftID}, 422)
			call(teacher, "POST", "/learning/courses/foreign/retrieval", map[string]string{"query": "公开", "resource_id": partialID}, 403)
		})
		t.Run("answer_markers_must_match_verified_citations", func(t *testing.T) {
			if _, err := db.Exec(ctx, `INSERT INTO retrieval_chunks(id,course_id,source_id,fragment_ids,title,body,locator,input_hash,search_tokens) VALUES('qa-public','course','publication-source',ARRAY['publication-public'],'公开内容','公开内容','{}','qa','公开 内容')`); err != nil {
				t.Fatal(err)
			}
			modelText := "依据公开内容回答[R1]。"
			var providerCalls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				providerCalls.Add(1)
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
			for i, test := range []struct {
				text   string
				status int
			}{{"依据公开内容回答[R1]。", 200}, {"依据公开内容回答[R99]。", 422}, {"依据公开内容回答。", 422}, {"依据公开内容回答[R1]和[R99]。", 422}} {
				modelText = test.text
				input := map[string]string{"topic": "公开内容", "request_id": fmt.Sprintf("citation-%d", i)}
				before := providerCalls.Load()
				raw := call(student, "POST", base+"/assist", input, test.status)
				if test.status == 200 {
					var original, replay any
					_ = json.Unmarshal(raw, &original)
					_ = json.Unmarshal(call(student, "POST", base+"/assist", input, 200), &replay)
					if !reflect.DeepEqual(original, replay) {
						t.Fatal("saved answer changed on retry")
					}
				} else {
					call(student, "POST", base+"/assist", input, 409)
				}
				if providerCalls.Load() != before+1 {
					t.Fatal("same request repeated a model call")
				}
				input["topic"] = "changed input"
				call(student, "POST", base+"/assist", input, 409)
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
		t.Run("processing_jobs_page_and_combined_kind_keep_object_scope", func(t *testing.T) {
			if _, err := db.Exec(ctx, `INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input) SELECT 'page-job-'||i,'course','teacher',CASE WHEN i%2=0 THEN 'extract' ELSE 'parse' END,'succeeded','{"source_id":"publication-source"}' FROM generate_series(1,65) i`); err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{}
			for offset := 0; offset < 65; offset += 20 {
				var rows []store.ProcessingJob
				decode(call(teacher, "GET", base+fmt.Sprintf("/jobs?kind=parse,extract&source_id=publication-source&size=20&offset=%d", offset), nil, 200), &rows)
				for _, row := range rows {
					if seen[row.ID] {
						t.Fatal("job repeated across pages")
					}
					seen[row.ID] = true
				}
			}
			if len(seen) != 65 {
				t.Fatal("scoped history silently truncated", len(seen))
			}
			call(teacher, "GET", base+"/jobs?size=201", nil, 422)
		})
	})
	t.Run("topic_scope_and_atomic_whole_group_regrade", func(t *testing.T) {
		decode := func(raw json.RawMessage, into any) {
			t.Helper()
			if e := json.Unmarshal(raw, into); e != nil {
				t.Fatal(e, string(raw))
			}
		}
		topic := id(call(teacher, "POST", base+"/topics", map[string]any{"title": "边界专题"}, 200))
		call(student, "GET", base+"/topics", nil, 403)
		call(other, "GET", base+"/topics", nil, 403)
		call(teacher, "PUT", base+"/topics/"+topic, map[string]any{"title": "边界专题", "active": false, "edit_version": 1}, 200)
		call(teacher, "PUT", base+"/topics/"+topic, map[string]any{"title": "覆盖新编辑", "active": true, "edit_version": 1}, 409)
		body := map[string]any{"title": "重评验收题", "prompt": "说明边界测试目的", "type": "subjective", "max_score": 10}
		var bank store.BankQuestionVersion
		decode(call(teacher, "POST", base+"/question-bank", body, 200), &bank)
		call(teacher, "POST", base+"/question-bank/versions/"+bank.ID+"/confirm", map[string]any{}, 200)
		criteria := []map[string]any{{"id": "D1", "title": "目的", "rule": "按证据给分", "max_score": 10}}
		var rubric store.RubricVersion
		decode(call(teacher, "POST", base+"/question-bank/versions/"+bank.ID+"/rubrics", map[string]any{"criteria": criteria}, 200), &rubric)
		call(teacher, "POST", base+"/rubrics/"+rubric.ID+"/confirm", map[string]any{}, 200)
		aid := id(call(teacher, "POST", base+"/assignments", map[string]any{"title": "整组重评事务验收", "type": "subjective", "questions": []any{map[string]any{"bank_question_version_id": bank.ID, "bound_rubric_id": rubric.ID}}}, 200))
		var assignment struct {
			Questions []store.Question `json:"questions"`
		}
		decode(call(teacher, "GET", base+"/assignments/"+aid, nil, 200), &assignment)
		qid := assignment.Questions[0].ID
		call(teacher, "POST", base+"/assignments/"+aid+"/state", map[string]string{"state": "published"}, 200)
		sids := []string{}
		for i, a := range []actor{student, peer} {
			s := id(call(a, "POST", base+"/assignments/"+aid+"/submissions", map[string]any{"question_id": qid, "answer_text": "检查拒绝超范围输入", "request_id": fmt.Sprintf("regrade-answer-%d", i)}, 200))
			sids = append(sids, s)
			g := id(call(teacher, "POST", base+"/submissions/"+s+"/revisions", map[string]any{"score": 4, "feedback": "原正式结果", "request_id": fmt.Sprintf("regrade-original-%d", i), "rubric_id": rubric.ID, "points": []any{map[string]any{"criterion_id": "D1", "score": 4, "feedback": "原评分", "quote": "拒绝超范围输入"}}}, 200))
			for _, state := range []string{"confirmed", "released"} {
				call(teacher, "POST", base+"/revisions/"+g+"/state", map[string]string{"state": state}, 200)
			}
		}
		call(teacher, "POST", base+"/assignments/"+aid+"/state", map[string]string{"state": "closed"}, 200)
		var revised store.RubricVersion
		decode(call(teacher, "POST", base+"/question-bank/versions/"+bank.ID+"/rubrics", map[string]any{"criteria": criteria}, 200), &revised)
		call(teacher, "POST", base+"/rubrics/"+revised.ID+"/confirm", map[string]any{}, 200)
		request := map[string]any{"question_id": qid, "rubric_id": revised.ID, "reason": "更正部分分口径", "preview": true}
		var preview struct {
			Count int `json:"count"`
		}
		decode(call(teacher, "POST", base+"/regrades", request, 200), &preview)
		if preview.Count != 2 {
			t.Fatal("freeze scope", preview.Count)
		}
		request["preview"] = false
		bid := id(call(teacher, "POST", base+"/regrades", request, 200))
		bp := base + "/regrades/" + bid
		call(teacher, "POST", base+"/regrades", request, 409)
		call(student, "GET", bp, nil, 403)
		call(other, "GET", bp, nil, 403)
		call(teacher, "POST", bp+"/state", map[string]string{"state": "released"}, 409)
		for i, s := range sids {
			item := map[string]any{"score": 8, "feedback": "更正后的正式结果", "confirmed": true, "edit_version": 1, "points": []any{map[string]any{"criterion_id": "D1", "score": 8, "feedback": "新口径", "quote": "拒绝超范围输入"}}}
			call(teacher, "PUT", bp+"/items/"+s, item, 200)
			call(teacher, "PUT", bp+"/items/"+s, item, 409)
			if i == 0 {
				call(teacher, "POST", bp+"/state", map[string]string{"state": "released"}, 409)
				if !strings.Contains(string(call(student, "GET", base+"/submissions/"+s, nil, 200)), "原正式结果") {
					t.Fatal("partial publication replaced old feedback")
				}
			}
		}
		call(teacher, "POST", bp+"/state", map[string]string{"state": "released"}, 200)
		call(teacher, "POST", bp+"/state", map[string]string{"state": "released"}, 200)
		var scores int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM grading_revisions WHERE regrade_batch_id=$1 AND state='released'`, bid).Scan(&scores); err != nil || scores != 2 {
			t.Fatal("not atomic / duplicated publication", scores, err)
		}
		for i, s := range sids {
			var response struct {
				Revisions []store.GradingRevision `json:"revisions"`
			}
			decode(call([]actor{student, peer}[i], "GET", base+"/submissions/"+s, nil, 200), &response)
			if len(response.Revisions) != 2 || response.Revisions[0].Score != 8 || response.Revisions[0].RubricID.String != revised.ID {
				t.Fatal("student did not get latest whole-group result")
			}
			var formal []store.CourseReleasedEvidenceRow
			decode(call([]actor{student, peer}[i], "GET", base+"/evidence", nil, 200), &formal)
			found := false
			for _, row := range formal {
				if row.SubmissionID == s {
					found = true
					if row.RubricVersion.Int32 != revised.Version {
						t.Fatal("formal standard version mismatch")
					}
				}
			}
			if !found {
				t.Fatal("formal evidence missing")
			}
			call(teacher, "POST", base+"/submissions/"+s+"/revisions", map[string]any{"score": 4, "feedback": "旧口径不能覆盖重评", "request_id": fmt.Sprintf("regrade-bypass-%d", i), "rubric_id": rubric.ID, "points": []any{map[string]any{"criterion_id": "D1", "score": 4, "feedback": "旧口径", "quote": "拒绝超范围输入"}}}, 409)
		}
		second := id(call(teacher, "POST", base+"/regrades", request, 200))
		call(teacher, "POST", base+"/regrades/"+second+"/state", map[string]string{"state": "canceled"}, 200)
		call(teacher, "POST", base+"/regrades/"+second+"/state", map[string]string{"state": "released"}, 409)
		conflict := id(call(teacher, "POST", base+"/regrades", request, 200))
		for _, s := range sids {
			call(teacher, "PUT", base+"/regrades/"+conflict+"/items/"+s, map[string]any{"score": 7, "feedback": "冲突回滚验收", "confirmed": true, "edit_version": 1, "points": []any{map[string]any{"criterion_id": "D1", "score": 7, "feedback": "新口径", "quote": "拒绝超范围输入"}}}, 200)
		}
		// Simulate an independent writer after freezing. The later student conflicts
		// after the earlier row was processed: the entire publication must roll back.
		if _, err := db.Exec(ctx, `INSERT INTO grading_revisions(id,submission_id,revision,score,feedback,reviewer_id,request_id) SELECT 'parallel-regrade-test',$1,max(revision)+1,6,'parallel','teacher','parallel-regrade-test' FROM grading_revisions WHERE submission_id=$1`, sids[0]); err != nil {
			t.Fatal(err)
		}
		call(teacher, "POST", base+"/regrades/"+conflict+"/state", map[string]string{"state": "released"}, 409)
		if err := db.QueryRow(ctx, `SELECT count(*) FROM grading_revisions WHERE regrade_batch_id=$1`, conflict).Scan(&scores); err != nil || scores != 0 {
			t.Fatal("conflict leaked a partial group", scores, err)
		}
		call(teacher, "POST", base+"/regrades/"+conflict+"/state", map[string]string{"state": "canceled"}, 200)
		reopened := id(call(teacher, "POST", base+"/regrades", request, 200))
		if _, err := db.Exec(ctx, `UPDATE assignments SET status='published' WHERE id=$1`, aid); err != nil {
			t.Fatal(err)
		}
		call(teacher, "POST", base+"/regrades/"+reopened+"/state", map[string]string{"state": "released"}, 409)
		if _, err := db.Exec(ctx, `UPDATE assignments SET status='closed' WHERE id=$1`, aid); err != nil {
			t.Fatal(err)
		}
		call(teacher, "POST", base+"/regrades/"+reopened+"/state", map[string]string{"state": "canceled"}, 200)
		var rows struct {
			Total int                         `json:"total"`
			Items []store.BankQuestionVersion `json:"items"`
		}
		decode(call(teacher, "GET", base+"/question-bank/search?search=重评验收&page=1&page_size=1&type=subjective", nil, 200), &rows)
		if rows.Total != 1 || len(rows.Items) != 1 || rows.Items[0].ID != bank.ID {
			t.Fatal("server paging/filter mismatch")
		}
	})
	t.Run("bulk_import_is_atomic_immutable_and_audited", func(t *testing.T) {
		aid := id(call(teacher, "POST", base+"/assignments", map[string]any{"title": "CSV transaction test", "questions": []any{map[string]any{"prompt": "Explain the boundary", "max_score": 10, "rubric": "Evidence"}}}, 200))
		ap := base + "/assignments/" + aid
		var assignment struct {
			Questions []store.Question `json:"questions"`
		}
		_ = json.Unmarshal(call(teacher, "GET", ap, nil, 200), &assignment)
		qid := assignment.Questions[0].ID
		input := map[string]any{"question_id": qid, "csv": "username,answer_text\r\nstudent,\"原文😀\r\n换行和\"\"引号\"\"\"\r\npeer,peer answer\r\n", "request_id": "import-request"}
		call(teacher, "POST", ap+"/import/preview", input, 409)
		call(teacher, "POST", ap+"/state", map[string]string{"state": "published"}, 200)
		call(student, "POST", ap+"/import/preview", input, 403)
		call(other, "POST", ap+"/import/preview", input, 403)
		call(actor{teacher.cookie, ""}, "POST", ap+"/import/confirm", input, 403)
		var preview struct {
			Valid       bool   `json:"valid"`
			PreviewHash string `json:"preview_hash"`
			Rows        []struct {
				Next  int    `json:"next_attempt"`
				Error string `json:"error"`
			} `json:"rows"`
		}
		readPreview := func() {
			t.Helper()
			if err := json.Unmarshal(call(teacher, "POST", ap+"/import/preview", input, 200), &preview); err != nil || !preview.Valid {
				t.Fatal(preview, err)
			}
			input["preview_hash"] = preview.PreviewHash
		}
		count := func(table string) int {
			t.Helper()
			var n int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE assignment_id=$1", aid).Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		readPreview()
		if count("submissions") != 0 || count("submission_imports") != 0 {
			t.Fatal("preview wrote data")
		}
		// A concurrent student submission invalidates the preview, never silently changing attempts.
		call(student, "POST", ap+"/submissions", map[string]string{"question_id": qid, "answer_text": "own previous answer", "request_id": "before-import"}, 200)
		call(teacher, "POST", ap+"/import/confirm", input, 409)
		if count("submissions") != 1 || count("submission_imports") != 0 {
			t.Fatal("stale preview wrote data")
		}
		readPreview()
		var receipt struct {
			Batch       store.SubmissionImport `json:"batch"`
			Submissions []store.Submission     `json:"submissions"`
		}
		if err := json.Unmarshal(call(teacher, "POST", ap+"/import/confirm", input, 200), &receipt); err != nil {
			t.Fatal(err)
		}
		if len(receipt.Submissions) != 2 || receipt.Submissions[0].Attempt != 2 || receipt.Submissions[0].AnswerText != "原文😀\r\n换行和\"引号\"" {
			t.Fatal("import lost immutable text or attempt", receipt.Submissions)
		}
		call(teacher, "POST", ap+"/import/confirm", input, 200)
		if count("submissions") != 3 || count("submission_imports") != 1 {
			t.Fatal("idempotence failed")
		}
		input["csv"] = "username,answer_text\nstudent,changed"
		call(teacher, "POST", ap+"/import/confirm", input, 409)
		input["request_id"] = "invalid-import"
		input["csv"] = "username,answer_text\nstudent,valid\nunknown,invalid"
		var invalidPreview struct {
			Valid       bool   `json:"valid"`
			PreviewHash string `json:"preview_hash"`
		}
		_ = json.Unmarshal(call(teacher, "POST", ap+"/import/preview", input, 200), &invalidPreview)
		if invalidPreview.Valid {
			t.Fatal("unknown student accepted")
		}
		input["preview_hash"] = invalidPreview.PreviewHash
		call(teacher, "POST", ap+"/import/confirm", input, 422)
		if count("submissions") != 3 || count("submission_imports") != 1 {
			t.Fatal("invalid batch partially committed")
		}
		call(student, "GET", ap+"/imports", nil, 403)
		for _, s := range receipt.Submissions {
			body := string(call(teacher, "GET", base+"/submissions/"+s.ID, nil, 200))
			if !strings.Contains(body, `"imported_by":"teacher"`) {
				t.Fatal("missing teacher provenance", body)
			}
			var actor, verb string
			if err := db.QueryRow(ctx, "SELECT actor_id,verb FROM learning_events WHERE submission_id=$1", s.ID).Scan(&actor, &verb); err != nil || actor != "teacher" || verb != "submission.imported" {
				t.Fatal("event impersonates student", actor, verb, err)
			}
		}
		if ready, err := store.New(db).HasInterventionSubmission(ctx, store.HasInterventionSubmissionParams{StudentID: "peer", AssignmentID: aid, SubmittedAt: receipt.Submissions[1].SubmittedAt}); err != nil || ready {
			t.Fatal("teacher import counted as student action", ready, err)
		}
		call(peer, "GET", base+"/submissions/"+receipt.Submissions[0].ID, nil, 403)
		if body := string(call(student, "GET", base+"/activity", nil, 200)); !strings.Contains(body, "submission.imported") {
			t.Fatal("student cannot see imported event")
		}
		call(teacher, "POST", ap+"/state", map[string]string{"state": "closed"}, 200)
		call(teacher, "POST", ap+"/import/preview", input, 409)
		// A retry may recover the already committed receipt after closure.
		input["request_id"] = "import-request"
		input["csv"] = "username,answer_text\r\nstudent,\"原文😀\r\n换行和\"\"引号\"\"\"\r\npeer,peer answer\r\n"
		call(teacher, "POST", ap+"/import/confirm", input, 200)
	})
	t.Run("intelligence_reports_examples_and_frozen_evidence", func(t *testing.T) {
		t.Setenv("RAG_ENABLED", "true")
		var modelCalls atomic.Int32
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			modelCalls.Add(1)
			var body struct {
				Messages []struct {
					Content string `json:"content"`
				} `json:"messages"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			var in struct {
				rag.IntelligenceInput
				EvidenceSpans []struct {
					ID string `json:"id"`
				} `json:"evidence_spans"`
			}
			_ = json.Unmarshal([]byte(body.Messages[1].Content), &in)
			var out any
			if len(in.Answers) > 0 {
				if len(in.EvidenceSpans) == 0 {
					t.Error("diagnosis model input has no selectable original evidence")
					http.Error(w, "missing evidence spans", 500)
					return
				}
				out = map[string]any{"findings": []any{map[string]any{"label_id": "concept", "title": "概念混淆", "explanation": "该次作答把范围内外混为一类", "evidence_ids": []string{in.EvidenceSpans[0].ID}}}}
			} else {
				ranking := []rag.RankedCandidate{}
				for _, v := range in.Candidates {
					ranking = append(ranking, rag.RankedCandidate{ID: v.ID, Reason: "按规则路径的前置关系学习"})
				}
				out = rag.IntelligenceOutput{Ranking: ranking}
			}
			content, _ := json.Marshal(out)
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(content)}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 50, "completion_tokens": 80}})
		}))
		defer provider.Close()
		t.Setenv("INTEL_FIXTURE_KEY", "fixture-only")
		t.Setenv("INTEL_FIXTURE_BASE", provider.URL)
		profiles := filepath.Join(t.TempDir(), "models.json")
		if e := os.WriteFile(profiles, []byte(`[{"id":"fixture","label":"fixture","kind":"chat","protocol":"openai","base_url_env":"INTEL_FIXTURE_BASE","key_env":"INTEL_FIXTURE_KEY","model":"fixture","input_micro_cny_per_token":1,"output_micro_cny_per_token":1,"batch_size":1}]`), 0600); e != nil {
			t.Fatal(e)
		}
		t.Setenv("MODEL_PROFILES_PATH", profiles)
		router = server.New(db, nil, false)
		models, e := rag.LoadModels(db)
		if e != nil {
			t.Fatal(e)
		}
		worker := rag.New(models)
		point := id(call(teacher, "POST", base+"/points", map[string]any{"title": "智能报告测试知识点", "kind": "point", "position": 99}, 200))
		example := map[string]any{"title": "教师自编示例", "body": "独立编写的边界检查教学示例", "origin": "teacher_example", "content_kind": "example", "student_visible": true, "use_for_learning": true, "use_for_grading": false, "knowledge_point_ids": []string{point}}
		kid := id(call(teacher, "POST", base+"/knowledge", example, 200))
		example["use_for_grading"] = true
		call(teacher, "POST", base+"/knowledge", example, 422)
		example["use_for_grading"] = false
		call(student, "GET", base+"/knowledge", nil, 200)
		call(teacher, "POST", base+"/knowledge/"+kid+"/state", map[string]any{"state": "confirmed", "edit_version": 1}, 200)
		if !strings.Contains(string(call(student, "GET", base+"/knowledge", nil, 200)), kid) {
			t.Fatal("confirmed teacher example invisible")
		}
		example["origin"] = "source"
		example["supersedes_id"] = kid
		call(teacher, "POST", base+"/knowledge", example, 422)
		aid := id(call(teacher, "POST", base+"/assignments", map[string]any{"title": "诊断正式结果", "questions": []any{map[string]any{"prompt": "18到60的整数年龄边界", "max_score": 10, "rubric": "判断内外合法性", "knowledge_point_id": point}}}, 200))
		var detail struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		}
		_ = json.Unmarshal(call(teacher, "GET", base+"/assignments/"+aid, nil, 200), &detail)
		qid := detail.Questions[0].ID
		rubric := id(call(teacher, "POST", base+"/questions/"+qid+"/rubrics", map[string]any{"criteria": []any{map[string]any{"id": "D1", "title": "合法分类", "max_score": 10, "rule": "区分内外"}}}, 200))
		call(teacher, "POST", base+"/rubrics/"+rubric+"/confirm", map[string]any{}, 200)
		call(teacher, "POST", base+"/assignments/"+aid+"/state", map[string]any{"state": "published"}, 200)
		sid := id(call(student, "POST", base+"/assignments/"+aid+"/submissions", map[string]any{"question_id": qid, "answer_text": "这六个年龄都合法", "request_id": "intel-answer"}, 200))
		rid := id(call(teacher, "POST", base+"/submissions/"+sid+"/revisions", map[string]any{"score": 3, "feedback": "范围外分类有误", "rubric_id": rubric, "request_id": "intel-grade", "points": []any{map[string]any{"criterion_id": "D1", "score": 3, "feedback": "范围外分类有误", "quote": "都合法"}}}, 200))
		for _, state := range []string{"confirmed", "released"} {
			call(teacher, "POST", base+"/revisions/"+rid+"/state", map[string]any{"state": state}, 200)
		}
		request := map[string]any{"kind": "diagnosis", "question_id": qid, "rubric_id": rubric, "request_id": "diagnosis-once"}
		call(student, "POST", base+"/intelligence", request, 403)
		var report struct {
			ID    string `json:"id"`
			JobID string `json:"job_id"`
		}
		_ = json.Unmarshal(call(teacher, "POST", base+"/intelligence", request, 200), &report)
		if got := id(call(teacher, "POST", base+"/intelligence", request, 200)); got != report.ID {
			t.Fatal("report retry duplicated")
		}
		request["rubric_id"] = "changed"
		call(teacher, "POST", base+"/intelligence", request, 409)
		for i := 0; i < 2; i++ {
			if e = worker.Process(ctx, asynq.NewTask("materials:process", []byte(report.JobID))); e != nil {
				t.Fatal(e)
			}
		}
		if modelCalls.Load() != 1 {
			t.Fatal("redelivery repeated model", modelCalls.Load())
		}
		var view struct {
			Report struct {
				Output      rag.IntelligenceOutput `json:"output"`
				EditVersion int                    `json:"edit_version"`
			} `json:"report"`
			Stale bool `json:"stale"`
		}
		_ = json.Unmarshal(call(teacher, "GET", base+"/intelligence/"+report.ID, nil, 200), &view)
		if view.Stale || len(view.Report.Output.Findings) != 1 || len(view.Report.Output.Findings[0].Evidence) != 1 || view.Report.Output.Findings[0].Evidence[0].Quote != "这六个年龄都合法" {
			t.Fatal("diagnosis missing or incorrectly stale")
		}
		call(student, "GET", base+"/intelligence/"+report.ID, nil, 404)
		call(other, "GET", base+"/intelligence/"+report.ID, nil, 403)
		out := view.Report.Output
		out.Findings[0].Evidence[0].Quote = "虚构引用"
		call(teacher, "PUT", base+"/intelligence/"+report.ID, map[string]any{"output": out, "edit_version": 1}, 422)
		out.Findings[0].Evidence[0].Quote = "这六个年龄都合法"
		out.Findings[0].LabelID = ""
		out.Findings[0].Title = "新问题标签"
		call(teacher, "POST", base+"/intelligence/"+report.ID+"/confirm", map[string]any{"output": out, "edit_version": 1}, 422)
		label := id(call(teacher, "POST", base+"/diagnosis-labels", map[string]any{"title": "新问题标签"}, 200))
		out.Findings[0].LabelID = label
		call(teacher, "PUT", base+"/intelligence/"+report.ID, map[string]any{"output": out, "edit_version": 1}, 200)
		call(teacher, "POST", base+"/intelligence/"+report.ID+"/confirm", map[string]any{"output": out, "edit_version": 1}, 409)
		taskInput := map[string]any{"student_id": "student", "title": "诊断后补学", "description": "核对范围内外分类", "source_submission_id": sid, "diagnosis_report_id": report.ID, "diagnosis_label_id": label}
		call(teacher, "POST", base+"/interventions", taskInput, 422)
		call(teacher, "POST", base+"/intelligence/"+report.ID+"/confirm", map[string]any{"output": out, "edit_version": 2}, 200)
		taskInput["student_id"] = "peer"
		call(teacher, "POST", base+"/interventions", taskInput, 422)
		taskInput["student_id"] = "student"
		var linkedTask store.Intervention
		decode(call(teacher, "POST", base+"/interventions", taskInput, 200), &linkedTask)
		if linkedTask.SourceSubmissionID.String != sid || linkedTask.DiagnosisReportID.String != report.ID || linkedTask.DiagnosisLabelID.String != label || linkedTask.Status != "draft" {
			t.Fatal("diagnosis origin lost or task auto-assigned", linkedTask)
		}
		if _, e = db.Exec(ctx, "UPDATE grading_revisions SET feedback='更正后的反馈' WHERE id=$1", rid); e != nil {
			t.Fatal(e)
		}
		call(teacher, "POST", base+"/intelligence/"+report.ID+"/confirm", map[string]any{"output": out, "edit_version": 2}, 409)
		call(teacher, "POST", base+"/interventions", taskInput, 409)
		call(student, "POST", base+"/path", map[string]any{}, 200)
		_ = json.Unmarshal(call(student, "POST", base+"/intelligence", map[string]any{"kind": "recommendation", "request_id": "recommend-once"}, 200), &report)
		if e = worker.Process(ctx, asynq.NewTask("materials:process", []byte(report.JobID))); e != nil {
			t.Fatal(e)
		}
		var recommendation struct {
			Report struct {
				Output rag.IntelligenceOutput `json:"output"`
			} `json:"report"`
		}
		_ = json.Unmarshal(call(student, "GET", base+"/intelligence/"+report.ID, nil, 200), &recommendation)
		if len(recommendation.Report.Output.Ranking) == 0 {
			t.Fatal("recommendation missing")
		}
		choice := recommendation.Report.Output.Ranking[0].ID
		call(student, "PUT", base+"/intelligence/"+report.ID+"/choice", map[string]any{"candidate_id": choice, "choice": "saved"}, 200)
		call(peer, "GET", base+"/intelligence/"+report.ID, nil, 404)
		call(student, "PUT", base+"/intelligence/"+report.ID+"/choice", map[string]any{"candidate_id": "foreign", "choice": "saved"}, 409)
		call(teacher, "POST", base+"/knowledge/"+kid+"/state", map[string]any{"state": "archived", "edit_version": 1}, 409)
		call(teacher, "POST", base+"/knowledge/"+kid+"/state", map[string]any{"state": "archived", "edit_version": 2}, 200)
		_ = json.Unmarshal(call(student, "GET", base+"/intelligence/"+report.ID, nil, 200), &recommendation)
		for _, rank := range recommendation.Report.Output.Ranking {
			if rank.ID == "knowledge:"+kid && rank.Reason != "内容已不可用或已完成，请以当前学习路径为准。" {
				t.Fatal("unavailable recommendation retained generated explanation", rank)
			}
		}
		call(student, "PUT", base+"/intelligence/"+report.ID+"/choice", map[string]any{"candidate_id": "knowledge:" + kid, "choice": "later"}, 409)
	})
	t.Run("assist_history_is_private_paginated_and_durable", func(t *testing.T) {
		var existing int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM assist_turns WHERE course_id='course' AND owner_id='student'").Scan(&existing); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, `INSERT INTO assist_turns(id,course_id,owner_id,request_id,question,state,response,created_at)
 SELECT 'turn-'||n,'course','student','request-'||n,'question-'||n,CASE WHEN n=1 THEN 'failed' ELSE 'succeeded' END,'{"text":"saved answer","sources":[]}',now()+n*interval '1 second' FROM generate_series(1,13)n;
 INSERT INTO assist_turns(id,course_id,owner_id,request_id,question) VALUES('peer-turn','course','peer','private','peer question')`); err != nil {
			t.Fatal(err)
		}
		var page struct {
			Total int                `json:"total"`
			Rows  []store.AssistTurn `json:"rows"`
		}
		_ = json.Unmarshal(call(student, "GET", base+"/assist/history?page=2&size=10", nil, 200), &page)
		if page.Total != 13+existing || len(page.Rows) != min(10, 3+existing) || page.Rows[0].ID != "turn-3" {
			t.Fatal("history pagination", page)
		}
		_ = json.Unmarshal(call(student, "GET", base+"/assist/history?page=8&size=10", nil, 200), &page)
		if page.Total != 13+existing || len(page.Rows) != 0 {
			t.Fatal("past last page total", page)
		}
		if body := string(call(student, "GET", base+"/assist/history/turn-1", nil, 200)); !strings.Contains(body, `"state":"failed"`) {
			t.Fatal("failed history hidden")
		}
		call(peer, "GET", base+"/assist/history/turn-3", nil, 404)
		call(teacher, "GET", base+"/assist/history/turn-3", nil, 404)
		call(other, "GET", base+"/assist/history", nil, 403)
	})

}
