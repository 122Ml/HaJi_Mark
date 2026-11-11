package rag

import (
	"encoding/json"
	"testing"
)

func TestModelListFieldsNormalizeWithoutChangingRules(t *testing.T) {
	raw := json.RawMessage(`[{"id":"D1","title":"目的","max_score":10,"rule":"检查拒绝","partial_credit":[{"score":5,"condition":"仅说明越界非法"}],"acceptable_answers":["拒绝越界","检查输入校验"],"error_conditions":["全部接受"]}]`)
	normalized, err := normalizeBankCriteria(raw)
	if err != nil {
		t.Fatal(err)
	}
	var points []Criterion
	if err = json.Unmarshal(normalized, &points); err != nil {
		t.Fatal(err)
	}
	if len(points) != 1 || points[0].AcceptableAnswers != "拒绝越界\n检查输入校验" || points[0].ErrorConditions != "全部接受" || points[0].Rule != "检查拒绝" {
		t.Fatalf("changed meaning: %+v", points)
	}
	if points[0].PartialCredit != "5分：仅说明越界非法" {
		t.Fatal("partial-credit condition changed")
	}
	if _, err = normalizeBankCriteria(json.RawMessage(`[{"acceptable_answers":[1]}]`)); err == nil {
		t.Fatal("non-text list accepted")
	}
	for _, raw := range []string{`[null]`, `[1]`, `{}`, `invalid`, `[{"max_score":10,"partial_credit":[{"score":11,"condition":"越界"}]}]`, `[{"max_score":10,"partial_credit":[{"condition":"缺分值"}]}]`} {
		if _, err = normalizeBankCriteria(json.RawMessage(raw)); err == nil {
			t.Fatalf("malformed scoring points accepted: %s", raw)
		}
	}
}

func TestBankCriteriaValidation(t *testing.T) {
	refs := []Hit{{ID: "allowed"}}
	base := Criterion{ID: "D1", Title: "边界覆盖", MaxScore: 10, Rule: "明确列出测试值", EvidenceIDs: []string{"allowed"}}
	if err := ValidateCriteria([]Criterion{base}, 10, refs); err != nil {
		t.Fatal(err)
	}
	cases := map[string][]Criterion{
		"empty":              {},
		"duplicate":          {base, base},
		"wrong_sum":          {{ID: "D1", Title: "点", MaxScore: 9, Rule: "规则"}},
		"foreign_evidence":   {{ID: "D1", Title: "点", MaxScore: 10, Rule: "规则", EvidenceIDs: []string{"foreign"}}},
		"duplicate_evidence": {{ID: "D1", Title: "点", MaxScore: 10, Rule: "规则", EvidenceIDs: []string{"allowed", "allowed"}}},
		"blank_rule":         {{ID: "D1", Title: "点", MaxScore: 10, Rule: " "}},
	}
	for name, points := range cases {
		t.Run(name, func(t *testing.T) {
			if ValidateCriteria(points, 10, refs) == nil {
				t.Fatal("invalid criteria accepted")
			}
		})
	}
}
