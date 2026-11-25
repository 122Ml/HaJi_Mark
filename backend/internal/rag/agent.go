package rag

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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

type AgentImage struct {
	DataURL string `json:"-"`
}

type AgentMessage struct {
	Role               string       `json:"role"`
	Content            string       `json:"content"`
	ImageAttachmentIDs []string     `json:"image_attachment_ids,omitempty"`
	Images             []AgentImage `json:"-"`
	ToolCallID         string       `json:"tool_call_id,omitempty"`
	ToolCalls          []ToolCall   `json:"tool_calls,omitempty"`
	ReasoningContent   string       `json:"reasoning_content,omitempty"`
}

func serializeAgentWireMessages(messages []AgentMessage) ([]any, int) {
	wire := make([]any, 0, len(messages))
	imageCount := 0
	for _, m := range messages {
		if len(m.Images) == 0 {
			wire = append(wire, m)
			continue
		}
		text := m.Content
		if strings.TrimSpace(text) == "" {
			text = "请查看附图。"
		}
		parts := make([]any, 0, 1+len(m.Images))
		parts = append(parts, map[string]any{"type": "text", "text": text})
		for _, img := range m.Images {
			if strings.TrimSpace(img.DataURL) == "" {
				continue
			}
			parts = append(parts, map[string]any{
				"type":      "image_url",
				"image_url": map[string]string{"url": img.DataURL},
			})
			imageCount++
		}
		wire = append(wire, map[string]any{"role": m.Role, "content": parts})
	}
	return wire, imageCount
}

// AgentChat retains the full assistant/tool exchange. It uses the same call
// ledger and cumulative budget as extraction, embeddings and grading.
func (m *Models) AgentChat(ctx context.Context, course, actor, profile string, messages []AgentMessage, tools []any) (AgentMessage, error) {
	return m.agentChat(ctx, course, actor, profile, messages, tools, nil)
}

func (m *Models) AgentChatStream(ctx context.Context, course, actor, profile string, messages []AgentMessage, tools []any, emit func(string) error) (AgentMessage, error) {
	return m.agentChat(ctx, course, actor, profile, messages, tools, emit)
}

func (m *Models) agentChat(ctx context.Context, course, actor, profile string, messages []AgentMessage, tools []any, emit func(string) error) (AgentMessage, error) {
	p, err := m.Profile(profile, "chat")
	if err != nil {
		return AgentMessage{}, err
	}
	wireMessages, imageCount := serializeAgentWireMessages(messages)
	body := map[string]any{"model": p.Model, "messages": wireMessages, "max_tokens": 3000, "tools": tools, "stream": false}
	streaming := emit != nil && !p.DisableStreaming
	if streaming {
		body["stream"] = true
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	if p.Thinking != "" {
		body["thinking"] = map[string]string{"type": p.Thinking}
	}
	// Estimate text payload separately from base64 image blobs; reserve bounded image token budget.
	textRaw, _ := json.Marshal(map[string]any{"messages": messages, "tools": tools})
	imageReserve := 1024
	if p.ImageTokenLimit > 0 {
		imageReserve = p.ImageTokenLimit
	}
	estimatedInput := len(textRaw) + imageCount*imageReserve
	var out struct {
		Choices []struct {
			Message AgentMessage `json:"message"`
			Finish  string       `json:"finish_reason"`
		} `json:"choices"`
	}
	var msg AgentMessage
	finish := ""
	if streaming {
		err = m.callDecoded(ctx, course, actor, "agent", p, "/chat/completions", body, estimatedInput, 3000, func(resp *http.Response) (usage, error) {
			var u usage
			var e error
			msg, finish, u, e = decodeAgentResponse(resp, emit)
			return u, e
		})
	} else {
		err = m.call(ctx, course, actor, "agent", p, "/chat/completions", body, estimatedInput, 3000, &out)
		if len(out.Choices) == 1 {
			msg = out.Choices[0].Message
			finish = out.Choices[0].Finish
		}
	}
	if err != nil {
		return AgentMessage{}, err
	}
	if finish != "stop" && finish != "tool_calls" {
		return AgentMessage{}, errors.New("Agent回复为空或截断，请缩小任务后显式重试")
	}
	if len(msg.ToolCalls) > 8 {
		return AgentMessage{}, errors.New("单轮工具调用超过8个")
	}
	if strings.TrimSpace(msg.Content) == "" && len(msg.ToolCalls) == 0 {
		return AgentMessage{}, errors.New("Agent未返回回答或工具调用")
	}
	msg.Role = "assistant"
	if len(msg.Content) > 120000 || len(msg.ReasoningContent) > 300000 {
		return AgentMessage{}, errors.New("Agent输出过长")
	}
	seen := map[string]bool{}
	for i := range msg.ToolCalls {
		t := &msg.ToolCalls[i]
		if strings.TrimSpace(t.Function.Arguments) == "" {
			t.Function.Arguments = "{}"
		}
		if t.Type == "" {
			t.Type = "function"
		}
		var args map[string]any
		if t.ID == "" || len(t.ID) > 200 || seen[t.ID] || t.Type != "function" || t.Function.Name == "" || len(t.Function.Name) > 200 || len(t.Function.Arguments) > 120000 || json.Unmarshal([]byte(t.Function.Arguments), &args) != nil || args == nil {
			return AgentMessage{}, errors.New("模型工具调用格式无效")
		}
		seen[t.ID] = true
	}
	return msg, nil
}
