package learning

import "testing"

func TestRegradePointValidation(t *testing.T) {
	criteria := []criterion{{ID: "D1", Title: "覆盖", MaxScore: 6}, {ID: "D2", Title: "分类", MaxScore: 4}}
	points := []pointScore{{CriterionID: "D1", Score: 6, Feedback: "完整", Quote: "17、18"}, {CriterionID: "D2", Score: 1, Feedback: "部分正确", Quote: "都合法"}}
	if _, sum, e := regradePoints(criteria, points, "测试17、18，都合法"); e != nil || sum != 7 {
		t.Fatal(sum, e)
	}
	points[0].Quote = "不在原文"
	if _, _, e := regradePoints(criteria, points, "测试17、18，都合法"); e == nil {
		t.Fatal("fabricated quotation accepted")
	}
	points[0].Quote = "17、18"
	points[0].Score = 7
	if _, _, e := regradePoints(criteria, points, "测试17、18，都合法"); e == nil {
		t.Fatal("score above max accepted")
	}
	points[0].Score = 6
	points[1].CriterionID = "D1"
	if _, _, e := regradePoints(criteria, points, "测试17、18，都合法"); e == nil {
		t.Fatal("duplicate point accepted")
	}
}
