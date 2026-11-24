import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Pagination,
  Progress,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AlertCircle,
  BookOpen,
  ClipboardCheck,
  Compass,
  Download,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { ActivityTimeline } from "./activity";
import { Link, useLearning, useLiveQuery, when } from "./context";
import { formatResourceLocator } from "./domain-meta";
import type { ReleasedEvidence } from "./learning-gaps";
import { RevisionPoints } from "./revision-points";
import type { Assignment, Point, Resource } from "./types";

const LazyDiagnosisPanel = lazy(() =>
  import("./intelligence").then((m) => ({ default: m.DiagnosisPanel })),
);
const LazyLearningGaps = lazy(() =>
  import("./learning-gaps").then((m) => ({ default: m.LearningGaps })),
);
const LazyInsightStudents = lazy(() =>
  import("./insight-students").then((m) => ({ default: m.InsightStudents })),
);

export interface Overview {
  id: string;
  display_name: string;
  completed_events: number;
  submitted_assignments: number;
  pending_interventions: number;
}

interface KnowledgeMasteryItem {
  id: string;
  title: string;
  count: number;
  rate: number | null;
}

const TEACHER_VIEWS = ["overview", "students", "evidence", "gaps"] as const;
type TeacherView = (typeof TEACHER_VIEWS)[number];

const SCORE_BANDS = [
  { key: "b0", label: "<60%", color: "var(--danger)" },
  { key: "b1", label: "60-69%", color: "var(--warning)" },
  { key: "b2", label: "70-79%", color: "var(--teal-bright)" },
  { key: "b3", label: "80-89%", color: "var(--teal)" },
  { key: "b4", label: "90-100%", color: "var(--success)" },
] as const;

function escapeCSVCell(raw: string): string {
  const value = String(raw ?? "");
  const trimmed = value.replace(/^[\s\u0000-\u001f]+/, "");
  const safe = /^[=+@\-]/.test(trimmed) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function exportEvidenceCSV(
  rows: ReleasedEvidence[],
  studentNames: Map<string, string>,
) {
  const cells = [
    [
      "学生姓名",
      "学生ID",
      "作业名称",
      "题目",
      "得分",
      "满分",
      "得分率",
      "发布时间",
      "提交ID",
      "评分修订ID",
      "标准版本ID",
      "逐点评分与依据",
      "总评",
    ],
    ...rows.map((r) => [
      r.student_name || studentNames.get(r.student_id) || "",
      r.student_id,
      r.assignment_title || "",
      r.prompt,
      String(r.score),
      String(r.max_score),
      r.max_score > 0 ? `${Math.round((r.score / r.max_score) * 100)}%` : "",
      r.released_at || "",
      r.submission_id,
      r.revision_id,
      r.rubric_id || "",
      JSON.stringify(r.point_scores || []),
      r.feedback || "",
    ]),
  ];
  const csv =
    "\uFEFF" +
    cells.map((row) => row.map(escapeCSVCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "课程正式评分证据.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function ScoreHistogramCard({ rows }: { rows: ReleasedEvidence[] }) {
  const { counts, maxCount, total, lowCount } = useMemo(() => {
    const bucketCounts = [0, 0, 0, 0, 0];
    let scored = 0;
    for (const r of rows) {
      if (!r.max_score || r.max_score <= 0) continue;
      scored += 1;
      const pct = (r.score / r.max_score) * 100;
      if (pct < 60) bucketCounts[0] += 1;
      else if (pct < 70) bucketCounts[1] += 1;
      else if (pct < 80) bucketCounts[2] += 1;
      else if (pct < 90) bucketCounts[3] += 1;
      else bucketCounts[4] += 1;
    }
    return {
      counts: bucketCounts,
      maxCount: Math.max(1, ...bucketCounts),
      total: scored,
      lowCount: bucketCounts[0],
    };
  }, [rows]);

  return (
    <Card className="card-panel" title="成绩分布直方图">
      {!total ? (
        <EmptyState title="暂无正式成绩分布">
          发布正式评分后，系统会自动按分数段统计分布情况。
        </EmptyState>
      ) : (
        <Space direction="vertical" className="live-full-width" size="small">
          <svg
            className="score-histogram-svg"
            viewBox="0 0 440 196"
            role="img"
            aria-label="成绩分布直方图"
          >
            <line
              x1="20"
              y1="44"
              x2="420"
              y2="44"
              stroke="var(--line)"
              strokeDasharray="3 3"
            />
            <line
              x1="20"
              y1="98"
              x2="420"
              y2="98"
              stroke="var(--line)"
              strokeDasharray="3 3"
            />
            <line x1="20" y1="154" x2="420" y2="154" stroke="var(--line)" />
            {SCORE_BANDS.map((band, idx) => {
              const count = counts[idx];
              const slotWidth = 80;
              const barWidth = 44;
              const x = 20 + idx * slotWidth + (slotWidth - barWidth) / 2;
              const maxBarHeight = 116;
              const barHeight =
                count > 0 ? Math.max(8, Math.round((count / maxCount) * maxBarHeight)) : 0;
              const y = 154 - barHeight;
              const centerX = x + barWidth / 2;
              return (
                <g key={band.key}>
                  {barHeight > 0 && (
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={6}
                      fill={band.color}
                    />
                  )}
                  <text
                    x={centerX}
                    y={Math.max(18, y - 8)}
                    textAnchor="middle"
                    fill="var(--ink)"
                    fontSize="12"
                    fontWeight="600"
                  >
                    {count}
                  </text>
                  <text
                    x={centerX}
                    y={178}
                    textAnchor="middle"
                    fill="var(--muted)"
                    fontSize="12"
                  >
                    {band.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <MetaTags>
            <MetaTag>有效成绩 {total} 条</MetaTag>
            <Tag color={lowCount > 0 ? "error" : "success"}>
              低于 60%：{lowCount} 条
            </Tag>
          </MetaTags>
        </Space>
      )}
    </Card>
  );
}

function MasteryBarsCard({ items }: { items: KnowledgeMasteryItem[] }) {
  const scored = items.filter((item) => item.rate !== null);
  const ungradedCount = items.length - scored.length;

  return (
    <Card className="card-panel" title="知识点掌握率对比">
      {!scored.length ? (
        <EmptyState title="暂无知识点掌握数据">
          发布关联知识点的正式评分后，这里会按掌握率由低到高排序对比。
        </EmptyState>
      ) : (
        <Space direction="vertical" className="live-full-width" size="small">
          <div className="mastery-bar-list">
            {scored.map((item) => {
              const rate = item.rate ?? 0;
              const tone =
                rate < 60
                  ? "tone-low"
                  : rate < 80
                    ? "tone-mid"
                    : "tone-good";
              return (
                <div className="mastery-bar-row" key={item.id}>
                  <Tooltip
                    title={`${item.title}：${rate}%（${item.count} 条有效结果）`}
                  >
                    <span className="mastery-bar-label">
                      {item.title}（{item.count}条）
                    </span>
                  </Tooltip>
                  <div className="mastery-bar-track" aria-hidden="true">
                    <div
                      className={`mastery-bar-fill ${tone}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="mastery-bar-val">{rate}%</span>
                </div>
              );
            })}
          </div>
          {ungradedCount > 0 && (
            <Typography.Text type="secondary">
              另有 {ungradedCount} 个知识点尚无正式评分证据。
            </Typography.Text>
          )}
        </Space>
      )}
    </Card>
  );
}

export function OverviewPage({ analysis = false }: { analysis?: boolean }) {
  const { session } = useSession();
  const { course } = useLearning();
  const teacher = session?.user.role === "teacher";
  const pageHeading = teacher ? (analysis ? "学情分析" : "教学看板") : "我的概览";
  const [params, setParams] = useSearchParams();
  const studentParam = params.get("student") || "";
  const rawView = params.get("view") || "";
  const view: TeacherView = (TEACHER_VIEWS as readonly string[]).includes(
    rawView,
  )
    ? (rawView as TeacherView)
    : studentParam
      ? "students"
      : analysis
        ? "gaps"
        : "overview";

  const [evidencePage, setEvidencePage] = useState(1);

  const overview = useLiveQuery<Overview[]>("/overview", teacher);
  const matchedStudent = useMemo(
    () =>
      teacher && studentParam
        ? overview.data?.find((s) => s.id === studentParam)
        : undefined,
    [teacher, studentParam, overview.data],
  );
  const validStudentFilter = matchedStudent ? matchedStudent.id : "";
  const invalidStudentParam = Boolean(
    teacher && studentParam && overview.data && !matchedStudent,
  );

  // Conditionally enable API queries per active role and view so hidden tabs never over-fetch.
  const useServerStudentEvidence =
    teacher && view === "evidence" && !!validStudentFilter;
  const classEvidenceEnabled =
    !teacher ||
    view !== "evidence" ||
    !studentParam ||
    invalidStudentParam;

  const classEvidence = useLiveQuery<ReleasedEvidence[]>(
    "/evidence",
    classEvidenceEnabled,
  );
  const studentEvidence = useLiveQuery<ReleasedEvidence[]>(
    `/evidence?student_id=${encodeURIComponent(validStudentFilter)}`,
    useServerStudentEvidence,
  );
  const activeEvidence = useServerStudentEvidence
    ? studentEvidence
    : classEvidence;

  const needAssignments = !teacher || view === "overview";
  const needPoints = !teacher || view === "overview";
  const assignments = useLiveQuery<Assignment[]>(
    "/assignments",
    needAssignments,
  );
  const points = useLiveQuery<{ points: Point[] }>("", needPoints);
  const resources = useLiveQuery<Resource[]>("/resources", !teacher);
  const events = useLiveQuery<{ resource_id: string; verb: string }[]>(
    "/events",
    !teacher,
  );

  const studentNames = useMemo(
    () => new Map((overview.data || []).map((s) => [s.id, s.display_name])),
    [overview.data],
  );

  const setStudentFilter = (id: string) => {
    setEvidencePage(1);
    const next = new URLSearchParams(params);
    if (id) next.set("student", id);
    else next.delete("student");
    setParams(next, { replace: true });
  };

  const setView = (nextView: string) => {
    setEvidencePage(1);
    const next = new URLSearchParams(params);
    next.set("view", nextView);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const list = activeEvidence.data || [];
    if (!teacher || !validStudentFilter || useServerStudentEvidence) {
      return list;
    }
    return list.filter((r) => r.student_id === validStudentFilter);
  }, [activeEvidence.data, teacher, validStudentFilter, useServerStudentEvidence]);

  const knowledgeMastery = useMemo<KnowledgeMasteryItem[]>(() => {
    const byPoint = new Map<
      string,
      { count: number; scoreSum: number; maxSum: number }
    >();
    for (const r of rows) {
      if (!r.knowledge_point_id) continue;
      const cur = byPoint.get(r.knowledge_point_id) || {
        count: 0,
        scoreSum: 0,
        maxSum: 0,
      };
      cur.count += 1;
      cur.scoreSum += r.score;
      cur.maxSum += r.max_score;
      byPoint.set(r.knowledge_point_id, cur);
    }
    const kpList = (points.data?.points || []).filter((p) => p.kind === "point");
    return kpList
      .map((p) => {
        const stats = byPoint.get(p.id);
        return {
          id: p.id,
          title: p.title,
          count: stats?.count || 0,
          rate:
            stats && stats.maxSum > 0
              ? Math.round((stats.scoreSum / stats.maxSum) * 100)
              : null,
        };
      })
      .sort((a, b) => {
        if (a.rate === null && b.rate === null)
          return a.title.localeCompare(b.title);
        if (a.rate === null) return 1;
        if (b.rate === null) return -1;
        return a.rate - b.rate || b.count - a.count;
      });
  }, [points.data, rows]);

  const completedResourceSet = useMemo(
    () =>
      new Set(
        (events.data || [])
          .filter((e) => e.verb === "completed")
          .map((e) => e.resource_id),
      ),
    [events.data],
  );

  const { score, max, lowCount } = useMemo(() => {
    let totalScore = 0;
    let totalMax = 0;
    let lowRecords = 0;
    for (const r of rows) {
      totalScore += r.score;
      totalMax += r.max_score;
      if (r.max_score > 0 && r.score / r.max_score < 0.6) {
        lowRecords += 1;
      }
    }
    return { score: totalScore, max: totalMax, lowCount: lowRecords };
  }, [rows]);

  const isLoading =
    (teacher && overview.isPending) ||
    (classEvidenceEnabled && classEvidence.isPending) ||
    (useServerStudentEvidence && studentEvidence.isPending) ||
    (needAssignments && assignments.isPending) ||
    (needPoints && points.isPending) ||
    (!teacher && (resources.isPending || events.isPending));

  const firstError =
    (teacher ? overview.error : null) ||
    (classEvidenceEnabled ? classEvidence.error : null) ||
    (useServerStudentEvidence ? studentEvidence.error : null) ||
    (needAssignments ? assignments.error : null) ||
    (needPoints ? points.error : null) ||
    (!teacher ? resources.error || events.error : null);

  if (isLoading) {
    return (
      <div className="live-page overview-page">
        <PageHeader title={pageHeading} subtitle={course?.title} />
        <LoadingState />
      </div>
    );
  }
  if (firstError) {
    return (
      <div className="live-page overview-page">
        <PageHeader title={pageHeading} subtitle={course?.title} />
        <ErrorState
          message={firstError.message}
          onRetry={() => {
            if (teacher) void overview.refetch();
            if (classEvidenceEnabled) void classEvidence.refetch();
            if (useServerStudentEvidence) void studentEvidence.refetch();
            if (needAssignments) void assignments.refetch();
            if (needPoints) void points.refetch();
            if (!teacher) {
              void resources.refetch();
              void events.refetch();
            }
          }}
        />
      </div>
    );
  }

  const evidenceTotalPages = Math.max(1, Math.ceil(rows.length / 10));
  const safeEvidencePage = Math.min(evidencePage, evidenceTotalPages);

  const shortcutItems: Array<[string, string, ReactNode]> = teacher
    ? [
        ["学习资料", "/teacher/materials", <BookOpen size={20} aria-hidden="true" />],
        ["作业中心", "/teacher/homework", <ClipboardCheck size={20} aria-hidden="true" />],
        ["干预任务", "/teacher/intervention", <Target size={20} aria-hidden="true" />],
      ]
    : [
        ["课程学习", "/student/course-content", <BookOpen size={20} aria-hidden="true" />],
        ["作业测验", "/student/homework", <ClipboardCheck size={20} aria-hidden="true" />],
        ["学习路径", "/student/learning", <Compass size={20} aria-hidden="true" />],
      ];

  const renderShortcuts = () => (
    <nav className="live-shortcuts" aria-label="工作台快捷入口">
      {shortcutItems.map(([title, to, iconNode]) => (
        <Link className="live-shortcut" to={to} key={to}>
          <strong>
            {title}
            <span aria-hidden="true">›</span>
          </strong>
          <div className="shortcut-art" aria-hidden="true">
            {iconNode}
          </div>
        </Link>
      ))}
    </nav>
  );

  const renderMetrics = () => (
    <div className="live-metrics">
      <Card className="card-panel metric-card">
        <Statistic
          title={
            <>
              <span className="metric-title-icon" aria-hidden="true">
                <Users size={14} />
              </span>
              <span>{teacher && !validStudentFilter ? "课程学生" : "有效评分记录"}</span>
            </>
          }
          value={
            teacher && !validStudentFilter
              ? overview.data?.length || 0
              : rows.length
          }
        />
      </Card>
      <Card className="card-panel metric-card">
        <Statistic
          title={
            <>
              <span className="metric-title-icon" aria-hidden="true">
                <ClipboardCheck size={14} />
              </span>
              <span>已发布作业</span>
            </>
          }
          value={
            assignments.data?.filter((a) => a.status === "published").length || 0
          }
        />
      </Card>
      <Card
        className={
          max
            ? "card-panel metric-card"
            : "card-panel metric-card is-empty-state"
        }
      >
        <Statistic
          title={
            <>
              <span className="metric-title-icon" aria-hidden="true">
                <TrendingUp size={14} />
              </span>
              <span>正式结果表现</span>
            </>
          }
          value={max ? Math.round((score / max) * 100) : 0}
          suffix={max ? "%" : undefined}
          formatter={
            max
              ? undefined
              : () => <StatusTag status="pending" label="证据不足" />
          }
        />
      </Card>
      <Card className="card-panel metric-card">
        <Statistic
          title={
            <>
              <span className="metric-title-icon" aria-hidden="true">
                <AlertCircle size={14} />
              </span>
              <span>需复习记录</span>
            </>
          }
          value={lowCount}
        />
      </Card>
    </div>
  );

  const renderKnowledgePerformance = () => (
    <Card className="card-panel knowledge-section" title={<>知识点表现</>}>
      {!knowledgeMastery.length ? (
        <EmptyState title="尚未维护知识点" />
      ) : (
        <div className="live-performance">
          {knowledgeMastery.map((p) => (
            <article key={p.id}>
              <strong>{p.title}</strong>
              <MetaTags>
                {p.rate !== null ? (
                  <>
                    <MetaTag>{p.rate}%</MetaTag>
                    <MetaTag>{p.count} 条有效结果</MetaTag>
                  </>
                ) : (
                  <StatusTag status="pending" label="证据不足" />
                )}
              </MetaTags>
              {p.rate !== null && (
                <Progress
                  aria-label={`${p.title}表现`}
                  percent={p.rate}
                  status={
                    p.rate < 60
                      ? "exception"
                      : p.rate >= 80
                        ? "success"
                        : "normal"
                  }
                  showInfo={false}
                  size="small"
                />
              )}
            </article>
          ))}
        </div>
      )}
    </Card>
  );

  const renderEvidenceCard = () => (
    <Card className="card-panel evidence-section" title={<>正式评分证据</>}>
      {!rows.length ? (
        <EmptyState title="暂无已发布评分">
          教师确认并发布评分后，正式结果会显示在这里。
        </EmptyState>
      ) : (
        rows
          .slice((safeEvidencePage - 1) * 10, safeEvidencePage * 10)
          .map((r) => {
            const studentDisplayName =
              r.student_name || studentNames.get(r.student_id) || r.student_id;
            return (
              <article className="live-row" key={r.submission_id}>
                <div>
                  <Typography.Text strong className="item-title">
                    {r.prompt}
                  </Typography.Text>
                  <MetaTags>
                    {teacher && <MetaTag>{studentDisplayName}</MetaTag>}
                    {r.assignment_title && (
                      <MetaTag>{r.assignment_title}</MetaTag>
                    )}
                    <MetaTag>
                      {r.score}/{r.max_score} 分
                    </MetaTag>
                    <MetaTag>第 {r.attempt} 次作答</MetaTag>
                    <span className="live-meta">{when(r.released_at)}</span>
                  </MetaTags>
                  <p>{r.feedback}</p>
                  <RevisionPoints points={r.point_scores} />
                  {teacher && (
                    <Link
                      className="ghost-btn"
                      to={`/teacher/intervention?new=1&student=${encodeURIComponent(r.student_id)}&submission=${encodeURIComponent(r.submission_id)}&point=${encodeURIComponent(r.knowledge_point_id || "")}`}
                    >
                      根据本次反馈安排任务
                    </Link>
                  )}
                </div>
                <Link
                  to={`/${teacher ? "teacher" : "student"}/homework/submissions/${r.submission_id}/${teacher ? "grade" : "feedback"}`}
                >
                  查看原始证据
                </Link>
              </article>
            );
          })
      )}
      <Pagination
        current={safeEvidencePage}
        pageSize={10}
        total={rows.length}
        onChange={setEvidencePage}
        showSizeChanger={false}
        hideOnSinglePage
      />
    </Card>
  );

  if (!teacher) {
    const publishedResources = (resources.data || []).filter(
      (r) => r.status === "published",
    );
    const completedCount = publishedResources.filter((r) =>
      completedResourceSet.has(r.id),
    ).length;
    const progressPct = publishedResources.length
      ? Math.round((completedCount / publishedResources.length) * 100)
      : 0;

    return (
      <div className="live-page overview-page student-overview">
        <PageHeader title={pageHeading} subtitle={course?.title} />
        {renderMetrics()}
        <Card
          className="card-panel"
          title={<>资料学习进度</>}
          extra={
            <Link className="ghost-btn" to="/student/course-content">
              继续学习课程资料
            </Link>
          }
        >
          <Space direction="vertical" className="live-full-width" size="small">
            <Progress
              percent={progressPct}
              status={progressPct === 100 && publishedResources.length > 0 ? "success" : "active"}
            />
            <p className="live-meta">
              已完成 {completedCount} / {publishedResources.length} 份资料
            </p>
          </Space>
        </Card>
        {renderKnowledgePerformance()}
        <Card className="card-panel" title={<>继续学习</>}>
          <div className="live-inline">
            <Link className="primary-link" to="/student/course-content">
              进入学习中心
            </Link>
            <Link className="ghost-btn" to="/student/homework">
              查看作业
            </Link>
            <Link className="ghost-btn" to="/student/intervention">
              老师任务
            </Link>
          </div>
          {!publishedResources.length ? (
            <EmptyState title="暂无已发布课程资料" />
          ) : (
            publishedResources.slice(0, 6).map((r) => {
              const done = completedResourceSet.has(r.id);
              const loc = formatResourceLocator(r.locator);
              return (
                <article className="live-row" key={r.id}>
                  <div>
                    <Link
                      to={`/student/course-content?resource=${encodeURIComponent(r.id)}`}
                    >
                      {r.title}
                    </Link>
                    <MetaTags>
                      <StatusTag
                        status={done ? "completed" : "pending"}
                        label={done ? "已完成" : "待学习"}
                      />
                      {loc && <MetaTag>{loc}</MetaTag>}
                      <MetaTag>v{r.version}</MetaTag>
                    </MetaTags>
                  </div>
                </article>
              );
            })
          )}
        </Card>
        <ActivityTimeline teacher={false} studentID="" />
        {renderEvidenceCard()}
        {renderShortcuts()}
      </div>
    );
  }

  return (
    <div className={`live-page overview-page teacher-overview-${view}`}>
      <PageHeader
        title={pageHeading}
        subtitle={course?.title}
        extra={
          view !== "gaps" ? (
            <>
              <Select
                aria-label="学生范围"
                style={{ minWidth: 140, maxWidth: "100%" }}
                value={validStudentFilter}
                onChange={(v) => setStudentFilter(v || "")}
                showSearch
                allowClear
                placeholder="全班学生"
                optionFilterProp="label"
                options={[
                  { value: "", label: "全班" },
                  ...(overview.data || []).map((s) => ({
                    value: s.id,
                    label: s.display_name,
                  })),
                ]}
              />
              <Button
                icon={<Download size={14} aria-hidden="true" />}
                disabled={
                  !activeEvidence.data ||
                  activeEvidence.isFetching ||
                  !!activeEvidence.error
                }
                onClick={() => exportEvidenceCSV(rows, studentNames)}
              >
                {view === "evidence" ? "导出 CSV" : "导出当前正式结果"}
              </Button>
            </>
          ) : undefined
        }
      />
      <Tabs
        activeKey={view}
        onChange={setView}
        items={[
          { key: "overview", label: "班级总览" },
          { key: "students", label: "学生与进度" },
          { key: "evidence", label: "评分证据" },
          { key: "gaps", label: "评分缺口" },
        ]}
      />
      {invalidStudentParam && (
        <Alert
          type="warning"
          showIcon
          message="指定的学生不在当前课程名单内，已切换为展示全班数据。"
          action={
            <Button size="small" onClick={() => setStudentFilter("")}>
              清除筛选
            </Button>
          }
        />
      )}
      {validStudentFilter && view !== "gaps" && (
        <div className="context-banner">
          <strong>{matchedStudent?.display_name}的学习详情</strong>
          <Link
            className="primary-link"
            to={`/teacher/intervention?new=1&student=${encodeURIComponent(validStudentFilter)}`}
          >
            安排补学补练
          </Link>
          <Button onClick={() => setStudentFilter("")}>返回全班</Button>
        </div>
      )}
      {validStudentFilter && view === "gaps" && (
        <Alert
          type="info"
          showIcon
          message="评分缺口与共性问题分析基于全班同题同标准的正式评分结果统计，不受单个学生筛选限制。"
          action={
            <Button size="small" onClick={() => setStudentFilter("")}>
              清除学生筛选
            </Button>
          }
        />
      )}

      {view === "overview" && (
        <>
          {renderMetrics()}
          {rows.length > 0 ? (
            <div className="insight-charts-grid">
              <ScoreHistogramCard rows={rows} />
              <MasteryBarsCard items={knowledgeMastery} />
            </div>
          ) : (
            <Card className="card-panel">
              <EmptyState title="暂无已发布的正式评分数据">
                发布作业并确认评分后，此处将自动呈现班级分数分布与知识点掌握度。
              </EmptyState>
            </Card>
          )}
          {renderKnowledgePerformance()}
          {renderShortcuts()}
        </>
      )}

      {view === "students" && (
        <>
          <Suspense fallback={<LoadingState />}>
            <LazyInsightStudents
              overview={overview.data || []}
              evidence={classEvidence.data || []}
              validStudentFilter={validStudentFilter}
              onSelectStudent={setStudentFilter}
            />
          </Suspense>
          <ActivityTimeline
            key={validStudentFilter}
            teacher
            studentID={validStudentFilter}
          />
        </>
      )}

      {view === "evidence" && renderEvidenceCard()}

      {view === "gaps" && (
        <Suspense fallback={<LoadingState />}>
          <LazyDiagnosisPanel
            evidence={classEvidence.data || []}
            members={overview.data || []}
          />
          <LazyLearningGaps
            evidence={classEvidence.data || []}
            members={overview.data || []}
          />
        </Suspense>
      )}
    </div>
  );
}

export { InterventionPage } from "./interventions";
