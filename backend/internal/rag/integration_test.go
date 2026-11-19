package rag

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
	"sync/atomic"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRAGIsolationAndBudget(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("rag_test_%d", time.Now().UnixNano())
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	paths, _ := filepath.Glob("../../db/migrations/*.sql")
	for _, p := range paths {
		raw, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		sql := strings.Split(strings.Split(string(raw), "-- +goose Up")[1], "-- +goose Down")[0]
		if _, e = db.Exec(ctx, sql); e != nil {
			t.Fatal(p, e)
		}
	}
	must := func(sql string) {
		t.Helper()
		if _, e := db.Exec(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
	must(`INSERT INTO users(id,display_name,role) VALUES('t','Teacher','teacher');INSERT INTO courses(id,title,teacher_id) VALUES('c','RAG test','t'),('foreign','other','t');
 INSERT INTO material_sources(id,course_id,created_by,title,sha256,parse_state,parse_revision,allow_derived) VALUES('s','c','t','source','hash','ready',1,true),('f','foreign','t','foreign','hash','ready',1,true);
 INSERT INTO material_fragments(id,source_id,revision,position,body,locator) VALUES('public','s',1,0,'公开边界值分析','{}'),('private','s',1,1,'内部评分细则','{}'),('foreign-f','f',1,0,'异课程机密','{}');
 INSERT INTO retrieval_chunks(id,course_id,source_id,fragment_ids,title,body,locator,input_hash,search_tokens) VALUES('p','c','s',ARRAY['public'],'public','公开边界值分析','{}','p','边界 测试'),('secret','c','s',ARRAY['private'],'secret','内部评分细则','{}','s','边界 测试'),('foreign-c','foreign','f',ARRAY['foreign-f'],'foreign','异课程机密','{}','f','边界 测试');
 INSERT INTO resources(id,course_id,title,content,locator,created_by,status,source_id,fragment_ids) VALUES('r','c','published','公开边界值分析','part','t','published','s',ARRAY['public']);`)
	q := store.New(db)
	find := func(teacher bool, want int) {
		t.Helper()
		rows, e := q.KeywordSearch(ctx, store.KeywordSearchParams{CourseID: "c", QueryTokens: "'边界'", Teacher: teacher, Purpose: "learning"})
		if e != nil || len(rows) != want {
			t.Fatalf("teacher=%v rows=%d want=%d err=%v", teacher, len(rows), want, e)
		}
		for _, r := range rows {
			if r.ID == "foreign-c" || !teacher && r.ID == "secret" {
				t.Fatal("private content leaked")
			}
		}
	}
	find(true, 2)
	find(false, 1)
	allowed, e := q.StudentCanDownloadSource(ctx, store.StudentCanDownloadSourceParams{ID: "s", CourseID: "c"})
	if e != nil || allowed {
		t.Fatal("partial publication must not allow original download")
	}
	must(`INSERT INTO knowledge_entries(id,course_id,created_by,title,body,state,student_visible,evidence) VALUES('kp','c','t','private knowledge','secret','confirmed',true,'[{"source_id":"s","fragment_id":"private","quote":"内部评分细则"}]');`)
	knowledge, e := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: false})
	if e != nil || len(knowledge) != 0 {
		t.Fatal("knowledge derived from private fragments leaked", e)
	}
	must(`UPDATE knowledge_entries SET evidence='[{"source_id":"s","fragment_id":"public","quote":"公开边界值分析"}]' WHERE id='kp'`)
	knowledge, e = q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: false})
	if e != nil || len(knowledge) != 1 {
		t.Fatal("confirmed public knowledge is missing", e)
	}
	must(`UPDATE material_sources SET allow_derived=false WHERE id='s'`)
	knowledge, e = q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: false})
	if e != nil || len(knowledge) != 0 {
		t.Fatal("derived knowledge survived revoked derivation permission", e)
	}
	must(`UPDATE material_sources SET allow_derived=true WHERE id='s'`)
	_, e = q.MissingChunkEmbeddings(ctx, store.MissingChunkEmbeddingsParams{CourseID: "c", SpaceID: "not-created"})
	if e != nil {
		t.Fatal("pending chunks failed to decode", e)
	}
	must(`UPDATE material_sources SET state='archived' WHERE id='s'`)
	find(true, 0)
	find(false, 0)
	must(`UPDATE model_budget SET limit_micro_cny=100000,reserved_micro_cny=0,spent_micro_cny=0`)
	var count atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := q.ReserveModelBudget(ctx, 30000); e == nil {
				count.Add(1)
			}
		}()
	}
	wg.Wait()
	if count.Load() != 3 {
		t.Fatal("concurrent reservations exceeded budget", count.Load())
	}
	must(`UPDATE model_budget SET limit_micro_cny=50000000,reserved_micro_cny=0,spent_micro_cny=0`)
	t.Setenv("RAG_ENABLED", "true")
	t.Setenv("RAG_TEST_KEY", "unit-test-not-a-real-secret")
	duplicate := false
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.Header.Get("Authorization") != "Bearer unit-test-not-a-real-secret" || body["model"] != "test-model" {
			t.Error("adapter request invalid")
		}
		second := 0
		if duplicate {
			second = 1
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"index": 1, "embedding": []float64{0, 1}}, {"index": second, "embedding": []float64{1, 0}}}, "usage": map[string]int{"prompt_tokens": 8}})
	}))
	defer provider.Close()
	t.Setenv("RAG_TEST_BASE", provider.URL)
	m := &Models{DB: db, Client: provider.Client()}
	p := Profile{ID: "test", Model: "test-model", BaseURLEnv: "RAG_TEST_BASE", KeyEnv: "RAG_TEST_KEY", InputRate: 1, Dimensions: 2, BatchSize: 2}
	vectors, e := m.Embed(ctx, "c", "t", p, []string{"first", "second"})
	if e != nil || vectors[0][0] != 1 {
		t.Fatal("adapter failed to restore order", e)
	}
	duplicate = true
	if _, e = m.Embed(ctx, "c", "t", p, []string{"first", "second"}); e == nil {
		t.Fatal("duplicate vector index must fail")
	}
	t.Run("streaming_and_fallback_settle_once_without_retry", func(t *testing.T) {
		for _, mode := range []string{"stream", "json", "disabled", "truncated", "invalid_usage"} {
			t.Run(mode, func(t *testing.T) {
				var requests atomic.Int32
				provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					var payload map[string]any
					_ = json.NewDecoder(r.Body).Decode(&payload)
					if payload["stream"] != (mode != "disabled") {
						t.Error("profile streaming preference ignored")
					}
					if mode == "json" || mode == "disabled" {
						w.Header().Set("Content-Type", "application/json")
						fmt.Fprint(w, `{"choices":[{"message":{"content":"已核对"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}`)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if mode == "truncated" {
						fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"已核对\"},\"finish_reason\":null}]}\n\n")
						return
					}
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"已核对\"},\"finish_reason\":\"stop\"}]}\n\n")
					prompt := 7
					if mode == "invalid_usage" {
						prompt = -1
					}
					fmt.Fprintf(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":%d,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n", prompt)
				}))
				defer provider.Close()
				t.Setenv("RAG_STREAM_BASE", provider.URL)
				models := &Models{DB: db, Client: provider.Client(), Profiles: []Profile{{ID: "stream-test", Kind: "chat", Model: "fixture", KeyEnv: "RAG_TEST_KEY", BaseURLEnv: "RAG_STREAM_BASE", InputRate: 1, OutputRate: 1, DisableStreaming: mode == "disabled"}}}
				before, _ := q.GetModelBudget(ctx)
				msg, err := models.AgentChatStream(ctx, "c", "t", "stream-test", []AgentMessage{{Role: "user", Content: "核对"}}, nil, func(string) error { return nil })
				if (err != nil) != (mode == "truncated") || err == nil && msg.Content != "已核对" {
					t.Fatal(mode, msg, err)
				}
				after, _ := q.GetModelBudget(ctx)
				want := int64(10)
				if mode == "truncated" || mode == "invalid_usage" {
					want = after.SpentMicroCny - before.SpentMicroCny
					if want < 1000 {
						t.Fatal("uncertain usage was not conservatively settled")
					}
				}
				if requests.Load() != 1 || after.ReservedMicroCny != before.ReservedMicroCny || after.SpentMicroCny-before.SpentMicroCny != want {
					t.Fatal("stream retried or settled incorrectly", requests.Load(), before, after)
				}
			})
		}
	})
	must(`UPDATE material_sources SET state='active',allow_derived=true WHERE id='s'`)
	var chatCalls atomic.Int32
	cancelJob := ""
	invalidReference := false
	chat := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatCalls.Add(1)
		var request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		var payload struct {
			Fragments []struct {
				SourceID   string `json:"source_id"`
				FragmentID string `json:"fragment_id"`
				Body       string `json:"body"`
			} `json:"fragments"`
		}
		if len(request.Messages) < 2 || json.Unmarshal([]byte(request.Messages[1].Content), &payload) != nil || len(payload.Fragments) != 1 || payload.Fragments[0].SourceID != "s" || payload.Fragments[0].FragmentID != "public" || payload.Fragments[0].Body != "公开边界值分析" {
			t.Error("extraction must name evidence IDs exactly as the output contract")
		}
		if cancelJob != "" {
			if _, err := q.CancelProcessingJob(ctx, store.CancelProcessingJobParams{ID: cancelJob, CourseID: "c"}); err != nil {
				t.Error(err)
			}
		}
		content := `{"candidates":[{"title":"候选","body":"公开边界值分析","content_kind":"method","evidence_fragment_ids":["public"]}]}`
		if invalidReference {
			content = strings.Replace(content, `"evidence_fragment_ids":["public"]`, `"evidence_fragment_ids":["private"]`, 1)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 8, "completion_tokens": 8}})
	}))
	defer chat.Close()
	t.Setenv("RAG_CHAT_TEST_BASE", chat.URL)
	service := New(&Models{DB: db, Client: chat.Client(), Profiles: []Profile{{ID: "chat-test", Kind: "chat", Model: "test", KeyEnv: "RAG_TEST_KEY", BaseURLEnv: "RAG_CHAT_TEST_BASE", InputRate: 1, OutputRate: 1}}})
	input, _ := json.Marshal(JobInput{SourceID: "s", FragmentIDs: []string{"public"}})
	create := func(id string) store.ProcessingJob {
		t.Helper()
		job, err := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{ID: id, CourseID: "c", CreatedBy: "t", Kind: "extract", Input: input})
		if err != nil {
			t.Fatal(err)
		}
		return job
	}
	job := create("extract-once")
	task := asynq.NewTask(taskType, []byte(job.ID))
	if e = service.Process(ctx, task); e != nil {
		t.Fatal(e)
	}
	completed, e := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: job.ID, CourseID: "c"})
	var output struct {
		CandidateIDs []string `json:"candidate_ids"`
	}
	_ = json.Unmarshal(completed.Output, &output)
	if e != nil || completed.State != "succeeded" || len(output.CandidateIDs) != 1 {
		t.Fatal("candidate commit and completion must persist together", completed.State, e)
	}
	before, _ := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: true})
	for _, candidate := range before {
		if candidate.ID == output.CandidateIDs[0] {
			var refs []Evidence
			if json.Unmarshal(candidate.Evidence, &refs) != nil || len(refs) != 1 || refs[0].Quote != "公开边界值分析" || refs[0].FragmentID != "public" {
				t.Fatal("extracted evidence must be resolved from the exact selected source fragment")
			}
		}
	}
	if e = service.Process(ctx, task); e != nil || chatCalls.Load() != 1 {
		t.Fatal("redelivery repeated a completed model call", chatCalls.Load(), e)
	}
	t.Run("unselected_evidence_retains_raw_draft_without_knowledge_writes", func(t *testing.T) {
		invalidReference = true
		defer func() { invalidReference = false }()
		failed := create("extract-unselected-evidence")
		if err := service.Process(ctx, asynq.NewTask(taskType, []byte(failed.ID))); err != nil {
			t.Fatal(err)
		}
		current, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: failed.ID, CourseID: "c"})
		after, listErr := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: true})
		if err != nil || listErr != nil || current.State != "failed" || !strings.Contains(string(current.Output), "private") || len(after) != len(before) {
			t.Fatal("invalid evidence must retain the raw draft but commit no candidates", current.State, err, listErr)
		}
	})
	t.Run("grade_total_is_derived_from_validated_points", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			content := `{"points":[{"criterion_id":"D1","score":2,"feedback":"原文有据","quote":"公开边界值分析"}],"score":99,"feedback":"仅按本次作答评价","review_status":"pending_teacher_review"}`
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 8, "completion_tokens": 8}})
		}))
		defer provider.Close()
		t.Setenv("RAG_GRADE_TEST_BASE", provider.URL)
		grader := New(&Models{DB: db, Client: provider.Client(), Profiles: []Profile{{ID: "grade-test", Kind: "chat", Model: "test", KeyEnv: "RAG_TEST_KEY", BaseURLEnv: "RAG_GRADE_TEST_BASE", InputRate: 1, OutputRate: 1}}})
		input, _ := json.Marshal(JobInput{Answer: "公开边界值分析", MaxScore: 2, Criteria: json.RawMessage(`[{"id":"D1","max_score":2}]`)})
		j, err := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{ID: "grade-server-total", CourseID: "c", CreatedBy: "t", Kind: "grade", Input: input})
		if err != nil {
			t.Fatal(err)
		}
		if err = grader.Process(ctx, asynq.NewTask(taskType, []byte(j.ID))); err != nil {
			t.Fatal(err)
		}
		completed, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: j.ID, CourseID: "c"})
		var output struct {
			Score    int    `json:"score"`
			Reported int    `json:"model_reported_score"`
			Source   string `json:"score_source"`
		}
		if err != nil || json.Unmarshal(completed.Output, &output) != nil || completed.State != "succeeded" || output.Score != 2 || output.Reported != 99 || output.Source != "server_sum" {
			t.Fatal("the server must own arithmetic without changing the model's individual scores", completed.State, output, err)
		}
	})
	canceled := create("extract-canceled")
	cancelJob = canceled.ID
	if e = service.Process(ctx, asynq.NewTask(taskType, []byte(canceled.ID))); e != nil {
		t.Fatal(e)
	}
	after, _ := q.ListKnowledgeEntries(ctx, store.ListKnowledgeEntriesParams{CourseID: "c", Teacher: true})
	current, _ := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: canceled.ID, CourseID: "c"})
	if len(after) != len(before) || current.State != "canceled" {
		t.Fatal("canceled extraction published candidates")
	}
	t.Run("canceled_index_cannot_activate_embedding_space", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var input struct {
				Input []string `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			if _, err := q.CancelProcessingJob(ctx, store.CancelProcessingJobParams{ID: "index-canceled", CourseID: "c"}); err != nil {
				t.Error(err)
			}
			data := []map[string]any{}
			for i := range input.Input {
				data = append(data, map[string]any{"index": i, "embedding": []float64{1, 0}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "usage": map[string]int{"prompt_tokens": 8}})
		}))
		defer provider.Close()
		t.Setenv("RAG_INDEX_TEST_BASE", provider.URL)
		service := New(&Models{DB: db, Client: provider.Client(), Profiles: []Profile{{ID: "index-test", Kind: "embedding", Model: "test", KeyEnv: "RAG_TEST_KEY", BaseURLEnv: "RAG_INDEX_TEST_BASE", InputRate: 1, Dimensions: 2, BatchSize: 100}}})
		if _, err := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{ID: "index-canceled", CourseID: "c", CreatedBy: "t", Kind: "index", Input: []byte("{}")}); err != nil {
			t.Fatal(err)
		}
		if err := service.Process(ctx, asynq.NewTask(taskType, []byte("index-canceled"))); err != nil {
			t.Fatal(err)
		}
		course, err := q.GetBusinessCourse(ctx, "c")
		if err != nil || course.EmbeddingSpaceID.Valid {
			t.Fatal("canceled index activated a new space", err)
		}
		job, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: "index-canceled", CourseID: "c"})
		if err != nil || job.State != "canceled" {
			t.Fatal("canceled index changed state", job.State, err)
		}
	})
	t.Run("reparse_failure_and_cancellation_preserve_previous_text", func(t *testing.T) {
		bin := t.TempDir()
		parser := "#!/bin/sh\nif [ \"$PARSER_TEST_FAIL\" = 1 ]; then printf '%s' '{\"error\":\"test parse failed\"}'; exit 1; fi\nprintf '%s' '{\"fragments\":[{\"body\":\"新的解析结果\",\"locator\":{},\"quality\":\"ready\"}]}'\n"
		if err := os.WriteFile(filepath.Join(bin, "python"), []byte(parser), 0700); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
		t.Setenv("PARSER_TEST_FAIL", "1")
		parseInput, _ := json.Marshal(JobInput{SourceID: "s"})
		makeJob := func(id string) store.ProcessingJob {
			t.Helper()
			j, err := q.CreateProcessingJob(ctx, store.CreateProcessingJobParams{ID: id, CourseID: "c", CreatedBy: "t", Kind: "parse", Input: parseInput})
			if err != nil {
				t.Fatal(err)
			}
			return j
		}
		failed := makeJob("parse-failure")
		if err := service.Process(ctx, asynq.NewTask(taskType, []byte(failed.ID))); err != nil {
			t.Fatal(err)
		}
		source, err := q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: "s", CourseID: "c"})
		if err != nil || source.ParseState != "ready" || source.ParseRevision != 1 {
			t.Fatal("failed reparse hid previous valid text", source.ParseState, source.ParseRevision, err)
		}
		t.Setenv("PARSER_TEST_FAIL", "0")
		canceled := makeJob("parse-canceled")
		claimed, err := q.ClaimProcessingJob(ctx, canceled.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = q.CancelProcessingJob(ctx, store.CancelProcessingJobParams{ID: canceled.ID, CourseID: "c"}); err != nil {
			t.Fatal(err)
		}
		if _, err = service.Parse(ctx, claimed, JobInput{SourceID: "s"}); err == nil {
			t.Fatal("canceled parse still wrote a revision")
		}
		source, err = q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: "s", CourseID: "c"})
		if err != nil || source.ParseState != "ready" || source.ParseRevision != 1 {
			t.Fatal("canceled parse changed source", source.ParseState, source.ParseRevision, err)
		}
		success := makeJob("parse-success")
		if err = service.Process(ctx, asynq.NewTask(taskType, []byte(success.ID))); err != nil {
			t.Fatal(err)
		}
		source, err = q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: "s", CourseID: "c"})
		if err != nil || source.ParseRevision != 2 || source.ParseState != "ready" {
			t.Fatal("successful reparse did not persist its new revision", source.ParseRevision, err)
		}
		old, err := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: "s", Revision: 1})
		if err != nil || len(old) != 2 {
			t.Fatal("reparse overwrote historical fragments", err)
		}
		if _, err = q.PendingCourseIndex(ctx, "c"); err != nil {
			t.Fatal("parsed source lost its durable index request", err)
		}
		if _, err = service.CreateJob(ctx, "c", "t", "index", JobInput{ProfileID: "different-profile"}); err == nil {
			t.Fatal("different index configuration silently coalesced")
		}
	})
	t.Run("interrupted_model_job_requires_explicit_retry", func(t *testing.T) {
		if _, err := db.Exec(ctx, `INSERT INTO processing_jobs(id,course_id,created_by,kind,input,state,started_at) VALUES('interrupted-generation','c','t','source_suggest','{}','running',now()-interval '16 minutes')`); err != nil {
			t.Fatal(err)
		}
		if _, err := q.ClaimProcessingJob(ctx, "interrupted-generation"); err == nil {
			t.Fatal("interrupted paid generation was automatically claimed again")
		}
		before, err := q.GetModelBudget(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(ctx, `INSERT INTO model_calls(id,course_id,actor_id,profile_id,purpose,reserved_micro_cny,created_at) VALUES('interrupted-call','c','t','test','source_suggest',3000,now()-interval '16 minutes'),('live-call','c','t','test','source_suggest',1000,now()); UPDATE model_budget SET reserved_micro_cny=reserved_micro_cny+4000`); err != nil {
			t.Fatal(err)
		}
		service := New(&Models{DB: db})
		for i := 0; i < 2; i++ {
			if err = service.recoverInterrupted(ctx); err != nil {
				t.Fatal(err)
			}
		}
		after, err := q.GetModelBudget(ctx)
		if err != nil || after.SpentMicroCny != before.SpentMicroCny+3000 || after.ReservedMicroCny != before.ReservedMicroCny+1000 {
			t.Fatal("orphan reservation not charged exactly once", after, err)
		}
		job, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: "interrupted-generation", CourseID: "c"})
		if err != nil || job.State != "failed" || !strings.Contains(job.Error, "显式重试") {
			t.Fatal("interrupted generation not failed for explicit retry", job, err)
		}
		if _, err = q.FinishModelCall(ctx, store.FinishModelCallParams{ID: "interrupted-call", State: "completed"}); err == nil {
			t.Fatal("late settlement could charge the orphan call twice")
		}
		var state string
		if err = db.QueryRow(ctx, `SELECT state FROM model_calls WHERE id='live-call'`).Scan(&state); err != nil || state != "reserved" {
			t.Fatal("live model reservation was changed", state, err)
		}
	})
	t.Run("database_claim_failures_are_not_reported_as_success", func(t *testing.T) {
		closed, err := pgxpool.NewWithConfig(ctx, config.Copy())
		if err != nil {
			t.Fatal(err)
		}
		closed.Close()
		if err = New(&Models{DB: closed}).Process(ctx, asynq.NewTask(taskType, []byte("job"))); err == nil {
			t.Fatal("database outage was acknowledged as completed work")
		}
	})
	t.Run("outbox_recovers_after_redis_and_database_claim_failure", func(t *testing.T) {
		addr := os.Getenv("TEST_REDIS_ADDR")
		if addr == "" {
			t.Skip("TEST_REDIS_ADDR must point to an isolated test Redis")
		}
		bin := t.TempDir()
		if err := os.WriteFile(filepath.Join(bin, "python"), []byte("#!/bin/sh\nprintf '%s' '{\"fragments\":[{\"body\":\"恢复测试正文\",\"locator\":{},\"quality\":\"ready\"}]}'\n"), 0700); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
		t.Setenv("REDIS_ADDR", "127.0.0.1:1")
		service := New(&Models{DB: db})
		job, err := service.CreateJob(ctx, "c", "t", "parse", JobInput{SourceID: "s"})
		if err != nil || job.State != "queued" {
			t.Fatal("Redis outage lost the durable job", err)
		}
		t.Setenv("REDIS_ADDR", addr)
		closed, err := pgxpool.NewWithConfig(ctx, config.Copy())
		if err != nil {
			t.Fatal(err)
		}
		closed.Close()
		broken := New(&Models{DB: closed})
		var first atomic.Bool
		first.Store(true)
		redis := asynq.RedisClientOpt{Addr: addr}
		server := asynq.NewServer(redis, asynq.Config{Concurrency: 1, TaskCheckInterval: 50 * time.Millisecond, ShutdownTimeout: time.Second})
		if err = server.Start(asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
			if first.Swap(false) {
				return broken.Process(ctx, task)
			}
			return service.Process(ctx, task)
		})); err != nil {
			t.Fatal(err)
		}
		defer server.Shutdown()
		client := asynq.NewClient(redis)
		defer client.Close()
		inspector := asynq.NewInspector(redis)
		defer inspector.Close()
		if err = enqueue(client, job.ID); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(10 * time.Second)
		for {
			info, err := inspector.GetQueueInfo("default")
			if err == nil && info.Archived >= 1 && !first.Load() {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("first delivery did not reach the simulated database outage", err)
			}
			time.Sleep(50 * time.Millisecond)
		}
		recoveryCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() { defer close(done); service.Recover(recoveryCtx) }()
		defer func() { cancel(); <-done }()
		deadline = time.Now().Add(2*recoveryInterval + time.Second)
		for {
			current, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: job.ID, CourseID: "c"})
			if err != nil {
				t.Fatal(err)
			}
			if current.State == "succeeded" {
				if current.Attempt != 1 {
					t.Fatal("failed database claim counted as execution", current.Attempt)
				}
				break
			}
			if current.State == "failed" || time.Now().After(deadline) {
				t.Fatal("recovery was blocked by the old queue delivery", current.State, current.Error)
			}
			time.Sleep(50 * time.Millisecond)
		}
	})
}
