import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Flex,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useSession } from "../shared/session";
import { EmptyState, LoadingState, MetaTag, MetaTags } from "../shared/ui";
import { ModelSelect, useJob } from "./ai-jobs";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  uuid,
  when,
} from "./context";
import { ContextAgent } from "./context-agent";
import { DraftNotice, useEditorDraft } from "./editing";
import { TaskCreator, TaskWorkspace } from "./interventions";
import type { ReleasedEvidence } from "./learning-gaps";
import type { Member, PointFeedback } from "./types";

type Label = {
  id: string;
  title: string;
  active?: boolean;
  edit_version?: number;
};

type Candidate = {
  id: string;
  title: string;
  object_id: string;
  point_id: string;
  kind: string;
  group: number;
  rule_reason: string;
};

type DiagnosisAnswer = {
  submission_id: string;
  revision_id: string;
  answer: string;
  feedback?: string;
  score?: number;
  max_score?: number;
  point_scores?: PointFeedback[];
};

type Quote = { submission_id: string; quote: string };

type Finding = {
  label_id: string;
  title: string;
  explanation: string;
  evidence: Quote[];
};

type Output = {
  findings?: Finding[];
  unclassified?: string[];
  ranking?: { id: string; reason: string }[];
};

type Report = {
  id: string;
  kind: string;
  question_id?: string | null;
  job_id?: string;
  job_state: string;
  job_error: string;
  state: string;
  edit_version: number;
  created_at: string;
  input: {
    eligible: number;
    rubric_id?: string;
    candidates?: Candidate[];
    answers?: DiagnosisAnswer[];
    prompt?: string;
  };
  output: Output;
};

export type IntelligenceDetail = {
  report: Report;
  stale?: boolean;
  choices?: { candidate_id: string; choice: string }[];
  unavailable?: string[];
};

type Detail = IntelligenceDetail;

type ReportRow = Pick<
  Report,
  "id" | "created_at" | "job_state" | "job_error" | "state" | "question_id" | "job_id"
>;

type CreatedReportResponse = {
  id: string;
  job_id?: string;
  job_state?: string;
  job_error?: string;
};

const pending = (s: string) => s === "queued" || s === "running";

const states: Record<string, string> = {
  queued: "排队中",
  running: "分析中",
  succeeded: "分析完成",
  failed: "分析失败",
  canceled: "已取消",
};

const choiceLabels: Record<string, string> = {
  saved: "已收藏",
  later: "已标稍后",
  dismissed: "已标记不感兴趣",
};

function quoteMatchesAnswer(answer: string | undefined, quote: string): boolean {
  if (!answer || !quote.trim()) return false;
  const normalizedAnswer = answer.replace(/\r\n/g, "\n");
  const normalizedQuote = quote.replace(/\r\n/g, "\n");
  return normalizedAnswer.includes(normalizedQuote);
}

function useReports(kind: string) {
  const list = useLiveQuery<ReportRow[]>(`/intelligence?kind=${kind}`);
  const [params, setParams] = useSearchParams();
  const urlSelected = params.get(`${kind}_report`) || "";
  const selected = urlSelected || list.data?.[0]?.id || "";

  const setSelected = (id: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set(`${kind}_report`, id);
        else next.delete(`${kind}_report`);
        return next;
      },
      { replace: true },
    );

  const detail = useLiveQuery<Detail>(`/intelligence/${selected}`, !!selected);

  const selectedRow = list.data?.find((r) => r.id === selected);
  const activeJobID =
    kind === "diagnosis" &&
    pending(detail.data?.report.job_state || selectedRow?.job_state || "")
      ? detail.data?.report.job_id || selectedRow?.job_id || ""
      : "";

  useJob(activeJobID, () => {
    void list.refetch();
    if (selected) void detail.refetch();
  });

  const running =
    pending(detail.data?.report.job_state || "") ||
    (list.data?.some((r) => pending(r.job_state)) ?? false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      void list.refetch();
      if (selected) void detail.refetch();
    }, 2000);
    return () => window.clearInterval(id);
  }, [running, selected, list.refetch, detail.refetch]);

  return { list, detail, selected, setSelected, running };
}

function ReportHistory({
  reports,
  questionLabels,
}: {
  reports: ReturnType<typeof useReports>;
  questionLabels?: Map<string, string>;
}) {
  return (
    <Select
      aria-label="分析历史"
      value={reports.selected || undefined}
      placeholder="分析历史"
      loading={reports.list.isPending}
      style={{ minWidth: 260, maxWidth: "100%" }}
      onChange={reports.setSelected}
      options={(reports.list.data || []).map((r) => {
        const qTitle = r.question_id ? questionLabels?.get(r.question_id) : "";
        const statusText =
          r.state === "confirmed"
            ? "教师已确认"
            : states[r.job_state] || "草稿";
        return {
          value: r.id,
          label: `${when(r.created_at)}${qTitle ? ` · ${qTitle}` : ""} · ${statusText}`,
        };
      })}
    />
  );
}

function ReportStatus({ report }: { report: Report }) {
  const action = useAction();
  const tagColor =
    report.job_state === "succeeded"
      ? "success"
      : report.job_state === "failed"
        ? "error"
        : report.job_state === "canceled"
          ? "default"
          : "processing";
  return (
    <>
      <Space wrap>
        <Tag color={tagColor}>{states[report.job_state] || report.job_state}</Tag>
        <Tag>
          {report.kind === "recommendation"
            ? "学习建议"
            : report.state === "confirmed"
              ? "教师已确认"
              : "分析草稿"}
        </Tag>
        {pending(report.job_state) && (
          <Button
            size="small"
            disabled={action.busy}
            loading={action.busy}
            onClick={() => void action.run(`/intelligence/${report.id}/cancel`)}
          >
            取消分析
          </Button>
        )}
      </Space>
      {report.job_error && (
        <Alert showIcon type="error" role="alert" message={report.job_error} />
      )}
      <Feedback message={action.message} failed={action.failed} />
    </>
  );
}

export function RecommendationPanel({
  pathReady,
  pathExists,
}: {
  pathReady: boolean;
  pathExists: boolean;
}) {
  const reports = useReports("recommendation");
  const action = useAction();
  const data = reports.detail.data;
  const r = data?.report;

  const rankedItems = useMemo(() => {
    if (!r || r.job_state !== "succeeded") return [];
    const byID = new Map(
      (r.input.candidates || []).map((c) => [c.id, c] as const),
    );
    return (r.output.ranking || [])
      .map((rank) => {
        const candidate = byID.get(rank.id);
        return candidate ? { rank, candidate } : null;
      })
      .filter((item): item is { rank: { id: string; reason: string }; candidate: Candidate } => item !== null);
  }, [r]);

  return (
    <Card
      className="card-panel"
      title="学习推荐"
      extra={
        <Button
          type="primary"
          disabled={!pathReady || action.busy || reports.running}
          loading={action.busy}
          onClick={async () => {
            const created = await action.run<CreatedReportResponse>(
              "/intelligence",
              {
                kind: "recommendation",
                request_id: uuid(),
              },
            );
            if (created) {
              reports.setSelected(created.id);
              if (created.job_state === "failed" && created.job_error) {
                action.setMessage(created.job_error);
              }
            }
          }}
        >
          AI排序
        </Button>
      }
    >
      <Space direction="vertical" className="live-full-width" size="middle">
        <ReportHistory reports={reports} />
        <Feedback
          error={reports.list.error || reports.detail.error}
          message={action.message}
          failed={action.failed}
        />
        {!pathReady && (
          <Typography.Text type="secondary">
            {pathExists
              ? "当前规则路径没有待推荐知识点。"
              : "请先生成学习路径。"}
          </Typography.Text>
        )}
        {(reports.list.isPending ||
          (!!reports.selected && reports.detail.isPending)) && (
          <LoadingState label="正在读取推荐记录…" />
        )}
        {r && (
          <>
            <ReportStatus report={r} />
            {r.job_state === "succeeded" && (
              <List
                dataSource={rankedItems}
                locale={{ emptyText: "本次没有推荐内容" }}
                renderItem={({ rank, candidate }) => {
                  const unavailable =
                    data?.unavailable?.includes(rank.id) ?? false;
                  const choice = data?.choices?.find(
                    (c) => c.candidate_id === rank.id,
                  )?.choice;
                  return (
                    <List.Item
                      actions={
                        unavailable
                          ? choice
                            ? [
                                <Tag key="prior-choice">
                                  {choiceLabels[choice] || choice}
                                </Tag>,
                              ]
                            : []
                          : [
                              <Space key="actions" wrap>
                                {(
                                  [
                                    ["saved", "收藏"],
                                    ["later", "稍后"],
                                    ["dismissed", "不感兴趣"],
                                  ] as const
                                ).map(([v, label]) => (
                                  <Button
                                    key={v}
                                    size="small"
                                    type={choice === v ? "primary" : "default"}
                                    disabled={action.busy}
                                    onClick={() =>
                                      void action.run(
                                        `/intelligence/${r.id}/choice`,
                                        { candidate_id: rank.id, choice: v },
                                        "PUT",
                                        "已更新学习偏好",
                                      )
                                    }
                                  >
                                    {label}
                                  </Button>
                                ))}
                              </Space>,
                            ]
                      }
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <Tag>
                              {candidate.kind === "knowledge"
                                ? "精炼知识"
                                : "学习资料"}
                            </Tag>
                            {unavailable ? (
                              <>
                                <Typography.Text type="secondary">
                                  {candidate.title}
                                </Typography.Text>
                                <Tag color="default">已完成或已不可用</Tag>
                              </>
                            ) : (
                              <Link
                                to={
                                  candidate.kind === "knowledge"
                                    ? `/student/knowledge?knowledge=${encodeURIComponent(candidate.object_id)}`
                                    : `/student/course-content?node=${encodeURIComponent(candidate.point_id)}&resource=${encodeURIComponent(candidate.object_id)}`
                                }
                              >
                                {candidate.title}
                              </Link>
                            )}
                          </Space>
                        }
                        description={
                          <>
                            <p>{rank.reason}</p>
                            <Typography.Text type="secondary">
                              {candidate.rule_reason}
                            </Typography.Text>
                          </>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </>
        )}
      </Space>
    </Card>
  );
}

type DiagnosisEvidence = Pick<
  ReleasedEvidence,
  | "assignment_title"
  | "question_id"
  | "rubric_id"
  | "rubric_version"
  | "prompt"
  | "score"
  | "max_score"
  | "submission_id"
  | "student_id"
  | "student_name"
  | "knowledge_point_id"
>;

export function DiagnosisPanel({
  evidence,
  members,
}: {
  evidence: DiagnosisEvidence[];
  members?: Member[];
}) {
  const reports = useReports("diagnosis");
  const action = useAction();
  const [scope, setScope] = useState("");
  const [model, setModel] = useState("");
  const { course } = useLearning();

  useEffect(() => {
    setScope("");
  }, [course?.id]);

  const { options, statsByScope, questionLabels } = useMemo(() => {
    const optMap = new Map<string, { value: string; label: string }>();
    const stats = new Map<string, { total: number; losing: number }>();
    const qLabels = new Map<string, string>();

    for (const e of evidence || []) {
      const key = `${e.question_id}:${e.rubric_id || ""}`;
      if (!optMap.has(key)) {
        optMap.set(key, {
          value: key,
          label: `${e.assignment_title} · ${e.prompt.slice(0, 55)} · ${e.rubric_version ? `标准v${e.rubric_version}` : "整题评分"}`,
        });
      }
      if (!qLabels.has(e.question_id)) {
        qLabels.set(
          e.question_id,
          `${e.assignment_title ? `${e.assignment_title} · ` : ""}${e.prompt.slice(0, 28)}`,
        );
      }
      const cur = stats.get(key) || { total: 0, losing: 0 };
      cur.total += 1;
      if (e.score < e.max_score) cur.losing += 1;
      stats.set(key, cur);
    }
    return {
      options: [...optMap.values()],
      statsByScope: stats,
      questionLabels: qLabels,
    };
  }, [evidence]);

  const selectedStats = scope ? statsByScope.get(scope) : undefined;
  const scopeInvalid =
    !!selectedStats && (selectedStats.losing === 0 || selectedStats.losing > 40);

  return (
    <Card className="card-panel" title="共性问题分析">
      <Space direction="vertical" className="live-full-width" size="middle">
        <Flex gap={8} wrap>
          <Select
            aria-label="分析题目与标准"
            style={{ width: 400, maxWidth: "100%" }}
            value={scope || undefined}
            placeholder="选择题目与正式标准"
            options={options}
            onChange={setScope}
          />
          <ModelSelect kind="chat" value={model} onChange={setModel} />
          <Button
            type="primary"
            loading={action.busy}
            disabled={!scope || scopeInvalid || action.busy || reports.running}
            onClick={async () => {
              const [question_id, rubric_id] = scope.split(":");
              const created = await action.run<CreatedReportResponse>(
                "/intelligence",
                {
                  kind: "diagnosis",
                  question_id,
                  rubric_id,
                  profile_id: model,
                  request_id: uuid(),
                },
              );
              if (created) {
                reports.setSelected(created.id);
                if (created.job_state === "failed" && created.job_error) {
                  action.setMessage(created.job_error);
                }
              }
            }}
          >
            分析正式失分作答
          </Button>
        </Flex>
        {selectedStats && selectedStats.losing === 0 && (
          <Alert
            type="warning"
            showIcon
            message="该题目与标准下当前全部为满分，尚无失分作答可供诊断。"
          />
        )}
        {selectedStats && selectedStats.losing > 40 && (
          <Alert
            type="warning"
            showIcon
            message={`该范围共有 ${selectedStats.losing} 份失分作答，超过单次 40 份诊断上限。`}
          />
        )}
        {selectedStats &&
          selectedStats.losing > 0 &&
          selectedStats.losing <= 40 && (
            <Typography.Text type="secondary">
              当前范围共 {selectedStats.total} 份正式结果，其中{" "}
              {selectedStats.losing} 份失分作答将参与分析。
            </Typography.Text>
          )}
        <ReportHistory reports={reports} questionLabels={questionLabels} />
        <Feedback
          error={reports.list.error || reports.detail.error}
          message={action.message}
          failed={action.failed}
        />
        <DiagnosisLabels />
        {(reports.list.isPending ||
          (!!reports.selected && reports.detail.isPending)) && (
          <LoadingState label="正在读取诊断报告…" />
        )}
        {reports.detail.data && (
          <DiagnosisReview
            key={reports.detail.data.report.id}
            detail={reports.detail.data}
            evidence={evidence}
            members={members}
            model={model}
            onReanalyzed={(id) => reports.setSelected(id)}
          />
        )}
      </Space>
    </Card>
  );
}

function DiagnosisLabels() {
  const { course } = useLearning();
  const labels = useLiveQuery<{ built_in: Label[]; custom: Label[] }>(
    "/diagnosis-labels",
  );
  const action = useAction();
  const clearError = action.clearError;
  const [title, setTitle] = useState("");
  useEffect(() => {
    setTitle("");
    clearError();
  }, [course?.id, clearError]);
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "labels",
          label: "问题标签",
          children: (
            <Space direction="vertical" className="live-full-width">
              {labels.isPending ? (
                <LoadingState label="正在读取问题标签…" />
              ) : (
                <>
                  <Space wrap>
                    {labels.data?.built_in.map((l) => (
                      <Tag key={l.id}>{l.title}</Tag>
                    ))}
                  </Space>
                  <List
                    dataSource={labels.data?.custom || []}
                    locale={{ emptyText: "暂无自定义标签" }}
                    renderItem={(l) => (
                      <List.Item
                        actions={[
                          <Button
                            key="toggle"
                            size="small"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(
                                `/diagnosis-labels/${l.id}`,
                                {
                                  active: !l.active,
                                  edit_version: l.edit_version,
                                },
                                "PUT",
                              )
                            }
                          >
                            {l.active ? "停用" : "启用"}
                          </Button>,
                        ]}
                      >
                        <Space>
                          {l.title}
                          <Tag color={l.active ? "success" : "default"}>
                            {l.active ? "启用" : "停用"}
                          </Tag>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <Space.Compact className="live-full-width">
                    <Input
                      aria-label="新问题标签"
                      value={title}
                      maxLength={50}
                      placeholder="新标签名称"
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <Button
                      disabled={!title.trim() || action.busy}
                      loading={action.busy}
                      onClick={async () => {
                        const clean = title.trim();
                        if (
                          clean &&
                          (await action.run("/diagnosis-labels", {
                            title: clean,
                          }))
                        ) {
                          setTitle("");
                        }
                      }}
                    >
                      新增标签
                    </Button>
                  </Space.Compact>
                </>
              )}
              <Feedback
                error={labels.error}
                message={action.message}
                failed={action.failed}
              />
            </Space>
          ),
        },
      ]}
    />
  );
}

export function DiagnosisReview({
  detail,
  evidence: propEvidence,
  members: propMembers,
  model = "",
  onReanalyzed,
  embedded = false,
}: {
  detail: Detail;
  evidence?: DiagnosisEvidence[];
  members?: Member[];
  model?: string;
  onReanalyzed?: (reportID: string) => void;
  embedded?: boolean;
}) {
  const r = detail.report;
  const { session } = useSession();
  const [taskOrigin, setTaskOrigin] = useState<{
    finding: Finding;
    submissionID: string;
  } | null>(null);
  const [createdTask, setCreatedTask] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [versionChanged, setVersionChanged] = useState(false);

  const labels = useLiveQuery<{ built_in: Label[]; custom: Label[] }>(
    "/diagnosis-labels",
  );
  const fetchedEvidence = useLiveQuery<ReleasedEvidence[]>(
    "/evidence",
    !propEvidence,
  );
  const evidenceList = propEvidence || fetchedEvidence.data || [];

  const action = useAction();
  const editable = r.state === "draft" && r.job_state === "succeeded";

  // Only enable local browser draft persistence for editable draft reports.
  const draft = useEditorDraft(`diagnosis:${r.id}`, r.output, editable);
  const output = editable ? draft.value : r.output;

  // Clear any leftover browser draft when report transitions to confirmed/non-editable.
  useEffect(() => {
    if (!editable && session?.user.id) {
      try {
        sessionStorage.removeItem(`haji-edit:${session.user.id}:diagnosis:${r.id}`);
      } catch {
        // Ignore storage errors.
      }
    }
  }, [editable, r.id, session?.user.id]);

  // Reconcile server edit_version updates while mounted (e.g. edited in AgentEditor).
  const seenVersion = useRef(r.edit_version);
  useEffect(() => {
    if (seenVersion.current !== r.edit_version) {
      seenVersion.current = r.edit_version;
      if (editable) {
        if (!draft.dirty) {
          draft.reset(r.output);
          setVersionChanged(false);
        } else {
          setVersionChanged(true);
        }
      }
    }
  }, [r.edit_version, r.output, editable, draft]);

  const available = useMemo(
    () => [
      ...(labels.data?.built_in || []),
      ...(labels.data?.custom.filter((l) => l.active) || []),
    ],
    [labels.data],
  );
  const availableMap = useMemo(
    () => new Map(available.map((l) => [l.id, l] as const)),
    [available],
  );

  const answerMap = useMemo(
    () =>
      new Map(
        (r.input.answers || []).map((a) => [a.submission_id, a] as const),
      ),
    [r.input.answers],
  );

  const evidenceMap = useMemo(
    () => new Map(evidenceList.map((e) => [e.submission_id, e] as const)),
    [evidenceList],
  );

  const memberNames = useMemo(
    () => new Map((propMembers || []).map((m) => [m.id, m.display_name])),
    [propMembers],
  );

  const reportEvidenceMeta = useMemo(() => {
    const firstSub = r.input.answers?.[0]?.submission_id;
    return firstSub ? evidenceMap.get(firstSub) : undefined;
  }, [r.input.answers, evidenceMap]);

  const studentLabelFor = (submissionID: string) => {
    const ev = evidenceMap.get(submissionID);
    if (ev?.student_name) return ev.student_name;
    if (ev?.student_id && memberNames.has(ev.student_id)) {
      return memberNames.get(ev.student_id) || submissionID.slice(0, 8);
    }
    return `作答 ${submissionID.slice(0, 8)}`;
  };

  const scoreLabelFor = (submissionID: string) => {
    const ans = answerMap.get(submissionID);
    if (
      typeof ans?.score === "number" &&
      typeof ans?.max_score === "number"
    ) {
      return `${ans.score}/${ans.max_score} 分`;
    }
    const ev = evidenceMap.get(submissionID);
    if (ev) return `${ev.score}/${ev.max_score} 分`;
    return "";
  };

  const findings = output.findings || [];

  // Inline validation for labels and verbatim quotes.
  const { duplicateKeys, hasDeactivatedLabel, hasInvalidQuote } = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    let deactivated = false;
    let invalidQuote = false;
    for (const f of findings) {
      const k = f.label_id || `new:${f.title.trim()}`;
      if (seen.has(k)) dups.add(k);
      seen.add(k);
      if (f.label_id && labels.data && !availableMap.has(f.label_id)) {
        deactivated = true;
      }
      for (const q of f.evidence) {
        const ans = answerMap.get(q.submission_id);
        if (!quoteMatchesAnswer(ans?.answer, q.quote)) {
          invalidQuote = true;
        }
      }
    }
    return {
      duplicateKeys: dups,
      hasDeactivatedLabel: deactivated,
      hasInvalidQuote: invalidQuote,
    };
  }, [findings, labels.data, availableMap, answerMap]);

  function changeFinding(i: number, patch: Partial<Finding>) {
    if (!editable) return;
    draft.change((v) => ({
      ...v,
      findings: v.findings?.map((f, n) => (n === i ? { ...f, ...patch } : f)),
    }));
  }

  async function reanalyze() {
    if (!r.question_id || reanalyzing) return;
    setReanalyzing(true);
    try {
      const created = await action.run<CreatedReportResponse>("/intelligence", {
        kind: "diagnosis",
        question_id: r.question_id,
        rubric_id: r.input.rubric_id || "",
        profile_id: model,
        request_id: uuid(),
      });
      if (created) {
        onReanalyzed?.(created.id);
      }
    } finally {
      setReanalyzing(false);
    }
  }

  return (
    <Space direction="vertical" className="live-full-width" size="middle">
      <ReportStatus report={r} />
      {!embedded && (
        <ContextAgent
          context={{ kind: "diagnosis", id: r.id, title: "当前诊断报告" }}
        />
      )}
      {detail.stale && (
        <Alert
          showIcon
          type="warning"
          message={
            r.state === "confirmed"
              ? "正式结果已变化。原已确认诊断保留查阅，但不能继续安排补学补练任务，请按最新成绩重新分析。"
              : "正式结果已变化。原分析保留，重新分析后才能确认。"
          }
          action={
            r.question_id ? (
              <Button
                size="small"
                type="primary"
                loading={reanalyzing}
                disabled={action.busy || reanalyzing}
                onClick={() => void reanalyze()}
              >
                按最新成绩重新分析
              </Button>
            ) : undefined
          }
        />
      )}
      {editable && versionChanged && (
        <Alert
          showIcon
          type="warning"
          message="服务端诊断内容已更新，当前编辑区保留的是你的本地修改。"
          action={
            <Button
              size="small"
              onClick={() => {
                draft.reset(r.output);
                setVersionChanged(false);
              }}
            >
              加载服务端最新版本
            </Button>
          }
        />
      )}
      {r.job_state === "succeeded" && (
        <>
          <Space direction="vertical" size={4} className="live-full-width">
            {(reportEvidenceMeta?.assignment_title ||
              reportEvidenceMeta?.rubric_version) && (
              <MetaTags>
                {reportEvidenceMeta.assignment_title && (
                  <MetaTag>{reportEvidenceMeta.assignment_title}</MetaTag>
                )}
                <MetaTag>
                  {reportEvidenceMeta.rubric_version
                    ? `标准 v${reportEvidenceMeta.rubric_version}`
                    : r.input.rubric_id
                      ? "逐点标准"
                      : "整题评分"}
                </MetaTag>
              </MetaTags>
            )}
            <Typography.Text>{r.input.prompt}</Typography.Text>
          </Space>
          <Space wrap>
            <Tag>本标准正式结果 {r.input.eligible} 人</Tag>
            <Tag>失分作答 {r.input.answers?.length || 0} 份</Tag>
            <Tag>未归类 {output.unclassified?.length || 0} 份</Tag>
          </Space>
          {editable && (
            <DraftNotice {...draft} onDiscard={() => draft.reset(r.output)} />
          )}
          {editable && duplicateKeys.size > 0 && (
            <Alert
              type="warning"
              showIcon
              message="存在重复的问题标签，请调整或合并后再保存与确认。"
            />
          )}
          {findings.map((f, i) => {
            const labelKey = f.label_id || `new:${f.title.trim()}`;
            const isDeactivated =
              Boolean(f.label_id) &&
              Boolean(labels.data) &&
              !availableMap.has(f.label_id);
            const isDuplicate = duplicateKeys.has(labelKey);
            const selectOptions = [
              ...available.map((l) => ({ value: l.id, label: l.title })),
              ...(isDeactivated
                ? [
                    {
                      value: f.label_id,
                      label: `${f.title}（已停用，请更换）`,
                      disabled: true,
                    },
                  ]
                : []),
            ];
            return (
              <Card
                key={`${f.label_id || f.title}:${i}`}
                size="small"
                title={
                  <Space wrap>
                    <Tag
                      color={
                        isDeactivated
                          ? "error"
                          : f.label_id
                            ? "blue"
                            : "warning"
                      }
                    >
                      {f.label_id ? f.title : `新标签建议：${f.title}`}
                    </Tag>
                    <Tag>
                      {new Set(f.evidence.map((e) => e.submission_id)).size} 人
                    </Tag>
                    {isDeactivated && (
                      <Tag color="error">已停用标签，请更换</Tag>
                    )}
                    {isDuplicate && <Tag color="warning">标签重复</Tag>}
                  </Space>
                }
                extra={
                  editable && (
                    <Button
                      size="small"
                      onClick={() =>
                        draft.change((v) => ({
                          ...v,
                          findings: v.findings?.filter((_, n) => n !== i),
                          unclassified: [
                            ...new Set([
                              ...(v.unclassified || []),
                              ...f.evidence.map((e) => e.submission_id),
                            ]),
                          ].filter(
                            (id) =>
                              !v.findings?.some(
                                (g, n) =>
                                  n !== i &&
                                  g.evidence.some((e) => e.submission_id === id),
                              ),
                          ),
                        }))
                      }
                    >
                      移除此项
                    </Button>
                  )
                }
              >
                <Space direction="vertical" className="live-full-width">
                  {editable && (
                    <Space wrap>
                      <Select
                        aria-label={`问题标签${i + 1}`}
                        style={{ minWidth: 220 }}
                        value={f.label_id || undefined}
                        placeholder="选择已维护标签"
                        options={selectOptions}
                        onChange={(id) => {
                          const found = availableMap.get(id);
                          if (found) {
                            changeFinding(i, {
                              label_id: found.id,
                              title: found.title,
                            });
                          }
                        }}
                      />
                      {!f.label_id && (
                        <Button
                          disabled={action.busy}
                          onClick={async () => {
                            const label = await action.run<Label>(
                              "/diagnosis-labels",
                              { title: f.title },
                            );
                            if (label) {
                              changeFinding(i, {
                                label_id: label.id,
                                title: label.title,
                              });
                            }
                          }}
                        >
                          建立此标签
                        </Button>
                      )}
                    </Space>
                  )}
                  {editable ? (
                    <Input.TextArea
                      aria-label={`分析说明${i + 1}`}
                      value={f.explanation}
                      autoSize={{ minRows: 2 }}
                      onChange={(e) =>
                        changeFinding(i, { explanation: e.target.value })
                      }
                    />
                  ) : (
                    <Typography.Paragraph>{f.explanation}</Typography.Paragraph>
                  )}
                  {f.evidence.map((e, n) => {
                    const ans = answerMap.get(e.submission_id);
                    const verified = quoteMatchesAnswer(ans?.answer, e.quote);
                    const scoreText = scoreLabelFor(e.submission_id);
                    return (
                      <Card key={e.submission_id} size="small">
                        <Space direction="vertical" className="live-full-width">
                          <Space wrap>
                            <Typography.Text strong>
                              {studentLabelFor(e.submission_id)}
                            </Typography.Text>
                            {scoreText && <Tag>{scoreText}</Tag>}
                            <Tag color={verified ? "success" : "warning"}>
                              {verified ? "原文已核验" : "引文与原答存在差异"}
                            </Tag>
                          </Space>
                          {editable ? (
                            <Input.TextArea
                              aria-label={`作答引用${i + 1}-${n + 1}`}
                              value={e.quote}
                              status={verified ? undefined : "warning"}
                              autoSize={{ minRows: 1 }}
                              onChange={(event) =>
                                changeFinding(i, {
                                  evidence: f.evidence.map((q, m) =>
                                    m === n
                                      ? { ...q, quote: event.target.value }
                                      : q,
                                  ),
                                })
                              }
                            />
                          ) : (
                            <blockquote>{e.quote}</blockquote>
                          )}
                          {ans?.answer && (
                            <Collapse
                              size="small"
                              ghost
                              items={[
                                {
                                  key: "answer",
                                  label: "展开完整作答原文",
                                  children: (
                                    <Typography.Paragraph className="live-prose">
                                      {ans.answer}
                                    </Typography.Paragraph>
                                  ),
                                },
                              ]}
                            />
                          )}
                          <Space wrap>
                            <Link
                              to={`/teacher/homework/submissions/${e.submission_id}/grade`}
                            >
                              查看原作答与正式评分
                            </Link>
                            {r.state === "confirmed" && !detail.stale && (
                              <Button
                                onClick={() => {
                                  setCreatedTask("");
                                  setTaskOrigin({
                                    finding: f,
                                    submissionID: e.submission_id,
                                  });
                                }}
                              >
                                为此学生安排补学补练
                              </Button>
                            )}
                          </Space>
                        </Space>
                      </Card>
                    );
                  })}
                </Space>
              </Card>
            );
          })}
          {!findings.length && <EmptyState title="没有可确认的问题归类" />}
          {!!output.unclassified?.length && (
            <Collapse
              items={[
                {
                  key: "unclassified",
                  label: `未归类作答（${output.unclassified.length}）`,
                  children: (
                    <Space direction="vertical" className="live-full-width">
                      {output.unclassified.map((id) => {
                        const scoreText = scoreLabelFor(id);
                        return (
                          <Space key={id} wrap>
                            <Typography.Text>
                              {studentLabelFor(id)}
                            </Typography.Text>
                            {scoreText && <Tag>{scoreText}</Tag>}
                            <Link
                              to={`/teacher/homework/submissions/${id}/grade`}
                            >
                              查看原作答与正式评分
                            </Link>
                          </Space>
                        );
                      })}
                    </Space>
                  ),
                },
              ]}
            />
          )}
          {editable && (
            <Space wrap>
              <Button
                disabled={
                  action.busy ||
                  !draft.dirty ||
                  hasDeactivatedLabel ||
                  duplicateKeys.size > 0 ||
                  hasInvalidQuote
                }
                loading={action.busy}
                onClick={async () => {
                  if (
                    await action.run(
                      `/intelligence/${r.id}`,
                      { output, edit_version: r.edit_version },
                      "PUT",
                    )
                  ) {
                    draft.saved(output);
                    setVersionChanged(false);
                  }
                }}
              >
                保存修改
              </Button>
              <Button
                type="primary"
                disabled={
                  action.busy ||
                  detail.stale ||
                  !findings.length ||
                  findings.some((f) => !f.label_id) ||
                  hasDeactivatedLabel ||
                  duplicateKeys.size > 0 ||
                  hasInvalidQuote
                }
                loading={action.busy}
                onClick={async () => {
                  if (
                    await action.run(`/intelligence/${r.id}/confirm`, {
                      output,
                      edit_version: r.edit_version,
                    })
                  ) {
                    draft.saved(output);
                    setVersionChanged(false);
                  }
                }}
              >
                确认本批诊断
              </Button>
            </Space>
          )}
        </>
      )}
      <Feedback message={action.message} failed={action.failed} />
      <Drawer
        title={createdTask ? "补学补练任务与下发" : "依据当前诊断安排任务"}
        open={!!taskOrigin}
        width="min(100vw, 720px)"
        destroyOnHidden
        onClose={() => setTaskOrigin(null)}
      >
        {createdTask ? (
          <TaskWorkspace id={createdTask} />
        ) : (
          taskOrigin && (
            <TaskCreator
              key={`${r.id}:${taskOrigin.finding.label_id}:${taskOrigin.submissionID}`}
              student=""
              source={taskOrigin.submissionID}
              point={
                evidenceMap.get(taskOrigin.submissionID)?.knowledge_point_id ||
                ""
              }
              diagnosis={{
                reportID: r.id,
                labelID: taskOrigin.finding.label_id,
                title: taskOrigin.finding.title,
                explanation: taskOrigin.finding.explanation,
              }}
              onCreated={setCreatedTask}
            />
          )
        )}
      </Drawer>
    </Space>
  );
}
