package rag

import (
	"encoding/json"
	"testing"
)

func segmentPayload(ids ...string) map[string]any {
	frags := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		frags = append(frags, map[string]any{"id": id, "time_start_ms": 0, "time_end_ms": 0})
	}
	return map[string]any{
		"fragments":     frags,
		"course_points": []map[string]any{{"id": "p1", "kind": "point"}},
	}
}

func TestValidateSegmentsAllowsSharedFragmentWithQuote(t *testing.T) {
	out := map[string]json.RawMessage{
		"segments": json.RawMessage(`[
			{"title":"概念","relation":"point","knowledge_point_id":"p1","fragment_ids":["f1"],"time_start_ms":0,"time_end_ms":0},
			{"title":"方法","relation":"sequence","knowledge_point_id":"","fragment_ids":["f1"],"split_quotes":["第二段讲方法"],"time_start_ms":0,"time_end_ms":0}
		]`),
	}
	if err := validateSegments(out, segmentPayload("f1")); err != nil {
		t.Fatalf("shared fragment with quote must pass: %v", err)
	}
}

func TestValidateSegmentsRejectsSharedFragmentWithoutQuote(t *testing.T) {
	out := map[string]json.RawMessage{
		"segments": json.RawMessage(`[
			{"title":"概念","relation":"point","knowledge_point_id":"p1","fragment_ids":["f1"],"time_start_ms":0,"time_end_ms":0},
			{"title":"方法","relation":"sequence","knowledge_point_id":"","fragment_ids":["f1"],"time_start_ms":0,"time_end_ms":0}
		]`),
	}
	if err := validateSegments(out, segmentPayload("f1")); err == nil {
		t.Fatal("shared fragment without quote must be rejected")
	}
}

func TestValidateSegmentsRejectsQuoteWithoutSharedFragment(t *testing.T) {
	out := map[string]json.RawMessage{
		"segments": json.RawMessage(`[
			{"title":"概念","relation":"point","knowledge_point_id":"p1","fragment_ids":["f1"],"split_quotes":["第二段"],"time_start_ms":0,"time_end_ms":0}
		]`),
	}
	if err := validateSegments(out, segmentPayload("f1")); err == nil {
		t.Fatal("quote on a non-shared fragment must be rejected")
	}
}

func TestValidateSegmentsRejectsTripleSplit(t *testing.T) {
	out := map[string]json.RawMessage{
		"segments": json.RawMessage(`[
			{"title":"甲","relation":"point","knowledge_point_id":"p1","fragment_ids":["f1"],"time_start_ms":0,"time_end_ms":0},
			{"title":"乙","relation":"sequence","knowledge_point_id":"","fragment_ids":["f1"],"split_quotes":["第二段"],"time_start_ms":0,"time_end_ms":0},
			{"title":"丙","relation":"sequence","knowledge_point_id":"","fragment_ids":["f1"],"split_quotes":["第三段"],"time_start_ms":0,"time_end_ms":0}
		]`),
	}
	if err := validateSegments(out, segmentPayload("f1")); err == nil {
		t.Fatal("splitting one fragment into 3+ segments must be rejected")
	}
}

func TestValidateSegmentsRejectsVideoSplit(t *testing.T) {
	out := map[string]json.RawMessage{
		"segments": json.RawMessage(`[
			{"title":"甲","relation":"point","knowledge_point_id":"p1","fragment_ids":["v1"],"time_start_ms":0,"time_end_ms":5000},
			{"title":"乙","relation":"sequence","knowledge_point_id":"","fragment_ids":["v1"],"split_quotes":["第二段"],"time_start_ms":0,"time_end_ms":5000}
		]`),
	}
	payload := map[string]any{
		"fragments":     []map[string]any{{"id": "v1", "time_start_ms": 0, "time_end_ms": 5000}},
		"course_points": []map[string]any{{"id": "p1", "kind": "point"}},
	}
	if err := validateSegments(out, payload); err == nil {
		t.Fatal("video fragment split must be rejected")
	}
}
