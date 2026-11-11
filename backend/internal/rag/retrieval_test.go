package rag

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestChunksPreserveChinese(t *testing.T) {
	input := strings.Repeat("边界值分析应覆盖合法区间与非法区间。", 200)
	parts := chunks(input)
	if len(parts) < 2 {
		t.Fatal("expected chunks")
	}
	for _, p := range parts {
		if !utf8.ValidString(p) || len([]rune(p)) > 1200 {
			t.Fatal("invalid unicode or oversized chunk")
		}
	}
	if strings.Join(parts, "") != input {
		t.Fatal("source content lost")
	}
}
func TestTokensChinese(t *testing.T) {
	tokens := Tokens("边界值分析 测试17与18 PostgreSQL")
	if len(tokens) < 3 {
		t.Fatal(tokens)
	}
	query := queryTokens("' | ! () <=>")
	if strings.Contains(query, " | ") {
		t.Fatal("operators must not survive as tokens")
	}
}
func TestGradeRejectsInventedEvidence(t *testing.T) {
	in := JobInput{Answer: "测试18和60。", Criteria: json.RawMessage(`[{"id":"D1","max_score":6}]`)}
	cases := []struct {
		name, quote  string
		score, total int
		valid        bool
	}{{"valid", "测试18和60", 2, 2, true}, {"fabricated", "测试17和61", 2, 2, false}, {"no evidence", "", 2, 2, false}, {"bad sum", "测试18和60", 2, 3, false}, {"over maximum", "测试18和60", 7, 7, false}, {"missing answer", "", 0, 0, true}}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]any{"points": []map[string]any{{"criterion_id": "D1", "score": c.score, "quote": c.quote, "feedback": "test"}}, "score": c.total, "feedback": "test"})
			var out map[string]json.RawMessage
			_ = json.Unmarshal(raw, &out)
			if e := ValidateGrade(out, in); (e == nil) != c.valid {
				t.Fatalf("valid=%v error=%v", c.valid, e)
			}
		})
	}
}
