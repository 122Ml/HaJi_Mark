export const jobKindLabels: Record<string, string> = {
  parse: "资料解析",
  index: "索引更新",
  extract: "知识提炼",
  rubric: "标准起草",
  grade: "评阅草稿",
  question_generate: "AI出题",
  question_analyze: "题目分析",
  bank_rubric: "题库标准起草",
  vision: "图像识别",
  source_suggest: "资料编排建议",
  source_segment: "资料内容切分",
  knowledge_compare: "知识比较",
  paper_split: "整卷拆题",
  diagnosis: "学情诊断",
  recommendation: "路径推荐",
};

export const stateLabels: Record<string, string> = {
  queued: "等待处理",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  ready: "已解析",
  parsing: "解析中",
  draft: "草稿",
  pending: "待处理",
  needs_review: "待核对",
  confirmed: "已确认",
  published: "已发布",
  released: "已发布",
  closed: "已关闭",
  archived: "已归档",
  assigned: "待执行",
  submitted: "已提交",
  reviewed: "已复查",
  graded: "已评分",
  active: "进行中",
  in_progress: "进行中",
  waiting_job: "等待任务",
  waiting_approval: "等待审批",
  completed: "已完成",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  superseded: "已替换",
  partial: "部分完成",
};

export const knowledgeStateLabels: Record<string, string> = {
  draft: "待审核",
  confirmed: "已确认",
  archived: "已归档",
};

export const knowledgeContentKinds = [
  { value: "concept", label: "概念" },
  { value: "method", label: "方法" },
  { value: "rule", label: "规则" },
  { value: "example", label: "示例" },
  { value: "misconception", label: "常见误区" },
] as const;

export const questionTypeLabels: Record<string, string> = {
  subjective: "主观题",
  quiz: "客观测验",
  code: "代码题",
};

export const pointKindLabels: Record<string, string> = {
  chapter: "章",
  section: "节",
  point: "知识点",
};

export const locatorKeyLabels: Record<string, string> = {
  page: "页",
  slide: "幻灯片",
  paragraph: "段落",
  block: "内容块",
  table: "表格",
  shape: "对象",
  method: "解析方式",
};

export function labelFor(map: Record<string, string>, key?: string | null, fallback = "未知") {
  if (!key) return fallback;
  return map[key] || key;
}

export function formatLocator(locator?: Record<string, unknown> | null): string {
  if (!locator) return "";
  return Object.entries(locator)
    .filter(([k, v]) => k in locatorKeyLabels && v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${locatorKeyLabels[k]} ${String(v)}`)
    .join(" · ");
}
