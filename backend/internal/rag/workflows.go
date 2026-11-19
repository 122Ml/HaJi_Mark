package rag

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
)

type PaperQuestion struct {
	Title           string   `json:"title"`
	Prompt          string   `json:"prompt"`
	Type            string   `json:"type"`
	MaxScore        int32    `json:"max_score"`
	Options         []string `json:"options"`
	CorrectAnswer   string   `json:"correct_answer"`
	ReferenceAnswer string   `json:"reference_answer"`
	AnswerOrigin    string   `json:"answer_origin"`
	FragmentIDs     []string `json:"source_fragment_ids"`
	AssetIDs        []string `json:"asset_ids"`
	Uncertain       []string `json:"uncertain"`
}
type PaperOutput struct {
	Questions []PaperQuestion `json:"questions"`
	Excluded  []struct {
		FragmentID string `json:"fragment_id"`
		Reason     string `json:"reason"`
	} `json:"excluded"`
	ReviewStatus string `json:"review_status"`
}

func ValidatePaper(out PaperOutput, fs []store.MaterialFragment, assets []store.MaterialAsset) error {
	if len(out.Questions) == 0 || len(out.Questions) > 100 || out.ReviewStatus != "pending_teacher_review" {
		return errors.New("拆题数量或审核状态无效")
	}
	allowed := map[string]bool{}
	covered := map[string]bool{}
	aids := map[string]bool{}
	body := ""
	for _, f := range fs {
		allowed[f.ID] = true
		body += f.Body + "\n"
	}
	for _, a := range assets {
		aids[a.ID] = true
	}
	for _, q := range out.Questions {
		if strings.TrimSpace(q.Title) == "" || len(q.Title) > 500 || strings.TrimSpace(q.Prompt) == "" || len(q.Prompt) > 30000 || q.MaxScore < 1 || q.MaxScore > 10000 || (q.Type != "subjective" && q.Type != "quiz" && q.Type != "code") || len(q.FragmentIDs) == 0 {
			return errors.New("题目标题、题干、题型、分值或出处不完整，请人工校正")
		}
		for _, id := range q.FragmentIDs {
			if !allowed[id] {
				return errors.New("拆题引用了范围外片段")
			}
			covered[id] = true
		}
		for _, id := range q.AssetIDs {
			if !aids[id] {
				return errors.New("拆题图像不属于原卷")
			}
		}
		if q.AnswerOrigin != "missing" && q.AnswerOrigin != "extracted" && q.AnswerOrigin != "teacher" {
			return errors.New("解答来源须为提取、留空或教师补录")
		}
		if q.AnswerOrigin == "missing" && (q.ReferenceAnswer != "" || q.CorrectAnswer != "") {
			return errors.New("未提供解答时不能补造原卷答案")
		}
		if q.AnswerOrigin == "extracted" && q.ReferenceAnswer != "" && !strings.Contains(body, q.ReferenceAnswer) {
			return errors.New("提取解答须能逐字定位原卷")
		}
		if q.AnswerOrigin == "extracted" && (q.CorrectAnswer != "" && !strings.Contains(body, q.CorrectAnswer) || q.CorrectAnswer == "" && q.ReferenceAnswer == "") {
			return errors.New("提取答案须非空且能逐字定位原卷")
		}
	}
	for _, x := range out.Excluded {
		if !allowed[x.FragmentID] || covered[x.FragmentID] || strings.TrimSpace(x.Reason) == "" {
			return errors.New("排除片段需要有效位置与原因，且不能同时归题")
		}
		covered[x.FragmentID] = true
	}
	if len(covered) != len(allowed) {
		return errors.New("有原卷片段未归题或说明排除，请核对完整性")
	}
	return nil
}

func (s *Service) WorkflowDraft(ctx context.Context, j store.ProcessingJob, in JobInput) (any, error) {
	payload := map[string]any{}
	instruction := ""
	var (
		compareCandidate store.KnowledgeEntry
		compareExisting  []store.KnowledgeEntry
		srcFragments     []store.MaterialFragment
		srcAssets        []store.MaterialAsset
	)
	if j.Kind == "knowledge_compare" {
		k, e := s.Q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: in.KnowledgeID, CourseID: j.CourseID})
		if e != nil {
			return nil, e
		}
		if k.EditVersion != in.EditVersion {
			return nil, errors.New("候选已修改，请重新比较")
		}
		candidates := []store.KnowledgeEntry{}
		if len(in.RelatedIDs) == 0 {
			hits, _, err := s.Search(ctx, j.CourseID, j.CreatedBy, shortQuery(k.Title+" "+k.Body), "comparison", true)
			if err != nil {
				return nil, err
			}
			for _, hit := range hits {
				if hit.KnowledgeID != "" && hit.KnowledgeID != k.ID && !contains(in.RelatedIDs, hit.KnowledgeID) {
					in.RelatedIDs = append(in.RelatedIDs, hit.KnowledgeID)
				}
			}
			if len(in.RelatedIDs) == 0 {
				return nil, errors.New("未召回相关确认知识，请检查索引或手动选择比较对象")
			}
		}
		for _, id := range in.RelatedIDs {
			v, e := s.Q.GetKnowledgeEntry(ctx, store.GetKnowledgeEntryParams{ID: id, CourseID: j.CourseID})
			if e != nil {
				return nil, e
			}
			if v.ID == k.ID || v.State != "confirmed" {
				return nil, errors.New("比较对象须为其他确认知识")
			}
			candidates = append(candidates, v)
		}
		compareCandidate = k
		compareExisting = candidates
		payload = map[string]any{"candidate": k, "existing": candidates}
		instruction = `比较candidate与existing，逐项给出原文证据、条件及结论差异，不因相似或措辞相反就认定冲突。返回 {"comparisons":[{"knowledge_id":"existing中的id","relation":"duplicate|supplement|conditional|conflict|uncertain","candidate_quote":"candidate.body的连续原文","existing_quote":"existing.body的连续原文","reason":"条件和差异说明","suggestion":"不采纳/合并新版本/条件并存/替换/待定"}],"review_status":"pending_teacher_review"}。全部决定交教师。`
	} else {
		src, e := s.Q.GetMaterialSource(ctx, store.GetMaterialSourceParams{ID: in.SourceID, CourseID: j.CourseID})
		if e != nil {
			return nil, e
		}
		if src.State != "active" || src.ParseRevision != in.ParseRevision {
			return nil, errors.New("来源版本已变化，请重新生成")
		}
		fs, e := s.Q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
		if e != nil {
			return nil, e
		}
		assets, e := s.Q.ListMaterialAssets(ctx, src.ID)
		if e != nil {
			return nil, e
		}
		points, e := s.Q.ListBusinessPoints(ctx, j.CourseID)
		if e != nil {
			return nil, e
		}
		topics, e := s.Q.ListTopics(ctx, j.CourseID)
		if e != nil {
			return nil, e
		}
		srcFragments = fs
		srcAssets = assets
		payload = map[string]any{"source": src.Title, "fragments": fs, "assets": assets, "course_points": points, "topics": topics}
		if j.Kind == "source_suggest" {
			// Suggestions use representative bounded excerpts; extraction uses explicit full selections.
			excerpts := append([]store.MaterialFragment(nil), fs...)
			if len(excerpts) > 60 {
				excerpts = excerpts[:60]
			}
			for i := range excerpts {
				v := []rune(excerpts[i].Body)
				if len(v) > 350 {
					excerpts[i].Body = string(v[:350])
				}
			}
			payload["fragments"] = excerpts
			payload["excerpt_only"] = true
			query := src.Title
			for _, f := range excerpts {
				query += " " + f.Body
			}
			hits, mode, e := s.Search(ctx, j.CourseID, j.CreatedBy, shortQuery(query), "comparison", true)
			if e != nil {
				return nil, e
			}
			summary := []map[string]string{}
			seen := map[string]bool{}
			for _, hit := range hits {
				if hit.KnowledgeID == "" || seen[hit.KnowledgeID] {
					continue
				}
				seen[hit.KnowledgeID] = true
				summary = append(summary, map[string]string{"id": hit.KnowledgeID, "title": hit.Title, "excerpt": hit.Body})
			}
			payload["known_knowledge"] = summary
			payload["retrieval_mode"] = mode
			instruction = `根据有限摘录提出目录、分类、专题、知识点关联和新知识点建议，不修改已有目录，不自动创建专题或知识点。识别与known_knowledge可能相似的知识，仅作比较入口。返回 {"outline":[{"title":"","fragment_ids":[]}],"topic_ids":[],"new_topic_names":[],"new_points":[{"title":"","parent_id":"","duplicate_of":"","reason":""}],"tags":[],"knowledge_point_ids":[],"similar_knowledge_ids":[],"reason":"概括依据和不确定性","review_status":"pending_teacher_review"}。所有id必须来自输入。`
			instruction += `无可靠建议时对应字段必须返回空数组，不生成空标题目录。knowledge_point_ids只能取course_points中kind=point的id，绝不能使用fragment的id；topic_ids只能取topics的id，similar_knowledge_ids只能取known_knowledge的id。new_points最多10条且只作候选，须教师逐条勾选后才创建：title为拟建知识点名称，不超过200字节，不得与course_points已有标题重复或仅措辞不同；parent_id只能取course_points中kind=chapter或section的id，不确定时返回空字符串；duplicate_of只在发现与course_points中kind=point的条目语义等价时填该id，否则返回空字符串。`
		} else if j.Kind == "source_segment" {
			if len(fs) > 120 {
				return nil, errors.New("原件片段超过120段上限，请先拆分原件后再切分")
			}
			excerpts := append([]store.MaterialFragment(nil), fs...)
			for i := range excerpts {
				v := []rune(excerpts[i].Body)
				if len(v) > 400 {
					excerpts[i].Body = string(v[:400])
				}
			}
			payload["fragments"] = excerpts
			payload["excerpt_only"] = true
			instruction = `把输入片段按内容切成若干连续段，覆盖全部片段，每个片段只能出现一次，顺序与输入一致。course_points只用于判断关联，不用于改写原文。返回 {"segments":[{"title":"本段主题","relation":"point|sequence","fragment_ids":[],"knowledge_point_id":"","reason":"切分依据"}],"review_status":"pending_teacher_review"}。`
			instruction += `relation=point表示本段内容明确对应某个已有知识点，此时knowledge_point_id只能取course_points中kind=point的id；relation=sequence表示只是前后顺序不同、没有明确对应知识点，此时knowledge_point_id必须为空字符串。段数不超过50，标题不超过200字节。不得遗漏片段，不得重复片段，不得引用未提供的片段或知识点。`
		} else if j.Kind == "paper_split" {
			instruction = `将原卷拆为单选quiz、主观subjective、代码文本code候选，跨页题必须合并，不执行代码。每个fragment必须归题或excluded说明。保留公式、图片资产id。原卷无答案则reference_answer/correct_answer留空、answer_origin=missing；有则逐字提取reference_answer且answer_origin=extracted，不自行解题。缺失分值暂用1并在uncertain要求教师确认。返回 {"questions":[{"title":"题号与名称","prompt":"完整题干","type":"subjective","max_score":1,"options":[],"correct_answer":"","reference_answer":"","answer_origin":"missing","source_fragment_ids":[],"asset_ids":[],"uncertain":[]}],"excluded":[{"fragment_id":"","reason":"公共说明/原卷答案/页预览等"}],"review_status":"pending_teacher_review"}。`
		} else {
			return nil, errors.New("不支持的处理类型")
		}
	}
	raw, _ := json.Marshal(payload)
	if len(raw) > 110000 {
		return nil, errors.New("本次内容超过单批上限，请分卷或分范围处理，未自动截断")
	}
	response, e := s.Models.Chat(ctx, j.CourseID, j.CreatedBy, j.Kind, in.ProfileID, safeSystem+instruction, string(raw), true)
	if e != nil {
		return nil, e
	}
	var out map[string]json.RawMessage
	failed := map[string]string{"raw_response": response}
	if json.Unmarshal([]byte(response), &out) != nil {
		return failed, errors.New("候选不是有效JSON")
	}
	var status string
	_ = json.Unmarshal(out["review_status"], &status)
	if status != "pending_teacher_review" {
		return failed, errors.New("候选缺少审核状态")
	}
	if j.Kind == "source_suggest" {
		if e = validateSuggestions(out, payload); e != nil {
			return failed, e
		}
	}
	if j.Kind == "source_segment" {
		if e = validateSegments(out, payload); e != nil {
			return failed, e
		}
	}
	if j.Kind == "paper_split" {
		var p PaperOutput
		if json.Unmarshal([]byte(response), &p) != nil {
			return failed, errors.New("拆题结果结构无效")
		}
		for _, q := range p.Questions {
			if q.AnswerOrigin == "teacher" {
				return failed, errors.New("模型不能冒充教师补录解答")
			}
		}
		if e = ValidatePaper(p, srcFragments, srcAssets); e != nil {
			return failed, e
		}
	}
	if j.Kind == "knowledge_compare" {
		k := compareCandidate
		known := compareExisting
		var pairs []struct {
			ID       string `json:"knowledge_id"`
			Relation string `json:"relation"`
			CQ       string `json:"candidate_quote"`
			EQ       string `json:"existing_quote"`
		}
		if json.Unmarshal(out["comparisons"], &pairs) != nil || len(pairs) != len(known) {
			return failed, errors.New("比较结果未覆盖所选条目")
		}
		seen := map[string]bool{}
		for _, p := range pairs {
			valid := false
			for _, v := range known {
				if p.ID == v.ID && p.EQ != "" && strings.Contains(v.Body, p.EQ) {
					valid = true
				}
			}
			if seen[p.ID] || !valid || p.CQ == "" || !strings.Contains(k.Body, p.CQ) || !contains([]string{"duplicate", "supplement", "conditional", "conflict", "uncertain"}, p.Relation) {
				return failed, errors.New("比较证据或关系无效")
			}
			seen[p.ID] = true
		}
	}
	// Compact input_snapshot so processing_jobs.output does not store 110KB fragment/body blobs,
	// while keeping the exact id/edit_version/state fields required by knowledge_compare decisions.
	var compactSnapshot map[string]any
	if j.Kind == "knowledge_compare" {
		existingMeta := make([]map[string]any, 0, len(compareExisting))
		for _, v := range compareExisting {
			existingMeta = append(existingMeta, map[string]any{
				"id":           v.ID,
				"edit_version": v.EditVersion,
				"state":        v.State,
			})
		}
		compactSnapshot = map[string]any{
			"candidate": map[string]any{
				"id":           compareCandidate.ID,
				"edit_version": compareCandidate.EditVersion,
				"state":        compareCandidate.State,
			},
			"existing":   existingMeta,
			"input_hash": Hash(string(raw)),
		}
	} else {
		compactSnapshot = map[string]any{
			"source_id":      in.SourceID,
			"parse_revision": in.ParseRevision,
			"fragment_count": len(srcFragments),
			"asset_count":    len(srcAssets),
			"input_hash":     Hash(string(raw)),
		}
	}
	out["input_snapshot"], _ = json.Marshal(compactSnapshot)
	return out, nil
}

func shortQuery(text string) string {
	r := []rune(text)
	if len(r) > 900 {
		r = r[:900]
	}
	return string(r)
}

// All proposed references are checked against the exact input snapshot, not the model's claims.
func validateSuggestions(out map[string]json.RawMessage, payload map[string]any) error {
	groups := map[string]map[string]bool{}
	for field, value := range map[string]any{"topic_ids": payload["topics"], "knowledge_point_ids": payload["course_points"], "similar_knowledge_ids": payload["known_knowledge"], "fragment_ids": payload["fragments"]} {
		b, _ := json.Marshal(value)
		var rows []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		}
		_ = json.Unmarshal(b, &rows)
		groups[field] = map[string]bool{}
		for _, row := range rows {
			if field == "knowledge_point_ids" && row.Kind != "" && row.Kind != "point" {
				continue
			}
			if row.ID != "" {
				groups[field][row.ID] = true
			}
		}
	}
	for _, field := range []string{"topic_ids", "knowledge_point_ids", "similar_knowledge_ids", "new_topic_names", "tags"} {
		var values []string
		if json.Unmarshal(out[field], &values) != nil || values == nil || len(values) > 30 {
			return errors.New("关联建议字段缺失或格式无效")
		}
		seen := map[string]bool{}
		for _, v := range values {
			if strings.TrimSpace(v) == "" || len(v) > 500 || seen[v] || (groups[field] != nil && !groups[field][v]) {
				return errors.New("关联建议包含重复、空值或范围外ID")
			}
			seen[v] = true
		}
	}
	var outline []struct {
		Title string   `json:"title"`
		IDs   []string `json:"fragment_ids"`
	}
	if json.Unmarshal(out["outline"], &outline) != nil || outline == nil || len(outline) > 30 {
		return errors.New("目录建议格式无效")
	}
	for _, row := range outline {
		if strings.TrimSpace(row.Title) == "" || len(row.Title) > 500 || len(row.IDs) == 0 {
			return errors.New("目录建议缺少标题或出处")
		}
		for _, id := range row.IDs {
			if !groups["fragment_ids"][id] {
				return errors.New("目录建议引用范围外片段")
			}
		}
	}
	var newPoints []struct {
		Title       string `json:"title"`
		ParentID    string `json:"parent_id"`
		DuplicateOf string `json:"duplicate_of"`
		Reason      string `json:"reason"`
	}
	if json.Unmarshal(out["new_points"], &newPoints) != nil || newPoints == nil || len(newPoints) > 10 {
		return errors.New("新知识点建议格式无效")
	}
	kinds := map[string]string{}
	var pointRows []struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	}
	rawPoints, _ := json.Marshal(payload["course_points"])
	_ = json.Unmarshal(rawPoints, &pointRows)
	for _, row := range pointRows {
		kinds[row.ID] = row.Kind
	}
	seenPointTitles := map[string]bool{}
	for _, p := range newPoints {
		title := strings.TrimSpace(p.Title)
		if title == "" || len(title) > 200 || strings.ContainsRune(title, '\x00') || seenPointTitles[normalizeTitle(title)] {
			return errors.New("新知识点建议标题为空、过长或重复")
		}
		seenPointTitles[normalizeTitle(title)] = true
		if p.ParentID != "" && kinds[p.ParentID] != "chapter" && kinds[p.ParentID] != "section" {
			return errors.New("新知识点建议的上级目录不在本课程")
		}
		if p.DuplicateOf != "" && kinds[p.DuplicateOf] != "point" {
			return errors.New("新知识点建议的合并目标无效")
		}
		if len(p.Reason) > 500 {
			return errors.New("新知识点建议依据过长")
		}
	}
	var reason string
	if json.Unmarshal(out["reason"], &reason) != nil || strings.TrimSpace(reason) == "" || len(reason) > 10000 {
		return errors.New("归类建议缺少依据")
	}
	return nil
}

func normalizeTitle(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), "")
}

// A split is only accepted when it is an exact partition of the input fragments.
func validateSegments(out map[string]json.RawMessage, payload map[string]any) error {
	var rows []struct {
		Title       string   `json:"title"`
		Relation    string   `json:"relation"`
		FragmentIDs []string `json:"fragment_ids"`
		PointID     string   `json:"knowledge_point_id"`
		Reason      string   `json:"reason"`
	}
	if json.Unmarshal(out["segments"], &rows) != nil || len(rows) == 0 || len(rows) > 50 {
		return errors.New("切分结果缺失、格式无效或段数超限")
	}
	fragments := map[string]bool{}
	rawFragments, _ := json.Marshal(payload["fragments"])
	var fs []struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rawFragments, &fs)
	for _, f := range fs {
		fragments[f.ID] = true
	}
	points := map[string]bool{}
	rawPoints, _ := json.Marshal(payload["course_points"])
	var ps []struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal(rawPoints, &ps)
	for _, p := range ps {
		if p.Kind == "point" {
			points[p.ID] = true
		}
	}
	seen := map[string]bool{}
	for _, r := range rows {
		title := strings.TrimSpace(r.Title)
		if title == "" || len(title) > 200 || strings.ContainsRune(title, '\x00') || len(r.FragmentIDs) == 0 {
			return errors.New("切分段缺少标题或片段")
		}
		if len(r.Reason) > 1000 {
			return errors.New("切分依据过长")
		}
		if r.Relation != "point" && r.Relation != "sequence" {
			return errors.New("切分段关联方式无效")
		}
		if r.Relation == "point" && !points[r.PointID] {
			return errors.New("切分段引用了范围外知识点")
		}
		if r.Relation == "sequence" && r.PointID != "" {
			return errors.New("顺序切分段不能指定知识点")
		}
		for _, id := range r.FragmentIDs {
			if !fragments[id] || seen[id] {
				return errors.New("切分片段重复或超出输入范围")
			}
			seen[id] = true
		}
	}
	if len(seen) != len(fragments) {
		return errors.New("切分未覆盖全部片段")
	}
	return nil
}
