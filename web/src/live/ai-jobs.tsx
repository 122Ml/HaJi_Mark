import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Collapse, Progress, Select, Space, Typography } from "antd";
import { requestJSON } from "../shared/api";
import { FeatureNotice, isFeatureDisabledError, MetaTags, StatusTag } from "../shared/ui";
import { Feedback, Link, useAction, useLearning, useLiveQuery, when } from "./context";
import { RichContent } from "./content-render";
import { FrozenEvidence } from "./citations";
import { jobKindLabels, labelFor, stateLabels } from "./domain-meta";
import type { Hit, Job, ModelInfo } from "./types";

const ACTIVE_STATES = new Set(["queued", "running"]);

export function ModelSelect({
  id,
  kind,
  value,
  onChange,
}: {
  id?: string;
  kind: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const q = useLiveQuery<ModelInfo>("/models");
  const options =
    q.data?.profiles
      .filter((p) => p.kind === kind)
      .map((p) => ({ value: p.id, label: p.label, disabled: !p.available })) || [];
  return (
    <Select
      id={id}
      aria-label={kind === "embedding" ? "向量模型" : "生成模型"}
      value={value || undefined}
      placeholder="默认模型"
      allowClear
      loading={q.isPending}
      onChange={(v) => onChange(v || "")}
      style={{ minWidth: 220, maxWidth: "100%" }}
      options={options}
    />
  );
}

export function useJob(id: string, onComplete?: (job: Job) => void) {
  const { course } = useLearning();
  const queryClient = useQueryClient();
  const prevState = useRef<string>("");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const q = useQuery({
    queryKey: ["live", course?.id, `/jobs/${id}`],
    enabled: !!course && !!id,
    queryFn: async ({ signal }) =>
      (await requestJSON<{ data: Job }>(`/learning/courses/${course!.id}/jobs/${id}`, { signal })).data,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return !state || ACTIVE_STATES.has(state) ? 2000 : false;
    },
  });

  useEffect(() => {
    prevState.current = "";
  }, [id]);

  useEffect(() => {
    const state = q.data?.state || "";
    if (prevState.current && ACTIVE_STATES.has(prevState.current) && state && !ACTIVE_STATES.has(state)) {
      onCompleteRef.current?.(q.data!);
      void queryClient.invalidateQueries({
        predicate: (entry) =>
          entry.queryKey[0] === "live" &&
          entry.queryKey[1] === course?.id &&
          ["jobs", "sources", "knowledge", "question-bank", "regrades", "intelligence"].includes(
            String(entry.queryKey[2] || "").split("/")[1]?.split("?")[0] || "",
          ),
      });
    }
    if (state) prevState.current = state;
  }, [q.data, course?.id, queryClient]);

  return q;
}

export function DraftPreview({ output }: { output: Record<string, unknown> }) {
  const criteria = output.criteria as
    | { id: string; title: string; max_score: number; rule: string }[]
    | undefined;
  const points = output.points as
    | { criterion_id: string; score: number; feedback: string; quote: string }[]
    | undefined;
  return (
    <div className="rag-draft-preview">
      {(
        output.questions as
          | { title: string; prompt: string; reference_answer: string }[]
          | undefined
      )?.map((q, i) => (
        <article key={i}>
          <strong>{q.title}</strong>
          <RichContent text={q.prompt} />
          <Collapse
            items={[
              {
                key: "content",
                label: <>参考解答</>,
                children: <RichContent text={q.reference_answer} />,
              },
            ]}
          />
        </article>
      ))}
      {(output.requirements as string[] | undefined)?.map((r, i) => (
        <p key={`r${i}`}>回答要求：{r}</p>
      ))}
      {(output.issues as string[] | undefined)?.map((r, i) => (
        <p key={`i${i}`}>待澄清：{r}</p>
      ))}
      {(
        output.associations as
          | { evidence_id: string; reason: string }[]
          | undefined
      )?.map((r, i) => (
        <p key={`a${i}`}>关联理由：{r.reason}</p>
      ))}
      {criteria?.map((p) => (
        <article key={p.id}>
          <strong>
            {p.title} · {p.max_score}分
          </strong>
          <p>{p.rule}</p>
        </article>
      ))}
      {points?.map((p) => (
        <article key={p.criterion_id}>
          <strong>
            {p.criterion_id} · {p.score}分
          </strong>
          <p>{p.feedback}</p>
          {p.quote && <blockquote>{p.quote}</blockquote>}
        </article>
      ))}
      {typeof output.feedback === "string" && <p>{output.feedback}</p>}
      <FrozenEvidence sources={output.evidence_refs as Hit[] | undefined} />
      <StatusTag status="pending" label="待教师审核" />
    </div>
  );
}

const ACTION_BUTTON_LABELS: Record<string, string> = {
  rubric: "AI起草标准",
  grade: "AI生成评阅草稿",
  question_generate: "AI出题",
  question_analyze: "题目分析",
  bank_rubric: "题库标准起草",
  vision: "识别所选图像",
  source_suggest: "生成编排建议",
  source_segment: "按知识点切分内容",
  knowledge_compare: "比较相关知识",
  paper_split: "拆分题卷",
};

export type AIJobKind =
  | "rubric"
  | "grade"
  | "question_generate"
  | "question_analyze"
  | "bank_rubric"
  | "vision"
  | "source_suggest"
  | "source_segment"
  | "knowledge_compare"
  | "paper_split";

export function AIJobRunner({
  kind,
  target,
  onAdopt,
  adoptLabel,
  showPreview = true,
  autoAdopt = false,
  disabled = false,
}: {
  kind: AIJobKind;
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
  adoptLabel?: string;
  showPreview?: boolean;
  autoAdopt?: boolean;
  disabled?: boolean;
}) {
  const action = useAction();
  const [model, setModel] = useState("");
  const [selectedJobID, setSelectedJobID] = useState("");
  const isBank = ["question_generate", "question_analyze", "bank_rubric"].includes(kind);
  const isWorkflow = ["vision", "source_suggest", "source_segment", "knowledge_compare", "paper_split"].includes(kind);

  const filterKeys = isWorkflow
    ? ["source_id", "knowledge_id", "asset_id"]
    : ["question_id", "submission_id", "rubric_id"];
  const filters = Object.fromEntries(
    Object.entries(target).filter(
      ([k, v]) => filterKeys.includes(k) && typeof v === "string" && v !== "",
    ),
  ) as Record<string, string>;

  const filterQuery = new URLSearchParams({ kind, ...filters }).toString();
  const jobs = useLiveQuery<Job[]>(`/jobs?${filterQuery}`);

  useEffect(() => {
    setSelectedJobID("");
  }, [kind, filterQuery]);

  const id = selectedJobID || jobs.data?.[0]?.id || "";
  const q = useJob(id);
  const stale =
    isBank &&
    !!q.data &&
    Object.entries(target).some(([key, value]) => {
      if (key === "evidence_ids") {
        const ids =
          (q.data!.input.evidence_refs as Hit[] | undefined)?.map((h) => h.id) || [];
        return (
          JSON.stringify([...ids].sort()) !==
          JSON.stringify([...(value as string[])].sort())
        );
      }
      return JSON.stringify(q.data!.input[key]) !== JSON.stringify(value);
    });
  const active = !!q.data && ACTIVE_STATES.has(q.data.state);
  const busy = action.busy || (!!id && q.isPending) || active;
  const buttonText = busy
    ? isWorkflow
      ? "处理中…"
      : "生成中…"
    : ACTION_BUTTON_LABELS[kind] || labelFor(jobKindLabels, kind);
  const autoAdoptedRef = useRef("");
  const onAdoptRef = useRef(onAdopt);
  onAdoptRef.current = onAdopt;

  useEffect(() => {
    if (
      autoAdopt &&
      q.data?.state === "succeeded" &&
      !stale &&
      q.data.id &&
      autoAdoptedRef.current !== q.data.id
    ) {
      autoAdoptedRef.current = q.data.id;
      void onAdoptRef.current(q.data.output, q.data.id);
    }
  }, [autoAdopt, q.data?.id, q.data?.state, q.data?.output, stale]);

  return (
    <section className="rag-ai-tool">
      <div className="live-inline">
        <ModelSelect
          kind={kind === "vision" ? "vision" : "chat"}
          value={model}
          onChange={setModel}
        />
        <Button
          disabled={disabled || busy || jobs.isPending || !!jobs.error}
          onClick={async () => {
            const j = await action.run<Job>(isBank ? "/question-bank/jobs" : "/jobs", {
              kind,
              profile_id: model,
              ...target,
            });
            if (j) setSelectedJobID(j.id);
          }}
          htmlType="button"
        >
          {buttonText}
        </Button>
        {active && id && (
          <Button
            disabled={action.busy}
            onClick={() => void action.run(`/jobs/${id}/cancel`)}
            htmlType="button"
          >
            取消任务
          </Button>
        )}
      </div>
      <Feedback
        error={jobs.error || q.error}
        message={q.data && !active && !action.failed ? "" : action.message}
        failed={action.failed}
      />
      {q.data && (
        <div
          role="status"
          className="live-stack"
          style={{ marginTop: 12, gap: 10 }}
        >
          <MetaTags>
            <StatusTag status={q.data.state} label={labelFor(stateLabels, q.data.state)} />
            {q.data.created_at && <span className="live-meta">{when(q.data.created_at)}</span>}
          </MetaTags>
          {active && <Progress percent={q.data.progress} size="small" />}
          {q.data.state === "failed" && (
            <>
              {q.data.error && (
                <Alert
                  className="rag-job-error"
                  type="error"
                  showIcon
                  role="alert"
                  message={q.data.error}
                />
              )}
              {typeof q.data.output?.raw_response === "string" && (
                <Collapse
                  items={[
                    {
                      key: "raw",
                      label: <>查看模型原始回复</>,
                      children: <pre className="live-prose">{q.data.output.raw_response}</pre>,
                    },
                  ]}
                />
              )}
              <Space wrap>
                <Button
                  size="small"
                  disabled={action.busy}
                  onClick={() => void action.run(`/jobs/${q.data!.id}/retry`)}
                  htmlType="button"
                >
                  重试
                </Button>
              </Space>
            </>
          )}
          {q.data.state === "canceled" && (
            <Typography.Text type="secondary" className="live-meta">
              任务已取消。
            </Typography.Text>
          )}
          {q.data.state === "succeeded" && (
            <>
              {showPreview && !isWorkflow && (
                <Collapse
                  items={[
                    {
                      key: "preview",
                      label: <>查看AI草稿</>,
                      children: <DraftPreview output={q.data.output} />,
                    },
                  ]}
                />
              )}
              <Space wrap>
                <Button
                  type={isWorkflow ? "primary" : "default"}
                  disabled={busy || stale}
                  onClick={() => onAdopt(q.data!.output, q.data!.id)}
                  htmlType="button"
                >
                  {adoptLabel || (isWorkflow ? "载入候选" : "载入编辑区")}
                </Button>
              </Space>
              {stale && (
                <Typography.Text type="secondary" className="live-meta">
                  当前要求或依据已变化，请按当前条件重新生成。
                </Typography.Text>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function AIDraft({
  kind,
  target,
  onAdopt,
  autoAdopt = false,
  disabled = false,
}: {
  kind: "rubric" | "grade" | "question_generate" | "question_analyze" | "bank_rubric";
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
  autoAdopt?: boolean;
  disabled?: boolean;
}) {
  return (
    <AIJobRunner
      kind={kind}
      target={target}
      onAdopt={onAdopt}
      autoAdopt={autoAdopt}
      disabled={disabled}
    />
  );
}

export function JobsPanel({
  kinds,
  sourceID = "",
  expanded = false,
}: {
  kinds?: string[];
  sourceID?: string;
  expanded?: boolean;
}) {
  const [page, setPage] = useState(1);
  const kindsKey = kinds?.join(",") || "";
  const { course } = useLearning();
  const queryClient = useQueryClient();
  const action = useAction();

  useEffect(() => {
    setPage(1);
  }, [sourceID, kindsKey]);

  const filter = new URLSearchParams({ size: "21", offset: String((page - 1) * 20) });
  if (sourceID) filter.set("source_id", sourceID);
  if (kindsKey) filter.set("kind", kindsKey);
  const path = `/jobs?${filter.toString()}`;

  const query = useQuery({
    queryKey: ["live", course?.id, path],
    enabled: !!course,
    refetchOnMount: "always",
    queryFn: async ({ signal }) =>
      (await requestJSON<{ data: Job[] }>(`/learning/courses/${course!.id}${path}`, { signal })).data,
    refetchInterval: (q) => {
      const list = q.state.data || [];
      const hasActive = list.some(
        (j) => (!kinds || kinds.includes(j.kind)) && ACTIVE_STATES.has(j.state),
      );
      return hasActive ? 2500 : false;
    },
  });

  const rows = query.data?.filter((j) => !kinds || kinds.includes(j.kind)) || [];
  const active = rows.some((j) => ACTIVE_STATES.has(j.state));
  const wasActive = useRef(false);

  useEffect(() => {
    if (wasActive.current && !active && course?.id) {
      void queryClient.invalidateQueries({
        predicate: (entry) =>
          entry.queryKey[0] === "live" &&
          entry.queryKey[1] === course.id &&
          ["sources", "resources", "knowledge", "question-bank", "topics", "regrades", "intelligence"].includes(
            String(entry.queryKey[2] || "").split("/")[1]?.split("?")[0] || "",
          ),
      });
    }
    wasActive.current = active;
  }, [active, course?.id, queryClient]);

  return (
    <Collapse
      className="card-panel rag-jobs"
      defaultActiveKey={expanded ? ["content"] : []}
      items={[
        {
          key: "content",
          label: (
            <MetaTags>
              <span>处理任务</span>
              {active && <StatusTag status="running" label="处理中" />}
            </MetaTags>
          ),
          children: isFeatureDisabledError(query.error) ? (
            <FeatureNotice
              title="后台智能处理任务尚未启用"
              description="当前环境未配置模型或检索处理服务。"
            />
          ) : (
            <>
              <Feedback
                error={query.error}
                message={action.message}
                failed={action.failed}
              />
              {!rows.length && <p>暂无处理任务。</p>}
              {rows.slice(0, 20).map((j) => (
                <article key={j.id} className="rag-job">
                  <div>
                    <strong>{labelFor(jobKindLabels, j.kind)}</strong>
                    <MetaTags>
                      <StatusTag status={j.state} label={labelFor(stateLabels, j.state)} />
                      <span className="live-meta">{when(j.created_at)}</span>
                    </MetaTags>
                    {((typeof j.input?.source_id === "string" && !sourceID) ||
                      (j.state === "succeeded" && j.kind === "extract")) && (
                      <Space wrap size="middle" style={{ marginTop: 6 }}>
                        {typeof j.input?.source_id === "string" && !sourceID && (
                          <Link
                            to={`/teacher/materials?source=${j.input.source_id}&source_view=tasks`}
                          >
                            打开来源与本次处理
                          </Link>
                        )}
                        {j.state === "succeeded" && j.kind === "extract" && (
                          <Link
                            to={`/teacher/materials?source=${String(j.input?.source_id || "")}&source_view=knowledge&job=${j.id}`}
                          >
                            核对本次知识候选
                          </Link>
                        )}
                      </Space>
                    )}
                    {j.state === "succeeded" && j.kind === "parse" && (
                      <Typography.Text
                        type="secondary"
                        className="live-meta"
                        style={{ display: "block", marginTop: 6 }}
                      >
                        原文已落库，尚需核对、发布和确认知识。索引状态独立查看。
                      </Typography.Text>
                    )}
                    {j.error && (
                      <p
                        className="rag-job-error"
                        role="alert"
                        style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}
                      >
                        {j.error}
                      </p>
                    )}
                  </div>
                  {j.state === "running" && (
                    <Progress percent={j.progress} size="small" />
                  )}
                  {ACTIVE_STATES.has(j.state) && (
                    <Button
                      disabled={action.busy}
                      onClick={() => void action.run(`/jobs/${j.id}/cancel`)}
                      htmlType="button"
                    >
                      取消
                    </Button>
                  )}
                  {j.state === "failed" && !!Object.keys(j.output || {}).length && (
                    <Collapse
                      items={[
                        {
                          key: "output",
                          label: "查看失败时保留的输出（未采纳）",
                          children: (
                            <pre className="job-raw-output">
                              {JSON.stringify(j.output, null, 2)}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  )}
                  {j.state === "failed" && !["diagnosis", "recommendation"].includes(j.kind) && (
                    <Button
                      disabled={action.busy}
                      onClick={() => void action.run(`/jobs/${j.id}/retry`)}
                      htmlType="button"
                    >
                      重试
                    </Button>
                  )}
                </article>
              ))}
              {(page > 1 || rows.length > 20) && (
                <div className="live-inline">
                  <Button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    htmlType="button"
                  >
                    上一页任务
                  </Button>
                  <span>第 {page} 页</span>
                  <Button
                    disabled={rows.length <= 20}
                    onClick={() => setPage(page + 1)}
                    htmlType="button"
                  >
                    下一页任务
                  </Button>
                </div>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
