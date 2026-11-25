package rag

import (
	"encoding/json"
	"testing"
)

func TestSerializeAgentWireMessages(t *testing.T) {
	msgs := []AgentMessage{
		{Role: "system", Content: "系统提示"},
		{
			Role:    "user",
			Content: "按截图建立课程目录",
			Images:  []AgentImage{{DataURL: "data:image/png;base64,iVBORw0KGgo="}},
		},
		{Role: "assistant", Content: "好的"},
		{
			Role:   "user",
			Images: []AgentImage{{DataURL: "   "}, {DataURL: "data:image/jpeg;base64,/9j/4AAQ"}},
		},
	}

	wire, count := serializeAgentWireMessages(msgs)
	if count != 2 || len(wire) != 4 {
		t.Fatalf("unexpected count=%d len=%d", count, len(wire))
	}

	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	// Message 0 has no images -> string content.
	if _, ok := decoded[0]["content"].(string); !ok {
		t.Fatalf("expected string content for text-only message, got %T", decoded[0]["content"])
	}

	// Message 1 has text + image_url parts.
	parts1, ok := decoded[1]["content"].([]any)
	if !ok || len(parts1) != 2 {
		t.Fatalf("expected 2 content parts on msg 1, got %#v", decoded[1]["content"])
	}
	p10 := parts1[0].(map[string]any)
	p11 := parts1[1].(map[string]any)
	if p10["type"] != "text" || p10["text"] != "按截图建立课程目录" {
		t.Fatalf("unexpected text part: %#v", p10)
	}
	if p11["type"] != "image_url" {
		t.Fatalf("expected image_url part, got %#v", p11)
	}

	// Message 3 had empty text and one blank image -> fallback prompt + 1 image_url.
	parts3, ok := decoded[3]["content"].([]any)
	if !ok || len(parts3) != 2 {
		t.Fatalf("expected 2 parts on msg 3, got %#v", decoded[3]["content"])
	}
	if parts3[0].(map[string]any)["text"] != "请查看附图。" {
		t.Fatalf("expected fallback prompt, got %#v", parts3[0])
	}
}
