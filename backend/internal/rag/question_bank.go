package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
)

// The same scoring-point structure is used by the bank and existing grading.
type Criterion struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	MaxScore          int32    `json:"max_score"`
	Rule              string   `json:"rule"`
	Requirement       string   `json:"requirement,omitempty"`
	PartialCredit     string   `json:"partial_credit,omitempty"`
	AcceptableAnswers string   `json:"acceptable_answers,omitempty"`
	ErrorConditions   string   `json:"error_conditions,omitempty"`
	EvidenceIDs       []string `json:"evidence_ids,omitempty"`
}

func EvidenceIDs(raw json.RawMessage) ([]string, error) {
	var refs []Hit
	if err := json.Unmarshal(raw, &refs); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(refs))
	for _, r := range refs {
		ids = append(ids, r.ID)
	}
	return ids, nil
}

// Never trust client-supplied quotation bodies or model-supplied source IDs.
func ResolveEvidence(ctx context.Context, q *store.Queries, course string, ids []string) ([]Hit, error) {
	if len(ids) > 8 {
		return nil, errors.New("最多选择8条依据")
	}
	out := make([]Hit, 0, len(ids))
	seen := map[string]bool{}
	chars := 0
	for _, id := range ids {
		if seen[id] {
			return nil, errors.New("依据不能重复")
		}
		seen[id] = true
		c, err := q.GetBankEvidence(ctx, store.GetBankEvidenceParams{ID: id, CourseID: course})
		if err != nil {
			return nil, errors.New("依据已失效、来源许可已撤回或不属于本课程，请重新选择")
		}
		chars += len([]rune(c.Body))
		if chars > 8000 {
			return nil, errors.New("所选依据超过8000字，请缩小范围")
		}
		out = append(out, Hit{ID: c.ID, SourceID: c.SourceID.String, KnowledgeID: c.KnowledgeID.String, ResourceID: c.ResourceID.String, FragmentIDs: c.FragmentIds, Title: c.Title, Heading: c.Heading, Body: c.Body, Locator: c.Locator})
	}
	return out, nil
}

func ValidateCriteria(points []Criterion, max int32, refs []Hit) error {
	if len(points) < 1 || len(points) > 30 {
		return errors.New("请填写1到30个评分点")
	}
	available := map[string]bool{}
	for _, r := range refs {
		available[r.ID] = true
	}
	seen := map[string]bool{}
	total := int32(0)
	for _, p := range points {
		id := strings.TrimSpace(p.ID)
		title := strings.TrimSpace(p.Title)
		rule := strings.TrimSpace(p.Rule)
		if id == "" || len(id) > 100 || seen[id] || title == "" || len(title) > 300 || rule == "" || len(rule) > 5000 ||
			p.MaxScore < 1 || p.MaxScore > max ||
			strings.ContainsRune(p.ID, '\x00') || strings.ContainsRune(p.Title, '\x00') || strings.ContainsRune(p.Rule, '\x00') ||
			strings.ContainsRune(p.Requirement, '\x00') || strings.ContainsRune(p.PartialCredit, '\x00') ||
			strings.ContainsRune(p.AcceptableAnswers, '\x00') || strings.ContainsRune(p.ErrorConditions, '\x00') {
			return errors.New("评分点编号须唯一，名称、规则和正数分值须完整且不含非法字符")
		}
		if len(p.Requirement)+len(p.PartialCredit)+len(p.AcceptableAnswers)+len(p.ErrorConditions) > 12000 {
			return errors.New("评分规则说明过长")
		}
		cited := map[string]bool{}
		for _, id := range p.EvidenceIDs {
			if !available[id] || cited[id] {
				return errors.New("评分点只能引用已选依据且不能重复")
			}
			cited[id] = true
		}
		seen[id] = true
		total += p.MaxScore
	}
	if total != max {
		return errors.New("各评分点满分之和必须等于本题满分")
	}
	return nil
}

type BankCandidate struct {
	Title           string      `json:"title"`
	Prompt          string      `json:"prompt"`
	ReferenceAnswer string      `json:"reference_answer"`
	Criteria        []Criterion `json:"criteria"`
}

// Some chat providers return descriptive rules as lists.
// Keep one canonical text representation for storage and teacher editing.
func normalizeBankCriteria(raw json.RawMessage) (json.RawMessage, error) {
	var points []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &points); err != nil {
		return nil, err
	}
	for _, p := range points {
		if p == nil {
			return nil, errors.New("评分点必须为对象")
		}
		for _, key := range []string{"partial_credit", "acceptable_answers", "error_conditions"} {
			value := strings.TrimSpace(string(p[key]))
			if !strings.HasPrefix(value, "[") {
				continue
			}
			var lines []string
			if err := json.Unmarshal(p[key], &lines); err != nil {
				if key != "partial_credit" {
					return nil, fmt.Errorf("%s必须为文本或文本数组", key)
				}
				var levels []struct {
					Score     *int32 `json:"score"`
					Condition string `json:"condition"`
				}
				var max int32
				if json.Unmarshal(p[key], &levels) != nil || json.Unmarshal(p["max_score"], &max) != nil {
					return nil, errors.New("部分分条件格式无效")
				}
				lines = nil
				for _, level := range levels {
					if level.Score == nil || *level.Score < 0 || *level.Score > max || strings.TrimSpace(level.Condition) == "" {
						return nil, errors.New("部分分须有条件且分值在评分点范围内")
					}
					lines = append(lines, fmt.Sprintf("%d分：%s", *level.Score, level.Condition))
				}
			}
			p[key], _ = json.Marshal(strings.Join(lines, "\n"))
		}
	}
	return json.Marshal(points)
}

func (s *Service) BankDraft(ctx context.Context, j store.ProcessingJob, in JobInput) (any, error) {
	ids, err := EvidenceIDs(in.EvidenceRefs)
	if err != nil {
		return nil, err
	}
	refs, err := ResolveEvidence(ctx, s.Q, j.CourseID, ids)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"question": in.Prompt, "requirements": in.Requirements, "max_score": in.MaxScore, "reference_answer": in.ReferenceAnswer, "count": in.Count, "sources": refs}
	criterionSchema := `{"id":"D1","title":"","max_score":1,"rule":"给分条件","requirement":"对应题目要求","partial_credit":"部分分条件","acceptable_answers":"可接受表达","error_conditions":"错误或矛盾条件","evidence_ids":["所选sources中的id"]}`
	instruction := ""
	switch j.Kind {
	case "question_generate":
		if len(refs) == 0 {
			return nil, errors.New("请先选择出题依据")
		}
		if in.Count < 1 || in.MaxScore < 1 {
			return nil, errors.New("出题数量和满分须为正整数")
		}
		instruction = `仅按教师要求与所选依据出文本主观题，条件完整，不补造来源。返回 {"questions":[{"title":"","prompt":"","reference_answer":"","criteria":[` + criterionSchema + `]}],"review_status":"pending_teacher_review"}。题数等于count，每题标准正整数加和等于max_score。不得读取学生作答。`
	case "question_analyze":
		instruction = `分析题目的考查要求、条件歧义及与所选依据的关系，不静默改题。返回 {"requirements":["具体回答要求"],"issues":["歧义或缺项；无则空数组"],"associations":[{"evidence_id":"所选sources中的id","reason":"关联理由"}],"review_status":"pending_teacher_review"}。没有依据不能伪造关联。`
	case "bank_rubric":
		if in.MaxScore < 1 {
			return nil, errors.New("题目满分须为正整数")
		}
		instruction = `根据题目、教师要求、可选参考解答和所选依据独立起草评分标准，不读取学生作答，不从资料增加题目未要求的扣分点；允许合理替代表达。返回 {"criteria":[` + criterionSchema + `],"review_status":"pending_teacher_review"}。正整数分值加和必须等于max_score。`
	default:
		return nil, errors.New("题库任务类型无效")
	}
	raw, _ := json.Marshal(payload)
	response, err := s.Models.Chat(ctx, j.CourseID, j.CreatedBy, j.Kind, in.ProfileID, safeSystem+instruction, string(raw), true)
	if err != nil {
		return nil, err
	}
	var out map[string]json.RawMessage
	failed := map[string]string{"raw_response": response}
	if json.Unmarshal([]byte(response), &out) != nil {
		return failed, errors.New("AI题库草稿不是有效JSON")
	}
	var status string
	_ = json.Unmarshal(out["review_status"], &status)
	if status != "pending_teacher_review" {
		return failed, errors.New("AI草稿缺少待教师审核状态")
	}
	if j.Kind == "question_generate" {
		var questions []map[string]json.RawMessage
		if err := json.Unmarshal(out["questions"], &questions); err != nil {
			log.Printf("bank draft %s unmarshal questions failed: %v", j.ID, err)
			return failed, errors.New("AI候选题目格式无效")
		}
		for _, q := range questions {
			if q == nil {
				return failed, errors.New("AI候选题目必须为对象")
			}
			normalized, err := normalizeBankCriteria(q["criteria"])
			if err != nil {
				return failed, err
			}
			q["criteria"] = normalized
		}
		out["questions"], _ = json.Marshal(questions)
	} else if j.Kind == "bank_rubric" {
		out["criteria"], err = normalizeBankCriteria(out["criteria"])
		if err != nil {
			return failed, err
		}
	}
	switch j.Kind {
	case "question_generate":
		var candidates []BankCandidate
		if err := json.Unmarshal(out["questions"], &candidates); err != nil {
			log.Printf("bank draft %s unmarshal candidates failed: %v", j.ID, err)
			return failed, errors.New("AI题目字段格式无效")
		}
		if len(candidates) != in.Count {
			return failed, fmt.Errorf("AI候选数量不符：要求%d，实际%d", in.Count, len(candidates))
		}
		for _, q := range candidates {
			if strings.TrimSpace(q.Title) == "" || len(q.Title) > 500 || strings.TrimSpace(q.Prompt) == "" || len(q.Prompt) > 30000 || strings.TrimSpace(q.ReferenceAnswer) == "" || len(q.ReferenceAnswer) > 30000 {
				return failed, errors.New("AI候选题干、标题或参考解答无效")
			}
			if err = ValidateCriteria(q.Criteria, in.MaxScore, refs); err != nil {
				return failed, err
			}
		}
	case "bank_rubric":
		var criteria []Criterion
		if err := json.Unmarshal(out["criteria"], &criteria); err != nil {
			log.Printf("bank draft %s unmarshal criteria failed: %v", j.ID, err)
			return failed, errors.New("AI标准字段格式无效")
		}
		if err = ValidateCriteria(criteria, in.MaxScore, refs); err != nil {
			return failed, err
		}
	case "question_analyze":
		var req, issues []string
		var associations []struct {
			EvidenceID string `json:"evidence_id"`
			Reason     string `json:"reason"`
		}
		if json.Unmarshal(out["requirements"], &req) != nil || req == nil || len(req) > 50 ||
			json.Unmarshal(out["issues"], &issues) != nil || issues == nil || len(issues) > 50 ||
			json.Unmarshal(out["associations"], &associations) != nil || associations == nil || len(associations) > 50 {
			return failed, errors.New("AI分析字段无效")
		}
		allowed := map[string]bool{}
		for _, r := range refs {
			allowed[r.ID] = true
		}
		seenAssoc := map[string]bool{}
		for _, a := range associations {
			if !allowed[a.EvidenceID] || seenAssoc[a.EvidenceID] || strings.TrimSpace(a.Reason) == "" {
				return failed, errors.New("AI分析引用了未选或重复依据")
			}
			seenAssoc[a.EvidenceID] = true
		}
	}
	out["evidence_refs"], _ = json.Marshal(refs)
	return out, nil
}
