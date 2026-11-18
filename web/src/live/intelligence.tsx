import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Flex,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
  Drawer,
} from "antd";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import { ModelSelect } from "./knowledge";
import { EmptyState } from "../shared/ui";
import { ContextAgent } from "./context-agent";
import { TaskCreator, TaskWorkspace } from "./interventions";
import { useSearchParams } from "react-router-dom";

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
  job_state: string;
  job_error: string;
  state: string;
  edit_version: number;
  created_at: string;
  input: {
    eligible: number;
    candidates?: Candidate[];
    answers?: { submission_id: string; answer: string; revision_id: string }[];
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
type ReportRow = Pick<Report, "id" | "created_at" | "job_state" | "state">;
const pending = (s: string) => s === "queued" || s === "running";
const states: Record<string, string> = {
  queued: "排队中",
  running: "分析中",
  succeeded: "分析完成",
  failed: "分析失败",
  canceled: "已取消",
};

function useReports(kind: string) {
  const list = useLiveQuery<ReportRow[]>(`/intelligence?kind=${kind}`);
  const [params,setParams] = useSearchParams();
  const selected = params.get(`${kind}_report`) || "";
  const setSelected = (id:string) => setParams(p=>{ const next = new URLSearchParams(p); id ? next.set(`${kind}_report`,id) : next.delete(`${kind}_report`); return next; }, {replace:true});
  const detail = useLiveQuery<Detail>(`/intelligence/${selected}`, !!selected);
  useEffect(() => {
    if (!selected && list.data?.length) setSelected(list.data[0].id);
  }, [list.data, selected]);
  const running =
    pending(detail.data?.report.job_state || "") ||
    list.data?.some((r) => pending(r.job_state));
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      void list.refetch();
      if (selected) void detail.refetch();
    }, 1500);
    return () => window.clearInterval(id);
  }, [running, selected, list.refetch, detail.refetch]);
  return { list, detail, selected, setSelected };
}
function ReportHistory({
  reports,
}: {
  reports: ReturnType<typeof useReports>;
}) {
  return (
    <Select
      aria-label="分析历史"
      value={reports.selected || undefined}
      placeholder="分析历史"
      style={{ minWidth: 240, maxWidth: "100%" }}
      onChange={reports.setSelected}
      options={(reports.list.data || []).map((r) => ({
        value: r.id,
        label: `${when(r.created_at)} · ${r.state === "confirmed" ? "教师已确认" : states[r.job_state] || "草稿"}`,
      }))}
    />
  );
}
function ReportStatus({ report }: { report: Report }) {
  const action = useAction();
  return (
    <>
      <Space wrap>
        <Tag
          color={
            report.job_state === "succeeded"
              ? "success"
              : report.job_state === "failed"
                ? "error"
                : "processing"
          }
        >
          {states[report.job_state]}
        </Tag>
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
            onClick={() => action.run(`/intelligence/${report.id}/cancel`)}
          >
            取消分析
          </Button>
        )}
      </Space>
      {report.job_error && (
        <Alert showIcon type="error" message={report.job_error} />
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
  return (
    <Card
      className="card-panel"
      title="学习推荐"
      extra={
        <Button
          type="primary"
          disabled={!pathReady || action.busy || (!!r && pending(r.job_state))}
          loading={action.busy}
          onClick={async () => {
            const created = await action.run<{ id: string }>("/intelligence", {
              kind: "recommendation",
              request_id: crypto.randomUUID(),
            });
            if (created) reports.setSelected(created.id);
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
        {r && (
          <>
            <ReportStatus report={r} />
            {r.job_state === "succeeded" && (
              <List
                dataSource={r.output.ranking || []}
                locale={{ emptyText: "本次没有推荐内容" }}
                renderItem={(rank) => {
                  const candidate = r.input.candidates?.find(
                    (c) => c.id === rank.id,
                  );
                  if (!candidate) return null;
                  const unavailable = data.unavailable?.includes(rank.id);
                  const choice = data.choices?.find(
                    (c) => c.candidate_id === rank.id,
                  )?.choice;
                  return (
                    <List.Item
                      actions={
                        unavailable
                          ? []
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
                                      action.run(
                                        `/intelligence/${r.id}/choice`,
                                        { candidate_id: rank.id, choice: v },
                                        "PUT",
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
                              <Typography.Text type="secondary">
                                {candidate.title}
                              </Typography.Text>
                            ) : (
                              <Link
                                to={
                                  candidate.kind === "knowledge"
                                    ? `/student/knowledge?knowledge=${candidate.object_id}`
                                    : `/student/course-content?node=${candidate.point_id}&resource=${candidate.object_id}`
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

type Evidence = {
  assignment_title: string;
  question_id: string;
  rubric_id: string | null;
  rubric_version: number | null;
  prompt: string;
};
export function DiagnosisPanel({ evidence }: { evidence: Evidence[] }) {
  const reports = useReports("diagnosis");
  const action = useAction();
  const [scope, setScope] = useState("");
  const [model, setModel] = useState("");
  const { course } = useLearning();
  useEffect(() => {
    setScope("");
  }, [course?.id]);
  const options = [
    ...new Map(
      evidence.map((e) => [
        `${e.question_id}:${e.rubric_id || ""}`,
        {
          value: `${e.question_id}:${e.rubric_id || ""}`,
          label: `${e.assignment_title} · ${e.prompt.slice(0, 55)} · ${e.rubric_version ? `标准v${e.rubric_version}` : "整题评分"}`,
        },
      ]),
    ).values(),
  ];
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
            disabled={
              !scope ||
              action.busy ||
              (!!reports.detail.data &&
                pending(reports.detail.data.report.job_state))
            }
            onClick={async () => {
              const [question_id, rubric_id] = scope.split(":");
              const created = await action.run<{ id: string }>(
                "/intelligence",
                {
                  kind: "diagnosis",
                  question_id,
                  rubric_id,
                  profile_id: model,
                  request_id: crypto.randomUUID(),
                },
              );
              if (created) reports.setSelected(created.id);
            }}
          >
            分析正式失分作答
          </Button>
        </Flex>
        <ReportHistory reports={reports} />
        <Feedback
          error={reports.list.error || reports.detail.error}
          message={action.message}
          failed={action.failed}
        />
        <DiagnosisLabels />
        {reports.detail.data && (
          <DiagnosisReview
            key={reports.detail.data.report.id}
            detail={reports.detail.data}
          />
        )}
      </Space>
    </Card>
  );
}
function DiagnosisLabels() {
  const labels = useLiveQuery<{ built_in: Label[]; custom: Label[] }>(
    "/diagnosis-labels",
  );
  const action = useAction();
  const [title, setTitle] = useState("");
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "labels",
          label: "问题标签",
          children: (
            <Space direction="vertical" className="live-full-width">
              <Space wrap>
                {labels.data?.built_in.map((l) => (
                  <Tag key={l.id}>{l.title}</Tag>
                ))}
              </Space>
              <List
                dataSource={labels.data?.custom || []}
                renderItem={(l) => (
                  <List.Item
                    actions={[
                      <Button
                        key="toggle"
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(
                            `/diagnosis-labels/${l.id}`,
                            { active: !l.active, edit_version: l.edit_version },
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
                      <Tag>{l.active ? "启用" : "停用"}</Tag>
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
                  onClick={async () => {
                    if (await action.run("/diagnosis-labels", { title }))
                      setTitle("");
                  }}
                >
                  新增标签
                </Button>
              </Space.Compact>
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
export function DiagnosisReview({ detail }: { detail: Detail }) {
  const r = detail.report;
  const [taskOrigin,setTaskOrigin] = useState<{finding:Finding;submissionID:string}|null>(null);
  const [createdTask,setCreatedTask] = useState("");
  const labels = useLiveQuery<{ built_in: Label[]; custom: Label[] }>(
    "/diagnosis-labels",
  );
  const action = useAction();
  const draft = useEditorDraft(
    `diagnosis:${r.id}`,
    r.output,
    r.job_state === "succeeded",
  );
  const output = draft.value;
  const available = [
    ...(labels.data?.built_in || []),
    ...(labels.data?.custom.filter((l) => l.active) || []),
  ];
  const editable = r.state === "draft" && r.job_state === "succeeded";
  function changeFinding(i: number, patch: Partial<Finding>) {
    draft.change((v) => ({
      ...v,
      findings: v.findings?.map((f, n) => (n === i ? { ...f, ...patch } : f)),
    }));
  }
  return (
    <Space direction="vertical" className="live-full-width" size="middle">
      <ReportStatus report={r} />
      <ContextAgent context={{kind:"diagnosis",id:r.id,title:"当前诊断报告"}} />
      {detail.stale && (
        <Alert
          showIcon
          type="warning"
          message="正式结果已变化。原分析保留，重新分析后才能确认。"
        />
      )}
      {r.job_state === "succeeded" && (
        <>
          <Typography.Text>{r.input.prompt}</Typography.Text>
          <Space wrap>
            <Tag>本标准正式结果 {r.input.eligible} 人</Tag>
            <Tag>失分作答 {r.input.answers?.length || 0} 份</Tag>
            <Tag>未归类 {output.unclassified?.length || 0} 份</Tag>
          </Space>
          <DraftNotice {...draft} />
          {(output.findings || []).map((f, i) => (
            <Card
              key={i}
              size="small"
              title={
                <Space wrap>
                  <Tag color={f.label_id ? "blue" : "warning"}>
                    {f.label_id ? f.title : `新标签建议：${f.title}`}
                  </Tag>
                  <Tag>
                    {new Set(f.evidence.map((e) => e.submission_id)).size} 人
                  </Tag>
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
                      options={available.map((l) => ({
                        value: l.id,
                        label: l.title,
                      }))}
                      onChange={(id) =>
                        changeFinding(i, {
                          label_id: id,
                          title: available.find((l) => l.id === id)!.title,
                        })
                      }
                    />
                    {!f.label_id && (
                      <Button
                        disabled={action.busy}
                        onClick={async () => {
                          const label = await action.run<Label>(
                            "/diagnosis-labels",
                            { title: f.title },
                          );
                          if (label)
                            changeFinding(i, {
                              label_id: label.id,
                              title: label.title,
                            });
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
                {f.evidence.map((e, n) => (
                  <Card key={e.submission_id} size="small">
                    <Space direction="vertical" className="live-full-width">
                      {editable ? (
                        <Input.TextArea
                          aria-label={`作答引用${i + 1}-${n + 1}`}
                          value={e.quote}
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
                      <Link
                        to={`/teacher/homework/submissions/${e.submission_id}/grade`}
                      >
                        查看原作答与正式评分
                      </Link>
                      {r.state === "confirmed" && !detail.stale && <Button onClick={()=>{setCreatedTask("");setTaskOrigin({finding:f,submissionID:e.submission_id});}}>为此学生安排补学补练</Button>}
                    </Space>
                  </Card>
                ))}
              </Space>
            </Card>
          ))}
          {!output.findings?.length && (
            <EmptyState title="没有可确认的问题归类" />
          )}
          {!!output.unclassified?.length && (
            <Collapse
              items={[
                {
                  key: "unclassified",
                  label: "未归类作答",
                  children: (
                    <Space direction="vertical">
                      {output.unclassified.map((id) => (
                        <Link
                          key={id}
                          to={`/teacher/homework/submissions/${id}/grade`}
                        >
                          查看作答 {id.slice(0, 8)}
                        </Link>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          )}
          {editable && (
            <Space wrap>
              <Button
                disabled={action.busy || !draft.dirty}
                onClick={async () => {
                  if (
                    await action.run(
                      `/intelligence/${r.id}`,
                      { output, edit_version: r.edit_version },
                      "PUT",
                    )
                  )
                    draft.saved(output);
                }}
              >
                保存修改
              </Button>
              <Button
                type="primary"
                disabled={
                  action.busy ||
                  detail.stale ||
                  output.findings?.some((f) => !f.label_id)
                }
                onClick={async () => {
                  if (
                    await action.run(`/intelligence/${r.id}/confirm`, {
                      output,
                      edit_version: r.edit_version,
                    })
                  )
                    draft.saved(output);
                }}
              >
                确认本批诊断
              </Button>
            </Space>
          )}
        </>
      )}
      <Feedback message={action.message} failed={action.failed} />
      <Drawer title={createdTask ? "补学补练任务与下发" : "依据当前诊断安排任务"} open={!!taskOrigin} width={720} destroyOnHidden onClose={()=>setTaskOrigin(null)}>
        {createdTask ? <TaskWorkspace id={createdTask}/> : taskOrigin && <TaskCreator key={`${r.id}:${taskOrigin.finding.label_id}:${taskOrigin.submissionID}`} student="" source={taskOrigin.submissionID} point="" diagnosis={{reportID:r.id,labelID:taskOrigin.finding.label_id,title:taskOrigin.finding.title,explanation:taskOrigin.finding.explanation}} onCreated={setCreatedTask}/>}
      </Drawer>
    </Space>
  );
}
