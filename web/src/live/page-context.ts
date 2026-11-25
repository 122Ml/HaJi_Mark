import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { BusinessContext } from "./context-agent";

export type LivePageContext = {
  path: string;
  page_title?: string;
  sub_page?: string;
  active_tab?: string;
  activity?: string;
  course_name?: string;
  headings?: string[];
  visible_tags?: string[];
  summary?: string;
  filters?: Record<string, string>;
};

export type ResolvedRouteContext = {
  path: string;
  page_title: string;
  sub_page?: string;
  active_tab?: string;
  filters: Record<string, string>;
  autoContext?: BusinessContext;
};

type CourseRef = { id: string; title: string } | null | undefined;

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

const SOURCE_VIEW_LABELS: Record<string, string> = {
  original: "原文核对",
  publication: "分段与发布",
  knowledge: "知识候选",
  tasks: "任务与记录",
};

const INSIGHT_VIEW_LABELS: Record<string, string> = {
  overview: "班级总览",
  students: "学生与进度",
  evidence: "评分证据",
  gaps: "评分缺口",
};

const MATERIALS_TAB_LABELS: Record<string, string> = {
  sources: "原始资料",
  published: "学习内容",
};

const COURSE_TAB_LABELS: Record<string, string> = {
  settings: "课程设置",
  members: "课程成员",
};

const STATE_LABELS: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
  confirmed: "已确认",
  rejected: "已拒绝",
  archived: "已归档",
  assigned: "待执行",
  submitted: "已提交",
  reviewed: "已复查",
  graded: "已评分",
  pending: "待批阅",
  released: "已发布",
  partial: "部分提交",
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  subjective: "主观题",
  quiz: "客观测验",
  code: "代码题",
  choice: "选择题",
  blank: "填空题",
  short: "简答题",
};

const CHANGE_KIND_LABELS: Record<string, string> = {
  source: "原始资料",
  knowledge: "知识条目",
  question: "题目版本",
  resource: "学习资料",
};

const FILTER_KEY_LABELS: Record<string, string> = {
  source_view: "资料视图",
  tab: "标签页",
  view: "分析视图",
  search: "搜索",
  knowledge_search: "知识搜索",
  resource_search: "资料搜索",
  state: "状态",
  knowledge_state: "知识状态",
  type: "题型",
  point: "知识点",
  topic: "专题",
  knowledge_topic: "知识专题",
  change: "变更对象",
  change_kind: "变更类型",
  diagnosis_report: "诊断报告",
  recommendation_report: "推荐报告",
  bank: "题库题目",
  bank_version: "题目版本",
  version: "版本",
  resource: "学习资料",
  source: "原始资料",
  paper_source: "拆题资料",
  fragment: "原文片段",
  knowledge: "知识条目",
  task: "任务",
  student: "学生",
  batch: "重评批次",
  assignment: "作业",
  question: "题目",
  submission: "作答",
  node: "目录节点",
  turn: "问答记录",
  job: "后台任务",
  new: "新建模式",
  paper: "整卷拆题",
};

const EXCLUDED_CONTAINER_SELECTOR =
  '[data-floating-assistant], .floating-agent-drawer, .grading-original, .answer-panel, textarea, input, select, [contenteditable="true"], script, style, noscript, svg, template';

function cleanText(raw: string | null | undefined, maxLen = 80): string {
  if (!raw) return "";
  const normalized = raw.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}…`;
}

function isSafeID(value: string | null | undefined): value is string {
  return Boolean(value && SAFE_ID_RE.test(value));
}

function stripRolePrefix(pathname: string): string {
  const cleaned = pathname.replace(/\/+$/, "") || "/";
  if (cleaned === "/teacher" || cleaned === "/student") return "";
  return cleaned.replace(/^\/(?:teacher|student)\//, "");
}

function extractFilters(params: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  const orderedKeys = [
    "source_view",
    "tab",
    "view",
    "search",
    "knowledge_search",
    "resource_search",
    "state",
    "knowledge_state",
    "type",
    "point",
    "topic",
    "knowledge_topic",
    "change_kind",
    "change",
    "diagnosis_report",
    "recommendation_report",
    "bank_version",
    "version",
    "bank",
    "resource",
    "source",
    "paper_source",
    "knowledge",
    "fragment",
    "task",
    "batch",
    "student",
    "node",
    "turn",
    "job",
    "assignment",
    "question",
    "submission",
  ];

  const translateValue = (key: string, val: string): string => {
    if (key === "source_view") return SOURCE_VIEW_LABELS[val] || val;
    if (key === "view") return INSIGHT_VIEW_LABELS[val] || val;
    if (key === "tab") {
      return MATERIALS_TAB_LABELS[val] || COURSE_TAB_LABELS[val] || val;
    }
    if (key === "state" || key === "knowledge_state") {
      return STATE_LABELS[val] || val;
    }
    if (key === "type") return QUESTION_TYPE_LABELS[val] || val;
    if (key === "change_kind") return CHANGE_KIND_LABELS[val] || val;
    return val;
  };

  for (const key of orderedKeys) {
    const rawVal = params.get(key);
    if (!rawVal) continue;
    const labelKey = FILTER_KEY_LABELS[key] || key;
    const cleanedVal = cleanText(translateValue(key, rawVal), 60);
    if (cleanedVal) {
      filters[labelKey] = cleanedVal;
    }
    if (Object.keys(filters).length >= 10) break;
  }

  return filters;
}

export function resolveRouteContext(
  pathname: string,
  search: string,
  teacher: boolean,
): ResolvedRouteContext {
  const params = new URLSearchParams(search);
  const subPath = stripRolePrefix(pathname);
  const fullPath = pathname.replace(/\/+$/, "") || "/";
  const filters = extractFilters(params);

  let pageTitle = "工作台";
  let subPage: string | undefined;
  let activeTab: string | undefined;
  let autoContext: BusinessContext | undefined;

  const sourceParam = params.get("source") || "";
  const resourceParam = params.get("resource") || "";
  const knowledgeParam = params.get("knowledge") || "";
  const bankParam = params.get("bank") || "";
  const bankVersionParam = params.get("bank_version") || params.get("version") || "";
  const paperSourceParam = params.get("paper_source") || "";
  const diagnosisParam = params.get("diagnosis_report") || "";
  const recommendationParam = params.get("recommendation_report") || "";
  const taskParam = params.get("task") || "";
  const submissionParam = params.get("submission") || "";
  const changeParam = params.get("change") || "";
  const changeKindParam = params.get("change_kind") || "";
  const tabParam = params.get("tab") || "";
  const viewParam = params.get("view") || "";
  const sourceViewParam = params.get("source_view") || "";
  const studentParam = params.get("student") || "";
  const batchParam = params.get("batch") || "";
  const turnParam = params.get("turn") || "";

  let match: RegExpMatchArray | null = null;

  if (subPath === "dashboard" || subPath === "teacher-twin/drilldown") {
    pageTitle = teacher ? "教学看板" : "我的概览";
    if (teacher && (viewParam || studentParam)) {
      const resolvedView = INSIGHT_VIEW_LABELS[viewParam] || (studentParam ? "学生与进度" : "");
      if (resolvedView) {
        subPage = resolvedView;
        activeTab = resolvedView;
      }
    }
  } else if (subPath === "home" || subPath === "student-twin") {
    pageTitle = teacher ? "教学看板" : "我的概览";
  } else if (subPath === "materials") {
    pageTitle = "学习资料";
    if (sourceParam) {
      const viewLabel = SOURCE_VIEW_LABELS[sourceViewParam] || "原文核对";
      activeTab = viewLabel;
      subPage = `原始资料 · ${viewLabel}`;
      if (isSafeID(sourceParam)) {
        autoContext = { kind: "source", id: sourceParam, title: "当前原始资料" };
      }
    } else if (tabParam === "published" || params.has("resource")) {
      activeTab = "学习内容";
      subPage = resourceParam ? "学习内容详情" : "学习内容";
      if (isSafeID(resourceParam)) {
        autoContext = { kind: "resource", id: resourceParam, title: "当前学习资料" };
      }
    } else {
      activeTab = "原始资料";
      subPage = "原始资料";
    }
  } else if (subPath === "knowledge") {
    pageTitle = "知识库";
    if (knowledgeParam) {
      subPage = "知识条目详情";
      if (isSafeID(knowledgeParam)) {
        autoContext = { kind: "knowledge", id: knowledgeParam, title: "当前知识条目" };
      }
    } else if (sourceParam) {
      subPage = "按原始资料筛选";
    }
  } else if (subPath === "question-bank") {
    pageTitle = "题库与标准";
    if (paperSourceParam || params.get("paper") === "1") {
      subPage = "整卷拆题";
      if (isSafeID(paperSourceParam)) {
        autoContext = { kind: "source", id: paperSourceParam, title: "拆题原始资料" };
      }
    } else if (params.get("new") === "1") {
      subPage = "新建题目";
    } else if (bankVersionParam) {
      subPage = "题目版本与标准详情";
      if (isSafeID(bankVersionParam)) {
        autoContext = { kind: "question", id: bankVersionParam, title: "当前题目版本" };
      }
    } else if (bankParam) {
      subPage = "题目详情";
    }
  } else if (subPath === "retrieval") {
    pageTitle = teacher ? "检索与问答" : "资料问答";
    if (resourceParam) {
      subPage = "定向资料问答";
      if (isSafeID(resourceParam)) {
        autoContext = { kind: "resource", id: resourceParam, title: "当前学习资料" };
      }
    } else if (turnParam) {
      subPage = "历史问答记录";
    }
  } else if (subPath === "content-impact") {
    pageTitle = "内容变更";
    if (changeParam || changeKindParam) {
      const kindLabel = CHANGE_KIND_LABELS[changeKindParam];
      subPage = kindLabel ? `${kindLabel}变更影响` : "变更影响详情";
    }
  } else if (subPath === "homework" || subPath === "assignments" || subPath === "grading") {
    pageTitle = "作业中心";
  } else if (subPath === "homework/new") {
    pageTitle = "新建作业";
  } else if ((match = subPath.match(/^homework\/submissions\/([^/]+)\/grade$/))) {
    pageTitle = "批阅作答";
    const submissionID = decodeURIComponent(match[1]);
    if (isSafeID(submissionID)) {
      autoContext = { kind: "submission", id: submissionID, title: "当前学生作答" };
    }
  } else if ((match = subPath.match(/^homework\/submissions\/([^/]+)\/feedback$/))) {
    pageTitle = "作答反馈";
    const submissionID = decodeURIComponent(match[1]);
    if (isSafeID(submissionID)) {
      autoContext = { kind: "submission", id: submissionID, title: "当前作答与反馈" };
    }
  } else if ((match = subPath.match(/^homework\/([^/]+)\/edit$/))) {
    pageTitle = "编辑作业";
    const assignmentID = decodeURIComponent(match[1]);
    if (isSafeID(assignmentID)) {
      autoContext = { kind: "assignment", id: assignmentID, title: "当前编辑作业" };
    }
  } else if ((match = subPath.match(/^homework\/([^/]+)\/submissions$/))) {
    pageTitle = "提交列表";
    subPage = "作业提交队列";
    const assignmentID = decodeURIComponent(match[1]);
    if (isSafeID(assignmentID)) {
      autoContext = { kind: "assignment", id: assignmentID, title: "当前作业" };
    }
  } else if ((match = subPath.match(/^homework\/([^/]+)$/))) {
    pageTitle = "作业详情";
    const assignmentID = decodeURIComponent(match[1]);
    if (isSafeID(assignmentID)) {
      autoContext = { kind: "assignment", id: assignmentID, title: "当前作业" };
    }
  } else if (subPath === "quiz") {
    pageTitle = "测验";
  } else if (subPath === "quiz/new") {
    pageTitle = "新建测验";
  } else if (subPath === "regrades") {
    pageTitle = "整组重评";
    if (params.get("new") === "1") {
      subPage = "建立重评批次";
    } else if (batchParam) {
      subPage = "重评批次详情";
    }
  } else if (subPath === "insight") {
    pageTitle = "学情分析";
    const viewKey = viewParam in INSIGHT_VIEW_LABELS ? viewParam : studentParam ? "students" : "gaps";
    const viewLabel = INSIGHT_VIEW_LABELS[viewKey] || "评分缺口";
    activeTab = viewLabel;
    if (diagnosisParam) {
      subPage = `${viewLabel} · 诊断报告`;
      if (isSafeID(diagnosisParam)) {
        autoContext = { kind: "diagnosis", id: diagnosisParam, title: "当前诊断报告" };
      }
    } else {
      subPage = viewLabel;
    }
  } else if (subPath === "intervention" || subPath.startsWith("intervention/")) {
    pageTitle = teacher ? "补学补练" : "老师任务";
    if (params.get("new") === "1") {
      subPage = "新建补学补练任务";
    } else if (taskParam) {
      subPage = "任务详情";
      if (isSafeID(taskParam)) {
        autoContext = { kind: "intervention", id: taskParam, title: "当前补学补练任务" };
      }
    } else if (isSafeID(submissionParam)) {
      autoContext = { kind: "submission", id: submissionParam, title: "关联学生作答" };
    }
  } else if (subPath === "courses") {
    pageTitle = teacher ? "课程与成员" : "学习资料";
    if (teacher) {
      const courseTab = tabParam === "members" ? "课程成员" : "课程设置";
      activeTab = courseTab;
      subPage = courseTab;
    }
  } else if (subPath === "curriculum") {
    pageTitle = "课程目录与知识图谱";
  } else if (subPath === "interaction") {
    pageTitle = "课程互动";
  } else if (subPath === "research") {
    pageTitle = "教研记录";
  } else if (subPath === "industry-intelligence") {
    pageTitle = "行业能力";
  } else if (subPath === "course-content" || subPath === "course-twin") {
    pageTitle = "学习资料";
    if (resourceParam) {
      subPage = "学习内容详情";
      if (isSafeID(resourceParam)) {
        autoContext = { kind: "resource", id: resourceParam, title: "当前学习资料" };
      }
    }
  } else if (subPath === "learning") {
    pageTitle = "学习路径";
    if (recommendationParam) {
      subPage = "学习推荐报告";
    }
  } else if (subPath === "profile") {
    pageTitle = "个人设置";
  } else if (subPath === "assistant") {
    pageTitle = "课程助理";
  }

  return {
    path: fullPath,
    page_title: pageTitle,
    sub_page: subPage,
    active_tab: activeTab,
    filters,
    autoContext,
  };
}

function isExcludedNode(el: Element | null): boolean {
  if (!el) return true;
  return el.closest(EXCLUDED_CONTAINER_SELECTOR) !== null;
}

function isVisibleElement(el: Element): boolean {
  if (isExcludedNode(el)) return false;
  if (el.closest(".ant-tabs-tabpane-hidden, [hidden], [aria-hidden='true']")) {
    return false;
  }
  const drawerAncestor = el.closest(".ant-drawer");
  if (drawerAncestor && !drawerAncestor.classList.contains("ant-drawer-open")) {
    return false;
  }
  const modalWrap = el.closest(".ant-modal-wrap");
  if (modalWrap && (modalWrap as HTMLElement).style.display === "none") {
    return false;
  }
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  }
  return true;
}

function readHeadingText(el: Element): string {
  if (el.classList.contains("section-head")) {
    const primary = el.querySelector(":scope > :is(h1, h2, h3, strong, .ant-typography, span)");
    return cleanText(primary?.textContent, 60);
  }
  return cleanText(el.textContent, 60);
}

function readFocusedControlLabel(): string {
  if (typeof document === "undefined") return "";
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) {
    return "";
  }
  if (active.id === "main-content" || active.tagName === "MAIN") {
    return "";
  }
  if (active.closest("[data-floating-assistant], .floating-agent-drawer")) {
    return "";
  }
  if (active.matches('input[type="password"]')) {
    return "";
  }
  if (active.closest(".grading-original, .answer-panel")) {
    return "";
  }

  const ariaLabel = cleanText(active.getAttribute("aria-label"), 50);
  if (ariaLabel) return ariaLabel;

  const labelledBy = active.getAttribute("aria-labelledby");
  if (labelledBy) {
    const refEl = document.getElementById(labelledBy.split(/\s+/)[0] || "");
    const refText = cleanText(refEl?.textContent, 50);
    if (refText) return refText;
  }

  if (active.id && typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    const forLabel = document.querySelector(`label[for="${CSS.escape(active.id)}"]`);
    const forText = cleanText(forLabel?.textContent, 50);
    if (forText) return forText;
  }

  const formItemLabel = active
    .closest(".ant-form-item")
    ?.querySelector(".ant-form-item-label label");
  const formLabelText = cleanText(formItemLabel?.textContent, 50);
  if (formLabelText) return formLabelText;

  if (!active.matches("input, textarea, select")) {
    const controlText = cleanText(active.textContent, 50);
    if (controlText) return controlText;
  }

  const placeholder = cleanText(active.getAttribute("placeholder"), 50);
  if (placeholder) return placeholder;

  return "";
}

function buildContextSnapshot(
  pathname: string,
  search: string,
  teacher: boolean,
  course?: CourseRef,
): { pageContext: LivePageContext; autoContext?: BusinessContext } {
  const resolved = resolveRouteContext(pathname, search, teacher);
  const courseName = cleanText(course?.title, 80) || undefined;

  if (typeof document === "undefined") {
    const summaryParts = [
      courseName ? `课程：${courseName}` : "",
      `页面：${resolved.page_title}${resolved.sub_page ? ` · ${resolved.sub_page}` : ""}`,
      resolved.active_tab ? `页签：${resolved.active_tab}` : "",
    ].filter(Boolean);
    return {
      pageContext: {
        path: resolved.path,
        page_title: resolved.page_title,
        sub_page: resolved.sub_page,
        active_tab: resolved.active_tab,
        course_name: courseName,
        filters: Object.keys(resolved.filters).length ? resolved.filters : undefined,
        summary: summaryParts.join("；").slice(0, 1000) || undefined,
      },
      autoContext: resolved.autoContext,
    };
  }

  const mainEl =
    document.querySelector("main#main-content") || document.querySelector("main");

  const headerTitle = mainEl
    ? cleanText(mainEl.querySelector(".page-header-title")?.textContent, 80)
    : "";

  const openOverlayTitles: string[] = [];
  for (const el of document.querySelectorAll(
    ".ant-drawer-open .ant-drawer-title, .ant-modal-wrap .ant-modal-title",
  )) {
    if (!isVisibleElement(el)) continue;
    const text = cleanText(el.textContent, 70);
    if (text && !openOverlayTitles.includes(text)) {
      openOverlayTitles.push(text);
    }
  }

  const tabLabels: string[] = [];
  const collectRoots: Element[] = [];
  if (mainEl) collectRoots.push(mainEl);
  for (const overlay of document.querySelectorAll(
    ".ant-drawer-open, .ant-modal-wrap",
  )) {
    if (isVisibleElement(overlay)) collectRoots.push(overlay);
  }

  for (const root of collectRoots) {
    for (const tabEl of root.querySelectorAll(".ant-tabs-tab-active")) {
      if (!isVisibleElement(tabEl)) continue;
      const text = cleanText(tabEl.textContent, 40);
      if (text && !tabLabels.includes(text)) {
        tabLabels.push(text);
      }
    }
  }

  const segmentedLabels: string[] = [];
  for (const root of collectRoots) {
    for (const segEl of root.querySelectorAll(".ant-segmented-item-selected")) {
      if (!isVisibleElement(segEl)) continue;
      const text = cleanText(segEl.textContent, 40);
      if (text && !segmentedLabels.includes(text)) {
        segmentedLabels.push(text);
      }
    }
  }

  const stepLabels: string[] = [];
  for (const root of collectRoots) {
    for (const stepEl of root.querySelectorAll(
      ".ant-steps-item-process .ant-steps-item-title",
    )) {
      if (!isVisibleElement(stepEl)) continue;
      const text = cleanText(stepEl.textContent, 50);
      if (text && !stepLabels.includes(text)) {
        stepLabels.push(text);
      }
    }
  }

  const headings: string[] = [];
  for (const root of collectRoots) {
    for (const headingEl of root.querySelectorAll(
      ".ant-card-head-title, h1, h2, h3, .section-head",
    )) {
      if (!isVisibleElement(headingEl)) continue;
      const text = readHeadingText(headingEl);
      if (
        text &&
        text !== resolved.page_title &&
        text !== headerTitle &&
        !headings.includes(text)
      ) {
        headings.push(text);
        if (headings.length >= 10) break;
      }
    }
    if (headings.length >= 10) break;
  }

  const visibleTags: string[] = [];
  for (const root of collectRoots) {
    for (const tagEl of root.querySelectorAll(".ant-tag, .ant-alert-message")) {
      if (!isVisibleElement(tagEl)) continue;
      const text = cleanText(tagEl.textContent, 50);
      if (text && !visibleTags.includes(text)) {
        visibleTags.push(text);
        if (visibleTags.length >= 12) break;
      }
    }
    if (visibleTags.length >= 12) break;
  }

  const focusLabel = readFocusedControlLabel();

  const effectiveActiveTab =
    tabLabels.length > 0 ? tabLabels.join(" · ") : resolved.active_tab;

  let effectiveSubPage = resolved.sub_page;
  if (!effectiveSubPage && openOverlayTitles.length > 0) {
    effectiveSubPage = openOverlayTitles[0];
  } else if (
    !effectiveSubPage &&
    headerTitle &&
    headerTitle !== resolved.page_title &&
    resolved.page_title === "作业详情"
  ) {
    effectiveSubPage = headerTitle;
  } else if (
    resolved.page_title === "学习资料" &&
    resolved.autoContext?.kind === "source" &&
    mainEl
  ) {
    const sourceTitle = cleanText(
      mainEl.querySelector(".source-task-workspace .workspace-heading .item-title")
        ?.textContent,
      50,
    );
    if (sourceTitle && tabLabels.length > 0) {
      effectiveSubPage = `${sourceTitle} · ${tabLabels[tabLabels.length - 1]}`;
    }
  }

  const activityParts: string[] = [];
  if (openOverlayTitles.length > 0) {
    activityParts.push(`查看或编辑「${openOverlayTitles[0]}」`);
  }
  if (stepLabels.length > 0) {
    activityParts.push(`当前步骤：${stepLabels[0]}`);
  }
  if (segmentedLabels.length > 0) {
    activityParts.push(`模式：${segmentedLabels[0]}`);
  }
  if (focusLabel) {
    activityParts.push(`聚焦控件：${focusLabel}`);
  }
  if (!activityParts.length && (effectiveSubPage || effectiveActiveTab)) {
    activityParts.push(`浏览「${effectiveSubPage || effectiveActiveTab}」`);
  }
  const activity = activityParts.join("；") || undefined;

  let refinedAutoContext = resolved.autoContext;
  if (refinedAutoContext) {
    let domTitle = "";
    if (
      refinedAutoContext.kind === "assignment" &&
      headerTitle &&
      headerTitle !== "作业详情" &&
      headerTitle !== "提交列表" &&
      headerTitle !== "编辑作业"
    ) {
      domTitle = headerTitle;
    } else if (refinedAutoContext.kind === "source" && mainEl) {
      domTitle = cleanText(
        mainEl.querySelector(".source-task-workspace .workspace-heading .item-title")
          ?.textContent,
        60,
      );
    } else if (
      (refinedAutoContext.kind === "knowledge" ||
        refinedAutoContext.kind === "question") &&
      openOverlayTitles.length > 0
    ) {
      domTitle = openOverlayTitles[0];
    }
    if (domTitle) {
      refinedAutoContext = { ...refinedAutoContext, title: domTitle };
    }
  }

  const filterSummary = Object.entries(resolved.filters)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`)
    .join("，");

  const summarySegments = [
    courseName ? `课程：${courseName}` : "",
    `页面：${resolved.page_title}${effectiveSubPage ? ` · ${effectiveSubPage}` : ""}`,
    effectiveActiveTab ? `页签：${effectiveActiveTab}` : "",
    segmentedLabels.length ? `分段选项：${segmentedLabels.join("、")}` : "",
    stepLabels.length ? `流程步骤：${stepLabels.join("、")}` : "",
    openOverlayTitles.length ? `当前弹窗/抽屉：${openOverlayTitles.join("、")}` : "",
    focusLabel ? `焦点：${focusLabel}` : "",
    filterSummary ? `筛选：${filterSummary}` : "",
    headings.length ? `可见区块：${headings.slice(0, 6).join("、")}` : "",
    visibleTags.length ? `状态标签：${visibleTags.slice(0, 8).join("、")}` : "",
  ].filter(Boolean);

  let summary = summarySegments.join("；").replace(/\0/g, "");
  if (summary.length > 1000) {
    summary = `${summary.slice(0, 997)}…`;
  }

  const pageContext: LivePageContext = {
    path: resolved.path,
    page_title: resolved.page_title,
    ...(effectiveSubPage ? { sub_page: effectiveSubPage } : {}),
    ...(effectiveActiveTab ? { active_tab: effectiveActiveTab } : {}),
    ...(activity ? { activity } : {}),
    ...(courseName ? { course_name: courseName } : {}),
    ...(headings.length ? { headings } : {}),
    ...(visibleTags.length ? { visible_tags: visibleTags } : {}),
    ...(summary ? { summary } : {}),
    ...(Object.keys(resolved.filters).length ? { filters: resolved.filters } : {}),
  };

  return { pageContext, autoContext: refinedAutoContext };
}

export function captureLivePageContext(
  pathname: string,
  search: string,
  teacher: boolean,
  course?: CourseRef,
): LivePageContext {
  return buildContextSnapshot(pathname, search, teacher, course).pageContext;
}

export function useLivePageContext(
  teacher: boolean,
  course: CourseRef,
  enabled: boolean,
) {
  const { pathname, search } = useLocation();
  const latestArgs = useRef({ pathname, search, teacher, course });
  latestArgs.current = { pathname, search, teacher, course };

  const initialSnapshot = useMemo(
    () => buildContextSnapshot(pathname, search, teacher, course),
    [pathname, search, teacher, course],
  );

  const [snapshot, setSnapshot] = useState(initialSnapshot);

  const refresh = useCallback(() => {
    const args = latestArgs.current;
    const next = buildContextSnapshot(
      args.pathname,
      args.search,
      args.teacher,
      args.course,
    );
    setSnapshot((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  }, []);

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    refresh();
    const settleTimer1 = window.setTimeout(refresh, 120);
    const settleTimer2 = window.setTimeout(refresh, 400);

    let debounceTimer: number | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        refresh();
      }, 150);
    };

    const mainEl =
      document.querySelector("main#main-content") ||
      document.querySelector("main");

    let observer: MutationObserver | null = null;
    if (mainEl && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((mutations) => {
        const allAssistant = mutations.every(
          (m) =>
            m.target instanceof Element &&
            m.target.closest("[data-floating-assistant], .floating-agent-drawer") !==
              null,
        );
        if (!allAssistant) {
          scheduleRefresh();
        }
      });
      observer.observe(mainEl, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "aria-selected", "aria-pressed", "hidden"],
      });
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-floating-assistant], .floating-agent-drawer")
      ) {
        return;
      }
      scheduleRefresh();
    };

    document.addEventListener("focusin", onFocusIn, true);

    return () => {
      window.clearTimeout(settleTimer1);
      window.clearTimeout(settleTimer2);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      observer?.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [enabled, pathname, search, teacher, course?.id, course?.title, refresh]);

  return {
    pageContext: snapshot.pageContext,
    autoContext: snapshot.autoContext,
    refresh,
  };
}
