package rag

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}
type AgentMessage struct {
	Role             string     `json:"role"`
	Content          string     `json:"content"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
}

// AgentChat retains the full assistant/tool exchange. It uses the same call
// ledger and cumulative budget as extraction, embeddings and grading.
func (m *Models) AgentChat(ctx context.Context, course, actor, profile string, messages []AgentMessage, tools []any) (AgentMessage, error) {
	p, err := m.Profile(profile, "chat")
	if err != nil {
		return AgentMessage{}, err
	}
	body := map[string]any{"model": p.Model, "messages": messages, "max_tokens": 3000, "tools": tools, "stream": false}
	if p.Thinking != "" {
		body["thinking"] = map[string]string{"type": p.Thinking}
	}
	raw, _ := json.Marshal(body)
	var out struct {
		Choices []struct {
			Message AgentMessage `json:"message"`
			Finish  string       `json:"finish_reason"`
		} `json:"choices"`
	}
	if err = m.call(ctx, course, actor, "agent", p, "/chat/completions", body, len(raw), 3000, &out); err != nil {
		return AgentMessage{}, err
	}
	if len(out.Choices) != 1 || out.Choices[0].Finish == "length" {
		return AgentMessage{}, errors.New("Agent回复为空或截断，请缩小任务后显式重试")
	}
	msg := out.Choices[0].Message
	if len(msg.ToolCalls) > 8 {
		return AgentMessage{}, errors.New("单轮工具调用超过8个")
	}
	if strings.TrimSpace(msg.Content) == "" && len(msg.ToolCalls) == 0 {
		return AgentMessage{}, errors.New("Agent未返回回答或工具调用")
	}
	msg.Role = "assistant"
	seen := map[string]bool{}
	for _, t := range msg.ToolCalls {
		var args map[string]any
		if t.ID == "" || len(t.ID) > 200 || seen[t.ID] || t.Type != "function" || len(t.Function.Arguments) > 120000 || json.Unmarshal([]byte(t.Function.Arguments), &args) != nil || args == nil {
			return AgentMessage{}, errors.New("模型工具调用格式无效")
		}
		seen[t.ID] = true
	}
	return msg, nil
}
