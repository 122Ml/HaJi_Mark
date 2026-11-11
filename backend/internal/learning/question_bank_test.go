package learning

import (
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"testing"
)

func TestBoundRubricOwnership(t *testing.T) {
	q := store.Question{ID: "instance", BankQuestionVersionID: text("version1"), BoundRubricID: text("rubric1")}
	r := store.RubricVersion{ID: "rubric1", BankQuestionVersionID: text("version1"), State: "confirmed"}
	if !rubricMatches(q, r) {
		t.Fatal("fixed version rejected")
	}
	r.ID = "rubric2"
	if rubricMatches(q, r) {
		t.Fatal("another standard allowed")
	}
	r.ID = "rubric1"
	r.BankQuestionVersionID = text("version2")
	if rubricMatches(q, r) {
		t.Fatal("another question version allowed")
	}
	r.BankQuestionVersionID = text("version1")
	r.State = "draft"
	if rubricMatches(q, r) {
		t.Fatal("draft standard allowed")
	}
	legacy := store.Question{ID: "old"}
	r = store.RubricVersion{ID: "old-rubric", QuestionID: text("old"), State: "confirmed"}
	if !rubricMatches(legacy, r) || rubricMatches(q, r) {
		t.Fatal("legacy ownership changed")
	}
}
