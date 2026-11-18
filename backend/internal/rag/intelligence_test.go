package rag

import (
	"strings"
	"testing"
)

func TestDiagnosisEvidenceSelection(t *testing.T) {
	answer := "  异常判断正确。可以给所有操作加锁，事务会自动解决并发问题。\n"
	in := IntelligenceInput{Labels: BaseDiagnosisLabels, Answers: []DiagnosisAnswer{{SubmissionID: "a", Answer: answer}, {SubmissionID: "blank", Answer: ""}}}
	spans := diagnosisSpans(in.Answers)
	if len(spans) != 2 || spans[1].ID != "a:1" || !strings.Contains(answer, spans[1].Quote) {
		t.Fatal("evidence must preserve the original substring", spans)
	}
	raw := `{"findings":[{"label_id":"concept","title":"概念混淆","explanation":"本次对锁的作用作了过度推断","evidence_ids":["a:1"]}],"unclassified":["blank"]}`
	out, err := decodeDiagnosis(raw, spans)
	if err != nil || ValidateIntelligence("diagnosis", in, out, false) != nil || out.Findings[0].Evidence[0].Quote != "可以给所有操作加锁，事务会自动解决并发问题。" {
		t.Fatal("selected evidence must be resolved by the server", out, err)
	}
	if _, err = decodeDiagnosis(strings.Replace(raw, "a:1", "foreign:1", 1), spans); err == nil {
		t.Fatal("unknown evidence ID accepted")
	}
	if _, err = decodeDiagnosis(strings.Replace(raw, `"evidence_ids":["a:1"]`, `"evidence_ids":["a:1"],"evidence":[{"submission_id":"a","quote":"model rewrite"}]`, 1), spans); err == nil {
		t.Fatal("model-written quotations accepted")
	}
	duplicate := strings.Replace(raw, `"a:1"`, `"a:1","a:0"`, 1)
	out, err = decodeDiagnosis(duplicate, spans)
	if err != nil || ValidateIntelligence("diagnosis", in, out, false) == nil {
		t.Fatal("one answer counted twice for the same finding")
	}
	long := strings.Repeat("知", 1500)
	for _, span := range diagnosisSpans([]DiagnosisAnswer{{SubmissionID: "long", Answer: long}}) {
		if len(span.Quote) > 3000 || !strings.Contains(long, span.Quote) {
			t.Fatal("long evidence violates quote bounds")
		}
	}
}

func TestIntelligenceEvidenceAndRanking(t *testing.T) {
	in := IntelligenceInput{Labels: BaseDiagnosisLabels, Answers: []DiagnosisAnswer{{SubmissionID: "a", Answer: "这六个年龄都合法"}, {SubmissionID: "blank", Answer: ""}}}
	out := IntelligenceOutput{Findings: []DiagnosisFinding{{LabelID: "concept", Title: "概念混淆", Explanation: "该次作答混淆范围内外", Evidence: []DiagnosisQuote{{SubmissionID: "a", Quote: "这六个年龄都合法"}}}}, Unclassified: []string{"blank"}}
	if e := ValidateIntelligence("diagnosis", in, out, true); e != nil {
		t.Fatal(e)
	}
	bad := out
	bad.Findings = append([]DiagnosisFinding{}, out.Findings...)
	bad.Findings[0].Evidence = []DiagnosisQuote{{SubmissionID: "a", Quote: "原文未写的内容"}}
	if ValidateIntelligence("diagnosis", in, bad, false) == nil {
		t.Fatal("fabricated quote accepted")
	}
	bad = out
	bad.Unclassified = nil
	if ValidateIntelligence("diagnosis", in, bad, false) == nil {
		t.Fatal("blank answer silently diagnosed")
	}
	bad = out
	bad.Findings = append([]DiagnosisFinding{}, out.Findings...)
	bad.Findings[0].LabelID = ""
	if ValidateIntelligence("diagnosis", in, bad, false) != nil || ValidateIntelligence("diagnosis", in, bad, true) == nil {
		t.Fatal("new labels must require teacher establishment")
	}
	in = IntelligenceInput{Candidates: []LearningCandidate{{ID: "a", Group: 0}, {ID: "b", Group: 1}}}
	out = IntelligenceOutput{Ranking: []RankedCandidate{{ID: "a", Reason: "先修"}, {ID: "b", Reason: "后续"}}}
	if e := ValidateIntelligence("recommendation", in, out, false); e != nil {
		t.Fatal(e)
	}
	for _, r := range [][]RankedCandidate{{{ID: "b", Reason: "x"}, {ID: "a", Reason: "x"}}, {{ID: "a", Reason: "x"}, {ID: "a", Reason: "x"}}, {{ID: "a", Reason: "x"}, {ID: "foreign", Reason: "x"}}} {
		if ValidateIntelligence("recommendation", in, IntelligenceOutput{Ranking: r}, false) == nil {
			t.Fatal("unsafe recommendation accepted", r)
		}
	}
}
