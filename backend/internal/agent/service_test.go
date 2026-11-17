package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/learning"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type modelFunc func([]rag.AgentMessage, []any) (rag.AgentMessage, error)

func (f modelFunc) AgentChat(_ context.Context, _, _, _ string, m []rag.AgentMessage, t []any) (rag.AgentMessage, error) {
	return f(m, t)
}
func tool(name string, args any) rag.AgentMessage {
	var call rag.ToolCall
	call.ID = uuid.NewString()
	call.Type = "function"
	call.Function.Name = name
	call.Function.Arguments = string(raw(args))
	return rag.AgentMessage{Role: "assistant", ToolCalls: []rag.ToolCall{call}}
}
func final() rag.AgentMessage {
	return rag.AgentMessage{Role: "assistant", Content: "已核对实际回执，处理完成。"}
}

func TestPoliciesAndSchemas(t *testing.T) {
	seen := map[string]bool{}
	for _, tool := range Catalog() {
		if seen[tool.Name] {
			t.Fatal("duplicate tool", tool.Name)
		}
		seen[tool.Name] = true
		if !json.Valid(raw(tool.definition())) {
			t.Fatal(tool.Name)
		}
	}
	find := func(name string) Tool {
		for _, tool := range Catalog() {
			if tool.Name == name {
				return tool
			}
		}
		t.Fatal(name)
		return Tool{}
	}
	for _, tc := range []struct {
		name, domain, role string
		tainted, want      bool
	}{
		{"source_import", "materials", "teacher", false, true}, {"source_import", "materials", "student", false, false}, {"question_create", "questions", "teacher", true, false},
		{"submission_read", "questions", "teacher", false, false}, {"submission_read", "assessment", "teacher", false, true}, {"delegate", "materials", "teacher", false, false},
		{"source_import", "coordinator", "teacher", false, false}, {"delegate", "coordinator", "teacher", false, true}, {"path_plan", "learning", "teacher", false, false},
	} {
		if got := allowed(find(tc.name), tc.domain, tc.role, tc.tainted); got != tc.want {
			t.Errorf("%+v got %v", tc, got)
		}
	}
	if _, e := toolPath("/resources/{id}", map[string]any{"id": "../other?x=y"}); e == nil {
		t.Fatal("path traversal allowed")
	}
	if validate(find("topic_create").Schema, map[string]any{"title": "x", "active": true, "sql": "delete"}) == nil {
		t.Fatal("unknown field accepted")
	}
	if e := validateAnswers(raw([]map[string]any{{"key": "choice", "kind": "select", "required": true, "options": []string{"A", "B"}}}), map[string]any{"choice": "invented"}); e == nil {
		t.Fatal("invented answer accepted")
	}
	if csvCell(" \t=cmd()") != "' \t=cmd()" {
		t.Fatal("spreadsheet formula not escaped")
	}
	clean := string(raw(safeData([]byte(`{"storage_path":"secret","data":{"session_hash":"secret","title":"safe"}}`))))
	if strings.Contains(clean, "secret") || !strings.Contains(clean, "safe") {
		t.Fatal(clean)
	}
	if strings.Contains(string(raw(find("course_context").Schema)), `"required":null`) {
		t.Fatal("empty required must be a JSON-schema array")
	}
	if allowed(find("job_wait"), "coordinator", "teacher", false) {
		t.Fatal("coordinator must delegate domain jobs")
	}
	args := map[string]any{"id": "s", "title": "title", "fragment_ids": []any{"f"}, "knowledge_point_id": nil}
	omitOptionalNulls(find("source_publish").Schema, args)
	if e := validate(find("source_publish").Schema, args); e != nil {
		t.Fatal("optional null should be omitted before validation", e)
	}
	args["title"] = nil
	omitOptionalNulls(find("source_publish").Schema, args)
	if validate(find("source_publish").Schema, args) == nil {
		t.Fatal("required null accepted")
	}
	if resumable(runtime{Frames: []frame{{}}, WriteUnknown: true}) || resumable(runtime{Frames: []frame{{}}, ModelCalls: maxModelCalls}) || !resumable(runtime{Frames: []frame{{}}}) {
		t.Fatal("resume policy inconsistent")
	}
	f := frame{}
	result := map[string]any{"response": map[string]any{"data": map[string]any{"id": "job", "kind": "parse", "state": "queued"}}}
	trackPendingJobs(&f, result)
	trackPendingJobs(&f, result)
	if len(f.PendingJobs) != 1 || f.PendingJobs[0] != "job" {
		t.Fatal("receipt recovery must retain one pending job", f.PendingJobs)
	}
	in := delegatedInput([]rag.AgentMessage{{Role: "user", Content: "旧轮要求"}, {Role: "tool", Content: "其他专家私有回执"}, {Role: "user", Content: "D3只能2分或0分；不可给1分"}, {Role: "assistant", Content: "摘要"}}, "修改D3")
	if !strings.Contains(in, "D3只能2分或0分；不可给1分") || !strings.Contains(in, "修改D3") || strings.Contains(in, "旧轮要求") || strings.Contains(in, "私有回执") {
		t.Fatal("delegation must preserve exact current requirements without inheriting tool transcripts", in)
	}
	ask := tool("request_input", map[string]any{})
	in = delegatedInput([]rag.AgentMessage{{Role: "user", Content: "先询问资料名称再导入"}, ask, {Role: "tool", ToolCallID: ask.ToolCalls[0].ID, Content: `{"title":"已回答的资料名称"}`}, {Role: "tool", ToolCallID: "other", Content: "其他专家私有内容"}}, "导入资料")
	if !strings.Contains(in, `{"title":"已回答的资料名称"}`) || strings.Contains(in, "私有内容") {
		t.Fatal("delegation lost a validated user answer or copied unrelated tool data", in)
	}
}

// This suite uses a deterministic model protocol fixture, not a claimed real
// AI evaluation. All sessions, policies, business writes and checkpoints are real.
func TestHarnessBusinessLoop(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	t.Setenv("PUBLIC_ORIGIN", "")
	t.Setenv("RAG_ENABLED", "true")
	t.Setenv("MODEL_PROFILES_PATH", "../../config/models.json")
	t.Setenv("MATERIALS_DIR", t.TempDir())
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("agent_test_%d", time.Now().UnixNano())
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
	migrations, _ := filepath.Glob("../../db/migrations/*.sql")
	for _, path := range migrations {
		b, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		sql := strings.Split(strings.Split(string(b), "-- +goose Up")[1], "-- +goose Down")[0]
		if _, e = db.Exec(ctx, sql); e != nil {
			t.Fatal(path, e)
		}
	}
	must := func(sql string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	must(`INSERT INTO users(id,display_name,role) VALUES('teacher','Teacher','teacher'),('other','Other','teacher'),('student','Student','student'),('peer','Peer','student');INSERT INTO courses(id,title,teacher_id,status) VALUES('course','Agent test','teacher','published'),('foreign','Foreign','other','published');INSERT INTO enrollments(course_id,student_id) VALUES('course','student'),('course','peer')`)
	tokens := map[string]string{"teacher": strings.Repeat("a", 64), "other": strings.Repeat("b", 64), "student": strings.Repeat("c", 64), "peer": strings.Repeat("d", 64)}
	for user, token := range tokens {
		must("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", rag.Hash(token), user)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	auth := identity.New(db, false)
	auth.Register(router.Group("/api/v1"))
	learning.Register(router.Group("/api/v1"), db, auth)
	s := New(db, nil, identity.Gateway{Handler: router})
	s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) { return final(), nil })
	s.Register(router.Group("/api/v1"), auth)
	base := "/api/v1/learning/courses/course/agent"
	request := func(user, method, path string, body any, status int) json.RawMessage {
		t.Helper()
		req := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(raw(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", rag.Hash("haji-csrf:"+tokens[user]))
		req.AddCookie(&http.Cookie{Name: identity.CookieName, Value: tokens[user]})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s got %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		var v struct {
			Data json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &v)
		return v.Data
	}
	objectID := func(b json.RawMessage) string {
		var v struct {
			ID    string `json:"id"`
			RunID string `json:"run_id"`
		}
		_ = json.Unmarshal(b, &v)
		if v.ID != "" {
			return v.ID
		}
		return v.RunID
	}
	conversation := func(user, mode string) string {
		return objectID(request(user, "POST", base+"/conversations", map[string]any{"mode": mode}, 200))
	}
	send := func(user, cid string) string {
		return objectID(request(user, "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "按要求处理当前课程", "request_id": uuid.NewString()}, 200))
	}
	tick := func(id string) store.AgentRun {
		t.Helper()
		if e := s.process(ctx, id); e != nil {
			t.Fatal(e)
		}
		r, e := s.Q.GetAgentRun(ctx, id)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	drive := func(id, want string) {
		t.Helper()
		for i := 0; i < 24; i++ {
			r := tick(id)
			if r.State == want {
				return
			}
			if !active(r.State) {
				t.Fatalf("run %s want %s got %s error %s", id, want, r.State, r.Error)
			}
		}
		t.Fatalf("run never reached %s", want)
	}
	pending := func(cid string) store.AgentRequest {
		t.Helper()
		rs, e := s.Q.ListAgentRequests(ctx, cid)
		if e != nil {
			t.Fatal(e)
		}
		for _, r := range rs {
			if r.State == "pending" {
				return r
			}
		}
		t.Fatal("missing request")
		return store.AgentRequest{}
	}
	readCount := func(table, where string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE "+where, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}

	t.Run("session_course_and_csrf_guards", func(t *testing.T) {
		cid := conversation("teacher", "auto-review")
		request("other", "GET", base+"/conversations/"+cid, nil, 403)
		request("student", "GET", base+"/conversations/"+cid, nil, 404)
		request("student", "POST", base+"/conversations", map[string]any{"mode": "full-access"}, 422)
		req := httptest.NewRequest("POST", "http://localhost"+base+"/conversations", strings.NewReader(`{}`))
		req.AddCookie(&http.Cookie{Name: identity.CookieName, Value: tokens["teacher"]})
		req.Header.Set("X-Agent-Session", rag.Hash(tokens["teacher"]))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatal("spoof header bypassed CSRF", w.Code)
		}
		result, e := s.Gateway.Invoke(ctx, rag.Hash(tokens["student"]), "POST", "/api/v1/learning/courses/course/resources", "application/json", strings.NewReader(`{"title":"forbidden"}`))
		if e != nil || result.Status != 403 {
			t.Fatal("gateway bypassed role", e, result.Status)
		}
		result, e = s.Gateway.Invoke(ctx, rag.Hash(tokens["teacher"]), "GET", "/api/v1/learning/courses/foreign/resources", "application/json", nil)
		if e != nil || result.Status != 403 {
			t.Fatal("gateway bypassed course", e, result.Status)
		}
	})
	t.Run("delegated_durable_input_actual_draft_and_idempotence", func(t *testing.T) {
		calls := 0
		s.Model = modelFunc(func(messages []rag.AgentMessage, _ []any) (rag.AgentMessage, error) {
			calls++
			switch calls {
			case 1:
				return tool("delegate", map[string]any{"domain": "materials", "goal": "创建教师需要的学习资料草稿"}), nil
			case 2:
				if len(messages) != 2 {
					t.Fatal("specialist inherited transcript")
				}
				return tool("request_input", map[string]any{"prompt": "请提供标题", "fields": []any{map[string]any{"key": "title", "label": "资料标题", "kind": "text", "required": true}}}), nil
			case 3:
				return tool("resource_create", map[string]any{"title": "Agent实际草稿", "content": "真实保存的课程资料", "source_note": "教师原创", "locator": "第一段"}), nil
			default:
				return final(), nil
			}
		})
		cid := conversation("teacher", "auto-review")
		rid := send("teacher", cid)
		drive(rid, "waiting_input")
		// Recreate the service against the same DB to verify persistence, not a RAM pause.
		restarted := New(db, nil, s.Gateway)
		restarted.Model = s.Model
		s = restarted
		req := pending(cid)
		request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve", "values": map[string]any{}}, 422)
		request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve", "values": map[string]any{"title": "Agent实际草稿"}}, 200)
		drive(rid, "succeeded")
		if readCount("resources", "title='Agent实际草稿'") != 1 {
			t.Fatal("business write missing or duplicated")
		}
		run, _ := s.Q.GetAgentRun(ctx, rid)
		body := map[string]any{"content": "重复投递", "request_id": run.RequestID}
		if got := objectID(request("teacher", "POST", base+"/conversations/"+cid+"/messages", body, 200)); got != rid {
			t.Fatal("request not idempotent")
		}
		snapshot := string(request("teacher", "GET", base+"/conversations/"+cid, nil, 200))
		if strings.Contains(snapshot, "session_hash") || strings.Contains(snapshot, "reasoning_content") {
			t.Fatal("runtime leaked")
		}
	})
	t.Run("full_access_still_requires_formal_confirmation_and_stale_snapshot_rejected", func(t *testing.T) {
		must("INSERT INTO resources(id,course_id,title,content,locator,source_note,created_by) VALUES('approval-resource','course','Approval','Before','1','教师原创','teacher')")
		calls := 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			if calls == 1 {
				return tool("delegate", map[string]any{"domain": "materials", "goal": "发布指定资料"}), nil
			}
			if calls == 2 {
				return tool("resource_publish", map[string]any{"id": "approval-resource"}), nil
			}
			return final(), nil
		})
		cid := conversation("teacher", "full-access")
		rid := send("teacher", cid)
		drive(rid, "waiting_approval")
		req := pending(cid)
		if readCount("resources", "id='approval-resource' AND status='draft'") != 1 {
			t.Fatal("formal confirmation bypassed")
		}
		must("UPDATE resources SET content='Changed by teacher' WHERE id='approval-resource'")
		request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve"}, 200)
		drive(rid, "succeeded")
		if readCount("resources", "id='approval-resource' AND status='draft'") != 1 {
			t.Fatal("stale approval executed")
		}
	})
	t.Run("readonly_cancel_and_unknown_write_are_not_replayed", func(t *testing.T) {
		calls := 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			if calls == 1 {
				return tool("delegate", map[string]any{"domain": "materials", "goal": "创建资料"}), nil
			}
			if calls == 2 {
				return tool("resource_create", map[string]any{"title": "should-not-exist", "content": "x", "locator": "1", "source_note": "teacher"}), nil
			}
			return final(), nil
		})
		cid := conversation("teacher", "read-only")
		rid := send("teacher", cid)
		drive(rid, "succeeded")
		if readCount("resources", "title='should-not-exist'") != 0 {
			t.Fatal("read-only wrote")
		}
		cid = conversation("teacher", "auto-review")
		rid = send("teacher", cid)
		request("teacher", "POST", base+"/runs/"+rid+"/cancel", map[string]any{}, 200)
		drive(rid, "canceled")
		// Crash window fixture: write was dispatched but no receipt was stored.
		cid = conversation("teacher", "auto-review")
		rid = send("teacher", cid)
		run, _ := s.Q.GetAgentRun(ctx, rid)
		var rt runtime
		_ = json.Unmarshal(run.Runtime, &rt)
		msg := tool("resource_create", map[string]any{"title": "unknown", "content": "x", "locator": "1", "source_note": "teacher"})
		rt.Frames = []frame{{Domain: "materials", Calls: msg.ToolCalls, Turn: 1}}
		key := stepKey(run, rt, msg.ToolCalls[0])
		_, e := s.Q.CreateAgentStep(ctx, store.CreateAgentStepParams{ID: key, RunID: rid, Agent: "materials", Tool: "resource_create", Arguments: raw(map[string]any{})})
		if e != nil {
			t.Fatal(e)
		}
		if e = s.stepResult(ctx, run, key, "executing", map[string]any{}); e != nil {
			t.Fatal(e)
		}
		if e = s.checkpoint(ctx, run, &rt, "running", ""); e != nil {
			t.Fatal(e)
		}
		drive(rid, "unknown")
		request("teacher", "POST", base+"/runs/"+rid+"/resume", map[string]any{}, 409)
		if readCount("resources", "title='unknown'") != 0 {
			t.Fatal("unknown write replayed")
		}
	})
	t.Run("attachments_import_and_job_wait", func(t *testing.T) {
		cid := conversation("teacher", "auto-review")
		var payload bytes.Buffer
		w := multipart.NewWriter(&payload)
		part, _ := w.CreateFormFile("file", "source.txt")
		_, _ = io.WriteString(part, "边界值分析：18至60含端点，测试17、18、19、59、60、61。")
		_ = w.Close()
		req := httptest.NewRequest("POST", "http://localhost"+base+"/conversations/"+cid+"/attachments", &payload)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.Header.Set("X-CSRF-Token", rag.Hash("haji-csrf:"+tokens["teacher"]))
		req.AddCookie(&http.Cookie{Name: identity.CookieName, Value: tokens["teacher"]})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != 200 {
			t.Fatal(response.Body.String())
		}
		var uploaded struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &uploaded)
		calls := 0
		s.Model = modelFunc(func(m []rag.AgentMessage, _ []any) (rag.AgentMessage, error) {
			calls++
			switch calls {
			case 1:
				return tool("delegate", map[string]any{"domain": "materials", "goal": "导入附件"}), nil
			case 2:
				return tool("source_import", map[string]any{"attachment_id": uploaded.Data.ID, "source_note": "教师上传测试原件", "allow_derived": false}), nil
			case 3:
				var id string
				if e := db.QueryRow(ctx, "SELECT id FROM processing_jobs WHERE kind='parse' ORDER BY created_at DESC LIMIT 1").Scan(&id); e != nil {
					t.Fatal(e)
				}
				return tool("job_wait", map[string]any{"id": id}), nil
			default:
				return final(), nil
			}
		})
		rid := objectID(request("teacher", "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "导入附件", "request_id": uuid.NewString(), "attachment_ids": []string{uploaded.Data.ID}}, 200))
		drive(rid, "waiting_job")
		if calls != 2 {
			t.Fatal("model resumed before imported parsing job finished", calls)
		}
		if readCount("material_sources", "filename='source.txt'") != 1 {
			t.Fatal("attachment not imported")
		}
		must("UPDATE processing_jobs SET state='succeeded',output='{}' WHERE kind='parse'")
		drive(rid, "succeeded")
		steps, err := s.Q.ListAgentSteps(ctx, cid)
		if err != nil || !strings.Contains(string(steps[0].Result), "receipts") || !strings.Contains(string(steps[0].Result), "source_import") {
			t.Fatal("delegation lost business receipts", err)
		}
		request("student", "GET", base+"/conversations/"+cid+"/attachments/"+uploaded.Data.ID+"/file", nil, 404)
		s.Model = modelFunc(func(messages []rag.AgentMessage, _ []any) (rag.AgentMessage, error) {
			if !strings.Contains(string(raw(messages)), uploaded.Data.ID) {
				t.Fatal("follow-up lost the server-registered attachment metadata")
			}
			return final(), nil
		})
		drive(send("teacher", cid), "succeeded")
	})
	t.Run("learner_context_blocks_question_drafting_and_student_tools", func(t *testing.T) {
		calls := 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			switch calls {
			case 1:
				return tool("delegate", map[string]any{"domain": "learning", "goal": "读取已发布学情"}), nil
			case 2:
				return tool("evidence_read", map[string]any{}), nil
			default:
				return final(), nil
			}
		})
		cid := conversation("teacher", "auto-review")
		rid := send("teacher", cid)
		drive(rid, "succeeded")
		conv, e := s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: cid, CourseID: "course", OwnerID: "teacher"})
		if e != nil || !conv.LearnerContext {
			t.Fatal("taint not persisted", e)
		}
		calls = 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			if calls == 1 {
				return tool("delegate", map[string]any{"domain": "questions", "goal": "起草标准"}), nil
			}
			return final(), nil
		})
		rid = send("teacher", cid)
		drive(rid, "succeeded")
		steps, _ := s.Q.ListAgentSteps(ctx, cid)
		if steps[len(steps)-1].State != "denied" {
			t.Fatal("questions received learner context")
		}
		calls = 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			if calls == 1 {
				return tool("source_import", map[string]any{"attachment_id": "x", "source_note": "x", "allow_derived": false}), nil
			}
			return final(), nil
		})
		cid = conversation("student", "auto-review")
		rid = send("student", cid)
		drive(rid, "succeeded")
		steps, _ = s.Q.ListAgentSteps(ctx, cid)
		if len(steps) != 1 || steps[0].State != "denied" {
			t.Fatal("student import allowed")
		}
		freshID := conversation("teacher", "auto-review")
		fresh, err := s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: freshID, CourseID: "course", OwnerID: "teacher"})
		if err != nil {
			t.Fatal(err)
		}
		rt := runtime{}
		if err := s.checkJobs(ctx, fresh, &rt, "assessment", map[string]any{"kind": "grade"}, "jobs_list"); err != nil || !rt.Tainted {
			t.Fatal("grading job list did not mark learner context", err)
		}
		fresh, err = s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: freshID, CourseID: "course", OwnerID: "teacher"})
		if err != nil || !fresh.LearnerContext {
			t.Fatal("grading job list taint was not persistent", err)
		}
		calls = 0
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			if calls == 1 {
				return tool("delegate", map[string]any{"domain": "assessment", "goal": "查看本人有权访问的作业"}), nil
			}
			if calls == 2 {
				return tool("assignments_list", map[string]any{}), nil
			}
			return final(), nil
		})
		cid = conversation("student", "read-only")
		drive(send("student", cid), "succeeded")
		steps, err = s.Q.ListAgentSteps(ctx, cid)
		if err != nil || len(steps) != 2 || steps[1].State != "succeeded" {
			t.Fatal("student could not query authorized assignments", err)
		}
	})
	t.Run("grading_confirmation_release_export_student_feedback_loop", func(t *testing.T) {
		assignment := objectID(request("teacher", "POST", "/api/v1/learning/courses/course/assignments", map[string]any{"title": "Harness评分闭环", "type": "subjective", "questions": []any{map[string]any{"prompt": "说明范围外测试目的", "max_score": 10, "rubric": "检查拒绝范围外输入"}}}, 200))
		var questionID string
		if e := db.QueryRow(ctx, "SELECT id FROM questions WHERE assignment_id=$1", assignment).Scan(&questionID); e != nil {
			t.Fatal(e)
		}
		standard := objectID(request("teacher", "POST", "/api/v1/learning/courses/course/questions/"+questionID+"/rubrics", map[string]any{"criteria": []any{map[string]any{"id": "D1", "title": "测试目的", "max_score": 10, "rule": "说明检查系统拒绝超范围输入得10分，否则0分"}}}, 200))
		request("teacher", "POST", "/api/v1/learning/courses/course/rubrics/"+standard+"/confirm", map[string]any{}, 200)
		request("teacher", "POST", "/api/v1/learning/courses/course/assignments/"+assignment+"/state", map[string]any{"state": "published"}, 200)
		submission := objectID(request("student", "POST", "/api/v1/learning/courses/course/assignments/"+assignment+"/submissions", map[string]any{"question_id": questionID, "answer_text": "检查系统是否拒绝超范围输入", "request_id": uuid.NewString()}, 200))
		calls := 0
		revision := ""
		s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
			calls++
			switch calls {
			case 1:
				return tool("delegate", map[string]any{"domain": "assessment", "goal": "生成指定提交的评分修订并逐次确认发布和导出"}), nil
			case 2:
				return tool("grade_save", map[string]any{"id": submission, "score": 10, "feedback": "=需按表格纯文本导出", "rubric_id": standard, "points": []any{map[string]any{"criterion_id": "D1", "score": 10, "feedback": "已说明拒绝目的", "quote": "检查系统是否拒绝超范围输入"}}}), nil
			case 3:
				if e := db.QueryRow(ctx, "SELECT id FROM grading_revisions WHERE submission_id=$1", submission).Scan(&revision); e != nil {
					t.Fatal(e)
				}
				return tool("grade_state", map[string]any{"id": revision, "state": "confirmed"}), nil
			case 4:
				return tool("grade_state", map[string]any{"id": revision, "state": "released"}), nil
			case 5:
				return tool("feedback_export", map[string]any{}), nil
			default:
				return final(), nil
			}
		})
		cid := conversation("teacher", "full-access")
		rid := send("teacher", cid)
		drive(rid, "waiting_approval")
		if b := string(request("student", "GET", "/api/v1/learning/courses/course/evidence", nil, 200)); strings.Contains(b, submission) {
			t.Fatal("draft leaked to student")
		}
		for i := 0; i < 2; i++ {
			req := pending(cid)
			if !strings.Contains(string(req.Snapshot), "检查系统是否拒绝") {
				t.Fatal("approval lacks actual answer/grade snapshot")
			}
			request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve"}, 200)
			if i == 0 {
				drive(rid, "waiting_approval")
			} else {
				drive(rid, "succeeded")
			}
		}
		if b := string(request("student", "GET", "/api/v1/learning/courses/course/evidence", nil, 200)); !strings.Contains(b, submission) || !strings.Contains(b, `"score":10`) {
			t.Fatal("released feedback not visible", b)
		}
		files, e := s.Q.ListAgentAttachments(ctx, cid)
		if e != nil || len(files) != 1 || files[0].Kind != "export" {
			t.Fatal("feedback file missing", e)
		}
		file, e := s.Q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: files[0].ID, ConversationID: cid})
		if e != nil {
			t.Fatal(e)
		}
		body, e := os.ReadFile(filepath.Join(attachmentDir(), file.StoragePath))
		if e != nil || !strings.Contains(string(body), "'=需按表格纯文本导出") {
			t.Fatal("export lost feedback or formula escape", e)
		}
		// A reconnect receives only events after its durable cursor.
		events, e := s.Q.ListAgentEvents(ctx, store.ListAgentEventsParams{ConversationID: cid})
		if e != nil || len(events) < 2 {
			t.Fatal("events missing", e)
		}
		streamCtx, stop := context.WithCancel(ctx)
		defer stop()
		req := httptest.NewRequest("GET", "http://localhost"+base+"/conversations/"+cid+"/events", nil).WithContext(streamCtx)
		req.AddCookie(&http.Cookie{Name: identity.CookieName, Value: tokens["teacher"]})
		req.Header.Set("Last-Event-ID", fmt.Sprint(events[0].ID))
		record := httptest.NewRecorder()
		timer := time.AfterFunc(30*time.Millisecond, stop)
		router.ServeHTTP(record, req)
		timer.Stop()
		if strings.Contains(record.Body.String(), fmt.Sprintf("id: %d\n", events[0].ID)) || !strings.Contains(record.Body.String(), fmt.Sprintf("id: %d\n", events[1].ID)) {
			t.Fatal("SSE cursor replay broken")
		}
	})
	t.Run("long_conversation_keeps_latest_runs_and_complete_receipts", func(t *testing.T) {
		cid := conversation("teacher", "auto-review")
		must(`INSERT INTO agent_runs(id,conversation_id,request_id,session_hash,state,created_at)
		 SELECT 'history-'||$1||'-'||n,$1,'request-'||n,'fixture','succeeded',now()+n*interval '1 second' FROM generate_series(1,31) n`, cid)
		must(`INSERT INTO agent_steps(id,run_id,agent,tool,arguments,state)
		 SELECT r.id||'-step-'||n,r.id,'learning','course_context','{}','succeeded'
		 FROM agent_runs r CROSS JOIN generate_series(1,40) n WHERE r.conversation_id=$1`, cid)
		must(`INSERT INTO agent_requests(id,run_id,step_id,kind,prompt,fields,state)
		 SELECT r.id||'-input',r.id,r.id||'-step-1','input','已回答的问题','[]','answered'
		 FROM agent_runs r WHERE r.conversation_id=$1`, cid)
		var snapshot struct {
			Runs []struct {
				ID        string `json:"id"`
				RequestID string `json:"request_id"`
			} `json:"runs"`
			Steps    []store.AgentStep    `json:"steps"`
			Requests []store.AgentRequest `json:"requests"`
		}
		body := request("teacher", "GET", base+"/conversations/"+cid, nil, 200)
		if e := json.Unmarshal(body, &snapshot); e != nil {
			t.Fatal(e)
		}
		if len(snapshot.Runs) != 30 || len(snapshot.Steps) != 1200 || len(snapshot.Requests) != 30 {
			t.Fatalf("latest window incomplete: runs=%d steps=%d requests=%d", len(snapshot.Runs), len(snapshot.Steps), len(snapshot.Requests))
		}
		oldest, newest := "history-"+cid+"-1", "history-"+cid+"-31"
		if snapshot.Runs[0].ID != newest || snapshot.Runs[0].RequestID != "request-31" {
			t.Fatal("missing latest run or request correlation")
		}
		for _, step := range snapshot.Steps {
			if step.RunID == oldest {
				t.Fatal("old receipts displaced current receipts")
			}
		}
		for _, r := range snapshot.Requests {
			if r.RunID == oldest {
				t.Fatal("requests outside visible run window")
			}
		}
	})
	t.Run("expired_session_prevents_background_work", func(t *testing.T) {
		cid := conversation("teacher", "auto-review")
		rid := send("teacher", cid)
		must("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", rag.Hash(tokens["teacher"]))
		drive(rid, "failed")
	})
}
