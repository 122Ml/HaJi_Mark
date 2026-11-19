package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/google/uuid"
)

func (s *Service) execute(ctx context.Context, run store.AgentRun, conv store.AgentConversation, rt *runtime, role string) error {
	f := &rt.Frames[len(rt.Frames)-1]
	call := f.Calls[f.Next]
	id := stepKey(run, *rt, call)
	args, argErr := decodeObject([]byte(call.Function.Arguments))
	tool, _ := lookupTool(call.Function.Name)
	storedArgs := args
	if argErr != nil {
		storedArgs = map[string]any{"raw_arguments": call.Function.Arguments}
	} else if tool.Name != "" {
		omitOptionalNulls(tool.Schema, args)
		if tool.Method == "JOB" && tool.Path != "parse" && tool.Path != "index" && tool.Path != "vision" || tool.Name == "course_answer" || tool.Name == "regrade_ai" {
			if getString(args, "profile_id") == "" {
				args["profile_id"] = rt.Profile
			}
		}
	}
	step, e := s.Q.CreateAgentStep(ctx, store.CreateAgentStepParams{ID: id, RunID: run.ID, Agent: f.Domain, Tool: call.Function.Name, Arguments: raw(storedArgs)})
	if e != nil {
		return e
	}
	if slices.Contains([]string{"succeeded", "failed", "denied"}, step.State) {
		var result any
		_ = json.Unmarshal(step.Result, &result)
		if step.State == "succeeded" && tool.Risk != "read" {
			trackPendingJobs(f, result)
		}
		appendResult(f, call, result)
		return nil
	}
	complete := func(state string, v any) error {
		if e := s.stepResult(ctx, run, id, state, v); e != nil {
			return e
		}
		appendResult(f, call, v)
		rt.Operations++
		return nil
	}
	// A safe GET may be requested again. Uncertain mutations are never replayed.
	if step.State == "executing" || step.State == "unknown" {
		if tool.Risk == "read" && tool.Method == "GET" {
			return complete("failed", map[string]any{"error": "上次查询在保存回执前中断，可重新发起只读查询"})
		}
		_ = s.stepResult(ctx, run, id, "unknown", map[string]any{"error": "进程在操作回执保存前中断，请核对实际对象"})
		return errUnknown
	}
	if argErr != nil {
		return complete("failed", map[string]any{"error": "工具参数不是有效JSON对象：" + argErr.Error()})
	}
	if tool.Name == "" || !allowed(tool, f.Domain, role, rt.Tainted) {
		return complete("denied", map[string]any{"error": "该工具不在当前身份、专家或数据隔离范围内"})
	}
	if e = validate(tool.Schema, args); e != nil {
		return complete("failed", map[string]any{"error": e.Error()})
	}
	if rt.Mode == "read-only" && tool.Risk != "read" {
		return complete("denied", map[string]any{"error": "当前为只读模式，未执行写操作。请结束运行后由用户修改模式"})
	}
	if tool.Learner {
		if e = s.Q.MarkAgentLearnerContext(ctx, conv.ID); e != nil {
			return e
		}
		rt.Tainted = true
	}
	if strings.HasPrefix(tool.Name, "job_") || tool.Name == "jobs_list" {
		if e = s.checkJobs(ctx, conv, rt, f.Domain, args, tool.Name); e != nil {
			return complete("denied", map[string]any{"error": e.Error()})
		}
	}
	if tool.Method == "DELEGATE" {
		domain := getString(args, "domain")
		if len(rt.Frames) != 1 || rt.Tainted && domain == "questions" || role == "student" && domain == "questions" {
			return complete("denied", map[string]any{"error": "不能将当前数据或身份委派给该领域。出题/标准请在不含学生作答的新会话处理"})
		}
		if !meaningful(getString(args, "goal"), 12000) {
			return complete("failed", map[string]any{"error": "任务目标为空或过长"})
		}
		rt.Frames = append(rt.Frames, frame{Domain: domain, Messages: []rag.AgentMessage{{Role: "system", Content: systemPrompt(domain, role, conv.CourseID, rt.Profile)}, {Role: "user", Content: delegatedInput(rt.Frames[0].Messages, getString(args, "goal"))}}})
		return s.event(ctx, s.Q, run, "delegated", map[string]any{"domain": domain, "step_id": id})
	}
	if tool.Method == "PLAN" {
		if e = s.event(ctx, s.Q, run, "plan", args); e != nil {
			return e
		}
		return complete("succeeded", map[string]any{"recorded": true})
	}
	risk := tool.Risk
	if tool.Name == "source_import" || tool.Name == "source_url_import" {
		if v, _ := args["allow_derived"].(bool); v {
			risk = "human"
		}
	}
	if tool.Method == "INPUT" || tool.Method == "EDITOR" || risk == "human" || risk == "approval" && rt.Mode != "full-access" {
		proceed, result, e := s.request(ctx, run, conv, rt, tool, step, args)
		if e != nil {
			return e
		}
		if !proceed {
			if result != nil {
				return complete("denied", result)
			}
			return errWaiting
		}
		if tool.Method == "INPUT" || tool.Method == "EDITOR" {
			return complete("succeeded", result)
		}
	}
	if tool.Method == "WAIT" {
		job, e := s.Q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: getString(args, "id"), CourseID: conv.CourseID})
		if e != nil {
			return complete("failed", map[string]any{"error": "任务不存在"})
		}
		if job.State == "queued" || job.State == "running" {
			waitSince := job.CreatedAt.Time
			if waitSince.IsZero() {
				waitSince = run.CreatedAt.Time
			}
			if time.Since(waitSince) > 30*time.Minute {
				return complete("failed", map[string]any{"error": "已等待30分钟，请稍后用任务ID查询；后台任务未被取消"})
			}
			if e = s.checkpoint(ctx, run, rt, "waiting_job", ""); e != nil {
				return e
			}
			return errWaiting
		}
		return complete("succeeded", map[string]any{"job": safeData(raw(job))})
	}
	// Check again immediately before dispatch; cancellation while a model or
	// approval was pending must not start a new business mutation.
	fresh, e := s.Q.GetAgentRun(ctx, run.ID)
	if e != nil {
		return e
	}
	if fresh.CancelRequested {
		if e = s.checkpoint(ctx, run, rt, "canceled", "运行已停止；已完成的操作保留"); e != nil {
			return e
		}
		return errStopped
	}
	if _, e = s.authorized(ctx, run, conv); e != nil {
		if e = s.checkpoint(ctx, run, rt, "failed", e.Error()); e != nil {
			return e
		}
		return errStopped
	}
	if e = s.stepResult(ctx, run, id, "executing", map[string]any{}); e != nil {
		return e
	}
	var value any
	switch tool.Method {
	case "UPLOAD":
		value, e = s.importAttachment(ctx, run, conv, args)
	case "EXPORT":
		value, e = s.exportFeedback(ctx, run, conv)
	default:
		value, e = s.invoke(ctx, run, conv, tool, args, step.ID)
	}
	if e != nil {
		if tool.Risk != "read" {
			_ = s.stepResult(ctx, run, id, "unknown", map[string]any{"error": e.Error()})
			return errUnknown
		}
		return complete("failed", map[string]any{"error": e.Error()})
	}
	state := "succeeded"
	if result, ok := value.(map[string]any); ok {
		if status, ok := result["http_status"].(int); ok && status >= 400 {
			state = "failed"
		}
		if _, ok := result["error"]; ok {
			state = "failed"
		}
	}
	if state == "succeeded" && tool.Risk != "read" {
		trackPendingJobs(f, value)
	}
	return complete(state, value)
}

func trackPendingJobs(f *frame, value any) {
	result, _ := value.(map[string]any)
	response, _ := result["response"].(map[string]any)
	jobs, _ := response["data"].([]any)
	if one, ok := response["data"].(map[string]any); ok {
		jobs = []any{one}
	}
	for _, value := range jobs {
		if report, ok := value.(map[string]any); ok && (report["kind"] == "diagnosis" || report["kind"] == "recommendation") && getString(report, "job_id") != "" && !slices.Contains(f.PendingJobs, getString(report, "job_id")) {
			f.PendingJobs = append(f.PendingJobs, getString(report, "job_id"))
			continue
		}
		if job, ok := value.(map[string]any); ok && getString(job, "id") != "" && getString(job, "kind") != "" && (job["state"] == "queued" || job["state"] == "running") && !slices.Contains(f.PendingJobs, getString(job, "id")) {
			f.PendingJobs = append(f.PendingJobs, getString(job, "id"))
		}
	}
}

func (s *Service) invoke(ctx context.Context, run store.AgentRun, conv store.AgentConversation, t Tool, args map[string]any, requestID string) (any, error) {
	path, e := toolPath(t.Path, args)
	if e != nil {
		return map[string]any{"error": e.Error()}, nil
	}
	body := map[string]any{}
	for k, v := range args {
		if !strings.Contains(t.Path, "{"+k+"}") {
			body[k] = v
		}
	}
	method := t.Method
	if t.Name == "submission_import_preview" || t.Name == "submission_import_confirm" {
		attachment := getString(args, "attachment_id")
		csv := getString(args, "csv")
		if (attachment == "") == (csv == "") {
			return map[string]any{"error": "CSV文本和同对话附件必须二选一"}, nil
		}
		if attachment != "" {
			a, err := s.Q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: attachment, ConversationID: conv.ID})
			if err != nil || a.Kind != "upload" || strings.ToLower(filepath.Ext(a.Filename)) != ".csv" || a.SizeBytes > 512<<10 {
				return map[string]any{"error": "请选择本对话内不超过512KiB的CSV上传附件"}, nil
			}
			fullPath, err := safeAttachmentPath(a.StoragePath)
			if err != nil {
				return map[string]any{"error": "附件路径无效"}, nil
			}
			file, err := os.Open(fullPath)
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(file, (512<<10)+1))
			_ = file.Close()
			if err != nil || len(data) > 512<<10 || rag.Hash(string(data)) != a.Sha256 {
				return map[string]any{"error": "附件内容与上传记录不一致，未导入"}, nil
			}
			body["csv"] = string(data)
			delete(body, "attachment_id")
		}
	}
	if t.Name == "grade_save" || t.Name == "submission_import_confirm" || t.Name == "answer_submit" || t.Name == "intelligence_create" {
		body["request_id"] = requestID
	}
	if method == "JOB" {
		method = "POST"
		body["kind"] = t.Path
		path = "/jobs"
		if t.Domain == "questions" {
			path = "/question-bank/jobs"
		}
	}
	if method == "GET" && len(body) > 0 {
		query := url.Values{}
		for k, v := range body {
			query.Set(k, fmt.Sprint(v))
		}
		path += "?" + query.Encode()
	}
	response, e := s.Gateway.Invoke(ctx, run.SessionHash, method, "/api/v1/learning/courses/"+conv.CourseID+path, "application/json", bytes.NewReader(raw(body)))
	if e != nil {
		return nil, e
	}
	if response.Status >= 500 {
		return nil, errors.New("业务服务返回异常，操作结果需核对")
	}
	value := safeData(response.Body)
	return map[string]any{"http_status": response.Status, "response": value}, nil
}

// Approval binds the exact tool arguments, current mode and current business
// snapshot. A changed snapshot rejects the old approval instead of rewriting it.
func (s *Service) request(ctx context.Context, run store.AgentRun, conv store.AgentConversation, rt *runtime, t Tool, step store.AgentStep, args map[string]any) (bool, any, error) {
	req, e := s.Q.GetAgentRequestForStep(ctx, step.ID)
	if notFound(e) {
		kind, prompt, fields := "approval", t.Label, any([]any{})
		snapshot := map[string]any{"tool": t.Name, "arguments": args, "mode": rt.Mode}
		if t.Method == "INPUT" {
			if e = validFields(args); e != nil {
				return false, map[string]any{"error": e.Error()}, nil
			}
			kind = "input"
			prompt = getString(args, "prompt")
			fields = args["fields"]
		} else if t.Method == "EDITOR" {
			hash, preview, err := s.snapshot(ctx, run, conv, t, args)
			if err != nil {
				return false, map[string]any{"error": err.Error()}, nil
			}
			if t.Path == "knowledge" {
				var found bool
				if wrapper, ok := preview.(map[string]any); ok {
					wrapper, _ = wrapper["object"].(map[string]any)
					if list, ok := wrapper["data"].([]any); ok {
						for _, v := range list {
							if k, ok := v.(map[string]any); ok && k["id"] == args["id"] {
								found = true
							}
						}
					}
				}
				if !found {
					return false, map[string]any{"error": "知识不存在或无权编辑"}, nil
				}
			}
			kind = "input"
			prompt = getString(args, "goal")
			snapshot["business_hash"] = hash
			snapshot["editor"] = map[string]any{"kind": t.Path, "id": args["id"]}
		} else if t.Snapshot != "" {
			hash, preview, e := s.snapshot(ctx, run, conv, t, args)
			if e != nil {
				return false, map[string]any{"error": e.Error()}, nil
			}
			snapshot["business_hash"] = hash
			snapshot["before"] = preview
			if len(raw(snapshot)) > 90000 {
				snapshot["before"] = map[string]any{"truncated": true, "message": "审批前对象预览超过90KB，已省略预览（已保留审批参数与校验摘要）"}
			}
		}
		req, e = s.Q.CreateAgentRequest(ctx, store.CreateAgentRequestParams{ID: uuid.NewString(), RunID: run.ID, StepID: step.ID, Kind: kind, Prompt: prompt, Fields: raw(fields), Snapshot: raw(snapshot)})
		if e != nil {
			return false, nil, e
		}
		if e = s.event(ctx, s.Q, run, "request", map[string]any{"request_id": req.ID}); e != nil {
			return false, nil, e
		}
	} else if e != nil {
		return false, nil, e
	}
	if req.State == "pending" && time.Now().Before(req.ExpiresAt.Time) {
		state := "waiting_approval"
		if req.Kind == "input" {
			state = "waiting_input"
		}
		return false, nil, s.checkpoint(ctx, run, rt, state, "")
	}
	if req.State != "answered" {
		return false, map[string]any{"denied": true, "reason": "用户拒绝或请求过期，未执行"}, nil
	}
	var response map[string]any
	_ = json.Unmarshal(req.Response, &response)
	if t.Method == "INPUT" || t.Method == "EDITOR" {
		return true, response, nil
	}
	var snapshot map[string]any
	_ = json.Unmarshal(req.Snapshot, &snapshot)
	if snapshot["mode"] != rt.Mode || string(raw(snapshot["arguments"])) != string(raw(args)) {
		return false, map[string]any{"error": "审批参数已变化，未执行"}, nil
	}
	if t.Snapshot != "" {
		hash, _, e := s.snapshot(ctx, run, conv, t, args)
		if e != nil {
			return false, nil, e
		}
		if snapshot["business_hash"] != hash {
			return false, map[string]any{"error": "审批后业务对象已变化，旧审批失效。请重新查询并提出新的操作"}, nil
		}
	}
	return true, response, nil
}
func (s *Service) snapshot(ctx context.Context, run store.AgentRun, conv store.AgentConversation, t Tool, args map[string]any) (string, any, error) {
	path, e := toolPath(t.Snapshot, args)
	if e != nil {
		return "", nil, e
	}
	if t.Snapshot == "@rubric" {
		r, e := s.Q.GetRubricVersion(ctx, getString(args, "id"))
		if e != nil {
			return "", nil, e
		}
		if r.BankQuestionVersionID.Valid {
			path = "/question-bank/versions/" + r.BankQuestionVersionID.String + "/rubrics"
		} else {
			path = "/questions/" + r.QuestionID.String + "/rubrics"
		}
	}
	if t.Snapshot == "@grade" {
		r, e := s.Q.GetBusinessRevision(ctx, getString(args, "id"))
		if e != nil {
			return "", nil, e
		}
		path = "/submissions/" + r.SubmissionID
	}
	if t.Snapshot == "@asset" {
		a, e := s.Q.GetMaterialAsset(ctx, store.GetMaterialAssetParams{ID: getString(args, "id"), CourseID: conv.CourseID})
		if e != nil {
			return "", nil, e
		}
		path = "/sources/" + a.SourceID + "/assets"
	}
	r, e := s.Gateway.Invoke(ctx, run.SessionHash, "GET", "/api/v1/learning/courses/"+conv.CourseID+path, "application/json", nil)
	if e != nil {
		return "", nil, e
	}
	if r.Status != 200 {
		return "", nil, errors.New("无法读取审批前对象，未执行")
	}
	var value any
	if json.Unmarshal(r.Body, &value) != nil {
		return "", nil, errors.New("对象快照无效")
	}
	if t.Method == "EDITOR" {
		read := func(path string) (any, error) {
			r, err := s.Gateway.Invoke(ctx, run.SessionHash, "GET", "/api/v1/learning/courses/"+conv.CourseID+path, "application/json", nil)
			if err != nil || r.Status != 200 {
				return nil, errors.New("编辑关联对象无法读取，请核对后重试")
			}
			var v any
			if json.Unmarshal(r.Body, &v) != nil {
				return nil, errors.New("编辑关联对象响应无效")
			}
			return v, nil
		}
		related := map[string]any{"object": value}
		id := getString(args, "id")
		extra := map[string]string{"source": "/sources/" + id + "/assets", "paper": "/decisions?object_id=" + url.QueryEscape(id), "import": "/assignments/" + id + "/imports"}[t.Path]
		if extra != "" {
			if related["saved_records"], e = read(extra); e != nil {
				return "", nil, e
			}
		}
		if t.Path == "question" {
			object, _ := value.(map[string]any)
			data, _ := object["data"].(map[string]any)
			versions, _ := data["versions"].([]any)
			rubrics := map[string]any{}
			for _, item := range versions {
				version, _ := item.(map[string]any)
				vid := getString(version, "id")
				if !safeID.MatchString(vid) {
					return "", nil, errors.New("题目版本无效")
				}
				if rubrics[vid], e = read("/question-bank/versions/" + vid + "/rubrics"); e != nil {
					return "", nil, e
				}
			}
			related["rubrics"] = rubrics
		}
		// Include the records the editor actually saves, not just its parent object.
		value = related
	}
	data := raw(value)
	return rag.Hash(string(data)), safeData(data), nil
}
func validFields(args map[string]any) error {
	fields, ok := args["fields"].([]any)
	if !ok || len(fields) < 1 || len(fields) > 4 || !meaningful(getString(args, "prompt"), 2000) {
		return errors.New("问题须包含1至4个字段和简短说明")
	}
	seen := map[string]bool{}
	for _, x := range fields {
		m, ok := x.(map[string]any)
		if !ok {
			return errors.New("问题字段无效")
		}
		key := getString(m, "key")
		if !safeID.MatchString(key) || seen[key] || !meaningful(getString(m, "label"), 1000) {
			return errors.New("问题字段键重复或无效")
		}
		seen[key] = true
		if getString(m, "kind") != "text" {
			options, _ := m["options"].([]any)
			if len(options) < 1 || len(options) > 12 {
				return errors.New("选择题须提供1至12项选项")
			}
		}
	}
	return nil
}
func jobDomain(kind string) (string, bool) {
	switch kind {
	case "parse", "index", "extract", "source_suggest", "knowledge_compare", "paper_split", "vision":
		return "materials", true
	case "question_generate", "question_analyze", "bank_rubric", "rubric":
		return "questions", true
	case "grade":
		return "assessment", true
	case "diagnosis", "recommendation":
		return "learning", true
	default:
		return "", false
	}
}
func (s *Service) checkJobs(ctx context.Context, conv store.AgentConversation, rt *runtime, domain string, args map[string]any, name string) error {
	if name == "jobs_list" {
		rawKind := strings.TrimSpace(getString(args, "kind"))
		if rawKind == "" {
			return errors.New("请指定本专家领域的任务kind，禁止跨领域读取任务")
		}
		parts := strings.Split(rawKind, ",")
		taint := false
		normalized := make([]string, 0, len(parts))
		for _, part := range parts {
			k := strings.TrimSpace(part)
			d, ok := jobDomain(k)
			if !ok || d != domain {
				return errors.New("请指定本专家领域的任务kind，禁止跨领域读取任务")
			}
			if rt.Tainted && k == "paper_split" {
				return errors.New("含作答上下文的会话不能读取整卷出题任务")
			}
			if k == "grade" || k == "diagnosis" || k == "recommendation" {
				taint = true
			}
			normalized = append(normalized, k)
		}
		args["kind"] = strings.Join(normalized, ",")
		if taint {
			rt.Tainted = true
			return s.Q.MarkAgentLearnerContext(ctx, conv.ID)
		}
		return nil
	}
	j, e := s.Q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: getString(args, "id"), CourseID: conv.CourseID})
	if e != nil {
		return errors.New("任务不存在或无权访问")
	}
	d, ok := jobDomain(j.Kind)
	if !ok || d != domain {
		return errors.New("该任务不属于当前专家领域")
	}
	if rt.Tainted && j.Kind == "paper_split" {
		return errors.New("含作答上下文的会话不能操作整卷出题任务")
	}
	if j.Kind == "grade" || j.Kind == "diagnosis" || j.Kind == "recommendation" {
		rt.Tainted = true
		return s.Q.MarkAgentLearnerContext(ctx, conv.ID)
	}
	return nil
}

func cleanValue(v any, depth int) any {
	if depth > 12 {
		return "[层级截断]"
	}
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, v := range x {
			if slices.Contains([]string{"storage_path", "session_hash", "password_hash", "token_hash", "runtime", "reasoning_content"}, k) {
				continue
			}
			out[k] = cleanValue(v, depth+1)
		}
		return out
	case []any:
		limit := len(x)
		if limit > 60 {
			limit = 60
		}
		out := make([]any, 0, limit+1)
		for _, v := range x[:limit] {
			out = append(out, cleanValue(v, depth+1))
		}
		if len(x) > limit {
			out = append(out, map[string]any{"truncated": true, "total": len(x)})
		}
		return out
	case string:
		if len([]rune(x)) > 10000 {
			return string([]rune(x)[:10000]) + "[内容截断，请缩小范围]"
		}
	}
	return v
}

// Remove server-only fields and bound each result. Truncation is explicit and
// never used as a successful full-source export or as a replacement for a file.
func safeData(data []byte) any {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return map[string]any{"error": "业务响应不是JSON"}
	}
	value = cleanValue(value, 0)
	if len(raw(value)) > 90000 {
		return map[string]any{"truncated": true, "message": "响应超过90KB，请缩小对象或查询范围"}
	}
	return value
}

// safeSnapshot protects required approval/editor metadata (tool, mode,
// arguments, editor, business_hash) from being wiped if preview data is large.
func safeSnapshot(data []byte) any {
	var m map[string]any
	if json.Unmarshal(data, &m) != nil || m == nil {
		return safeData(data)
	}
	cleaned, ok := cleanValue(m, 0).(map[string]any)
	if !ok {
		return safeData(data)
	}
	if len(raw(cleaned)) <= 90000 {
		return cleaned
	}
	if _, hasBefore := cleaned["before"]; hasBefore {
		cleaned["before"] = map[string]any{"truncated": true, "message": "审批前对象预览超过90KB，已省略部分预览"}
	}
	if len(raw(cleaned)) <= 90000 {
		return cleaned
	}
	out := map[string]any{"truncated": true, "message": "部分快照字段过大已折叠"}
	for _, keep := range []string{"tool", "mode", "arguments", "editor", "business_hash"} {
		if v, exists := cleaned[keep]; exists {
			out[keep] = v
		}
	}
	return out
}

func attachmentDir() string { return filepath.Join(rag.MaterialsDir(), "agent") }

func safeAttachmentPath(storagePath string) (string, error) {
	if storagePath == "" || filepath.IsAbs(storagePath) || strings.HasPrefix(storagePath, "/") || strings.HasPrefix(storagePath, "\\") || strings.ContainsRune(storagePath, '\x00') {
		return "", errors.New("附件路径无效")
	}
	base := filepath.Clean(attachmentDir())
	full := filepath.Clean(filepath.Join(base, storagePath))
	rel, err := filepath.Rel(base, full)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", errors.New("附件路径越界")
	}
	return full, nil
}

func (s *Service) importAttachment(ctx context.Context, run store.AgentRun, conv store.AgentConversation, args map[string]any) (any, error) {
	a, e := s.Q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: getString(args, "attachment_id"), ConversationID: conv.ID})
	if e != nil || a.Kind != "upload" {
		return map[string]any{"error": "附件不存在或不属于本会话"}, nil
	}
	fullPath, e := safeAttachmentPath(a.StoragePath)
	if e != nil {
		return map[string]any{"error": "附件路径无效"}, nil
	}
	file, e := os.Open(fullPath)
	if e != nil {
		return nil, errors.New("无法打开已上传附件")
	}
	defer file.Close()
	// A bounded local temp file avoids holding a 30MiB multipart payload in memory.
	body, e := os.CreateTemp(attachmentDir(), "multipart-*")
	if e != nil {
		return nil, e
	}
	defer os.Remove(body.Name())
	defer body.Close()
	w := multipart.NewWriter(body)
	part, e := w.CreateFormFile("files", a.Filename)
	if e != nil {
		return nil, e
	}
	hasher := sha256.New()
	n, e := io.Copy(io.MultiWriter(part, hasher), io.LimitReader(file, (30<<20)+1))
	if e != nil {
		return nil, e
	}
	if n > 30<<20 || hex.EncodeToString(hasher.Sum(nil)) != a.Sha256 {
		return map[string]any{"error": "附件内容与上传记录不一致，未导入"}, nil
	}
	for _, key := range []string{"source_note", "allow_derived", "title"} {
		if v, ok := args[key]; ok {
			if e = w.WriteField(key, fmt.Sprint(v)); e != nil {
				return nil, e
			}
		}
	}
	if e = w.Close(); e != nil {
		return nil, e
	}
	if _, e = body.Seek(0, 0); e != nil {
		return nil, e
	}
	r, e := s.Gateway.Invoke(ctx, run.SessionHash, "POST", "/api/v1/learning/courses/"+conv.CourseID+"/sources", w.FormDataContentType(), body)
	if e != nil {
		return nil, e
	}
	if r.Status >= 500 {
		return nil, errors.New("导入回执异常，请核对原件列表和任务，避免重复导入")
	}
	return map[string]any{"http_status": r.Status, "response": safeData(r.Body)}, nil
}
func csvCell(v any) string {
	x := fmt.Sprint(v)
	trim := strings.TrimLeft(x, " \t\r\n")
	if strings.HasPrefix(trim, "=") || strings.HasPrefix(trim, "+") || strings.HasPrefix(trim, "-") || strings.HasPrefix(trim, "@") {
		return "'" + x
	}
	return x
}
func (s *Service) exportFeedback(ctx context.Context, run store.AgentRun, conv store.AgentConversation) (any, error) {
	r, e := s.Gateway.Invoke(ctx, run.SessionHash, "GET", "/api/v1/learning/courses/"+conv.CourseID+"/evidence", "application/json", nil)
	if e != nil {
		return nil, e
	}
	if r.Status != 200 {
		return map[string]any{"http_status": r.Status, "response": safeData(r.Body)}, nil
	}
	var payload struct {
		Data []map[string]any `json:"data"`
	}
	if e = json.Unmarshal(r.Body, &payload); e != nil {
		return nil, e
	}
	columns := []string{"student_id", "question_id", "prompt", "submission_id", "attempt", "score", "max_score", "feedback", "revision_id", "released_at"}
	var b bytes.Buffer
	b.WriteString("\ufeff")
	w := csv.NewWriter(&b)
	_ = w.Write(columns)
	for _, row := range payload.Data {
		line := make([]string, len(columns))
		for i, k := range columns {
			if v, ok := row[k]; ok && v != nil {
				line[i] = csvCell(v)
			}
		}
		if e = w.Write(line); e != nil {
			return nil, e
		}
	}
	w.Flush()
	if e = w.Error(); e != nil {
		return nil, e
	}
	id := uuid.NewString()
	if e = os.MkdirAll(attachmentDir(), 0700); e != nil {
		return nil, e
	}
	path := id + ".csv"
	if e = os.WriteFile(filepath.Join(attachmentDir(), path), b.Bytes(), 0600); e != nil {
		return nil, e
	}
	a, e := s.Q.CreateAgentAttachment(ctx, store.CreateAgentAttachmentParams{ID: id, ConversationID: conv.ID, Filename: "评分反馈.csv", StoragePath: path, Sha256: rag.Hash(b.String()), SizeBytes: int64(b.Len()), Kind: "export"})
	if e != nil {
		_ = os.Remove(filepath.Join(attachmentDir(), path))
		return nil, e
	}
	return map[string]any{"attachment_id": a.ID, "filename": a.Filename, "rows": len(payload.Data), "download_url": "/api/v1/learning/courses/" + conv.CourseID + "/agent/conversations/" + conv.ID + "/attachments/" + a.ID + "/file"}, nil
}
