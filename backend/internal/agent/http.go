package agent

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
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
	c.JSON(200, gin.H{"data": gin.H{"configured": s.chatConfigured(), "profiles": profiles, "tools": tools, "limits": gin.H{"steps": maxOperations, "model_calls": maxModelCalls, "delegation_depth": 1, "file_mib": 30, "attachment_count": 30}}})
}
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
func (s *Service) conversations(c *gin.Context) {
	size, e := strconv.Atoi(c.DefaultQuery("size", "100"))
	offset, e2 := strconv.Atoi(c.DefaultQuery("offset", "0"))
	search := c.Query("search")
	if e != nil || e2 != nil || size < 1 || size > 100 || offset < 0 || offset > 1000000 || len(search) > 200 || strings.ContainsRune(search, '\x00') {
		fail(c, 422, "对话分页或搜索参数无效")
		return
	}
	v, e := s.Q.ListAgentConversationPage(c.Request.Context(), store.ListAgentConversationPageParams{CourseID: c.Param("courseID"), OwnerID: identity.Current(c).ID, Search: escapeLike(search), PageSize: int32(size), PageOffset: int32(offset)})
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
	if !meaningful(in.Title, 200) || strings.ContainsRune(in.Title, '\x00') || !validMode(in.Mode, identity.Current(c).Role) {
		fail(c, 422, "会话标题或权限模式无效")
		return
	}
	if s.Profiles != nil {
		p, e := s.Profiles.Profile(in.Profile, "chat")
		if e != nil {
			fail(c, 422, e.Error())
			return
		}
		if in.Profile == "" {
			in.Profile = p.ID
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
		p, err := s.Profiles.Profile(in.Profile, "chat")
		if err != nil {
			fail(c, 422, err.Error())
			return
		}
		if in.Profile == "" {
			in.Profile = p.ID
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
	before := struct {
		Time      time.Time `json:"time"`
		KindOrder int32     `json:"kind_order"`
		ID        string    `json:"id"`
	}{Time: time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), KindOrder: 999, ID: "~"}
	if cursor := c.Query("before"); cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || len(raw) > 256 || json.Unmarshal(raw, &before) != nil || before.Time.IsZero() || before.ID == "" {
			fail(c, 422, "历史游标无效，请重新打开对话")
			return
		}
	}
	timeline, e := s.Q.ListAgentTimeline(ctx, store.ListAgentTimelineParams{ConversationID: conv.ID, BeforeTime: pgtype.Timestamptz{Time: before.Time, Valid: true}, BeforeKindOrder: before.KindOrder, BeforeID: before.ID})
	if e != nil {
		data(c, nil, e)
		return
	}
	hasMore := len(timeline) > 50
	if hasMore {
		timeline = timeline[:50]
	}
	messageIDs, runIDs := []string{}, []string{}
	for _, item := range timeline {
		if item.Kind == "message" {
			messageIDs = append(messageIDs, item.ID)
		} else {
			runIDs = append(runIDs, item.ID)
		}
	}
	nextCursor := ""
	if hasMore {
		last := timeline[len(timeline)-1]
		raw, _ := json.Marshal(struct {
			Time      time.Time `json:"time"`
			KindOrder int32     `json:"kind_order"`
			ID        string    `json:"id"`
		}{last.CreatedAt.Time, last.KindOrder, last.ID})
		nextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	// All private runtime fields (session references and model reasoning) stay server-side.
	messages, e := s.Q.ListAgentPageMessages(ctx, store.ListAgentPageMessagesParams{ConversationID: conv.ID, Ids: messageIDs})
	if e != nil {
		data(c, nil, e)
		return
	}
	runs, e := s.Q.ListAgentPageRuns(ctx, store.ListAgentPageRunsParams{ConversationID: conv.ID, Ids: runIDs})
	if e != nil {
		data(c, nil, e)
		return
	}
	runIDs = runIDs[:0]
	for _, run := range runs {
		runIDs = append(runIDs, run.ID)
	}
	steps, e := s.Q.ListAgentPageSteps(ctx, runIDs)
	if e != nil {
		data(c, nil, e)
		return
	}
	requests, e := s.Q.ListAgentPageRequests(ctx, runIDs)
	if e != nil {
		data(c, nil, e)
		return
	}
	attachmentIDs := []string{}
	for _, message := range messages {
		attachmentIDs = append(attachmentIDs, message.AttachmentIds...)
	}
	attachments, e := s.Q.ListAgentPageAttachments(ctx, store.ListAgentPageAttachmentsParams{ConversationID: conv.ID, Ids: attachmentIDs})
	if e != nil {
		data(c, nil, e)
		return
	}
	latestEventID, e := s.Q.GetLatestAgentEventID(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	if messages == nil {
		messages = []store.AgentMessage{}
	}
	if runs == nil {
		runs = []store.ListAgentPageRunsRow{}
	}
	if attachments == nil {
		attachments = []store.ListAgentPageAttachmentsRow{}
	}
	publicSteps := []gin.H{}
	for _, step := range steps {
		publicSteps = append(publicSteps, gin.H{"id": step.ID, "run_id": step.RunID, "agent": step.Agent, "tool": step.Tool, "state": step.State, "arguments": safeData(step.Arguments), "result": safeData(step.Result)})
	}
	publicRequests := []gin.H{}
	for _, req := range requests {
		publicRequests = append(publicRequests, gin.H{"id": req.ID, "run_id": req.RunID, "step_id": req.StepID, "kind": req.Kind, "prompt": req.Prompt, "fields": json.RawMessage(req.Fields), "snapshot": safeSnapshot(req.Snapshot), "response": safeData(req.Response), "state": req.State, "expires_at": req.ExpiresAt})
	}
	needRuntime := []string{}
	for _, run := range runs {
		if run.State == "failed" || run.State == "unknown" {
			needRuntime = append(needRuntime, run.ID)
		}
	}
	resumableByRun := map[string]bool{}
	if len(needRuntime) > 0 {
		runtimes, readErr := s.Q.ListAgentRunRuntimes(ctx, needRuntime)
		if readErr != nil {
			data(c, nil, readErr)
			return
		}
		for _, row := range runtimes {
			var rt runtime
			resumableByRun[row.ID] = json.Unmarshal(row.Runtime, &rt) == nil && resumable(rt)
		}
	}
	publicRuns := []gin.H{}
	for _, run := range runs {
		publicRuns = append(publicRuns, gin.H{"id": run.ID, "request_id": run.RequestID, "state": run.State, "error": run.Error, "cancel_requested": run.CancelRequested, "created_at": run.CreatedAt, "can_resume": resumableByRun[run.ID], "stream_text": run.StreamText, "stream_turn": run.StreamTurn})
	}
	data(c, gin.H{"conversation": conv, "messages": messages, "runs": publicRuns, "steps": publicSteps, "requests": publicRequests, "attachments": attachments, "has_more": hasMore, "next_cursor": nextCursor, "latest_event_id": latestEventID}, nil)
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
		Content     string           `json:"content"`
		Attachments []string         `json:"attachment_ids"`
		RequestID   string           `json:"request_id"`
		Context     *businessContext `json:"context"`
		PageContext *pageContext     `json:"page_context"`
	}
	if !bind(c, &in) {
		return
	}
	if (!meaningful(in.Content, 12000) && len(in.Attachments) == 0) || len(in.Content) > 12000 || strings.ContainsRune(in.Content, '\x00') || len(in.Attachments) > 20 {
		fail(c, 422, "请输入最多12000字节的消息，每条最多20份附件")
		return
	}
	if _, e := uuid.Parse(in.RequestID); e != nil {
		fail(c, 422, "缺少有效幂等请求ID")
		return
	}
	if !s.chatConfigured() {
		fail(c, 503, "未配置可用模型，请检查服务端接口和密钥")
		return
	}
	if _, ok := s.owned(c); !ok {
		return
	}
	// Verify business context via Gateway outside the FOR UPDATE transaction to avoid pool deadlock.
	contextNote, learnerContext, contextErr := s.verifyContext(c, in.Context)
	if contextErr != nil {
		fail(c, 422, contextErr.Error())
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
	if learnerContext {
		if e = q.MarkAgentLearnerContext(ctx, conv.ID); e != nil {
			data(c, nil, e)
			return
		}
		conv.LearnerContext = true
	}
	if s.Profiles != nil {
		if _, e = s.Profiles.Profile(conv.ProfileID, "chat"); e != nil {
			fail(c, 422, e.Error())
			return
		}
	}
	history, e := q.ListRecentAgentMessages(ctx, conv.ID)
	if e != nil {
		data(c, nil, e)
		return
	}
	allAttachmentIDs := make([]string, 0, len(in.Attachments))
	seenIn := make(map[string]bool, len(in.Attachments))
	seenAll := map[string]bool{}
	for _, id := range in.Attachments {
		if seenIn[id] {
			fail(c, 422, "附件无效、重复或不属于本会话")
			return
		}
		seenIn[id] = true
		if !seenAll[id] {
			seenAll[id] = true
			allAttachmentIDs = append(allAttachmentIDs, id)
		}
	}
	for _, m := range history {
		for _, id := range m.AttachmentIds {
			if !seenAll[id] {
				seenAll[id] = true
				allAttachmentIDs = append(allAttachmentIDs, id)
			}
		}
	}
	attByID := map[string]store.AgentAttachment{}
	if len(allAttachmentIDs) > 0 {
		rows, err := q.ListAgentAttachmentsByIDs(ctx, store.ListAgentAttachmentsByIDsParams{ConversationID: conv.ID, Ids: allAttachmentIDs})
		if err != nil {
			data(c, nil, err)
			return
		}
		for _, row := range rows {
			attByID[row.ID] = row
		}
	}
	meta := []map[string]any{}
	curImageIDs := []string{}
	for _, id := range in.Attachments {
		a, ok := attByID[id]
		if !ok || a.Kind != "upload" {
			fail(c, 422, "附件无效、重复或不属于本会话")
			return
		}
		meta = append(meta, formatAttachmentMeta(a))
		if isImageExt(strings.ToLower(filepath.Ext(a.StoragePath))) {
			curImageIDs = append(curImageIDs, a.ID)
		}
	}
	if len(curImageIDs) > maxConversationImages {
		curImageIDs = curImageIDs[len(curImageIDs)-maxConversationImages:]
	}
	remainingImageBudget := maxConversationImages - len(curImageIDs)
	historyImages := make([][]string, len(history))
	for i := len(history) - 1; i >= 0 && remainingImageBudget > 0; i-- {
		var imgs []string
		for _, id := range history[i].AttachmentIds {
			a, ok := attByID[id]
			if !ok || !isImageExt(strings.ToLower(filepath.Ext(a.StoragePath))) {
				continue
			}
			imgs = append(imgs, a.ID)
		}
		if len(imgs) > remainingImageBudget {
			imgs = imgs[len(imgs)-remainingImageBudget:]
		}
		historyImages[i] = imgs
		remainingImageBudget -= len(imgs)
	}
	messages := []rag.AgentMessage{{Role: "system", Content: systemPrompt("coordinator", identity.Current(c).Role, conv.CourseID, conv.ProfileID)}}
	for i, m := range history {
		content := m.Content
		priorAttachments := []map[string]any{}
		for _, id := range m.AttachmentIds {
			a, ok := attByID[id]
			if !ok {
				continue
			}
			priorAttachments = append(priorAttachments, formatAttachmentMeta(a))
		}
		if len(priorAttachments) > 0 {
			content += "\n历史消息附件（服务端登记元数据）：" + string(raw(priorAttachments))
		}
		messages = append(messages, rag.AgentMessage{Role: m.Role, Content: content, ImageAttachmentIDs: historyImages[i]})
	}
	content := in.Content + contextNote + formatPageContext(in.PageContext)
	if len(meta) > 0 {
		content += "\n本次对话附件（服务端登记元数据）：" + string(raw(meta))
	}
	messages = append(messages, rag.AgentMessage{Role: "user", Content: content, ImageAttachmentIDs: curImageIDs})
	rt := runtime{Mode: conv.Mode, Profile: conv.ProfileID, Tainted: conv.LearnerContext, Frames: []frame{{Domain: "coordinator", Messages: messages}}}
	if in.Attachments == nil {
		in.Attachments = []string{}
	}
	if e = q.CreateAgentMessage(ctx, store.CreateAgentMessageParams{ID: uuid.NewString(), ConversationID: conv.ID, Role: "user", Content: in.Content + contextNote, AttachmentIds: in.Attachments}); e != nil {
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
const (
	maxImageBytes         = 10 << 20
	maxConversationImages = 6
)

func isImageExt(ext string) bool {
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp"
}

func expectedImageMIME(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

func detectImageMIME(head []byte) (string, bool) {
	if len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP" {
		return "image/webp", true
	}
	mime := http.DetectContentType(head)
	if mime == "image/png" || mime == "image/jpeg" || mime == "image/webp" {
		return mime, true
	}
	return "", false
}

func formatAttachmentMeta(a store.AgentAttachment) map[string]any {
	ext := strings.ToLower(filepath.Ext(a.StoragePath))
	mediaKind := "document"
	if isImageExt(ext) {
		mediaKind = "image"
	}
	item := map[string]any{
		"attachment_id": a.ID,
		"filename":      a.Filename,
		"ext":           ext,
		"media_kind":    mediaKind,
		"bytes":         a.SizeBytes,
		"sha256":        a.Sha256,
	}
	if isImageExt(ext) {
		item["is_image"] = true
	}
	return item
}

func sanitizeFilename(name, fallbackExt string) string {
	clean := filepath.Base(name)
	clean = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' || r == '/' || r == ';' {
			return -1
		}
		return r
	}, clean)
	clean = strings.TrimSpace(clean)
	if runes := []rune(clean); len(runes) > 200 {
		clean = string(runes[:200])
	}
	if clean == "" || clean == "." || clean == ".." {
		return "attachment" + fallbackExt
	}
	return clean
}

func sanitizeDownloadFilename(name string) (asciiFallback, utf8Name string) {
	utf8Name = sanitizeFilename(name, "")
	var b strings.Builder
	for _, r := range utf8Name {
		if r >= 0x20 && r <= 0x7e && r != '"' && r != '\\' && r != ';' && r != '/' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	fallback := strings.Trim(b.String(), " ._")
	if fallback == "" {
		fallback = "attachment"
		if ext := filepath.Ext(utf8Name); ext != "" && len(ext) <= 16 {
			fallback += ext
		}
	}
	return fallback, utf8Name
}

func (s *Service) upload(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 31<<20)
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()
	if e := c.Request.ParseMultipartForm(1 << 20); e != nil {
		fail(c, 422, "附件超出30MiB或上传格式无效")
		return
	}
	f, e := c.FormFile("file")
	if e != nil || f.Size < 1 || f.Size > 30<<20 {
		fail(c, 422, "请选择1份非空且不超过30MiB的文件")
		return
	}
	ext := strings.ToLower(filepath.Ext(f.Filename))
	if ext == "" || (!strings.Contains("|.pdf|.docx|.pptx|.txt|.md|.html|.htm|.csv|", "|"+ext+"|") && !isImageExt(ext)) {
		fail(c, 422, "支持PDF、DOCX、PPTX、文本、HTML、CSV及PNG/JPG/WEBP图片")
		return
	}
	if isImageExt(ext) && f.Size > maxImageBytes {
		fail(c, 422, "图片附件须不超过10MiB")
		return
	}
	// Perform disk I/O and SHA256 hashing outside the FOR UPDATE transaction.
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
	var head [512]byte
	headLen, headErr := io.ReadFull(input, head[:])
	if headErr != nil && headErr != io.EOF && headErr != io.ErrUnexpectedEOF {
		_ = input.Close()
		fail(c, 422, "文件读取失败")
		return
	}
	if headLen == 0 {
		_ = input.Close()
		fail(c, 422, "请选择非空文件")
		return
	}
	if isImageExt(ext) {
		detected, ok := detectImageMIME(head[:headLen])
		if !ok || detected != expectedImageMIME(ext) {
			_ = input.Close()
			fail(c, 422, "文件内容与图片格式不匹配，仅支持真实PNG/JPG/WEBP")
			return
		}
	}
	out, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		_ = input.Close()
		data(c, nil, e)
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(path)
		}
	}()
	hash := sha256.New()
	if _, e = out.Write(head[:headLen]); e != nil {
		_ = input.Close()
		_ = out.Close()
		fail(c, 422, "文件写入失败")
		return
	}
	_, _ = hash.Write(head[:headLen])
	limit := int64(30<<20) - int64(headLen) + 1
	if isImageExt(ext) {
		limit = maxImageBytes - int64(headLen) + 1
	}
	nBody, e := io.Copy(io.MultiWriter(out, hash), io.LimitReader(input, limit))
	n := int64(headLen) + nBody
	_ = input.Close()
	if closeErr := out.Close(); e == nil {
		e = closeErr
	}
	maxAllowed := int64(30 << 20)
	if isImageExt(ext) {
		maxAllowed = maxImageBytes
	}
	if n < 1 || n > maxAllowed || e != nil {
		fail(c, 422, "文件读取失败或超出大小限制")
		return
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	cleanFilename := sanitizeFilename(f.Filename, ext)

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
	if count >= 30 || size+n > 150<<20 {
		fail(c, 422, "本会话最多30份上传附件、累计150MiB")
		return
	}
	a, e := q.CreateAgentAttachment(ctx, store.CreateAgentAttachmentParams{ID: id, ConversationID: conv.ID, Filename: cleanFilename, StoragePath: name, Sha256: digest, SizeBytes: n, Kind: "upload"})
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e == nil {
		committed = true
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
	fullPath, e := safeAttachmentPath(a.StoragePath)
	if e != nil {
		fail(c, 404, "附件不存在")
		return
	}
	info, e := os.Stat(fullPath)
	if e != nil || info.IsDir() {
		fail(c, 404, "附件文件不存在或已移除")
		return
	}
	fallback, utf8Name := sanitizeDownloadFilename(a.Filename)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "no-store")
	ext := strings.ToLower(filepath.Ext(a.StoragePath))
	if c.Query("inline") == "1" && isImageExt(ext) {
		if mime := expectedImageMIME(ext); mime != "" {
			c.Header("Content-Type", mime)
		}
		c.Header("Content-Disposition", fmt.Sprintf(`inline; filename="%s"; filename*=UTF-8''%s`, fallback, url.PathEscape(utf8Name)))
		c.File(fullPath)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback, url.PathEscape(utf8Name)))
	c.File(fullPath)
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
	if !s.chatConfigured() {
		fail(c, 503, "未配置可用模型，请检查服务端接口和密钥")
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
	if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,$2))", run.ID, agentLockSalt).Scan(&locked); e != nil {
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
	if (run.State != "waiting_input" && run.State != "waiting_approval") || run.CancelRequested {
		fail(c, 409, "运行已停止或状态已变化，不能再回答")
		return
	}
	var requestSnapshot map[string]any
	_ = json.Unmarshal(req.Snapshot, &requestSnapshot)
	if requestSnapshot["editor"] != nil && in.Decision == "approve" {
		toolName, _ := requestSnapshot["tool"].(string)
		t, ok := lookupTool(toolName)
		args, valid := requestSnapshot["arguments"].(map[string]any)
		if !ok || t.Method != "EDITOR" || !valid {
			fail(c, 422, "编辑任务无效")
			return
		}
		// Use the caller's live session reference instead of a potentially rotated run.SessionHash.
		freshRun := run
		freshRun.SessionHash = identity.SessionReference(c)
		hash, current, err := s.snapshot(ctx, freshRun, conv, t, args)
		if err != nil {
			fail(c, 409, "当前保存对象无法读取，请核对权限与对象状态")
			return
		}
		in.Values = map[string]any{"editor": requestSnapshot["editor"], "changed": hash != requestSnapshot["business_hash"], "saved_snapshot": current, "snapshot_hash": hash}
	} else if req.Kind == "input" && in.Decision == "approve" {
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
	if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,$2))", run.ID, agentLockSalt).Scan(&locked); e != nil {
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
	if (run.State != "waiting_input" && run.State != "waiting_approval") || run.CancelRequested {
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
		if !ok || (!f.Required && v == nil) {
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
			seen := make(map[string]bool, len(items))
			for _, item := range items {
				x, ok := item.(string)
				if !ok || !slices.Contains(f.Options, x) || seen[x] {
					return fmt.Errorf("%s选项无效", f.Key)
				}
				seen[x] = true
			}
		} else {
			x, ok := v.(string)
			if !ok || len(x) > 10000 || strings.ContainsRune(x, '\x00') || f.Required && strings.TrimSpace(x) == "" {
				return fmt.Errorf("%s回答无效", f.Key)
			}
			if f.Kind == "select" {
				if !f.Required && strings.TrimSpace(x) == "" {
					continue
				}
				if !slices.Contains(f.Options, x) {
					return fmt.Errorf("%s选项无效", f.Key)
				}
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

// SSE streams clear the per-response write deadline and tail from latest_event_id
// on fresh connections without replaying historical events.
func (s *Service) stream(c *gin.Context) {
	conv, ok := s.owned(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	rawCursor := strings.TrimSpace(c.GetHeader("Last-Event-ID"))
	if rawCursor == "" {
		rawCursor = strings.TrimSpace(c.Query("after"))
	}
	var after int64
	if rawCursor == "" {
		latest, err := s.Q.GetLatestAgentEventID(ctx, conv.ID)
		if err != nil {
			data(c, nil, err)
			return
		}
		after = latest
	} else {
		parsed, err := strconv.ParseInt(rawCursor, 10, 64)
		if err != nil || parsed < 0 {
			fail(c, 400, "事件游标无效")
			return
		}
		after = parsed
	}
	rc := http.NewResponseController(c.Writer)
	_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, no-transform")
	c.Header("X-Accel-Buffering", "no")
	if _, err := io.WriteString(c.Writer, "retry: 2000\n\n"); err != nil {
		return
	}
	// Unwrap gin.ResponseWriter after headers are written so rc.Flush calls FlushError() on the underlying writer.
	for rw := http.ResponseWriter(c.Writer); ; {
		u, ok := rw.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			rc = http.NewResponseController(rw)
			break
		}
		inner := u.Unwrap()
		if inner == nil || inner == rw {
			rc = http.NewResponseController(rw)
			break
		}
		rw = inner
	}
	if err := rc.Flush(); err != nil {
		return
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * time.Minute)
	defer deadline.Stop()
	lastAuthCheck := time.Now()
	lastWrite := time.Now()
	sessionRef := identity.SessionReference(c)
	sendFinal := func(event string) {
		if ctx.Err() != nil {
			return
		}
		_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if _, err := io.WriteString(c.Writer, "event: "+event+"\ndata: {}\n\n"); err == nil {
			_ = rc.Flush()
		}
	}

	for {
		if ctx.Err() != nil {
			return
		}
		// Re-verify session and course access periodically so revoked members lose live streams.
		if time.Since(lastAuthCheck) >= 15*time.Second {
			user, e := s.Q.GetSessionUser(ctx, sessionRef)
			if e != nil || user.ID != conv.OwnerID {
				sendFinal("auth_error")
				return
			}
			access, e := s.Q.CanAccessCourse(ctx, store.CanAccessCourseParams{CourseID: conv.CourseID, ActorID: user.ID, ActorRole: user.Role})
			if e != nil || !access {
				sendFinal("auth_error")
				return
			}
			lastAuthCheck = time.Now()
		}
		events, e := s.Q.ListAgentEvents(ctx, store.ListAgentEventsParams{ConversationID: conv.ID, ID: after})
		if e != nil {
			return
		}
		if len(events) > 0 {
			_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
			for _, ev := range events {
				if _, err := fmt.Fprintf(c.Writer, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Kind, ev.Payload); err != nil {
					return
				}
				after = ev.ID
			}
			if err := rc.Flush(); err != nil {
				return
			}
			lastWrite = time.Now()
		} else if time.Since(lastWrite) >= 15*time.Second {
			_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if _, err := io.WriteString(c.Writer, ": heartbeat\n\n"); err != nil {
				return
			}
			if err := rc.Flush(); err != nil {
				return
			}
			lastWrite = time.Now()
		}
		if len(events) == 100 {
			if ctx.Err() != nil {
				return
			}
			select {
			case <-deadline.C:
				sendFinal("reconnect")
				return
			default:
				continue
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-deadline.C:
			sendFinal("reconnect")
			return
		case <-ticker.C:
		}
	}
}
