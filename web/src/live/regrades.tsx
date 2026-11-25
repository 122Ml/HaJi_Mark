import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { Field } from "../shared/Field";
import { PageHeader } from "../shared/PageHeader";
import { useConfirm } from "../shared/confirm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { ModelSelect, useJob } from "./ai-jobs";
import { FrozenEvidence } from "./citations";
import { RichContent } from "./content-render";
import { Feedback, Link, useAction, useLearning, useLiveQuery, when } from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import type { BankVersion } from "./question-bank";
import {
  normalizePointScores,
  type LiveRevision,
  type PointEntry,
} from "./rubrics";
import { IntegerInput } from "./shared-editors";
import type { Job, RubricVersion } from "./types";
import { hasControlNull } from "./validation";

type RegradeQuestion = {
  id: string;
  prompt: string;
  type: string;
  max_score: number;
  options: string[];
  bank_question_version_id: string | null;
};

type Batch = {
  id: string;
  question_id: string;
  state: string;
  reason: string;
  rubric_id: string | null;
  correct_answer: string;
  question_snapshot: RegradeQuestion;
  created_at?: string;
  released_at?: string | null;
};

type Item = {
  submission_id: string;
  answer_text: string;
  answer_sha256: string;
  display_name: string;
  attempt: number;
  baseline_revision: number;
  score: number | null;
  feedback: string;
  point_scores: PointEntry[];
  confirmed: boolean;
  edit_version: number;
  ai_job_id: string | null;
};

type Detail = { batch: Batch; items: Item[]; rubric: RubricVersion | null };

type PreviewSubmission = {
  id: string;
  student_id: string;
  attempt: number;
  submitted_at?: string;
};

const stateNames: Record<string, string> = {
  active: "待复核",
  released: "已统一发布",
  canceled: "已取消",
};

function formatScoreDelta(baseline: number | null, next: number): {
  text: string;
  color: string;
} {
  if (baseline === null) {
    return { text: `原未评分 → 新分 ${next}`, color: "processing" };
  }
  const diff = next - baseline;
  if (diff > 0) {
    return { text: `原分 ${baseline} → 新分 ${next}（+${diff}）`, color: "success" };
  }
  if (diff < 0) {
    return { text: `原分 ${baseline} → 新分 ${next}（${diff}）`, color: "error" };
  }
  return { text: `原分 ${baseline} → 新分 ${next}（无变化）`, color: "default" };
}

export function RegradesPage() {
  const { course } = useLearning();
  const q = useLiveQuery<Batch[]>("/regrades");
  const [params, setParams] = useSearchParams();
  const creating = params.get("new") === "1";
  const id = params.get("batch") || "";

  function setCreating(v: boolean) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v) next.set("new", "1");
      else next.delete("new");
      return next;
    });
  }

  return (
    <div className="live-page">
      <PageHeader
        title="整组重评"
        subtitle={course?.title}
        extra={
          <Button
            htmlType="button"
            onClick={() => setCreating(!creating)}
            type="primary"
          >
            {creating ? "收起" : "建立重评批次"}
          </Button>
        }
      />
      <Feedback error={q.error} />
      {creating && (
        <CreateRegrade
          onCreated={(batchID) => {
            const p = new URLSearchParams(params);
            p.set("batch", batchID);
            p.delete("new");
            setParams(p);
          }}
        />
      )}
      <Card className="card-panel">
        {q.isPending ? (
          <LoadingState />
        ) : q.data?.length ? (
          q.data.map((b) => (
            <div className="live-row" key={b.id}>
              <div>
                <Typography.Text strong className="item-title">
                  {b.question_snapshot.prompt.slice(0, 100)}
                </Typography.Text>
                <p>{b.reason}</p>
                <MetaTags>
                  <StatusTag
                    status={b.state}
                    label={stateNames[b.state] || b.state}
                  />
                  <MetaTag>满分 {b.question_snapshot.max_score}</MetaTag>
                  {b.created_at && (
                    <span className="live-meta">{when(b.created_at)}</span>
                  )}
                </MetaTags>
              </div>
              <Button
                htmlType="button"
                onClick={() => {
                  const p = new URLSearchParams(params);
                  p.set("batch", b.id);
                  p.delete("new");
                  setParams(p);
                }}
              >
                查看批次
              </Button>
            </div>
          ))
        ) : (
          <EmptyState title="暂无重评批次" />
        )}
      </Card>
      {id && <RegradeDetail key={id} id={id} />}
    </div>
  );
}

export function CreateRegrade({
  onCreated,
  initial,
}: {
  onCreated: (id: string) => void;
  initial?: { assignmentID: string; questionID: string; reason: string };
}) {
  const [params] = useSearchParams();
  const assignments = useLiveQuery<
    { id: string; title: string; status: string }[]
  >("/assignments");
  const [assignment, setAssignment] = useState(
    initial?.assignmentID || params.get("assignment") || "",
  );
  const [question, setQuestion] = useState(
    initial?.questionID || params.get("question") || "",
  );
  const [version, setVersion] = useState("");
  const [rubric, setRubric] = useState("");
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState(
    initial?.reason || params.get("reason") || "",
  );
  const [preview, setPreview] = useState<{
    count: number;
    submissions?: PreviewSubmission[];
  } | null>(null);
  const action = useAction();

  const closedAssignments = useMemo(
    () => (assignments.data || []).filter((a) => a.status === "closed"),
    [assignments.data],
  );
  const validAssignment = closedAssignments.some((a) => a.id === assignment)
    ? assignment
    : "";

  const detail = useLiveQuery<{ questions: RegradeQuestion[] }>(
    `/assignments/${validAssignment}`,
    !!validAssignment,
  );
  const current = detail.data?.questions.find((q) => q.id === question);

  const original = useLiveQuery<BankVersion>(
    `/question-bank/versions/${current?.bank_question_version_id}`,
    !!current?.bank_question_version_id,
  );
  const bank = useLiveQuery<{ versions: BankVersion[] }>(
    `/question-bank/${original.data?.bank_id}`,
    !!original.data?.bank_id,
  );

  const compatibleBankVersions = useMemo(() => {
    if (!current || !bank.data) return [];
    const currentOpts = JSON.stringify(current.options || []);
    return bank.data.versions.filter(
      (v) =>
        v.state === "confirmed" &&
        v.prompt === current.prompt &&
        v.type === current.type &&
        v.max_score === current.max_score &&
        JSON.stringify(v.options || []) === currentOpts,
    );
  }, [bank.data, current]);

  const effectiveVersionID = useMemo(() => {
    const candidate = version || current?.bank_question_version_id || "";
    if (!compatibleBankVersions.length) return "";
    return compatibleBankVersions.some((v) => v.id === candidate)
      ? candidate
      : compatibleBankVersions[0]?.id || "";
  }, [version, current?.bank_question_version_id, compatibleBankVersions]);

  const rubrics = useLiveQuery<RubricVersion[]>(
    current?.bank_question_version_id
      ? `/question-bank/versions/${effectiveVersionID || current.bank_question_version_id}/rubrics`
      : `/questions/${question}/rubrics`,
    !!current && current.type !== "quiz",
  );

  const payload = {
    question_id: question,
    rubric_id: current?.type === "quiz" ? "" : rubric,
    correct_answer: answer,
    reason: reason.trim(),
  };
  const previewKey = JSON.stringify(payload);
  useEffect(() => {
    setPreview(null);
  }, [previewKey]);

  const combinedError =
    assignments.error ||
    detail.error ||
    original.error ||
    bank.error ||
    rubrics.error;

  return (
    <Card className="card-panel" title={<>冻结本题有效提交</>}>
      <Form layout="vertical" className="live-form" style={{ maxWidth: "none" }}>
        <Field className="ui-field" label={<>已关闭作业</>}>
        <Select
          aria-label="已关闭作业"
          loading={assignments.isPending}
          value={validAssignment}
          onChange={(e) => {
            setAssignment(e);
            setQuestion("");
            setRubric("");
            setVersion("");
            setAnswer("");
          }}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">请选择</Select.Option>
          {closedAssignments.map((a) => (
            <Select.Option key={a.id} value={a.id}>
              {a.title}
            </Select.Option>
          ))}
        </Select>
      </Field>
      {assignment && !assignments.isPending && !validAssignment && (
        <Alert
          type="warning"
          showIcon
          message="当前链接指向的作业尚未关闭或不存在；请先关闭作业后再发起整组重评。"
        />
      )}
      <Field className="ui-field" label={<>题目</>}>
        <Select
          aria-label="重评题目"
          loading={detail.isPending && !!validAssignment}
          value={current ? question : ""}
          onChange={(e) => {
            setQuestion(e);
            setRubric("");
            setVersion("");
            setAnswer("");
          }}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">请选择</Select.Option>
          {detail.data?.questions.map((q, idx) => (
            <Select.Option key={q.id} value={q.id}>
              第 {idx + 1} 题 · {q.prompt.slice(0, 80)}
            </Select.Option>
          ))}
        </Select>
      </Field>
      {current?.type === "quiz" ? (
        <Field className="ui-field" label={<>更正答案</>}>
          <Select
            aria-label="更正答案"
            value={answer}
            onChange={(e) => setAnswer(e)}
            showSearch
            optionFilterProp="children"
          >
            <Select.Option value="">请选择</Select.Option>
            {current.options.map((o, i) => (
              <Select.Option key={i} value={o}>
                {o}
              </Select.Option>
            ))}
          </Select>
        </Field>
      ) : (
        current && (
          <>
            {current.bank_question_version_id && (
              <Field className="ui-field" label={<>题库确认版本</>}>
                <Select
                  aria-label="题库确认版本"
                  loading={original.isPending || bank.isPending}
                  value={effectiveVersionID}
                  onChange={(e) => {
                    setVersion(e);
                    setRubric("");
                  }}
                  showSearch
                  optionFilterProp="children"
                >
                  {compatibleBankVersions.map((v) => (
                    <Select.Option key={v.id} value={v.id}>
                      v{v.version} · {v.title}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
            )}
            <Field className="ui-field" label={<>统一新标准</>}>
              <Select
                aria-label="统一新标准"
                loading={rubrics.isPending}
                value={rubric}
                onChange={(e) => setRubric(e)}
                showSearch
                optionFilterProp="children"
              >
                <Select.Option value="">请选择已确认标准</Select.Option>
                {rubrics.data
                  ?.filter((r) => r.state === "confirmed")
                  .map((r) => (
                    <Select.Option key={r.id} value={r.id}>
                      标准 v{r.version} ·{" "}
                      {r.criteria.map((c) => c.title).join("、")}
                    </Select.Option>
                  ))}
              </Select>
            </Field>
          </>
        )
      )}
      <Field className="ui-field" label={<>重评原因</>} required>
        <Input.TextArea
          aria-label="重评原因"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Feedback
        error={combinedError}
        message={action.message}
        failed={action.failed}
      />
      <Button
        htmlType="button"
        disabled={
          action.busy ||
          !question ||
          !reason.trim() ||
          hasControlNull(reason) ||
          !(current?.type === "quiz" ? answer : rubric)
        }
        onClick={async () => {
          const p = await action.run<{
            count: number;
            submissions?: PreviewSubmission[];
          }>(
            "/regrades",
            { ...payload, preview: true },
            "POST",
            "已生成重评范围预览",
            { invalidate: false },
          );
          if (p) setPreview(p);
        }}
      >
        预览范围
      </Button>
      {preview && (
        <Space direction="vertical" size="small" className="live-full-width">
          <Alert
            type="info"
            showIcon
            message={`本题共有 ${preview.count} 份有效提交将进入重评批次；每名学生取最新正式提交，未交不补零。`}
          />
          {preview.submissions && preview.submissions.length > 0 && (
            <Table<PreviewSubmission>
              size="small"
              rowKey="id"
              dataSource={preview.submissions}
              scroll={{ x: 640 }}
              pagination={{ pageSize: 5, showSizeChanger: false }}
              columns={[
                {
                  title: "序号",
                  width: 64,
                  render: (_, __, idx) => idx + 1,
                },
                {
                  title: "提交次数",
                  dataIndex: "attempt",
                  width: 100,
                  render: (v: number) => `第 ${v} 次`,
                },
                {
                  title: "提交时间",
                  dataIndex: "submitted_at",
                  width: 165,
                  onCell: () => ({ style: { whiteSpace: "nowrap" } }),
                  render: (v?: string) => when(v),
                },
              ]}
            />
          )}
          <Button
            htmlType="button"
            disabled={action.busy}
            onClick={async () => {
              const b = await action.run<Batch>(
                "/regrades",
                payload,
                "POST",
                "已建立重评批次",
              );
              if (b) onCreated(b.id);
            }}
            type="primary"
          >
            确认冻结并建立批次
          </Button>
        </Space>
      )}
      </Form>
    </Card>
  );
}

export function RegradeDetail({ id }: { id: string }) {
  const confirm = useConfirm();
  const q = useLiveQuery<Detail>(`/regrades/${id}`);
  const action = useAction();
  const [selected, setSelected] = useState("");
  const [bulkFeedback, setBulkFeedback] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkFailed, setBulkFailed] = useState(false);

  const d = q.data;

  useEffect(() => {
    if (d && !d.rubric && !bulkFeedback) {
      setBulkFeedback(`按更正答案「${d.batch.correct_answer}」统一重评`);
    }
  }, [d, bulkFeedback]);

  if (q.isPending) return <LoadingState />;
  if (q.error || !d) {
    return (
      <ErrorState
        message={q.error?.message || "重评批次不存在"}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const items = d.items;
  const item = items.find((i) => i.submission_id === selected) || items[0];
  const currentIdx = item
    ? items.findIndex((i) => i.submission_id === item.submission_id)
    : -1;
  const done = items.filter((i) => i.confirmed).length;
  const unconfirmedItems = items.filter((i) => !i.confirmed);
  const nextUnconfirmed =
    items.find(
      (i, idx) => !i.confirmed && idx > currentIdx,
    ) || items.find((i) => !i.confirmed && i.submission_id !== item?.submission_id);

  async function applyQuizBulk() {
    if (!d || d.rubric || d.batch.state !== "active") return;
    const text = bulkFeedback.trim();
    if (!text || hasControlNull(text)) {
      setBulkFailed(true);
      setBulkMessage("请先填写统一重评反馈后再批量应用。");
      return;
    }
    const targets = d.items.filter((it) => !it.confirmed);
    if (!targets.length) return;
    const ok = await confirm(
      `将为 ${targets.length} 份待复核提交按更正答案「${d.batch.correct_answer}」重新计分并确认，确认执行？`,
    );
    if (!ok) return;
    setBulkBusy(true);
    setBulkFailed(false);
    setBulkMessage("");
    const max = d.batch.question_snapshot.max_score;
    let succeeded = 0;
    let failed = 0;
    for (const target of targets) {
      const score = target.answer_text === d.batch.correct_answer ? max : 0;
      const res = await action.run(
        `/regrades/${d.batch.id}/items/${target.submission_id}`,
        {
          score,
          feedback: text,
          points: [],
          confirmed: true,
          edit_version: target.edit_version,
          ai_job_id: "",
        },
        "PUT",
        undefined,
        { invalidate: false, silent: true },
      );
      if (res) succeeded += 1;
      else failed += 1;
    }
    setBulkBusy(false);
    await q.refetch();
    if (failed > 0) {
      setBulkFailed(true);
      setBulkMessage(`批量应用完成：成功 ${succeeded} 份，失败 ${failed} 份，请刷新后核对未确认项。`);
    } else {
      setBulkFailed(false);
      setBulkMessage(`已按更正答案批量重新计分并确认 ${succeeded} 份提交。`);
    }
  }

  return (
    <Card className="card-panel">
      <div className="live-stack">
        <div className="workspace-heading">
        <MetaTags>
          <StatusTag
            status={d.batch.state}
            label={stateNames[d.batch.state] || d.batch.state}
          />
          <MetaTag>
            已确认 {done}/{items.length}
          </MetaTag>
        </MetaTags>
        <div className="live-inline">
          <Button
            htmlType="button"
            disabled={
              action.busy ||
              bulkBusy ||
              d.batch.state !== "active" ||
              items.length === 0 ||
              done !== items.length
            }
            onClick={async () => {
              if (
                await confirm(
                  "发布整组重评将正式更新所选提交的成绩与反馈，确认发布？",
                )
              ) {
                void action.run(
                  `/regrades/${id}/state`,
                  { state: "released" },
                  "POST",
                  "整组重评结果已统一发布",
                );
              }
            }}
            type="primary"
          >
            整组发布
          </Button>
          <Button
            htmlType="button"
            disabled={action.busy || bulkBusy || d.batch.state !== "active"}
            onClick={async () => {
              if (await confirm("取消批次并保留原有正式结果？", { danger: true })) {
                void action.run(
                  `/regrades/${id}/state`,
                  { state: "canceled" },
                  "POST",
                  "已取消重评批次，原有正式结果保持不变",
                );
              }
            }}
          >
            取消批次
          </Button>
        </div>
      </div>

      {d.batch.state === "active" && done < items.length && (
        <span className="live-meta">
          还有 {items.length - done} 份提交待复核，全部确认后可整组发布。
        </span>
      )}

      <RichContent text={d.batch.question_snapshot.prompt} />
      <p>{d.batch.reason}</p>
      <FrozenEvidence sources={d.rubric?.evidence_refs} />
      <Feedback message={action.message} failed={action.failed} />

      {!d.rubric && d.batch.state === "active" && unconfirmedItems.length > 0 && (
        <Card size="small" title="客观题批量重评">
          <Form layout="vertical" component={false}>
            <Space direction="vertical" size="small" className="live-full-width">
              <span className="live-meta">
                当前有 {unconfirmedItems.length} 份待复核客观题提交，将按更正答案「{d.batch.correct_answer}」自动重新计分。
              </span>
              <Field className="ui-field" label="统一重评反馈" required>
                <Input
                  aria-label="客观题批量重评反馈"
                  disabled={bulkBusy || action.busy}
                  value={bulkFeedback}
                  onChange={(e) => setBulkFeedback(e.target.value)}
                />
              </Field>
              <Button
                type="primary"
                htmlType="button"
                loading={bulkBusy}
                disabled={action.busy || !bulkFeedback.trim()}
                onClick={() => void applyQuizBulk()}
              >
                一键批量应用并确认待复核项（{unconfirmedItems.length}）
              </Button>
              <Feedback message={bulkMessage} failed={bulkFailed} />
            </Space>
          </Form>
        </Card>
      )}

      <Form layout="vertical" component={false}>
        <Space wrap align="end">
          <Field className="ui-field" label={<>冻结名单</>}>
            <Select
              aria-label="冻结名单"
              value={item?.submission_id || ""}
              onChange={(e) => setSelected(e)}
              showSearch
              optionFilterProp="children"
              style={{ minWidth: 260, maxWidth: "100%" }}
            >
              {items.map((i) => (
                <Select.Option key={i.submission_id} value={i.submission_id}>
                  {i.display_name} · 第{i.attempt}次 ·{" "}
                  {i.confirmed ? "已确认" : "待复核"}
                  {i.score !== null ? ` · ${i.score}分` : ""}
                </Select.Option>
              ))}
            </Select>
          </Field>
          {items.length > 1 && (
            <Space wrap size="small">
              <Button
                htmlType="button"
                disabled={currentIdx <= 0}
                onClick={() => {
                  if (currentIdx > 0) setSelected(items[currentIdx - 1].submission_id);
                }}
              >
                上一份
              </Button>
              <Button
                htmlType="button"
                disabled={currentIdx < 0 || currentIdx >= items.length - 1}
                onClick={() => {
                  if (currentIdx >= 0 && currentIdx < items.length - 1) {
                    setSelected(items[currentIdx + 1].submission_id);
                  }
                }}
              >
                下一份
              </Button>
              {nextUnconfirmed && (
                <Button
                  htmlType="button"
                  onClick={() => setSelected(nextUnconfirmed.submission_id)}
                >
                  下一份待复核
                </Button>
              )}
            </Space>
          )}
        </Space>
      </Form>

      {item && (
        <RegradeEditor
          key={item.submission_id}
          batch={d.batch}
          item={item}
          rubric={d.rubric}
          onRefresh={() => void q.refetch()}
        />
      )}
      </div>
    </Card>
  );
}

interface RegradeDraft {
  score: number;
  feedback: string;
  points: PointEntry[];
  ai_job_id: string;
}

function RegradeEditor({
  batch,
  item,
  rubric,
  onRefresh,
}: {
  batch: Batch;
  item: Item;
  rubric: RubricVersion | null;
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const action = useAction();
  const [model, setModel] = useState("");
  const [selectedJobID, setSelectedJobID] = useState("");
  const [validationError, setValidationError] = useState("");

  // Fetch original submission revisions to display accurate baseline score vs new score diff.
  const baselineQuery = useLiveQuery<{ revisions: LiveRevision[] }>(
    `/submissions/${item.submission_id}`,
  );
  const baselineRevision = useMemo(() => {
    const list = baselineQuery.data?.revisions || [];
    if (!list.length) return null;
    return (
      list.find((r) => (r.revision ?? r.version) === item.baseline_revision) ||
      list[0]
    );
  }, [baselineQuery.data?.revisions, item.baseline_revision]);
  const baselineScore = baselineRevision ? baselineRevision.score : null;

  // Persistent lookup for existing AI grading jobs so switching students or refreshing never loses jobs.
  const jobFilterQuery = useMemo(
    () =>
      new URLSearchParams({
        kind: "grade",
        submission_id: item.submission_id,
        rubric_id: batch.rubric_id || "",
      }).toString(),
    [item.submission_id, batch.rubric_id],
  );
  const existingJobs = useLiveQuery<Job[]>(
    `/jobs?${jobFilterQuery}`,
    batch.state === "active" && !!rubric && !!batch.rubric_id,
  );
  const activeJobID =
    selectedJobID || existingJobs.data?.[0]?.id || item.ai_job_id || "";
  const ai = useJob(activeJobID);

  const initialDraft = useMemo<RegradeDraft>(
    () => ({
      score: item.score || 0,
      feedback: item.feedback || "",
      points: rubric
        ? normalizePointScores(rubric.criteria, item.point_scores)
        : [],
      ai_job_id: item.ai_job_id || "",
    }),
    [item.submission_id, item.score, item.feedback, item.point_scores, item.ai_job_id, rubric],
  );

  const draft = useEditorDraft<RegradeDraft>(
    `regrade:${batch.id}:${item.submission_id}`,
    initialDraft,
  );
  const v = draft.value;
  const max = batch.question_snapshot.max_score;

  const normalizedPoints = useMemo(
    () => (rubric ? normalizePointScores(rubric.criteria, v.points) : []),
    [rubric, v.points],
  );
  const pointByID = useMemo(
    () => new Map(normalizedPoints.map((p) => [p.criterion_id, p])),
    [normalizedPoints],
  );

  function updateCriterion(criterionID: string, patch: Partial<PointEntry>) {
    setValidationError("");
    if (!rubric) return;
    draft.change((prev) => {
      const current = normalizePointScores(rubric.criteria, prev.points);
      return {
        ...prev,
        points: current.map((entry) =>
          entry.criterion_id === criterionID ? { ...entry, ...patch } : entry,
        ),
      };
    });
  }

  const total = rubric
    ? normalizedPoints.reduce((acc, p) => acc + p.score, 0)
    : item.answer_text === batch.correct_answer
      ? max
      : 0;
  const deltaInfo = formatScoreDelta(baselineScore, total);

  function validateItem(): string | null {
    if (!v.feedback.trim() || hasControlNull(v.feedback)) {
      return "请填写总反馈。";
    }
    if (rubric) {
      for (const c of rubric.criteria) {
        const entry = pointByID.get(c.id);
        if (!entry) return `评分点 ${c.id} 缺失。`;
        if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > c.max_score) {
          return `评分点 ${c.id} 得分须在 0 至 ${c.max_score} 之间。`;
        }
        if (!entry.feedback.trim() || hasControlNull(entry.feedback)) {
          return `请填写评分点 ${c.id} 的逐点反馈。`;
        }
        if (hasControlNull(entry.quote)) {
          return `评分点 ${c.id} 的原文引用包含非法字符。`;
        }
      }
    }
    return null;
  }

  const missingPointFeedback =
    !!rubric &&
    rubric.criteria.some((c) => !(pointByID.get(c.id)?.feedback || "").trim());

  const criteriaCount = rubric?.criteria.length || 0;

  return (
    <div className="regrade-editor">
      <article>
        <Typography.Text strong className="item-title">
          {item.display_name} · 作答原文
        </Typography.Text>
        <MetaTags>
          <Tag
            className="ui-meta-tag"
            color={deltaInfo.color}
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              maxWidth: "100%",
            }}
          >
            {deltaInfo.text}
          </Tag>
          <StatusTag
            status={item.confirmed ? "confirmed" : "pending"}
            label={item.confirmed ? "本份已确认" : "待复核"}
          />
        </MetaTags>
        <pre className="live-prose">{item.answer_text || "（空白）"}</pre>
        {baselineRevision && (
          <Collapse
            items={[
              {
                key: "baseline",
                label: (
                  <>
                    原基线评分（修订 {baselineRevision.revision ?? baselineRevision.version} · {baselineRevision.score}/{max} 分）
                  </>
                ),
                children: (
                  <>
                    <p className="live-prose">{baselineRevision.feedback}</p>
                    {(baselineRevision.point_scores ?? baselineRevision.point_results)?.map(
                      (pt) => (
                        <p key={pt.criterion_id} className="live-meta">
                          {pt.criterion_id} · {pt.title}：{pt.score}/{pt.max_score} 分 — {pt.feedback}
                        </p>
                      ),
                    )}
                  </>
                ),
              },
            ]}
          />
        )}
        <Link to={`/teacher/homework/submissions/${item.submission_id}/grade`}>
          查看原有评分历史
        </Link>
      </article>

      <Form layout="vertical" component={false}>
        <div className="live-form">
        <DraftNotice
          restored={draft.restored}
          storageError={draft.storageError}
          onDiscard={() => {
            draft.reset(initialDraft);
            setValidationError("");
          }}
        />
        {batch.state === "active" && rubric && (
          <div className="rag-ai-tool">
            <div className="live-inline">
              <ModelSelect kind="chat" value={model} onChange={setModel} />
              <Button
                htmlType="button"
                disabled={
                  action.busy ||
                  ["queued", "running"].includes(ai.data?.state || "")
                }
                onClick={async () => {
                  const j = await action.run<Job>(
                    `/regrades/${batch.id}/items/${item.submission_id}/ai`,
                    { profile_id: model },
                    "POST",
                    "已排队生成重评草稿",
                  );
                  if (j) setSelectedJobID(j.id);
                }}
              >
                {["queued", "running"].includes(ai.data?.state || "")
                  ? "生成中…"
                  : "生成本份重评草稿"}
              </Button>
            </div>
            {ai.data?.state === "failed" && (
              <Alert
                type="error"
                showIcon
                role="alert"
                message={ai.data.error || "AI 生成失败"}
              />
            )}
            {ai.data?.state === "succeeded" && (
              <Button
                htmlType="button"
                onClick={async () => {
                  if (draft.dirty && !(await confirm("载入 AI 草稿替换当前编辑？"))) {
                    return;
                  }
                  const output = ai.data!.output || {};
                  const rawPoints = Array.isArray(output.points)
                    ? (output.points as Partial<PointEntry>[])
                    : [];
                  const cleanPoints = normalizePointScores(
                    rubric.criteria,
                    rawPoints,
                  );
                  const cleanTotal = cleanPoints.reduce(
                    (sum, p) => sum + p.score,
                    0,
                  );
                  draft.change({
                    score: cleanTotal,
                    feedback:
                      typeof output.feedback === "string" ? output.feedback : "",
                    points: cleanPoints,
                    ai_job_id: activeJobID,
                  });
                  setValidationError("");
                }}
              >
                载入评分草稿
              </Button>
            )}
          </div>
        )}

        {rubric?.criteria.map((c) => {
          const entry = pointByID.get(c.id) ?? {
            criterion_id: c.id,
            score: 0,
            feedback: "",
            quote: "",
          };
          return (
            <Card
              size="small"
              key={c.id}
              title={
                <>
                  {c.id} · {c.title} · {c.max_score}分
                </>
              }
            >
              <div className="live-stack" style={{ gap: 12 }}>
                <p style={{ margin: 0 }}>{c.rule}</p>
                <Field className="ui-field" label={<>得分</>} required>
                  <IntegerInput
                    aria-label={criteriaCount === 1 ? "得分" : `${c.id} 得分`}
                    min={0}
                    max={c.max_score}
                    value={entry.score}
                    onChange={(val) => updateCriterion(c.id, { score: val })}
                    disabled={batch.state !== "active" || action.busy}
                  />
                </Field>
                <Field className="ui-field" label={<>学生原文引用</>}>
                  <Input.TextArea
                    aria-label={
                      criteriaCount === 1 ? "学生原文引用" : `${c.id} 学生原文引用`
                    }
                    value={entry.quote}
                    onChange={(e) =>
                      updateCriterion(c.id, { quote: e.target.value })
                    }
                    disabled={batch.state !== "active" || action.busy}
                  />
                </Field>
                <Field className="ui-field" label={<>逐点反馈</>} required>
                  <Input.TextArea
                    aria-label={
                      criteriaCount === 1 ? "逐点反馈" : `${c.id} 逐点反馈`
                    }
                    value={entry.feedback}
                    onChange={(e) =>
                      updateCriterion(c.id, { feedback: e.target.value })
                    }
                    disabled={batch.state !== "active" || action.busy}
                  />
                </Field>
              </div>
            </Card>
          );
        })}

        <Space wrap align="center">
          <strong>
            总分 {total}/{max}
          </strong>
          <Tag
            className="ui-meta-tag"
            color={deltaInfo.color}
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              maxWidth: "100%",
            }}
          >
            {deltaInfo.text}
          </Tag>
        </Space>
        {!rubric && <p>按本批固定答案「{batch.correct_answer}」判分</p>}

        <Field className="ui-field" label={<>总反馈</>} required>
          <Input.TextArea
            aria-label="总反馈"
            disabled={batch.state !== "active" || action.busy}
            value={v.feedback}
            onChange={(e) => {
              setValidationError("");
              draft.change((prev) => ({ ...prev, feedback: e.target.value }));
            }}
          />
        </Field>

        {validationError && (
          <Alert type="error" showIcon role="alert" message={validationError} />
        )}

        <Feedback
          error={ai.error || existingJobs.error}
          message={action.message}
          failed={action.failed}
        />

        {action.error?.code === "stale_revision" && (
          <Alert
            type="warning"
            showIcon
            message="本份重评记录已被更新，请刷新获取最新版本后再保存。"
            action={
              <Button size="small" htmlType="button" onClick={onRefresh}>
                刷新最新数据
              </Button>
            }
          />
        )}

        <div className="live-inline">
          {[false, true].map((confirmed) => (
            <Button
              key={String(confirmed)}
              htmlType="button"
              disabled={
                action.busy ||
                batch.state !== "active" ||
                !v.feedback.trim() ||
                missingPointFeedback
              }
              onClick={async () => {
                const err = validateItem();
                if (err) {
                  setValidationError(err);
                  return;
                }
                setValidationError("");
                const snapshot = v;
                const r = await action.run(
                  `/regrades/${batch.id}/items/${item.submission_id}`,
                  {
                    score: total,
                    feedback: v.feedback.trim(),
                    points: normalizedPoints,
                    confirmed,
                    edit_version: item.edit_version,
                    ai_job_id: v.ai_job_id || "",
                  },
                  "PUT",
                  confirmed ? "已确认本份重评结果" : "已保存本份重评草稿",
                );
                if (r) draft.saved(snapshot);
              }}
              type={confirmed ? "primary" : "default"}
            >
              {confirmed ? "确认本份" : "保存草稿"}
            </Button>
          ))}
        </div>
        </div>
      </Form>
    </div>
  );
}
