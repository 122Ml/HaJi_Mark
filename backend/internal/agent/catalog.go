package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

type Schema map[string]any
type Tool struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Domain      string `json:"domain"`
	Risk        string `json:"risk"`
	Method      string `json:"method,omitempty"`
	Path        string `json:"-"`
	Snapshot    string `json:"-"`
	Student     bool   `json:"student"`
	Learner     bool   `json:"-"`
	Description string `json:"description"`
	Schema      Schema `json:"parameters"`
}

func str(desc string) Schema {
	return Schema{"type": "string", "description": desc, "maxLength": 30000}
}
func integer(desc string) Schema {
	return Schema{"type": "integer", "description": desc, "minimum": 0, "maximum": 10000}
}
func boolean(desc string) Schema   { return Schema{"type": "boolean", "description": desc} }
func array(item Schema) Schema     { return Schema{"type": "array", "items": item, "maxItems": 50} }
func enum(values ...string) Schema { return Schema{"type": "string", "enum": values} }
func object(props map[string]any, required ...string) Schema {
	if required == nil {
		required = []string{}
	}
	return Schema{"type": "object", "properties": props, "required": required, "additionalProperties": false}
}
func props(kvs ...any) map[string]any {
	m := map[string]any{}
	for i := 0; i < len(kvs); i += 2 {
		m[kvs[i].(string)] = kvs[i+1]
	}
	return m
}

func Catalog() []Tool {
	id := str("数据库返回的对象ID，不能使用标题或猜测ID")
	ids := array(id)
	evidence := array(object(props("source_id", id, "fragment_id", id, "quote", str("逐字连续原文")), "source_id", "fragment_id", "quote"))
	criterion := object(props("id", str("维度编号"), "title", str("维度名称"), "max_score", integer("维度满分"), "rule", str("具体给分规则"), "requirement", str("对应要求"), "partial_credit", str("部分分"), "acceptable_answers", str("替代表达"), "error_conditions", str("错误条件"), "evidence_ids", ids), "id", "title", "max_score", "rule")
	var tools []Tool
	add := func(name, label, domain, risk, method, path, snapshot string, student, learner bool, s Schema) {
		tools = append(tools, Tool{name, label, domain, risk, method, path, snapshot, student, learner, label + "。只操作当前课程；使用查询返回的ID；字段须符合业务规则。", s})
	}
	read := func(name, label, domain, path string, student, learner bool, s Schema) {
		add(name, label, domain, "read", "GET", path, "", student, learner, s)
	}
	empty := object(props())
	withID := object(props("id", id), "id")
	read("course_context", "查看课程上下文", "materials", "", true, false, empty)
	read("curriculum_read", "查看课程目录和知识点", "materials", "/graph", true, false, empty)
	read("sources_list", "列出原件", "materials", "/sources", false, false, empty)
	read("source_read", "查看原件和解析片段", "materials", "/sources/{id}", false, false, withID)
	read("source_assets", "查看原件的图像公式图表", "materials", "/sources/{id}/assets", false, false, withID)
	add("asset_revision", "教师核对公式图表转写", "materials", "human", "POST", "/assets/{id}/revisions", "@asset", false, false, object(props("id", id, "body", str("核对后的转写，可包含LaTeX"), "base_revision", integer("当前图像修订号"), "model_job_id", id), "id", "body", "base_revision"))
	read("resources_list", "列出学习资料", "materials", "/resources", true, false, empty)
	read("topics_list", "列出专题库", "materials", "/topics", false, false, empty)
	read("knowledge_list", "列出可见知识", "materials", "/knowledge", true, false, empty)
	read("impact_read", "查看内容变更影响", "materials", "/impact", false, false, object(props("source_id", id, "knowledge_id", id)))
	add("retrieval_search", "检索有权限的资料知识", "materials", "read", "POST", "/retrieval", "", true, false, object(props("query", str("检索问题"), "purpose", enum("learning", "grading", "comparison")), "query", "purpose"))
	add("course_answer", "根据可见资料回答并校验引用", "learning", "read", "POST", "/assist", "", true, false, object(props("topic", str("问题"), "profile_id", str("可选生成profile")), "topic"))
	add("source_import", "将对话附件导入为原件并解析", "materials", "create", "UPLOAD", "/sources", "", false, false, object(props("attachment_id", id, "source_note", str("教师确认的来源说明，不能编造"), "allow_derived", boolean("是否明确允许知识提炼，未授权取false"), "title", str("可选标题")), "attachment_id", "source_note", "allow_derived"))
	add("source_url_import", "导入公开单页或直链文档", "materials", "approval", "POST", "/sources/url", "", false, false, object(props("url", str("教师指定的公开HTTP网址"), "source_note", str("来源说明"), "allow_derived", boolean("提炼许可"), "title", str("标题")), "url", "source_note", "allow_derived"))
	add("resource_create", "创建私有学习资料草稿", "materials", "create", "POST", "/resources", "", false, false, object(props("title", str("资料标题"), "content", str("完整正文"), "source_note", str("来源"), "source_url", str("来源链接"), "locator", str("原件页码或段落定位"), "knowledge_point_id", id), "title", "content", "locator", "source_note"))
	add("resource_revision", "新建学习资料修订", "materials", "approval", "POST", "/resources/{id}/revisions", "/resources", false, false, object(props("id", id, "title", str("标题"), "content", str("正文"), "source_note", str("来源"), "source_url", str("链接"), "locator", str("定位"), "knowledge_point_id", id), "id", "title", "content", "source_note", "locator"))
	add("resource_publish", "教师发布学习资料", "materials", "human", "POST", "/resources/{id}/publish", "/resources", false, false, withID)
	add("source_publish", "选择原文片段发布为学习资料", "materials", "human", "POST", "/sources/{id}/publish", "/sources/{id}", false, false, object(props("id", id, "title", str("标题"), "fragment_ids", ids, "knowledge_point_id", id), "id", "title", "fragment_ids"))
	add("source_correct", "校正原文并保存新修订", "materials", "approval", "PUT", "/sources/{id}/fragments", "/sources/{id}", false, false, object(props("id", id, "revision", integer("当前解析版本"), "fragments", array(object(props("id", id, "heading", str("标题"), "body", str("完整片段正文"), "quality", enum("ready", "needs_review")), "id", "heading", "body", "quality"))), "id", "revision", "fragments"))
	add("source_archive", "归档原件限制未来使用", "materials", "human", "POST", "/sources/{id}/archive", "/sources/{id}", false, false, withID)
	add("source_derivation", "调整来源知识提炼许可", "materials", "human", "PUT", "/sources/{id}/derivation", "/sources/{id}", false, false, object(props("id", id, "allow_derived", boolean("明确许可")), "id", "allow_derived"))
	add("topic_create", "创建专题库", "materials", "create", "POST", "/topics", "", false, false, object(props("title", str("名称"), "description", str("说明"), "active", boolean("是否启用")), "title", "active"))
	add("content_link", "设置专题标签与知识点关联", "materials", "approval", "PUT", "/content-links", "/topics", false, false, object(props("kind", enum("source", "knowledge", "question"), "id", id, "topic_ids", ids, "tags", array(str("标签")), "knowledge_point_ids", ids), "kind", "id", "topic_ids", "tags", "knowledge_point_ids"))
	knowledgeProps := props("title", str("知识标题"), "body", str("精炼正文"), "category", str("分类"), "content_kind", enum("concept", "method", "rule", "example", "misconception"), "conditions", str("适用条件"), "knowledge_point_ids", ids, "related_ids", ids, "evidence", evidence, "student_visible", boolean("是否学生可见"), "use_for_learning", boolean("用于学习"), "use_for_grading", boolean("用于评分"), "edit_version", integer("当前编辑版本"), "supersedes_id", id)
	add("knowledge_create", "保存知识草稿", "materials", "create", "POST", "/knowledge", "", false, false, object(knowledgeProps, "title", "body", "content_kind", "evidence"))
	copyProps := props()
	for k, v := range knowledgeProps {
		copyProps[k] = v
	}
	copyProps["id"] = id
	add("knowledge_update", "修改知识草稿或新增知识版本", "materials", "approval", "PUT", "/knowledge/{id}", "/knowledge", false, false, object(copyProps, "id", "title", "body", "content_kind", "evidence", "edit_version"))
	add("knowledge_state", "教师确认或归档知识", "materials", "human", "POST", "/knowledge/{id}/state", "/knowledge", false, false, object(props("id", id, "state", enum("confirmed", "archived"), "edit_version", integer("编辑版本")), "id", "state", "edit_version"))
	add("knowledge_decide", "处理重复冲突知识候选", "materials", "human", "POST", "/knowledge/{id}/decision", "/knowledge", false, false, object(props("id", id, "action", enum("discard", "merge", "coexist", "replace", "defer"), "edit_version", integer("编辑版本"), "compare_job_id", id, "reason", str("决定理由"), "title", str("新版本标题"), "body", str("新版本内容"), "conditions", str("适用条件"), "related_ids", ids), "id", "action", "edit_version", "reason"))
	add("suggestions_adopt", "采纳原件目录专题建议", "materials", "approval", "POST", "/sources/{id}/suggestions/adopt", "/sources/{id}", false, false, object(props("id", id, "job_id", id, "topic_ids", ids, "tags", array(str("标签")), "knowledge_point_ids", ids, "new_topics", array(str("新专题名")), "outline", array(str("目录标题")), "reason", str("采纳理由")), "id", "job_id", "reason"))
	read("question_list", "列出独立题库", "questions", "/question-bank", false, false, empty)
	read("question_read", "查看题目和各版本", "questions", "/question-bank/{id}", false, false, object(props("id", str("独立题目bank_id，不是题目version_id；来自question_list或question_version的bank_id")), "id"))
	read("question_version", "读取确切题目版本", "questions", "/question-bank/versions/{id}", false, false, object(props("id", str("题目version_id，不是bank_id或rubric_id")), "id"))
	read("question_rubrics", "读取题目版本评分标准", "questions", "/question-bank/versions/{id}/rubrics", false, false, object(props("id", str("题目version_id；返回标准列表中的id才是rubric_id")), "id"))
	add("question_evidence", "查询可用于出题和标准的精确依据ID", "questions", "read", "POST", "/question-bank/evidence", "", false, false, object(props("query", str("知识检索词"), "source_id", id, "knowledge_id", id), "query"))
	qprops := props("title", str("题目名"), "prompt", str("题干"), "type", enum("subjective", "quiz", "code"), "max_score", integer("统一满分"), "requirements", str("考查要求"), "reference_answer", str("参考解答草稿"), "options", array(str("选项")), "correct_answer", str("客观题正确选项"), "knowledge_point_id", id, "evidence_ids", ids, "criteria", array(criterion), "ai_job_id", id)
	add("question_create", "保存独立题目草稿", "questions", "create", "POST", "/question-bank", "", false, false, object(qprops, "title", "prompt", "type", "max_score"))
	qp := props()
	for k, v := range qprops {
		qp[k] = v
	}
	qp["id"] = id
	add("question_revision", "新建题目版本", "questions", "create", "POST", "/question-bank/{id}/versions", "/question-bank/{id}", false, false, object(qp, "id", "title", "prompt", "type", "max_score"))
	add("question_confirm", "教师确认题目版本", "questions", "human", "POST", "/question-bank/versions/{id}/confirm", "/question-bank/versions/{id}", false, false, withID)
	add("reference_confirm", "教师确认参考解答", "questions", "human", "POST", "/question-bank/versions/{id}/reference/confirm", "/question-bank/versions/{id}", false, false, withID)
	add("rubric_create", "保存题库评分标准草稿", "questions", "create", "POST", "/question-bank/versions/{id}/rubrics", "/question-bank/versions/{id}", false, false, object(props("id", id, "criteria", array(criterion), "evidence_ids", ids, "ai_job_id", id), "id", "criteria"))
	add("rubric_confirm", "教师确认评分标准版本", "questions", "human", "POST", "/rubrics/{id}/confirm", "@rubric", false, false, object(props("id", str("rubric_create或question_rubrics返回的标准rubric_id，不能传题目version_id")), "id"))
	add("question_generate", "按所选依据生成题目参考答案及标准草稿", "questions", "create", "JOB", "question_generate", "", false, false, object(props("requirements", str("出题要求"), "max_score", integer("每题满分"), "count", integer("题数1到3"), "evidence_ids", array(str("retrieval_search返回的hits[].id，不能用knowledge_id、source_id或fragment_id代替")), "profile_id", str("省略则沿用当前会话生成模型profile，不能自造ID")), "requirements", "max_score", "count", "evidence_ids"))
	add("question_analyze", "分析题目要求歧义与依据", "questions", "create", "JOB", "question_analyze", "", false, false, object(props("question_id", id, "evidence_ids", ids, "profile_id", str("生成profile")), "question_id", "evidence_ids"))
	add("rubric_generate", "独立起草题库评分标准", "questions", "create", "JOB", "bank_rubric", "", false, false, object(props("question_id", id, "evidence_ids", ids, "profile_id", str("生成profile")), "question_id", "evidence_ids"))
	for _, j := range []struct{ name, label, kind string }{
		{"source_parse", "解析原件", "parse"}, {"source_suggest", "生成目录分类关联建议", "source_suggest"}, {"knowledge_extract", "提炼所选原文片段", "extract"}, {"knowledge_compare", "比较重复冲突知识", "knowledge_compare"}, {"image_recognize", "识别所选公式图表", "vision"}, {"paper_split", "拆分题卷候选", "paper_split"}, {"index_build", "重建检索索引", "index"},
	} {
		add(j.name, j.label, "materials", "create", "JOB", j.kind, "", false, false, object(props("source_id", id, "fragment_ids", ids, "knowledge_id", id, "related_ids", ids, "asset_id", id, "profile_id", str("按任务选择chat/vision/embedding profile"))))
	}
	read("jobs_list", "查询处理任务", "materials", "/jobs", false, false, object(props("kind", str("任务种类"), "source_id", id, "submission_id", id, "question_id", id)))
	read("job_read", "查看任务结果", "materials", "/jobs/{id}", false, false, withID)
	add("job_wait", "等待已有任务完成并返回结果", "control", "read", "WAIT", "", "", false, false, withID)
	add("job_cancel", "取消处理任务", "materials", "approval", "POST", "/jobs/{id}/cancel", "/jobs/{id}", false, false, withID)
	add("job_retry", "显式重试失败处理任务（可能计费）", "materials", "approval", "POST", "/jobs/{id}/retry", "/jobs/{id}", false, false, withID)
	read("assignments_list", "列出作业", "assessment", "/assignments", true, false, empty)
	read("assignment_read", "查看作业和冻结题目", "assessment", "/assignments/{id}", true, false, withID)
	read("assessment_rubrics", "读取作业绑定的题库版本标准", "assessment", "/question-bank/versions/{id}/rubrics", false, false, withID)
	read("legacy_rubrics", "读取旧作业题目标准", "assessment", "/questions/{id}/rubrics", false, false, withID)
	read("submissions_list", "查询授权作答", "assessment", "/assignments/{id}/submissions", true, true, withID)
	read("submission_read", "查看授权作答和评阅", "assessment", "/submissions/{id}", true, true, withID)
	read("assignment_roster", "查看作业提交名单", "assessment", "/assignments/{id}/roster", false, true, withID)
	question := object(props("bank_question_version_id", id, "bound_rubric_id", id, "prompt", str("旧题题干"), "max_score", integer("满分"), "rubric", str("旧题标准"), "options", array(str("选项")), "correct_answer", str("客观题规则"), "knowledge_point_id", id, "resource_id", id))
	add("assignment_create", "创建作业草稿", "assessment", "create", "POST", "/assignments", "", false, false, object(props("title", str("作业名"), "description", str("要求"), "type", enum("subjective", "quiz", "code"), "due_at", str("RFC3339截止时间"), "questions", array(question)), "title", "type", "questions"))
	add("assignment_state", "教师发布或关闭作业", "assessment", "human", "POST", "/assignments/{id}/state", "/assignments/{id}", false, false, object(props("id", id, "state", enum("published", "closed")), "id", "state"))
	add("grade_generate", "按冻结标准生成评分草稿", "assessment", "create", "JOB", "grade", "", false, true, object(props("submission_id", id, "rubric_id", id, "profile_id", str("模型profile")), "submission_id", "rubric_id"))
	add("grade_save", "保存评分修订草稿", "assessment", "create", "POST", "/submissions/{id}/revisions", "/submissions/{id}", false, true, object(props("id", id, "score", integer("总分"), "feedback", str("整体反馈"), "rubric_id", id, "ai_job_id", id, "request_id", str("幂等请求ID"), "points", array(object(props("criterion_id", str("维度ID"), "score", integer("分数"), "feedback", str("反馈"), "quote", str("逐字学生原文")), "criterion_id", "score", "feedback", "quote"))), "id", "score", "feedback", "rubric_id", "points"))
	add("grade_state", "教师确认或发布评分", "assessment", "human", "POST", "/revisions/{id}/state", "@grade", false, true, object(props("id", id, "state", enum("confirmed", "released")), "id", "state"))
	read("regrades_list", "列出整组重评", "assessment", "/regrades", false, true, empty)
	read("regrade_read", "查看整组重评和冻结输入", "assessment", "/regrades/{id}", false, true, withID)
	add("regrade_create", "冻结作答建立整组重评", "assessment", "human", "POST", "/regrades", "/assignments", false, true, object(props("question_id", id, "rubric_id", id, "correct_answer", str("客观题更正答案"), "reason", str("更正理由")), "question_id", "reason"))
	add("regrade_ai", "生成一份重评草稿", "assessment", "create", "POST", "/regrades/{id}/items/{submission_id}/ai", "", false, true, object(props("id", id, "submission_id", id, "profile_id", str("模型profile")), "id", "submission_id"))
	add("regrade_item_save", "保存并核对一份重评修订", "assessment", "human", "PUT", "/regrades/{id}/items/{submission_id}", "/regrades/{id}", false, true, object(props("id", id, "submission_id", id, "score", integer("总分"), "feedback", str("反馈"), "edit_version", integer("当前版本"), "confirmed", boolean("是否教师确认"), "ai_job_id", id, "points", array(object(props("criterion_id", str("维度编号"), "score", integer("得分"), "feedback", str("反馈"), "quote", str("逐字原文")), "criterion_id", "score", "feedback", "quote"))), "id", "submission_id", "score", "feedback", "edit_version", "confirmed", "points"))
	add("regrade_state", "教师整组发布重评", "assessment", "human", "POST", "/regrades/{id}/state", "/regrades/{id}", false, true, object(props("id", id, "state", enum("released")), "id", "state"))
	read("evidence_read", "读取已发布评分证据", "learning", "/evidence", true, true, object(props("student_id", id)))
	read("overview_read", "查看班级学情汇总", "learning", "/overview", false, true, empty)
	read("activity_read", "查看授权学习时间线", "learning", "/activity", true, true, object(props("student_id", id)))
	read("interventions_list", "查看补学补练任务", "learning", "/interventions", true, true, empty)
	read("intervention_evidence", "核对补学补练完成证据", "learning", "/interventions/{id}/evidence", true, true, withID)
	read("path_read", "查看本人学习路径", "learning", "/path", true, true, empty)
	add("path_plan", "生成本人规则学习路径", "learning", "create", "POST", "/path", "", true, true, empty)
	add("note_save", "保存本人的学习笔记", "learning", "approval", "PUT", "/resources/{id}/note", "/notes", true, true, object(props("id", id, "note", str("笔记内容"), "favorite", boolean("收藏")), "id", "note", "favorite"))
	add("intervention_create", "创建补学补练任务草稿", "learning", "create", "POST", "/interventions", "", false, true, object(props("student_id", id, "title", str("任务标题"), "description", str("任务说明"), "resource_id", id, "assignment_id", id), "student_id", "title", "description"))
	add("intervention_state", "下发或复核补学补练任务", "learning", "human", "POST", "/interventions/{id}/state", "/interventions", false, true, object(props("id", id, "state", enum("assigned", "reviewed"), "content", str("复核说明")), "id", "state"))
	read("interactions_read", "查看课程答疑", "learning", "/interactions", true, false, empty)
	add("interaction_send", "发送课程提问或回复", "learning", "human", "POST", "/interactions", "/interactions", true, false, object(props("kind", enum("question", "reply", "announcement", "discussion"), "title", str("标题"), "content", str("发送内容"), "parent_id", id), "kind", "content"))
	add("feedback_export", "导出本人有权限的正式评分证据CSV", "assessment", "create", "EXPORT", "", "", true, true, empty)
	add("request_input", "向用户提出1至4项必要问题；随后等待回答", "control", "read", "INPUT", "", "", true, false, object(props("prompt", str("为何需要这些信息"), "fields", array(object(props("key", str("字段键"), "label", str("问题"), "kind", enum("text", "select", "multiselect"), "required", boolean("必填"), "options", array(str("选项"))), "key", "label", "kind", "required"))), "prompt", "fields"))
	domain := enum("materials", "questions", "assessment", "learning")
	domain["description"] = "materials=导入解析与知识；questions=新出题/改题/独立标准；assessment=创建发布作业、引用既有题目、评阅和重评；learning=问答与学习。创建作业不是出题，必须选assessment。"
	add("delegate", "委派明确领域的任务；创建发布作业用assessment，新出题和标准用questions", "control", "read", "DELEGATE", "", "", true, false, object(props("domain", domain, "goal", str("完整保留用户目标、必要对象ID和禁止事项，不传学生原文给出题标准专家")), "domain", "goal"))
	add("plan_update", "更新用户可见的简短任务计划", "control", "read", "PLAN", "", "", true, false, object(props("steps", array(str("动作与完成条件"))), "steps"))
	return tools
}

func allowed(t Tool, domain, role string, tainted bool) bool {
	if role == "student" && !t.Student {
		return false
	}
	if role == "teacher" && (t.Name == "path_read" || t.Name == "path_plan" || t.Name == "note_save") {
		return false
	}
	if tainted && t.Domain == "questions" {
		return false
	}
	if domain == "coordinator" {
		if t.Name == "job_wait" {
			return false
		}
		return t.Domain == "control" || t.Name == "feedback_export"
	}
	if t.Method == "DELEGATE" {
		return false
	}
	if strings.HasPrefix(t.Name, "job_") || t.Name == "jobs_list" {
		return role == "teacher"
	}
	if t.Domain == "control" {
		return true
	}
	if t.Domain == domain {
		return true
	}
	// Specialists can retrieve evidence without accessing student work.
	return !t.Learner && t.Risk == "read" && (t.Name == "course_context" || t.Name == "retrieval_search" || t.Name == "resources_list" || t.Name == "curriculum_read" || t.Name == "knowledge_list")
}
func (t Tool) definition() any {
	return map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Schema}}
}

// Providers may emit null for an unspecified optional property. Normalize that
// wire representation before validation, audit storage and approval snapshots.
// Required properties and unknown properties still fail the ordinary validator.
func omitOptionalNulls(s Schema, values map[string]any) {
	required, _ := s["required"].([]string)
	properties, _ := s["properties"].(map[string]any)
	for key, value := range values {
		property, exists := properties[key]
		if !exists {
			continue
		}
		if value == nil && !slices.Contains(required, key) {
			delete(values, key)
			continue
		}
		child := property.(Schema)
		if object, ok := value.(map[string]any); ok && child["type"] == "object" {
			omitOptionalNulls(child, object)
		}
		if items, ok := value.([]any); ok && child["type"] == "array" {
			itemSchema := child["items"].(Schema)
			for _, item := range items {
				if object, ok := item.(map[string]any); ok && itemSchema["type"] == "object" {
					omitOptionalNulls(itemSchema, object)
				}
			}
		}
	}
}
func validate(s Schema, v any) error {
	typ, _ := s["type"].(string)
	switch typ {
	case "object":
		m, ok := v.(map[string]any)
		if !ok {
			return errors.New("参数必须是对象")
		}
		p := s["properties"].(map[string]any)
		for k, value := range m {
			sub, ok := p[k]
			if !ok {
				return fmt.Errorf("未知字段%s", k)
			}
			if e := validate(sub.(Schema), value); e != nil {
				return fmt.Errorf("%s: %w", k, e)
			}
		}
		req, _ := s["required"].([]string)
		for _, k := range req {
			if _, ok := m[k]; !ok {
				return fmt.Errorf("缺少字段%s", k)
			}
		}
	case "array":
		a, ok := v.([]any)
		if !ok || len(a) > 50 {
			return errors.New("数组无效或超过50项")
		}
		for _, x := range a {
			if e := validate(s["items"].(Schema), x); e != nil {
				return e
			}
		}
	case "string":
		x, ok := v.(string)
		if !ok || len(x) > 30000 {
			return errors.New("须为不超过30000字节的字符串；可选字段无值请省略，不要传null")
		}
		if opts, ok := s["enum"].([]string); ok && !slices.Contains(opts, x) {
			return errors.New("选项无效")
		}
	case "integer":
		x, ok := v.(float64)
		if !ok || x != float64(int64(x)) || x < 0 || x > 10000 {
			return errors.New("整数范围无效")
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return errors.New("须为true或false")
		}
	}
	return nil
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,200}$`)

func toolPath(template string, args map[string]any) (string, error) {
	path := template
	for _, name := range []string{"id", "submission_id"} {
		if strings.Contains(path, "{"+name+"}") {
			v, _ := args[name].(string)
			if !safeID.MatchString(v) {
				return "", errors.New("对象ID无效")
			}
			path = strings.ReplaceAll(path, "{"+name+"}", v)
		}
	}
	return path, nil
}
func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
