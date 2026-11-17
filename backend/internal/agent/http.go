package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (s *Service) Register(api *gin.RouterGroup, auth *identity.Handler) {
	g := api.Group("/learning/courses/:courseID/agent", auth.RequireSession(), auth.RequireCourse("courseID"))
	g.GET("/status", s.status)
	g.GET("/conversations", s.conversations)
	g.POST("/conversations", auth.RequireCSRF(), s.createConversation)
	g.GET("/conversations/:conversationID", s.conversation)
	g.PATCH("/conversations/:conversationID", auth.RequireCSRF(), s.options)
	g.POST("/conversations/:conversationID/messages", auth.RequireCSRF(), s.send)
	g.POST("/conversations/:conversationID/attachments", auth.RequireCSRF(), s.upload)
	g.GET("/conversations/:conversationID/attachments/:attachmentID/file", s.download)
	g.GET("/conversations/:conversationID/events", s.stream)
	g.POST("/runs/:runID/cancel", auth.RequireCSRF(), s.cancel)
	g.POST("/runs/:runID/resume", auth.RequireCSRF(), s.resume)
	g.POST("/requests/:requestID/respond", auth.RequireCSRF(), s.respond)
}
func fail(c *gin.Context, status int, message string) {
	identity.Fail(c, status, "agent_error", message)
}
func data(c *gin.Context, v any, e error) {
	if e != nil {
		if notFound(e) {
			fail(c, 404, "会话或记录不存在")
		} else {
			fail(c, 503, "会话保存或读取失败，请稍后重试")
		}
		return
	}
	c.JSON(200, gin.H{"data": v})
}
func bind(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	if c.ShouldBindJSON(v) != nil {
		fail(c, 400, "请求格式无效或超过128KiB")
		return false
	}
	return true
}
func (s *Service) owned(c *gin.Context) (store.AgentConversation, bool) {
	conv, e := s.Q.GetAgentConversation(c.Request.Context(), store.GetAgentConversationParams{ID: c.Param("conversationID"), CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID})
	if e != nil {
		data(c, nil, e)
		return conv, false
	}
	return conv, true
}
func (s *Service) runOwned(c *gin.Context, id string) (store.AgentRun, store.AgentConversation, bool) {
	run, e := s.Q.GetAgentRun(c.Request.Context(), id)
	if e != nil {
		data(c, nil, e)
		return run, store.AgentConversation{}, false
	}
	conv, e := s.Q.GetAgentConversation(c.Request.Context(), store.GetAgentConversationParams{ID: run.ConversationID, CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID})
	if e != nil {
		data(c, nil, e)
		return run, conv, false
	}
	return run, conv, true
}
func (s *Service) status(c *gin.Context) {
	profiles := []map[string]any{}
	if s.Profiles != nil {
		for _, p := range s.Profiles.Public() {
			if p["kind"] == "chat" {
				profiles = append(profiles, p)
			}
		}
	}
	tools := []Tool{}
	for _, t := range Catalog() {
		if identity.Current(c).Role == "teacher" || t.Student {
			tools = append(tools, t)
		}
	}
	c.JSON(200, gin.H{"data": gin.H{"configured": s.Model != nil, "profiles": profiles, "tools": tools, "limits": gin.H{"steps": maxOperations, "model_calls": maxModelCalls, "delegation_depth": 1, "file_mib": 30, "attachment_count": 30}}})
}
func (s *Service) conversations(c *gin.Context) {
	v, e := s.Q.ListAgentConversations(c.Request.Context(), store.ListAgentConversationsParams{CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID})
	data(c, v, e)
}
func validMode(mode, role string) bool {
	return mode == "read-only" || mode == "auto-review" || mode == "full-access" && role == "teacher"
}
func (s *Service) createConversation(c *gin.Context) {
	var in struct {
		Title   string `json:"title"`
		Mode    string `json:"mode"`
		Profile string `json:"profile_id"`
	}
	if !bind(c, &in) {
		return
	}
	if in.Mode == "" {
		in.Mode = "auto-review"
	}
	if in.Title == "" {
		in.Title = "新对话"
	}
	if !meaningful(in.Title, 200) || !validMode(in.Mode, identity.Current(c).Role) {
		fail(c, 422, "会话标题或权限模式无效")
		return
	}
	if s.Profiles != nil {
		if _, e := s.Profiles.Profile(in.Profile, "chat"); e != nil {
			fail(c, 422, e.Error())
			return
		}
	}
	v, e := s.Q.CreateAgentConversation(c.Request.Context(), store.CreateAgentConversationParams{ID: uuid.NewString(), CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID, Title: in.Title, Mode: in.Mode, ProfileID: in.Profile})
	data(c, v, e)
}
func (s *Service) options(c *gin.Context) {
	var in struct {
		Mode    string `json:"mode"`
		Profile string `json:"profile_id"`
	}
	if !bind(c, &in) {
		return
	}
	if !validMode(in.Mode, identity.Current(c).Role) {
		fail(c, 422, "权限模式无效")
		return
	}
	ctx := c.Request.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		data(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	conv, e := q.LockAgentConversation(ctx, store.LockAgentConversationParams{ID: c.Param("conversationID"), CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID})
	if e != nil {
		data(c, nil, e)
		return
	}
	busy, e := q.AgentHasActiveRun(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if busy {
		fail(c, 409, "请先结束当前运行，再修改模型或权限模式")
		return
	}
	if s.Profiles != nil {
		if _, e = s.Profiles.Profile(in.Profile, "chat"); e != nil {
			fail(c, 422, e.Error())
			return
		}
	}
	v, e := q.UpdateAgentConversation(ctx, store.UpdateAgentConversationParams{ID: conv.ID, Mode: in.Mode, ProfileID: in.Profile})
	if e == nil {
		e = tx.Commit(ctx)
	}
	data(c, v, e)
}
func (s *Service) conversation(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	// All private runtime fields (session references and model reasoning) stay server-side.
	messages, e := s.Q.ListAgentMessages(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	runs, e := s.Q.ListAgentRuns(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	steps, e := s.Q.ListAgentSteps(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	requests, e := s.Q.ListAgentRequests(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	attachments, e := s.Q.ListAgentAttachments(ctx, conv.ID)
	if messages == nil {
		messages = []store.AgentMessage{}
	}
	if runs == nil {
		runs = []store.ListAgentRunsRow{}
	}
	if attachments == nil {
		attachments = []store.ListAgentAttachmentsRow{}
	}
	publicSteps := []gin.H{}
	for _, step := range steps {
		publicSteps = append(publicSteps, gin.H{"id": step.ID, "run_id": step.RunID, "agent": step.Agent, "tool": step.Tool, "state": step.State, "arguments": safeData(step.Arguments), "result": safeData(step.Result)})
	}
	publicRequests := []gin.H{}
	for _, req := range requests {
		publicRequests = append(publicRequests, gin.H{"id": req.ID, "run_id": req.RunID, "step_id": req.StepID, "kind": req.Kind, "prompt": req.Prompt, "fields": json.RawMessage(req.Fields), "snapshot": safeData(req.Snapshot), "response": safeData(req.Response), "state": req.State, "expires_at": req.ExpiresAt})
	}
	publicRuns := []gin.H{}
	for _, run := range runs {
		canResume := false
		if run.State == "failed" || run.State == "unknown" {
			checkpoint, readErr := s.Q.GetAgentRun(ctx, run.ID)
			if readErr != nil {
				data(c, nil, readErr)
				return
			}
			var rt runtime
			canResume = json.Unmarshal(checkpoint.Runtime, &rt) == nil && resumable(rt)
		}
		publicRuns = append(publicRuns, gin.H{"id": run.ID, "request_id": run.RequestID, "state": run.State, "error": run.Error, "cancel_requested": run.CancelRequested, "created_at": run.CreatedAt, "can_resume": canResume})
	}
	data(c, gin.H{"conversation": conv, "messages": messages, "runs": publicRuns, "steps": publicSteps, "requests": publicRequests, "attachments": attachments}, e)
}

func resumable(rt runtime) bool {
	if rt.WriteUnknown || len(rt.Frames) == 0 || rt.Operations >= maxOperations {
		return false
	}
	f := rt.Frames[len(rt.Frames)-1]
	return rt.ModelCalls < maxModelCalls || f.Next < len(f.Calls)
}
func (s *Service) send(c *gin.Context) {
	var in struct {
		Content     string   `json:"content"`
		Attachments []string `json:"attachment_ids"`
		RequestID   string   `json:"request_id"`
	}
	if !bind(c, &in) {
		return
	}
	if (!meaningful(in.Content, 12000) && len(in.Attachments) == 0) || len(in.Content) > 12000 || len(in.Attachments) > 10 {
		fail(c, 422, "请输入最多12000字节的消息，每条最多10份附件")
		return
	}
	if _, e := uuid.Parse(in.RequestID); e != nil {
		fail(c, 422, "缺少有效幂等请求ID")
		return
	}
	if s.Model == nil {
		fail(c, 503, "Agent尚未启用或生成模型未配置")
		return
	}
	ctx := c.Request.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		data(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	conv, e := q.LockAgentConversation(ctx, store.LockAgentConversationParams{ID: c.Param("conversationID"), CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID})
	if e != nil {
		data(c, nil, e)
		return
	}
	old, e := q.GetAgentRunByRequest(ctx, store.GetAgentRunByRequestParams{ConversationID: conv.ID, RequestID: in.RequestID})
	if e == nil {
		c.JSON(200, gin.H{"data": gin.H{"run_id": old.ID, "state": old.State}})
		return
	}
	if !notFound(e) {
		data(c, nil, e)
		return
	}
	busy, e := q.AgentHasActiveRun(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if busy {
		fail(c, 409, "当前对话已有运行，请先回答问题、审批或停止")
		return
	}
	if s.Profiles != nil {
		if _, e = s.Profiles.Profile(conv.ProfileID, "chat"); e != nil {
			fail(c, 422, e.Error())
			return
		}
	}
	meta := []map[string]any{}
	seen := map[string]bool{}
	for _, id := range in.Attachments {
		a, e := q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: id, ConversationID: conv.ID})
		if e != nil || a.Kind != "upload" || seen[id] {
			fail(c, 422, "附件无效、重复或不属于本会话")
			return
		}
		seen[id] = true
		meta = append(meta, map[string]any{"attachment_id": a.ID, "filename": a.Filename, "bytes": a.SizeBytes, "sha256": a.Sha256})
	}
	history, e := q.ListAgentMessages(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	messages := []rag.AgentMessage{{Role: "system", Content: systemPrompt("coordinator", identity.Current(c).Role, conv.CourseID, conv.ProfileID)}}
	if len(history) > 12 {
		history = history[len(history)-12:]
	}
	for _, m := range history {
		content := m.Content
		priorAttachments := []map[string]any{}
		for _, id := range m.AttachmentIds {
			a, err := q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: id, ConversationID: conv.ID})
			if err != nil {
				data(c, nil, err)
				return
			}
			priorAttachments = append(priorAttachments, map[string]any{"attachment_id": a.ID, "filename": a.Filename, "bytes": a.SizeBytes, "sha256": a.Sha256})
		}
		if len(priorAttachments) > 0 {
			content += "\n历史消息附件（服务端登记元数据）：" + string(raw(priorAttachments))
		}
		messages = append(messages, rag.AgentMessage{Role: m.Role, Content: content})
	}
	content := in.Content
	if len(meta) > 0 {
		content += "\n本次对话附件（服务端登记元数据）：" + string(raw(meta))
	}
	messages = append(messages, rag.AgentMessage{Role: "user", Content: content})
	rt := runtime{Mode: conv.Mode, Profile: conv.ProfileID, Tainted: conv.LearnerContext, Frames: []frame{{Domain: "coordinator", Messages: messages}}}
	if in.Attachments == nil {
		in.Attachments = []string{}
	}
	if e = q.CreateAgentMessage(ctx, store.CreateAgentMessageParams{ID: uuid.NewString(), ConversationID: conv.ID, Role: "user", Content: in.Content, AttachmentIds: in.Attachments}); e != nil {
		data(c, nil, e)
		return
	}
	title := []rune(strings.TrimSpace(in.Content))
	if len(title) > 24 {
		title = title[:24]
	}
	if len(title) == 0 {
		title = []rune("附件导入")
	}
	if e = q.SetAgentConversationTitle(ctx, store.SetAgentConversationTitleParams{ID: conv.ID, Title: string(title)}); e != nil {
		data(c, nil, e)
		return
	}
	run, e := q.CreateAgentRun(ctx, store.CreateAgentRunParams{ID: uuid.NewString(), ConversationID: conv.ID, RequestID: in.RequestID, SessionHash: identity.SessionReference(c), Runtime: raw(rt)})
	if e == nil {
		e = s.event(ctx, q, run, "status", map[string]any{"state": "queued"})
	}
	if e == nil {
		e = q.TouchAgentConversation(ctx, conv.ID)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	data(c, gin.H{"run_id": run.ID, "state": run.State}, e)
}
func (s *Service) upload(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 31<<20)
	if e := c.Request.ParseMultipartForm(1 << 20); e != nil {
		fail(c, 422, "附件超出30MiB或上传格式无效")
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	f, e := c.FormFile("file")
	if e != nil || f.Size < 1 || f.Size > 30<<20 {
		fail(c, 422, "请选择1份非空且不超过30MiB的文件")
		return
	}
	ext := strings.ToLower(filepath.Ext(f.Filename))
	if !strings.Contains("|.pdf|.docx|.pptx|.txt|.md|.html|.htm|.csv|", "|"+ext+"|") || ext == "" {
		fail(c, 422, "支持PDF、DOCX、PPTX、文本、HTML与CSV")
		return
	}
	ctx := c.Request.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		data(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	_, e = q.LockAgentConversation(ctx, store.LockAgentConversationParams{ID: conv.ID, CourseID: conv.CourseID, OwnerID: conv.OwnerID})
	if e != nil {
		data(c, nil, e)
		return
	}
	attachments, e := q.ListAgentAttachments(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	var size int64
	count := 0
	for _, a := range attachments {
		if a.Kind == "upload" {
			count++
			size += a.SizeBytes
		}
	}
	if count >= 30 || size+f.Size > 150<<20 {
		fail(c, 422, "本会话最多30份上传附件、累计150MiB")
		return
	}
	if e = os.MkdirAll(attachmentDir(), 0700); e != nil {
		data(c, nil, e)
		return
	}
	id := uuid.NewString()
	name := id + ext
	path := filepath.Join(attachmentDir(), name)
	input, e := f.Open()
	if e != nil {
		data(c, nil, e)
		return
	}
	defer input.Close()
	out, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		data(c, nil, e)
		return
	}
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(out, hash), io.LimitReader(input, 30<<20+1))
	closeErr := out.Close()
	if e == nil {
		e = closeErr
	}
	if n > 30<<20 || e != nil {
		_ = os.Remove(path)
		fail(c, 422, "文件读取失败或超出大小限制")
		return
	}
	a, e := q.CreateAgentAttachment(ctx, store.CreateAgentAttachmentParams{ID: id, ConversationID: conv.ID, Filename: filepath.Base(f.Filename), StoragePath: name, Sha256: hex.EncodeToString(hash.Sum(nil)), SizeBytes: n, Kind: "upload"})
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		_ = os.Remove(path)
	}
	data(c, gin.H{"id": a.ID, "filename": a.Filename, "size_bytes": a.SizeBytes, "kind": a.Kind}, e)
}
func (s *Service) download(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	a, e := s.Q.GetAgentAttachment(c.Request.Context(), store.GetAgentAttachmentParams{ID: c.Param("attachmentID"), ConversationID: conv.ID})
	if e != nil {
		data(c, nil, e)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "no-store")
	c.FileAttachment(filepath.Join(attachmentDir(), a.StoragePath), a.Filename)
}
func (s *Service) cancel(c *gin.Context) {
	run, _, ok := s.runOwned(c, c.Param("runID"))
	if !ok {
		return
	}
	if !active(run.State) {
		fail(c, 409, "运行已经结束")
		return
	}
	e := s.Q.CancelAgentRun(c.Request.Context(), run.ID)
	data(c, gin.H{"cancel_requested": true}, e)
}
func (s *Service) resume(c *gin.Context) {
	run, conv, ok := s.runOwned(c, c.Param("runID"))
	if !ok {
		return
	}
	var rt runtime
	if json.Unmarshal(run.Runtime, &rt) != nil {
		fail(c, 409, "检查点无效")
		return
	}
	if (run.State != "failed" && run.State != "unknown") || !resumable(rt) {
		fail(c, 409, "此运行不能自动恢复，请先核对未知写操作")
		return
	}
	// Reset only the interrupted inference marker; successful tools stay recorded.
	rt.Inference = false
	ctx := c.Request.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		data(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	var locked bool
	if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,1741))", run.ID).Scan(&locked); e != nil {
		data(c, nil, e)
		return
	}
	if !locked {
		fail(c, 409, "运行正在推进，请刷新后再恢复")
		return
	}
	_, e = q.LockAgentConversation(ctx, store.LockAgentConversationParams{ID: conv.ID, CourseID: conv.CourseID, OwnerID: conv.OwnerID})
	if e != nil {
		data(c, nil, e)
		return
	}
	busy, e := q.AgentHasActiveRun(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if busy {
		fail(c, 409, "已有其他运行，不能恢复旧运行")
		return
	}
	run, e = q.GetAgentRun(ctx, run.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if (run.State != "failed" && run.State != "unknown") || json.Unmarshal(run.Runtime, &rt) != nil || !resumable(rt) {
		fail(c, 409, "运行已变化或含未知写入，不能恢复")
		return
	}
	rt.Inference = false
	if e = q.ReauthorizeAgentRun(ctx, store.ReauthorizeAgentRunParams{ID: run.ID, SessionHash: identity.SessionReference(c)}); e == nil {
		e = q.UpdateAgentRun(ctx, store.UpdateAgentRunParams{ID: run.ID, State: "queued", Runtime: raw(rt)})
	}
	if e == nil {
		e = s.event(ctx, q, run, "status", map[string]any{"state": "queued"})
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	data(c, gin.H{"run_id": run.ID}, e)
}
func (s *Service) respond(c *gin.Context) {
	var in struct {
		Decision string         `json:"decision"`
		Values   map[string]any `json:"values"`
	}
	if !bind(c, &in) {
		return
	}
	if in.Decision != "approve" && in.Decision != "reject" {
		fail(c, 422, "请选择确认或拒绝")
		return
	}
	ctx := c.Request.Context()
	req, e := s.Q.GetAgentRequest(ctx, c.Param("requestID"))
	if e != nil {
		data(c, nil, e)
		return
	}
	run, conv, ok := s.runOwned(c, req.RunID)
	if !ok {
		return
	}
	if !active(run.State) || run.CancelRequested {
		fail(c, 409, "运行已停止，不能再回答")
		return
	}
	if req.Kind == "input" && in.Decision == "approve" {
		if e = validateAnswers(req.Fields, in.Values); e != nil {
			fail(c, 422, e.Error())
			return
		}
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		data(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	var locked bool
	if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,1741))", run.ID).Scan(&locked); e != nil {
		data(c, nil, e)
		return
	}
	if !locked {
		fail(c, 409, "运行正在推进，请稍后提交本次回答")
		return
	}
	_, e = q.LockAgentConversation(ctx, store.LockAgentConversationParams{ID: conv.ID, CourseID: conv.CourseID, OwnerID: conv.OwnerID})
	if e != nil {
		data(c, nil, e)
		return
	}
	run, e = q.GetAgentRun(ctx, run.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if !active(run.State) || run.CancelRequested {
		fail(c, 409, "运行状态已变化")
		return
	}
	state := "answered"
	if in.Decision == "reject" {
		state = "rejected"
	}
	_, e = q.RespondAgentRequest(ctx, store.RespondAgentRequestParams{ID: req.ID, State: state, Response: raw(in.Values)})
	if notFound(e) {
		fail(c, 409, "问题已回答或过期，请刷新")
		return
	}
	if e == nil {
		e = q.ReauthorizeAgentRun(ctx, store.ReauthorizeAgentRunParams{ID: run.ID, SessionHash: identity.SessionReference(c)})
	}
	if e == nil {
		e = q.UpdateAgentRun(ctx, store.UpdateAgentRunParams{ID: run.ID, State: "queued", Runtime: run.Runtime})
	}
	if e == nil {
		e = s.event(ctx, q, run, "response", map[string]any{"request_id": req.ID, "state": state})
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	data(c, gin.H{"state": state}, e)
}
func validateAnswers(fields json.RawMessage, values map[string]any) error {
	var list []struct {
		Key      string   `json:"key"`
		Kind     string   `json:"kind"`
		Required bool     `json:"required"`
		Options  []string `json:"options"`
	}
	if e := json.Unmarshal(fields, &list); e != nil {
		return e
	}
	known := map[string]bool{}
	for _, f := range list {
		known[f.Key] = true
		v, ok := values[f.Key]
		if !ok {
			if f.Required {
				return fmt.Errorf("请回答%s", f.Key)
			}
			continue
		}
		if f.Kind == "multiselect" {
			items, ok := v.([]any)
			if !ok || len(items) > len(f.Options) || f.Required && len(items) == 0 {
				return fmt.Errorf("%s选项无效", f.Key)
			}
			for _, v := range items {
				x, ok := v.(string)
				if !ok || !slicesContains(f.Options, x) {
					return fmt.Errorf("%s选项无效", f.Key)
				}
			}
		} else {
			x, ok := v.(string)
			if !ok || len(x) > 10000 || f.Required && strings.TrimSpace(x) == "" {
				return fmt.Errorf("%s回答无效", f.Key)
			}
			if f.Kind == "select" && !slicesContains(f.Options, x) {
				return fmt.Errorf("%s选项无效", f.Key)
			}
		}
	}
	for k := range values {
		if !known[k] {
			return fmt.Errorf("未知回答字段%s", k)
		}
	}
	return nil
}
func slicesContains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}

// Short-lived SSE connections fit existing 120s proxy timeouts. Durable IDs and
// Last-Event-ID replay make reconnects and browser refreshes lossless.
func (s *Service) stream(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(c.GetHeader("Last-Event-ID"), 10, 64)
	if after == 0 {
		after, _ = strconv.ParseInt(c.Query("after"), 10, 64)
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Connection", "keep-alive")
	_, _ = io.WriteString(c.Writer, "retry: 2000\n\n")
	c.Writer.Flush()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	deadline := time.NewTimer(25 * time.Second)
	defer deadline.Stop()
	for {
		// A logged-out or removed member must not keep a live stream grant.
		user, e := s.Q.GetSessionUser(c.Request.Context(), identity.SessionReference(c))
		if e != nil || user.ID != conv.OwnerID {
			return
		}
		access, e := s.Q.CanAccessCourse(c.Request.Context(), store.CanAccessCourseParams{CourseID: conv.CourseID, ActorID: user.ID, ActorRole: user.Role})
		if e != nil || !access {
			return
		}
		events, e := s.Q.ListAgentEvents(c.Request.Context(), store.ListAgentEventsParams{ConversationID: conv.ID, ID: after})
		if e != nil {
			return
		}
		for _, ev := range events {
			_, _ = fmt.Fprintf(c.Writer, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Kind, ev.Payload)
			after = ev.ID
		}
		_, _ = io.WriteString(c.Writer, ": heartbeat\n\n")
		c.Writer.Flush()
		if len(events) == 100 {
			continue
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-deadline.C:
			return
		case <-ticker.C:
		}
	}
}
