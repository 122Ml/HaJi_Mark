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
type streamFunc func(func(string) error) (rag.AgentMessage, error)

func (f streamFunc) AgentChat(_ context.Context, _, _, _ string, _ []rag.AgentMessage, _ []any) (rag.AgentMessage, error) {
	return f(func(string) error { return nil })
}
func (f streamFunc) AgentChatStream(_ context.Context, _, _, _ string, _ []rag.AgentMessage, _ []any, emit func(string) error) (rag.AgentMessage, error) {
	return f(emit)
}

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
		{"question_editor", "questions", "teacher", true, false}, {"knowledge_editor", "materials", "student", false, false}, {"answer_submit", "assessment", "teacher", false, false},
		{"paper_editor", "materials", "teacher", true, false}, {"paper_split", "materials", "teacher", true, false},
	} {
		if got := allowed(find(tc.name), tc.domain, tc.role, tc.tainted); got != tc.want {
			t.Errorf("%+v got %v", tc, got)
		}
	}
	if _, e := toolPath("/resources/{id}", map[string]any{"id": "../other?x=y"}); e == nil {
		t.Fatal("path traversal allowed")
	}
	if p, e := toolPath("/assignments/{id}/questions/{question_id}/draft", map[string]any{"id": "a1", "question_id": "q1"}); e != nil || p != "/assignments/a1/questions/q1/draft" {
		t.Fatalf("question_id placeholder broken: path=%q err=%v", p, e)
	}
	if _, e := toolPath("/assignments/{id}/questions/{unknown}", map[string]any{"id": "a1"}); e == nil {
		t.Fatal("unreplaced placeholder allowed")
	}
	for _, spec := range Catalog() {
		for _, tmpl := range []string{spec.Path, spec.Snapshot} {
			if !strings.Contains(tmpl, "{") {
				continue
			}
			if _, e := toolPath(tmpl, map[string]any{"id": "id1", "submission_id": "sub1", "question_id": "q1"}); e != nil {
				t.Fatalf("tool %s template %q failed placeholder check: %v", spec.Name, tmpl, e)
			}
		}
	}
	if validate(find("topic_create").Schema, map[string]any{"title": "x", "active": true, "sql": "delete"}) == nil {
		t.Fatal("unknown field accepted")
	}
	if validate(find("topic_create").Schema, map[string]any{"title": "bad\x00title", "active": true}) == nil {
		t.Fatal("NUL byte accepted")
	}
	if d, ok := jobDomain("parse,grade"); ok || d != "" {
		t.Fatalf("comma-separated unknown kind allowed: %q %v", d, ok)
	}
	if d, ok := jobDomain("unknown_kind"); ok || d != "" {
		t.Fatalf("unknown kind allowed: %q %v", d, ok)
	}
	if e := validateAnswers(raw([]map[string]any{{"key": "choice", "kind": "select", "required": true, "options": []string{"A", "B"}}}), map[string]any{"choice": "invented"}); e == nil {
		t.Fatal("invented answer accepted")
	}
	if e := validateAnswers(raw([]map[string]any{{"key": "multi", "kind": "multiselect", "required": true, "options": []string{"A", "B"}}}), map[string]any{"multi": []any{"A", "A"}}); e == nil {
		t.Fatal("duplicate multiselect accepted")
	}
	if e := validateAnswers(raw([]map[string]any{{"key": "opt", "kind": "select", "required": false, "options": []string{"A", "B"}}}), map[string]any{"opt": ""}); e != nil {
		t.Fatalf("optional empty select rejected: %v", e)
	}
	hugeSnap := raw(map[string]any{"tool": "source_correct", "mode": "auto-review", "arguments": map[string]any{"id": "s1"}, "editor": map[string]any{"kind": "source", "id": "s1"}, "business_hash": "abc", "before": map[string]any{"blob": strings.Repeat("a", 120000)}})
	cleanedSnap, ok := safeSnapshot(hugeSnap).(map[string]any)
	if !ok || cleanedSnap["arguments"] == nil || cleanedSnap["editor"] == nil || cleanedSnap["business_hash"] != "abc" {
		t.Fatalf("safeSnapshot wiped required metadata: %#v", cleanedSnap)
	}
	if _, e := safeAttachmentPath("../escape.txt"); e == nil {
		t.Fatal("attachment path traversal allowed")
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
		if os.Getenv("REQUIRE_INTEGRATION_TESTS") == "1" {
			t.Fatal("TEST_DATABASE_URL must be set when REQUIRE_INTEGRATION_TESTS=1")
		}
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
	t.Run("workspace_context_is_authorized_persisted_and_tainted_before_runtime", func(t *testing.T) {
		must(`INSERT INTO resources(id,course_id,title,content,source_note,locator,created_by,status) VALUES('context-public','course','public','visible','fixture','1','teacher','published'),('context-draft','course','private','secret','fixture','1','teacher','draft'),('context-foreign','foreign','foreign','secret','fixture','1','other','published')`)
		cid := conversation("student", "read-only")
		for _, id := range []string{"context-draft", "context-foreign", "missing"} {
			request("student", "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "解释当前资料", "request_id": uuid.NewString(), "context": map[string]string{"kind": "resource", "id": id}}, 422)
		}
		request("student", "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "解释当前资料", "request_id": uuid.NewString(), "context": map[string]string{"kind": "unknown", "id": "context-public"}}, 422)
		rid := objectID(request("student", "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "解释当前资料", "request_id": uuid.NewString(), "context": map[string]string{"kind": "resource", "id": "context-public"}}, 200))
		run, err := s.Q.GetAgentRun(ctx, rid)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(run.Runtime), "context-public") || strings.Contains(string(run.Runtime), "context-draft") {
			t.Fatal("verified reference missing or untrusted data attached")
		}
		messages, err := s.Q.ListAgentMessages(ctx, cid)
		if err != nil || len(messages) != 1 || !strings.Contains(messages[0].Content, "服务端已核验") {
			t.Fatal("business reference not durable", err)
		}
		must(`INSERT INTO interventions(id,course_id,student_id,title,description,teacher_id) VALUES('context-task','course','student','task','fixture','teacher')`)
		cid = conversation("teacher", "auto-review")
		rid = objectID(request("teacher", "POST", base+"/conversations/"+cid+"/messages", map[string]any{"content": "检查任务", "request_id": uuid.NewString(), "context": map[string]string{"kind": "intervention", "id": "context-task"}}, 200))
		run, err = s.Q.GetAgentRun(ctx, rid)
		if err != nil {
			t.Fatal(err)
		}
		var rt runtime
		_ = json.Unmarshal(run.Runtime, &rt)
		conv, err := s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: cid, CourseID: "course", OwnerID: "teacher"})
		if err != nil || !rt.Tainted || !conv.LearnerContext {
			t.Fatal("learner context must be marked before model or tools", err)
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
		 SELECT 'history-'||$1||'-'||n,$1,'request-'||n,'fixture','succeeded',now()+n*interval '1 second' FROM generate_series(1,65) n`, cid)
		must(`UPDATE agent_runs SET updated_at=created_at WHERE conversation_id=$1`, cid)
		must(`INSERT INTO agent_messages(id,conversation_id,role,content,created_at)
		 SELECT 'message-'||$1||'-'||n,$1,'user','history message '||n,now()+n*interval '1 second' FROM generate_series(1,225)n`, cid)
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
			Messages []store.AgentMessage `json:"messages"`
			HasMore  bool                 `json:"has_more"`
			Cursor   string               `json:"next_cursor"`
		}
		body := request("teacher", "GET", base+"/conversations/"+cid, nil, 200)
		if e := json.Unmarshal(body, &snapshot); e != nil {
			t.Fatal(e)
		}
		if len(snapshot.Runs) != 10 || len(snapshot.Steps) != 400 || len(snapshot.Requests) != 10 || len(snapshot.Messages) != 50 || !snapshot.HasMore {
			t.Fatalf("latest window incomplete: runs=%d steps=%d requests=%d messages=%d", len(snapshot.Runs), len(snapshot.Steps), len(snapshot.Requests), len(snapshot.Messages))
		}
		oldest, newest := "history-"+cid+"-1", "history-"+cid+"-65"
		if snapshot.Runs[0].ID != newest || snapshot.Runs[0].RequestID != "request-65" {
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
		messages, runs := map[string]bool{}, map[string]bool{}
		pages := 0
		for {
			for _, m := range snapshot.Messages {
				if messages[m.ID] {
					t.Fatal("message duplicated across pages", m.ID)
				}
				messages[m.ID] = true
			}
			for _, r := range snapshot.Runs {
				runs[r.ID] = true
			}
			if len(snapshot.Steps) != len(snapshot.Runs)*40 || len(snapshot.Requests) != len(snapshot.Runs) {
				t.Fatal("paged receipts incomplete")
			}
			pages++
			if !snapshot.HasMore {
				break
			}
			if pages > 10 || snapshot.Cursor == "" {
				t.Fatal("cursor did not advance")
			}
			body = request("teacher", "GET", base+"/conversations/"+cid+"?before="+snapshot.Cursor, nil, 200)
			if e := json.Unmarshal(body, &snapshot); e != nil {
				t.Fatal(e)
			}
		}
		if len(messages) != 225 || len(runs) != 65 {
			t.Fatal("history truncated", len(messages), len(runs))
		}
		request("teacher", "GET", base+"/conversations/"+cid+"?before=not-valid", nil, 422)
		// Pending approvals remain actionable even when their run is older than the page.
		must("UPDATE agent_runs SET state='waiting_input' WHERE id=$1", oldest)
		body = request("teacher", "GET", base+"/conversations/"+cid, nil, 200)
		if !strings.Contains(string(body), oldest+"-input") {
			t.Fatal("active old run hidden")
		}
		must("UPDATE agent_runs SET state='succeeded',updated_at=now()+interval '1 day' WHERE id=$1", oldest)
		body = request("teacher", "GET", base+"/conversations/"+cid, nil, 200)
		if !strings.Contains(string(body), oldest+"-input") {
			t.Fatal("resumed terminal run hidden")
		}
		must(`INSERT INTO agent_conversations(id,course_id,owner_id,title,mode) SELECT 'list-'||$1||'-'||n,'course','teacher','searchable-'||n,'read-only' FROM generate_series(1,35)n`, cid)
		var conversations []store.AgentConversation
		_ = json.Unmarshal(request("teacher", "GET", base+"/conversations?search=searchable-&size=10&offset=30", nil, 200), &conversations)
		if len(conversations) != 5 {
			t.Fatal("conversation search/paging", len(conversations))
		}
	})
	t.Run("csv_attachment_preview_confirmation_and_conversation_scope", func(t *testing.T) {
		business := "/api/v1/learning/courses/course"
		must("UPDATE users SET username='csv-student',password_hash='test-fixture-no-login' WHERE id='student'")
		assignment := objectID(request("teacher", "POST", business+"/assignments", map[string]any{"title": "CSV附件测试", "questions": []any{map[string]any{"prompt": "说明测试目的", "max_score": 10, "rubric": "说明拒绝超范围输入"}}}, 200))
		var question string
		if e := db.QueryRow(ctx, "SELECT id FROM questions WHERE assignment_id=$1", assignment).Scan(&question); e != nil {
			t.Fatal(e)
		}
		standard := objectID(request("teacher", "POST", business+"/questions/"+question+"/rubrics", map[string]any{"criteria": []any{map[string]any{"id": "D1", "title": "目的", "max_score": 10, "rule": "检查系统是否拒绝超范围输入"}}}, 200))
		request("teacher", "POST", business+"/rubrics/"+standard+"/confirm", map[string]any{}, 200)
		request("teacher", "POST", business+"/assignments/"+assignment+"/state", map[string]any{"state": "published"}, 200)
		cid := conversation("teacher", "full-access")
		csv := "username,answer_text\r\ncsv-student,\"范围外输入应被拒绝\"\r\n"
		if e := os.MkdirAll(attachmentDir(), 0700); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(filepath.Join(attachmentDir(), "answers.csv"), []byte(csv), 0600); e != nil {
			t.Fatal(e)
		}
		attachment, e := s.Q.CreateAgentAttachment(ctx, store.CreateAgentAttachmentParams{ID: uuid.NewString(), ConversationID: cid, Filename: "answers.csv", StoragePath: "answers.csv", Sha256: rag.Hash(csv), SizeBytes: int64(len(csv)), Kind: "upload"})
		if e != nil {
			t.Fatal(e)
		}
		calls := 0
		s.Model = modelFunc(func(messages []rag.AgentMessage, _ []any) (rag.AgentMessage, error) {
			calls++
			args := map[string]any{"id": assignment, "question_id": question, "attachment_id": attachment.ID}
			switch calls {
			case 1:
				return tool("delegate", map[string]any{"domain": "assessment", "goal": "预览附件并请求确认导入"}), nil
			case 2:
				return tool("submission_import_preview", args), nil
			case 3:
				last := messages[len(messages)-1]
				var preview struct {
					Response struct {
						Data struct {
							Hash string `json:"preview_hash"`
						} `json:"data"`
					} `json:"response"`
				}
				if e := json.Unmarshal([]byte(last.Content), &preview); e != nil || preview.Response.Data.Hash == "" {
					t.Fatal("attachment preview failed", last.Content, e)
				}
				args["preview_hash"] = preview.Response.Data.Hash
				return tool("submission_import_confirm", args), nil
			default:
				return final(), nil
			}
		})
		rid := send("teacher", cid)
		var editorTool Tool
		for _, spec := range Catalog() {
			if spec.Name == "import_editor" {
				editorTool = spec
			}
		}
		importRun, _ := s.Q.GetAgentRun(ctx, rid)
		importConv, _ := s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: cid, CourseID: "course", OwnerID: "teacher"})
		beforeImport, _, err := s.snapshot(ctx, importRun, importConv, editorTool, map[string]any{"id": assignment})
		if err != nil {
			t.Fatal(err)
		}
		drive(rid, "waiting_approval")
		if readCount("submissions", "assignment_id=$1", assignment) != 0 {
			t.Fatal("attachment imported without confirmation")
		}
		req := pending(cid)
		request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve"}, 200)
		drive(rid, "succeeded")
		if readCount("submissions", "assignment_id=$1", assignment) != 1 || readCount("submission_imports", "assignment_id=$1 AND imported_by='teacher'", assignment) != 1 {
			t.Fatal("approved attachment not imported exactly once")
		}
		afterImport, receipt, err := s.snapshot(ctx, importRun, importConv, editorTool, map[string]any{"id": assignment})
		if err != nil || afterImport == beforeImport || !strings.Contains(string(raw(receipt)), "imported_by") {
			t.Fatal("editor did not verify the saved import batch", err)
		}
		otherCID := conversation("teacher", "full-access")
		conv, _ := s.Q.GetAgentConversation(ctx, store.GetAgentConversationParams{ID: otherCID, CourseID: "course", OwnerID: "teacher"})
		run, _ := s.Q.GetAgentRun(ctx, rid)
		for _, spec := range Catalog() {
			if spec.Name == "submission_import_preview" {
				v, err := s.invoke(ctx, run, conv, spec, map[string]any{"id": assignment, "question_id": question, "attachment_id": attachment.ID}, "scoped")
				if err != nil || !strings.Contains(string(raw(v)), "本对话") {
					t.Fatal("cross-conversation attachment accepted", v, err)
				}
			}
		}
	})
	t.Run("editor_handoff_reuses_real_saved_objects_and_readonly_denies", func(t *testing.T) {
		business := "/api/v1/learning/courses/course"
		body := map[string]any{"origin": "teacher_example", "title": "工作台示例", "body": "教师编写的初稿", "content_kind": "example", "use_for_learning": true, "use_for_grading": false, "evidence": []any{}}
		kid := objectID(request("teacher", "POST", business+"/knowledge", body, 200))
		script := func() {
			calls := 0
			s.Model = modelFunc(func([]rag.AgentMessage, []any) (rag.AgentMessage, error) {
				calls++
				switch calls {
				case 1:
					return tool("delegate", map[string]any{"domain": "materials", "goal": "请教师在知识工作台完成编辑"}), nil
				case 2:
					return tool("knowledge_editor", map[string]any{"id": kid, "goal": "核对正文并保存后返回"}), nil
				default:
					return final(), nil
				}
			})
		}
		script()
		cid := conversation("teacher", "full-access")
		rid := send("teacher", cid)
		drive(rid, "waiting_input")
		req := pending(cid)
		var snapshot map[string]any
		_ = json.Unmarshal(req.Snapshot, &snapshot)
		if snapshot["editor"] == nil || req.Kind != "input" {
			t.Fatal("editor request missing", string(req.Snapshot))
		}
		body["body"] = "教师已保存的正文"
		body["edit_version"] = 1
		request("teacher", "PUT", business+"/knowledge/"+kid, body, 200)
		request("student", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve"}, 404)
		request("teacher", "POST", base+"/requests/"+req.ID+"/respond", map[string]any{"decision": "approve", "values": map[string]any{"saved_snapshot": "伪造的浏览器回执"}}, 200)
		drive(rid, "succeeded")
		answered, e := s.Q.GetAgentRequest(ctx, req.ID)
		var receipt map[string]any
		_ = json.Unmarshal(answered.Response, &receipt)
		if e != nil || !strings.Contains(string(answered.Response), "教师已保存的正文") || strings.Contains(string(answered.Response), "伪造的浏览器回执") || receipt["changed"] != true {
			t.Fatal("editor receipt not read from server", string(answered.Response), e)
		}
		script()
		cid = conversation("teacher", "read-only")
		rid = send("teacher", cid)
		drive(rid, "succeeded")
		if readCount("agent_requests", "run_id=$1", rid) != 0 {
			t.Fatal("readonly opened writable editor")
		}
	})
	t.Run("stream_text_is_persistent_and_cancel_does_not_execute_tools", func(t *testing.T) {
		cid := conversation("teacher", "read-only")
		rid := send("teacher", cid)
		s.Model = streamFunc(func(emit func(string) error) (rag.AgentMessage, error) {
			if e := emit("正在核对"); e != nil {
				return rag.AgentMessage{}, e
			}
			if e := emit("正在核对当前资料"); e != nil {
				return rag.AgentMessage{}, e
			}
			return rag.AgentMessage{Role: "assistant", Content: "正在核对当前资料"}, nil
		})
		drive(rid, "succeeded")
		run, e := s.Q.GetAgentRun(ctx, rid)
		if e != nil || run.StreamText != "正在核对当前资料" || run.StreamTurn != 1 {
			t.Fatal("stream checkpoint missing", run.StreamText, e)
		}
		if readCount("agent_events", "run_id=$1 AND kind='text'", rid) < 1 {
			t.Fatal("stream events missing")
		}
		if !strings.Contains(string(request("teacher", "GET", base+"/conversations/"+cid, nil, 200)), `"stream_text":"正在核对当前资料"`) {
			t.Fatal("refresh loses stream")
		}
		cid = conversation("teacher", "auto-review")
		rid = send("teacher", cid)
		s.Model = streamFunc(func(emit func(string) error) (rag.AgentMessage, error) {
			if e := s.Q.CancelAgentRun(ctx, rid); e != nil {
				t.Fatal(e)
			}
			if e := emit("未完成片段"); e != nil {
				return rag.AgentMessage{}, e
			}
			return tool("resource_create", map[string]any{"title": "不应执行"}), nil
		})
		drive(rid, "canceled")
		if readCount("agent_steps", "run_id=$1", rid) != 0 {
			t.Fatal("canceled generation executed a tool")
		}
	})
	t.Run("expired_session_prevents_background_work", func(t *testing.T) {
		cid := conversation("teacher", "auto-review")
		rid := send("teacher", cid)
		must("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", rag.Hash(tokens["teacher"]))
		drive(rid, "failed")
	})
}
