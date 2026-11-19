package rag

import (
	"context"
	"encoding/json"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"strings"
	"testing"
)

func TestPublicImportRejectsUnsafeDestinations(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "ftp://example.com/a", "https://user:pass@example.com/a", "http://example.com:8080/a", "data:text/html,test"} {
		if _, e := validPublicURL(raw); e == nil {
			t.Errorf("allowed unsafe URL %s", raw)
		}
	}
	for _, address := range []string{
		"127.0.0.1:80", "10.0.0.2:80", "169.254.169.254:80", "192.168.1.2:443",
		"100.100.100.200:80", "100.64.0.1:80", "198.18.0.1:80", "240.0.0.1:80",
		"[::1]:80", "[::ffff:127.0.0.1]:80", "[64:ff9b::169.254.169.254]:80",
		"[64:ff9b:1::1]:80", "[fec0::1]:80", "[2002:7f00:1::1]:80",
		"[2001::1]:80", "[2001:db8::1]:80", "[100::1]:80", "[fc00::1]:80",
	} {
		if c, e := publicDial(context.Background(), "tcp", address); e == nil {
			c.Close()
			t.Errorf("allowed private address %s", address)
		}
	}
	for _, badPath := range []string{"", "../secret", "/etc/passwd", `a\..\..\b`, "ok\x00bad"} {
		if _, e := SafeMaterialPath(badPath); e == nil {
			t.Errorf("allowed unsafe material path %q", badPath)
		}
	}
	if _, e := SafeMaterialPath("sub/file.pdf"); e != nil {
		t.Errorf("rejected valid material path: %v", e)
	}
}

func TestPaperCoverageAndAnswerOrigin(t *testing.T) {
	fs := []store.MaterialFragment{{ID: "page1", Body: "题干上半"}, {ID: "page2", Body: "题干下半"}, {ID: "key", Body: "原卷解答：分层检查"}}
	raw := `{"questions":[{"title":"跨页主观题","prompt":"题干上半\n题干下半","type":"subjective","max_score":10,"source_fragment_ids":["page1","page2"],"answer_origin":"missing"}],"excluded":[{"fragment_id":"key","reason":"答案区"}],"review_status":"pending_teacher_review"}`
	makeOutput := func() PaperOutput {
		var out PaperOutput
		if e := json.Unmarshal([]byte(raw), &out); e != nil {
			t.Fatal(e)
		}
		return out
	}
	good := makeOutput()
	if e := ValidatePaper(good, fs, nil); e != nil {
		t.Fatal(e)
	}
	extracted := makeOutput()
	extracted.Questions[0].AnswerOrigin = "extracted"
	extracted.Questions[0].ReferenceAnswer = "分层检查"
	if e := ValidatePaper(extracted, fs, nil); e != nil {
		t.Fatal("valid original answer rejected", e)
	}
	tests := []struct {
		name   string
		mutate func(*PaperOutput)
	}{
		{"dropped page", func(o *PaperOutput) { o.Questions[0].FragmentIDs = []string{"page1"} }},
		{"foreign evidence", func(o *PaperOutput) { o.Questions[0].FragmentIDs = append(o.Questions[0].FragmentIDs, "foreign") }},
		{"invented answer", func(o *PaperOutput) { o.Questions[0].ReferenceAnswer = "编造答案" }},
		{"false extraction", func(o *PaperOutput) {
			o.Questions[0].AnswerOrigin = "extracted"
			o.Questions[0].ReferenceAnswer = "编造答案"
		}},
		{"invented extracted option", func(o *PaperOutput) {
			o.Questions[0].AnswerOrigin = "extracted"
			o.Questions[0].CorrectAnswer = "原卷不存在的选项"
		}},
		{"empty extracted answer", func(o *PaperOutput) { o.Questions[0].AnswerOrigin = "extracted" }},
		{"unreviewed status", func(o *PaperOutput) { o.ReviewStatus = "confirmed" }},
		{"foreign figure", func(o *PaperOutput) { o.Questions[0].AssetIDs = []string{"foreign-figure"} }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			out := makeOutput()
			tc.mutate(&out)
			if ValidatePaper(out, fs, nil) == nil {
				t.Fatal("invalid paper accepted")
			}
		})
	}
}

func TestSuggestionReferencesStayInInput(t *testing.T) {
	payload := map[string]any{
		"fragments":       []map[string]string{{"id": "f"}},
		"topics":          []map[string]string{{"id": "t"}},
		"course_points":   []map[string]string{{"id": "p", "kind": "point"}, {"id": "ch", "kind": "chapter"}},
		"known_knowledge": []map[string]string{{"id": "k"}},
	}
	raw := `{"outline":[{"title":"章节","fragment_ids":["f"]}],"topic_ids":["t"],"knowledge_point_ids":["p"],"similar_knowledge_ids":["k"],"new_topic_names":[],"new_points":[],"tags":[],"reason":"原文依据"}`
	withPoint := `{"outline":[{"title":"章节","fragment_ids":["f"]}],"topic_ids":["t"],"knowledge_point_ids":["p"],"similar_knowledge_ids":["k"],"new_topic_names":[],"new_points":[{"title":"新知识点","parent_id":"ch","duplicate_of":"","reason":"原文依据"}],"tags":[],"reason":"原文依据"}`
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"valid", raw, true},
		{"valid new point under chapter", withPoint, true},
		{"chapter rejected", strings.Replace(raw, `["p"]`, `["ch"]`, 1), false},
		{"foreign topic", strings.Replace(raw, `["t"]`, `["foreign"]`, 1), false},
		{"foreign fragment", strings.Replace(raw, `["f"]`, `["foreign"]`, 1), false},
		{"missing field", strings.Replace(raw, `"tags":[],`, "", 1), false},
		{"missing new points", strings.Replace(raw, `"new_points":[],`, "", 1), false},
		{"duplicate id", strings.Replace(raw, `["p"]`, `["p","p"]`, 1), false},
		{"new point under a point", strings.Replace(withPoint, `"parent_id":"ch"`, `"parent_id":"p"`, 1), false},
		{"new point merge target is chapter", strings.Replace(withPoint, `"duplicate_of":""`, `"duplicate_of":"ch"`, 1), false},
		{"new point empty title", strings.Replace(withPoint, `"title":"新知识点"`, `"title":""`, 1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out map[string]json.RawMessage
			_ = json.Unmarshal([]byte(tc.body), &out)
			if (validateSuggestions(out, payload) == nil) != tc.valid {
				t.Fatal("unexpected validation result")
			}
		})
	}
}

func TestValidateSegmentsExactPartition(t *testing.T) {
	payload := map[string]any{
		"fragments":     []map[string]string{{"id": "f1"}, {"id": "f2"}},
		"course_points": []map[string]string{{"id": "p", "kind": "point"}, {"id": "ch", "kind": "chapter"}},
	}
	valid := `{"segments":[{"title":"第一部分","relation":"point","fragment_ids":["f1"],"knowledge_point_id":"p","reason":"对应知识点"},{"title":"第二部分","relation":"sequence","fragment_ids":["f2"],"knowledge_point_id":"","reason":"顺承衔接"}]}`
	for _, tc := range []struct {
		name, body string
		wantValid  bool
	}{
		{"valid partition", valid, true},
		{"missing fragment", `{"segments":[{"title":"只有第一部分","relation":"sequence","fragment_ids":["f1"],"knowledge_point_id":"","reason":"缺第二段"}]}`, false},
		{"duplicate fragment", strings.Replace(valid, `"fragment_ids":["f2"]`, `"fragment_ids":["f1","f2"]`, 1), false},
		{"foreign fragment", strings.Replace(valid, `"f2"`, `"f3"`, 1), false},
		{"non-point target", strings.Replace(valid, `"knowledge_point_id":"p"`, `"knowledge_point_id":"ch"`, 1), false},
		{"sequence with point id", `{"segments":[{"title":"第一部分","relation":"sequence","fragment_ids":["f1","f2"],"knowledge_point_id":"p","reason":"冲突"}]}`, false},
		{"empty title", strings.Replace(valid, `"第一部分"`, `"   "`, 1), false},
		{"out of order", `{"segments":[{"title":"第二部分","relation":"sequence","fragment_ids":["f2"],"knowledge_point_id":"","reason":"顺承"},{"title":"第一部分","relation":"point","fragment_ids":["f1"],"knowledge_point_id":"p","reason":"对应"}]}`, false},
		{"nul byte in title", strings.Replace(valid, `"第一部分"`, `"第一\u0000部分"`, 1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out map[string]json.RawMessage
			_ = json.Unmarshal([]byte(tc.body), &out)
			if (validateSegments(out, payload) == nil) != tc.wantValid {
				t.Fatal("unexpected segment validation result")
			}
		})
	}
}
