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

export const ASSET_KIND_LABELS: Record<string, string> = {
  page: "原页预览",
  image: "图片",
  figure: "图表",
  chart: "数据图表",
  diagram: "结构／流程图",
  table: "表格",
  formula: "公式",
  crop: "裁剪图像",
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

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".m4v"] as const;

export function isVideoSource(
  mediaType?: string | null,
  filename?: string | null,
): boolean {
  const mt = (mediaType || "").trim().toLowerCase().split(";")[0];
  if (mt.startsWith("video/") || mt === "application/mp4") return true;
  if (mt && mt !== "application/octet-stream") return false;
  const name = (filename || "").trim().toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTimeRangeMs(
  startMs?: number | null,
  endMs?: number | null,
): string {
  if (
    startMs === null ||
    startMs === undefined ||
    endMs === null ||
    endMs === undefined
  ) {
    return "";
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
    return "";
  }
  const start = formatDurationMs(startMs);
  const end = formatDurationMs(endMs);
  return start && end ? `${start}–${end}` : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function extractTimeRangeMs(
  locator?: Record<string, unknown> | null,
): { startMs: number; endMs: number } | null {
  if (!locator || typeof locator !== "object") return null;
  const startMs =
    toFiniteNumber(locator.time_start_ms) ?? toFiniteNumber(locator.start_ms);
  const endMs =
    toFiniteNumber(locator.time_end_ms) ?? toFiniteNumber(locator.end_ms);
  if (startMs === null || endMs === null || startMs < 0 || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

export function labelFor(map: Record<string, string>, key?: string | null, fallback = "未知") {
  if (!key) return fallback;
  return map[key] || key;
}

export function formatLocator(locator?: Record<string, unknown> | null): string {
  if (!locator || typeof locator !== "object") return "";
  const parts = Object.entries(locator)
    .filter(([k, v]) => k in locatorKeyLabels && v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${locatorKeyLabels[k]} ${String(v)}`);
  const range = extractTimeRangeMs(locator);
  if (range) {
    const timeLabel = formatTimeRangeMs(range.startMs, range.endMs);
    if (timeLabel) parts.push(`时间 ${timeLabel}`);
  }
  return parts.join(" · ");
}

function parseResourceLocatorArray(
  raw?: string | null,
): { prefix: string; items: Record<string, unknown>[] } | null {
  const trimmed = (raw || "").trim();
  if (!trimmed || !trimmed.endsWith("]")) return null;
  let idx = trimmed.indexOf("[");
  while (idx >= 0) {
    if (idx === 0 || /\s/.test(trimmed[idx - 1])) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(idx));
        if (Array.isArray(parsed)) {
          const items = parsed.filter(
            (item): item is Record<string, unknown> =>
              !!item && typeof item === "object" && !Array.isArray(item),
          );
          return { prefix: trimmed.slice(0, idx).trim(), items };
        }
      } catch {
        // Continue searching for the trailing JSON array boundary.
      }
    }
    idx = trimmed.indexOf("[", idx + 1);
  }
  return null;
}

export function extractResourceTimeRangeMs(
  raw?: string | null,
): { startMs: number; endMs: number } | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const parsed = parseResourceLocatorArray(trimmed);
  if (parsed) {
    const ranges = parsed.items
      .map((item) => extractTimeRangeMs(item))
      .filter((r): r is { startMs: number; endMs: number } => r !== null);
    if (!ranges.length) return null;
    const startMs = Math.min(...ranges.map((r) => r.startMs));
    const endMs = Math.max(...ranges.map((r) => r.endMs));
    return endMs > startMs ? { startMs, endMs } : null;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return extractTimeRangeMs(obj as Record<string, unknown>);
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function formatResourceLocator(raw?: string | null): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const parsed = parseResourceLocatorArray(trimmed);
  if (parsed) {
    const ranges = parsed.items
      .map((item) => extractTimeRangeMs(item))
      .filter((r): r is { startMs: number; endMs: number } => r !== null);
    if (ranges.length) {
      const startMs = Math.min(...ranges.map((r) => r.startMs));
      const endMs = Math.max(...ranges.map((r) => r.endMs));
      const rangeText = formatTimeRangeMs(startMs, endMs);
      if (rangeText) {
        return parsed.prefix ? `${parsed.prefix} · ${rangeText}` : rangeText;
      }
    }
    const formatted = Array.from(
      new Set(parsed.items.map((item) => formatLocator(item)).filter(Boolean)),
    );
    if (formatted.length === 1) {
      return parsed.prefix ? `${parsed.prefix} · ${formatted[0]}` : formatted[0];
    }
    if (formatted.length > 1) {
      const summary = `${formatted[0]} 等 ${formatted.length} 处`;
      return parsed.prefix ? `${parsed.prefix} · ${summary}` : summary;
    }
    return parsed.prefix || trimmed;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const formatted = formatLocator(obj as Record<string, unknown>);
        if (formatted) return formatted;
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function formatHitLocator(locator?: Record<string, unknown> | null): string {
  if (!locator || typeof locator !== "object") return "";
  const parts: string[] = [];
  const base = formatLocator(locator);
  if (base) parts.push(base);
  const extra: [string, string][] = [
    ["location", "位置"],
    ["locator", "位置"],
    ["knowledge_version", "知识版本"],
    ["resource_version", "资料版本"],
  ];
  for (const [key, label] of extra) {
    const val = locator[key];
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      const rawText = String(val).trim();
      const text = key.endsWith("_version")
        ? `v${rawText}`
        : formatResourceLocator(rawText);
      parts.push(`${label} ${text}`);
    }
  }
  if (!parts.length) {
    const sec =
      typeof locator.section === "string" && locator.section.trim()
        ? locator.section.trim()
        : typeof locator.heading === "string" && locator.heading.trim()
          ? locator.heading.trim()
          : "";
    if (sec) parts.push(sec);
  }
  return parts.join(" · ");
}
