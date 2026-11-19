package rag

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAgentStreamAssemblyAndTruncation(t *testing.T) {
	event := func(v any) string { b, _ := json.Marshal(v); return "data: " + string(b) + "\n\n" }
	choice := func(delta any, finish any) string {
		return event(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
	}
	stream := choice(map[string]any{"content": "正在", "reasoning_content": "不公开的推理"}, nil) + choice(map[string]any{"content": "核对", "tool_calls": []any{map[string]any{"index": 0, "id": "call-1", "type": "function", "function": map[string]string{"name": "source_read", "arguments": "{\"id\":"}}}}, nil) + choice(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]string{"arguments": "\"abc\"}"}}}}, nil) + choice(map[string]any{}, "tool_calls") + event(map[string]any{"choices": []any{}, "usage": map[string]int{"prompt_tokens": 33, "completion_tokens": 8}}) + "data: [DONE]\n\n"
	response := func(body, kind string) *http.Response {
		return &http.Response{Header: http.Header{"Content-Type": []string{kind}}, Body: io.NopCloser(strings.NewReader(body))}
	}
	snapshots := []string{}
	msg, finish, u, e := decodeAgentResponse(response(stream, "text/event-stream; charset=utf-8"), func(text string) error { snapshots = append(snapshots, text); return nil })
	if e != nil || finish != "tool_calls" || msg.Content != "正在核对" || len(msg.ToolCalls) != 1 || msg.ToolCalls[0].Function.Arguments != `{"id":"abc"}` || u.Prompt != 33 || len(snapshots) != 2 {
		t.Fatal(msg, finish, u, snapshots, e)
	}
	for _, s := range snapshots {
		if strings.Contains(s, "推理") || strings.Contains(s, "abc") {
			t.Fatal("private tool delta exposed")
		}
	}
	for _, broken := range []string{choice(map[string]any{"content": "未完成"}, nil), choice(map[string]any{"content": "截断"}, "length") + "data: [DONE]\n\n", "data: {bad}\n\ndata: [DONE]\n\n"} {
		if _, _, _, e := decodeAgentResponse(response(broken, "text/event-stream"), nil); e == nil {
			t.Fatal("broken stream accepted")
		}
	}
	// Clean EOF after valid finish_reason (without [DONE]) is accepted.
	noDone := strings.Replace(stream, "data: [DONE]\n\n", "", 1)
	if msg, finish, u, e := decodeAgentResponse(response(noDone, "text/event-stream"), nil); e != nil || finish != "tool_calls" || msg.Content != "正在核对" || u.Prompt != 33 {
		t.Fatalf("clean EOF after finish_reason failed: msg=%+v finish=%q u=%+v err=%v", msg, finish, u, e)
	}
	// Trailing empty-delta chunk containing usage after finish_reason is accepted.
	trailingUsage := choice(map[string]any{"content": "完成"}, "stop") + event(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 12, "completion_tokens": 4}}) + "data: [DONE]\n\n"
	if msg, finish, u, e := decodeAgentResponse(response(trailingUsage, "text/event-stream"), nil); e != nil || finish != "stop" || msg.Content != "完成" || u.Prompt != 12 {
		t.Fatalf("trailing empty-delta usage chunk failed: msg=%+v finish=%q u=%+v err=%v", msg, finish, u, e)
	}
	// Repeated tool_call id/name are not duplicated, and empty arguments default to "{}".
	repeatedTool := choice(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call-dup", "type": "function", "function": map[string]string{"name": "course_context", "arguments": ""}}}}, nil) +
		choice(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call-dup", "type": "function", "function": map[string]string{"name": "course_context", "arguments": ""}}}}, "tool_calls") +
		"data: [DONE]\n\n"
	if msg, finish, _, e := decodeAgentResponse(response(repeatedTool, "text/event-stream"), nil); e != nil || finish != "tool_calls" || len(msg.ToolCalls) != 1 || msg.ToolCalls[0].ID != "call-dup" || msg.ToolCalls[0].Function.Name != "course_context" || msg.ToolCalls[0].Function.Arguments != "{}" {
		t.Fatalf("repeated tool_call / empty args failed: msg=%+v finish=%q err=%v", msg, finish, e)
	}
	jsonReply := `{"choices":[{"message":{"role":"assistant","content":"兼容回退"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3}}`
	msg, finish, u, e = decodeAgentResponse(response(jsonReply, "application/json"), nil)
	if e != nil || msg.Content != "兼容回退" || finish != "stop" || u.Prompt != 3 {
		t.Fatal("same-response JSON fallback failed", e)
	}
}
