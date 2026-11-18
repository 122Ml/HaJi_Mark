package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
)

type LearningCandidate struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	ObjectID   string `json:"object_id"`
	Title      string `json:"title"`
	PointID    string `json:"point_id"`
	Group      int    `json:"group"`
	RuleReason string `json:"rule_reason"`
}
type DiagnosisLabel struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

var BaseDiagnosisLabels = []DiagnosisLabel{{"omission", "要点遗漏"}, {"concept", "概念混淆"}, {"condition", "适用条件不符"}, {"steps", "步骤或论证缺口"}}

type DiagnosisAnswer struct {
	SubmissionID string          `json:"submission_id"`
	RevisionID   string          `json:"revision_id"`
	Answer       string          `json:"answer"`
	Feedback     string          `json:"feedback"`
	Score        int32           `json:"score"`
	MaxScore     int32           `json:"max_score"`
	Points       json.RawMessage `json:"point_scores"`
}
type IntelligenceInput struct {
	Prompt     string              `json:"prompt,omitempty"`
	RubricID   string              `json:"rubric_id,omitempty"`
	PathID     string              `json:"path_id,omitempty"`
	Labels     []DiagnosisLabel    `json:"labels,omitempty"`
	Answers    []DiagnosisAnswer   `json:"answers,omitempty"`
	Candidates []LearningCandidate `json:"candidates,omitempty"`
	Eligible   int                 `json:"eligible"`
}
type DiagnosisQuote struct {
	SubmissionID string `json:"submission_id"`
	Quote        string `json:"quote"`
}
type DiagnosisFinding struct {
	LabelID     string           `json:"label_id"`
	Title       string           `json:"title"`
	Explanation string           `json:"explanation"`
	Evidence    []DiagnosisQuote `json:"evidence"`
}
type RankedCandidate struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}
type IntelligenceOutput struct {
	Findings     []DiagnosisFinding `json:"findings,omitempty"`
	Unclassified []string           `json:"unclassified,omitempty"`
	Ranking      []RankedCandidate  `json:"ranking,omitempty"`
}

type diagnosisSpan struct {
	ID           string `json:"id"`
	SubmissionID string `json:"submission_id"`
	Quote        string `json:"quote"`
}

// The model selects evidence; only the server copies immutable student text.
func diagnosisSpans(answers []DiagnosisAnswer) []diagnosisSpan {
	spans := []diagnosisSpan{}
	for _, a := range answers {
		start, count, position := 0, 0, 0
		appendSpan := func(end int) {
			if quote := strings.TrimSpace(a.Answer[start:end]); quote != "" {
				spans = append(spans, diagnosisSpan{ID: fmt.Sprintf("%s:%d", a.SubmissionID, position), SubmissionID: a.SubmissionID, Quote: quote})
				position++
			}
			start, count = end, 0
		}
		for i, r := range a.Answer {
			count++
			if strings.ContainsRune("。！？!?\n", r) || count == 700 {
				appendSpan(i + utf8.RuneLen(r))
			}
		}
		appendSpan(len(a.Answer))
	}
	return spans
}

func decodeDiagnosis(raw string, spans []diagnosisSpan) (IntelligenceOutput, error) {
	var model struct {
		Findings []struct {
			DiagnosisFinding
			EvidenceIDs []string `json:"evidence_ids"`
		} `json:"findings"`
		Unclassified []string `json:"unclassified"`
	}
	out := IntelligenceOutput{}
	if err := json.Unmarshal([]byte(raw), &model); err != nil {
		return out, errors.New("诊断未返回有效结构")
	}
	byID := map[string]diagnosisSpan{}
	for _, span := range spans {
		byID[span.ID] = span
	}
	for _, f := range model.Findings {
		if len(f.Evidence) != 0 || len(f.EvidenceIDs) == 0 {
			return out, errors.New("诊断须选择作答片段ID，原文由服务端附上")
		}
		for _, id := range f.EvidenceIDs {
			span, ok := byID[id]
			if !ok {
				return out, errors.New("诊断选择了未提供的作答片段")
			}
			f.Evidence = append(f.Evidence, DiagnosisQuote{SubmissionID: span.SubmissionID, Quote: span.Quote})
		}
		out.Findings = append(out.Findings, f.DiagnosisFinding)
	}
	out.Unclassified = model.Unclassified
	return out, nil
}

// ValidateIntelligence never accepts a model-supplied population or arbitrary object link.
func ValidateIntelligence(kind string, in IntelligenceInput, out IntelligenceOutput, confirmed bool) error {
	if kind == "recommendation" {
		if len(out.Ranking) != len(in.Candidates) || len(out.Findings) > 0 {
			return errors.New("推荐数量与规则候选不一致")
		}
		allowed := map[string]LearningCandidate{}
		seen := map[string]bool{}
		last := -1
		for _, c := range in.Candidates {
			allowed[c.ID] = c
		}
		for _, r := range out.Ranking {
			c, ok := allowed[r.ID]
			if !ok || seen[r.ID] || c.Group < last || strings.TrimSpace(r.Reason) == "" || len(r.Reason) > 1600 {
				return errors.New("推荐越出候选范围、重复或违反前置顺序")
			}
			seen[r.ID] = true
			last = c.Group
		}
		return nil
	}
	if kind != "diagnosis" || len(out.Findings) > 12 || len(out.Ranking) > 0 {
		return errors.New("诊断结构或数量无效")
	}
	answers := map[string]DiagnosisAnswer{}
	labels := map[string]string{}
	covered := map[string]bool{}
	usedLabels := map[string]bool{}
	for _, a := range in.Answers {
		answers[a.SubmissionID] = a
	}
	for _, l := range in.Labels {
		labels[l.ID] = l.Title
	}
	for _, f := range out.Findings {
		if strings.TrimSpace(f.Title) == "" || len(f.Title) > 180 || strings.TrimSpace(f.Explanation) == "" || len(f.Explanation) > 3000 || len(f.Evidence) == 0 || len(f.Evidence) > len(in.Answers) {
			return errors.New("每项诊断须有标签、说明和作答原句")
		}
		if f.LabelID != "" && labels[f.LabelID] != f.Title {
			return errors.New("诊断标签不在当前可用标签中")
		}
		if confirmed && f.LabelID == "" {
			return errors.New("新标签须先由教师明确建立，再确认诊断")
		}
		key := f.LabelID
		if key == "" {
			key = "new:" + f.Title
		}
		if usedLabels[key] {
			return errors.New("重复诊断标签请合并")
		}
		usedLabels[key] = true
		seen := map[string]bool{}
		for _, e := range f.Evidence {
			a, ok := answers[e.SubmissionID]
			if !ok || seen[e.SubmissionID] || strings.TrimSpace(e.Quote) == "" || len(e.Quote) > 3000 || !strings.Contains(a.Answer, e.Quote) {
				return errors.New("诊断引用必须逐字来自本批对应作答，且同项不重复计人")
			}
			seen[e.SubmissionID] = true
			covered[e.SubmissionID] = true
		}
	}
	unseen := map[string]bool{}
	for _, id := range out.Unclassified {
		if _, ok := answers[id]; !ok || covered[id] || unseen[id] {
			return errors.New("未归类作答不在本批或重复")
		}
		unseen[id] = true
	}
	if len(covered)+len(unseen) != len(answers) {
		return errors.New("每份作答必须有诊断证据或明确列入未归类")
	}
	return nil
}

func (s *Service) Intelligence(ctx context.Context, j store.ProcessingJob, job JobInput) (any, error) {
	r, e := s.Q.IntelligenceReport(ctx, store.IntelligenceReportParams{ID: job.ReportID, CourseID: j.CourseID})
	if e != nil {
		return nil, e
	}
	if r.JobID != j.ID || r.OwnerID != j.CreatedBy || r.Kind != j.Kind {
		return nil, errors.New("智能分析任务与报告不匹配")
	}
	var in IntelligenceInput
	if e = json.Unmarshal(r.Input, &in); e != nil {
		return nil, e
	}
	system := safeSystem
	payload := string(r.Input)
	var spans []diagnosisSpan
	if r.Kind == "diagnosis" {
		spans = diagnosisSpans(in.Answers)
		var input map[string]any
		if e = json.Unmarshal(r.Input, &input); e != nil {
			return nil, e
		}
		input["evidence_spans"] = spans
		encoded, _ := json.Marshal(input)
		payload = string(encoded)
		system += `根据同一道题、同一评分标准的正式结果提出有待教师确认的问题标签。仅描述该次作答，不推断整体能力或心理原因。返回 {"findings":[{"label_id":"已有标签ID，建议新标签则为空串","title":"已有标签的原名或新标签名","explanation":"基于作答的谨慎解释","evidence_ids":["evidence_spans中的id"]}],"unclassified":["证据不足或不适用的submission_id"]}。原文由服务端根据evidence_ids直接附上，不要生成evidence或quote字段。只选提供的片段，同项每份作答最多选择一个片段；所有输入作答必须至少归入一项或未归类，不得两者同时。不要返回人数，人数由系统去重统计。`
	} else {
		system += `对规则已筛出的学习候选作排序，不新增、不遗漏、不重复任何ID。group是前置顺序，只能在同一group内重排；没有正式成绩不等于零分。返回 {"ranking":[{"id":"候选ID","reason":"简洁学习建议，区分无证据和正式失分"}]}。阅读和收藏不代表掌握。`
	}
	raw, e := s.Models.Chat(ctx, j.CourseID, j.CreatedBy, j.Kind, job.ProfileID, system, payload, true)
	if e != nil {
		return nil, e
	}
	var out IntelligenceOutput
	failedDraft := map[string]any{"raw_response": raw, "review_status": "pending_teacher_review"}
	if r.Kind == "diagnosis" {
		out, e = decodeDiagnosis(raw, spans)
	} else {
		e = json.Unmarshal([]byte(raw), &out)
	}
	if e != nil {
		return failedDraft, e
	}
	if e = ValidateIntelligence(r.Kind, in, out, false); e != nil {
		return failedDraft, e
	}
	data, _ := json.Marshal(out)
	tx, e := s.Models.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	if e = lockRunningJob(ctx, q, j); e != nil {
		return nil, e
	}
	if _, e = q.FinishIntelligenceReport(ctx, store.FinishIntelligenceReportParams{ID: r.ID, Output: data}); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return map[string]string{"report_id": r.ID}, nil
}

func SortCandidates(c []LearningCandidate) {
	sort.Slice(c, func(i, j int) bool {
		if c[i].Group != c[j].Group {
			return c[i].Group < c[j].Group
		}
		return c[i].ID < c[j].ID
	})
}
