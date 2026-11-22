package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
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

func TestVideoHelpersAndValidTimeSpan(t *testing.T) {
	for _, ext := range []string{".mp4", ".MP4", " .mov ", ".mkv", ".webm", ".m4v"} {
		if !IsVideoExtension(ext) {
			t.Errorf("expected %q to be a video extension", ext)
		}
	}
	for _, ext := range []string{"", ".pdf", ".txt", ".avi", "mp4"} {
		if IsVideoExtension(ext) {
			t.Errorf("expected %q not to be a video extension", ext)
		}
	}
	if !IsVideoSource("video/mp4", "x.bin") || !IsVideoSource(" VIDEO/webm ", "") || !IsVideoSource("application/octet-stream", "clip.MKV") {
		t.Fatal("expected video sources to be detected")
	}
	if IsVideoSource("application/pdf", "doc.pdf") || IsVideoSource("", "notes.md") {
		t.Fatal("non-video source misclassified as video")
	}
	for _, tc := range []struct {
		start, end int64
		want       bool
	}{
		{0, 0, true},
		{0, 1, true},
		{100, 500, true},
		{0, math.MaxInt32, true},
		{1000, 0, false},
		{-1, 100, false},
		{500, 500, false},
		{500, 200, false},
		{0, int64(math.MaxInt32) + 1, false},
	} {
		if got := ValidTimeSpan(tc.start, tc.end); got != tc.want {
			t.Errorf("ValidTimeSpan(%d, %d) = %v, want %v", tc.start, tc.end, got, tc.want)
		}
	}
}

func TestSampleFragmentsUniform(t *testing.T) {
	small := make([]store.MaterialFragment, 12)
	for i := range small {
		small[i] = store.MaterialFragment{ID: fmt.Sprintf("f-%d", i), Position: int32(i)}
	}
	if got := sampleFragments(small, 60); len(got) != 12 || got[0].ID != "f-0" || got[11].ID != "f-11" {
		t.Fatalf("unexpected small sample: len=%d", len(got))
	}

	large := make([]store.MaterialFragment, 125)
	for i := range large {
		large[i] = store.MaterialFragment{ID: fmt.Sprintf("f-%d", i), Position: int32(i)}
	}
	sampled := sampleFragments(large, 60)
	if len(sampled) != 60 {
		t.Fatalf("expected 60 sampled fragments, got %d", len(sampled))
	}
	if sampled[0].ID != "f-0" || sampled[59].ID != "f-124" {
		t.Fatalf("expected uniform endpoints f-0..f-124, got %s..%s", sampled[0].ID, sampled[59].ID)
	}
	seen := map[string]bool{}
	prevPos := int32(-1)
	for _, f := range sampled {
		if seen[f.ID] || f.Position <= prevPos {
			t.Fatalf("sampled fragments not strictly increasing/unique: %+v", f)
		}
		seen[f.ID] = true
		prevPos = f.Position
	}
}

func TestValidateSegmentsTimecodesAndNormalization(t *testing.T) {
	videoPayload := map[string]any{
		"fragments": []map[string]any{
			{"id": "f1", "time_start_ms": 0, "time_end_ms": 10000},
			{"id": "f2", "time_start_ms": 10000, "time_end_ms": 25000},
			{"id": "f3", "time_start_ms": 25000, "time_end_ms": 40000},
		},
		"course_points": []map[string]string{{"id": "p", "kind": "point"}},
	}

	// Valid video segments normalize omitted or inaccurate spans to exact [firstStart, lastEnd].
	var videoOut map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"segments":[{"title":"段一","relation":"point","fragment_ids":["f1","f2"],"knowledge_point_id":"p","time_start_ms":100,"time_end_ms":20000,"reason":"要点"},{"title":"段二","relation":"sequence","fragment_ids":["f3"],"knowledge_point_id":"","time_start_ms":0,"time_end_ms":0,"reason":"顺承"}]}`), &videoOut)
	if err := validateSegments(videoOut, videoPayload); err != nil {
		t.Fatalf("expected video segments to validate and normalize: %v", err)
	}
	var normalized []struct {
		TimeStartMs int64 `json:"time_start_ms"`
		TimeEndMs   int64 `json:"time_end_ms"`
	}
	if err := json.Unmarshal(videoOut["segments"], &normalized); err != nil || len(normalized) != 2 {
		t.Fatalf("failed to decode normalized segments: %v", err)
	}
	if normalized[0].TimeStartMs != 0 || normalized[0].TimeEndMs != 25000 || normalized[1].TimeStartMs != 25000 || normalized[1].TimeEndMs != 40000 {
		t.Fatalf("unexpected normalized video timecodes: %+v", normalized)
	}

	// Invalid video spans must be rejected.
	for _, bad := range []struct {
		name, body string
	}{
		{"end zero with nonzero start", `{"segments":[{"title":"段一","relation":"sequence","fragment_ids":["f1","f2","f3"],"knowledge_point_id":"","time_start_ms":1000,"time_end_ms":0,"reason":"bad"}]}`},
		{"negative start", `{"segments":[{"title":"段一","relation":"sequence","fragment_ids":["f1","f2","f3"],"knowledge_point_id":"","time_start_ms":-1,"time_end_ms":500,"reason":"bad"}]}`},
		{"equal start end", `{"segments":[{"title":"段一","relation":"sequence","fragment_ids":["f1","f2","f3"],"knowledge_point_id":"","time_start_ms":500,"time_end_ms":500,"reason":"bad"}]}`},
		{"int32 overflow", fmt.Sprintf(`{"segments":[{"title":"段一","relation":"sequence","fragment_ids":["f1","f2","f3"],"knowledge_point_id":"","time_start_ms":0,"time_end_ms":%d,"reason":"bad"}]}`, int64(math.MaxInt32)+1)},
	} {
		t.Run(bad.name, func(t *testing.T) {
			var out map[string]json.RawMessage
			_ = json.Unmarshal([]byte(bad.body), &out)
			if validateSegments(out, videoPayload) == nil {
				t.Fatalf("expected %s to be rejected", bad.name)
			}
		})
	}

	// Non-video fragments must enforce 0,0 in normalized segments and still reject invalid spans.
	docPayload := map[string]any{
		"fragments":     []map[string]any{{"id": "d1"}, {"id": "d2"}},
		"course_points": []map[string]string{},
	}
	var docOut map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"segments":[{"title":"文档段","relation":"sequence","fragment_ids":["d1","d2"],"knowledge_point_id":"","time_start_ms":100,"time_end_ms":500,"reason":"doc"}]}`), &docOut)
	if err := validateSegments(docOut, docPayload); err != nil {
		t.Fatalf("expected non-video segments to normalize to 0,0: %v", err)
	}
	normalized = nil
	_ = json.Unmarshal(docOut["segments"], &normalized)
	if len(normalized) != 1 || normalized[0].TimeStartMs != 0 || normalized[0].TimeEndMs != 0 {
		t.Fatalf("expected non-video segment times normalized to 0,0, got %+v", normalized)
	}

	var badDoc map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"segments":[{"title":"文档段","relation":"sequence","fragment_ids":["d1","d2"],"knowledge_point_id":"","time_start_ms":1000,"time_end_ms":0,"reason":"bad"}]}`), &badDoc)
	if validateSegments(badDoc, docPayload) == nil {
		t.Fatal("expected invalid (1000,0) on non-video segment to fail")
	}
}
