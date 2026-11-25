package rag

import (
	"encoding/json"
	"testing"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
)

func frag(id, body string, startMs, endMs int64) store.MaterialFragment {
	loc, _ := json.Marshal(map[string]int64{"time_start_ms": startMs, "time_end_ms": endMs})
	return store.MaterialFragment{ID: id, Body: body, Locator: loc, Quality: "ready"}
}

func TestResolveSectionSpansPlainPartition(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "一二三四五", 0, 0), frag("f2", "六七八", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f2"}},
	}
	spans, err := ResolveSectionSpans(rows, frags)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if spans[0].StartChar != 0 || spans[0].EndChar != 5 || spans[1].StartChar != 0 || spans[1].EndChar != 3 {
		t.Fatalf("unexpected spans: %+v", spans)
	}
}

func TestResolveSectionSpansSharedFragment(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "第一段讲概念。第二段讲方法。", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "概念", FragmentIDs: []string{"f1"}},
		{Title: "方法", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"第二段讲方法"}},
	}
	spans, err := ResolveSectionSpans(rows, frags)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	body := []rune(frags[0].Body)
	if spans[0].EndChar != spans[1].StartChar {
		t.Fatalf("split offsets must be contiguous: %+v", spans)
	}
	if string(body[spans[1].StartChar:]) != "第二段讲方法。" {
		t.Fatalf("second section must start at the quote, got %q", string(body[spans[1].StartChar:]))
	}
}

func TestResolveSectionSpansRejectsAmbiguousQuote(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "定义：甲。定义：乙。", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"定义："}},
	}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("ambiguous quote must be rejected")
	}
}

func TestResolveSectionSpansRequiresQuoteForSharedFragment(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "一二三四", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f1"}},
	}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("shared fragment without quote must be rejected")
	}
}

func TestResolveSectionSpansRejectsMissingFragment(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "一二三", 0, 0), frag("f2", "四五六", 0, 0)}
	rows := []SectionSplitInput{{Title: "甲", FragmentIDs: []string{"f1"}}}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("missing fragment must be rejected")
	}
}

func TestResolveSectionSpansRejectsQuoteOnVideoFragment(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "第一段讲概念。第二段讲方法。", 1000, 9000)}
	rows := []SectionSplitInput{
		{Title: "概念", FragmentIDs: []string{"f1"}},
		{Title: "方法", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"第二段讲方法"}},
	}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("video fragment split must be rejected")
	}
}

func TestResolveSectionSpansRejectsQuoteOutsideFragment(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "一二三四", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"不存在的句子"}},
	}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("quote outside fragment must be rejected")
	}
}

func TestResolveSectionSpansMultiFragmentCrossBoundary(t *testing.T) {
	frags := []store.MaterialFragment{
		frag("f1", "前九字一二三四五六。边界后", 0, 0),
		frag("f2", "首段尾次段正文后续", 0, 0),
	}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f1", "f2"}, SplitQuotes: []string{"边界后"}},
		{Title: "丙", FragmentIDs: []string{"f2"}, SplitQuotes: []string{"次段正文后续"}},
	}
	spans, err := ResolveSectionSpans(rows, frags)
	if err != nil {
		t.Fatalf("multi-fragment cross-boundary split must pass: %v", err)
	}
	if spans[0].StartChar != 0 || spans[0].EndChar != 10 {
		t.Fatalf("unexpected span 0: %+v", spans[0])
	}
	if spans[1].StartChar != 10 || spans[1].EndChar != 3 {
		t.Fatalf("unexpected span 1 (StartChar > EndChar across fragments): %+v", spans[1])
	}
	if spans[2].StartChar != 3 || spans[2].EndChar != 9 {
		t.Fatalf("unexpected span 2: %+v", spans[2])
	}
}

func TestResolveSectionSpansRejectsTripleSplit(t *testing.T) {
	frags := []store.MaterialFragment{frag("f1", "第一段内容。第二段内容。第三段内容。", 0, 0)}
	rows := []SectionSplitInput{
		{Title: "甲", FragmentIDs: []string{"f1"}},
		{Title: "乙", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"第二段内容"}},
		{Title: "丙", FragmentIDs: []string{"f1"}, SplitQuotes: []string{"第三段内容"}},
	}
	if _, err := ResolveSectionSpans(rows, frags); err == nil {
		t.Fatal("splitting one fragment into 3+ sections must be rejected")
	}
}
