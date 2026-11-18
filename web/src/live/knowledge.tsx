import { Field } from "../shared/Field";
import { ContextAgent } from "./context-agent";
import { useLocationValue } from "./location-state";
import { useConfirm } from "../shared/confirm";
import { FileUpload } from "../shared/FileUpload";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Select, Progress, Tabs, Collapse, Button, Card, Form, Input, Checkbox, Alert, Typography } from "antd";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { LoadingState, ErrorState, EmptyState, MetaTag, MetaTags, StatusTag } from "../shared/ui";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { useEditorDraft, DraftNotice, useUnsavedChanges } from "./editing";
import "./knowledge.css";
import {
  ContentLinks,
  TopicManager,
  DecisionHistory,
  type TopicData,
} from "./content-topics";
import { MaterialAssets } from "./material-assets";
import { URLImport, SourceSuggestions, PaperImport } from "./material-assist";
import { KnowledgeReview } from "./knowledge-review";
import { RichContent } from "./content-render";
import { RetrievalHistory } from "./retrieval-history";
import { CourseWorkspace, type Point, type Resource } from "./course";

type Profile = { id: string; label: string; kind: string; available: boolean };
type ModelInfo = {
  profiles: Profile[];
};
export type Job = {
  id: string;
  kind: string;
  state: string;
  progress: number;
  error: string;
  created_at: string;
  output: Record<string, unknown>;
  input: Record<string, unknown>;
};
type Source = {
  id: string;
  title: string;
  filename: string;
  state: string;
  parse_state: string;
  parse_error: string;
  parse_revision: number;
  allow_derived: boolean;
  fragment_count?: number;
  review_count?: number;
};
type Fragment = {
  id: string;
  heading: string;
  body: string;
  locator: Record<string, unknown>;
  quality: string;
};
type SourceDetail = {
  source: Source;
  fragments: Fragment[];
  display_revision: number;
};
type Evidence = { source_id: string; fragment_id: string; quote: string };
export type Knowledge = {
  origin: "source" | "teacher_example";
  id: string;
  title: string;
  body: string;
  category: string;
  content_kind: string;
  conditions: string;
  state: string;
  version: number;
  edit_version: number;
  evidence: Evidence[];
  student_visible: boolean;
  use_for_learning: boolean;
  use_for_grading: boolean;
  knowledge_point_ids: string[];
  related_ids: string[];
};
export type Hit = {
  id: string;
  title: string;
  heading: string;
  body: string;
  locator: Record<string, unknown>;
  source_id?: string;
  knowledge_id?: string;
  resource_id?: string;
  fragment_ids?: string[];
};
export type AssistAnswer = {
  text: string;
  sources: Hit[];
  mode: string;
  status: string;
  citations?: { id: string; quote: string }[];
};
export function FrozenEvidence({ sources }: { sources?: Hit[] }) {
  const {session} = useSession();
  const teacher = session?.user.role === "teacher";
  if (!sources?.length) return null;
  return (
    <Collapse
      items={[
        {
          key: "content",
          label: <>引用依据（{sources.length}）</>,
          children: (
            <>
              {sources.map((hit) => (
                <article className="rag-hit" key={hit.id}>
                  <strong>{hit.title}</strong>
                  <small>{location(hit.locator)}</small>
                  <p className="live-prose">{hit.body}</p>
                  {teacher && hit.source_id && (
                    <Link
                      to={`/teacher/materials?source=${hit.source_id}&fragment=${hit.fragment_ids?.[0] || ""}`}
                    >
                      查看引用原文
                    </Link>
                  )}
                  {hit.knowledge_id && (
                    <Link to={`/${teacher?"teacher":"student"}/knowledge?knowledge=${hit.knowledge_id}`}>查看知识库</Link>
                  )}
                  {hit.resource_id && <Link to={`/${teacher?"teacher/materials?tab=published":"student/course-content?"}&resource=${hit.resource_id}`}>返回学习资料</Link>}
                </article>
              ))}
            </>
          ),
        },
      ]}
    />
  );
}
export function GroundedAnswer({ answer }: { answer: AssistAnswer }) {
  const { session } = useSession();
  return (
    <>
      <RichContent text={answer.text} />
      {answer.citations?.map((c, i) => {
        const hit = answer.sources.find((h) => h.id === c.id);
        return (
          <blockquote key={`${c.id}:${i}`}>
            {c.quote}
            <small>
              {hit?.title}
              {hit ? ` · ${location(hit.locator)}` : ""}
            </small>
            {session?.user.role === "teacher" && hit?.source_id && (
              <Link
                to={`/teacher/materials?source=${hit.source_id}&fragment=${hit.fragment_ids?.[0] || ""}`}
              >
                查看原文
              </Link>
            )}
            {hit?.resource_id && <Link to={`/${session?.user.role === "teacher"?"teacher/materials?tab=published":"student/course-content?"}&resource=${hit.resource_id}`}>查看引用学习资料</Link>}
          </blockquote>
        );
      })}
    </>
  );
}
const labels: Record<string, string> = {
  queued: "等待处理",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  ready: "已解析",
  draft: "待审核",
  confirmed: "已确认",
  archived: "已归档",
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
  knowledge_compare: "知识比较",
  paper_split: "整卷拆题",
};
const kinds = [
  { value: "concept", label: "概念" },
  { value: "method", label: "方法" },
  { value: "rule", label: "规则" },
  { value: "example", label: "示例" },
  { value: "misconception", label: "常见误区" },
];
function location(locator: Record<string, unknown>) {
  return Object.entries(locator)
    .filter(([k]) =>
      [
        "page",
        "slide",
        "paragraph",
        "block",
        "table",
        "shape",
        "method",
      ].includes(k),
    )
    .map(
      ([k, v]) =>
        `${({ page: "页", slide: "幻灯片", paragraph: "段落", block: "内容块", table: "表格", shape: "对象", method: "解析方式" } as Record<string, string>)[k] || k} ${String(v)}`,
    )
    .join(" · ");
}
export function ModelSelect({
  kind,
  value,
  onChange,
}: {
  kind: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const q = useLiveQuery<ModelInfo>("/models");
  return (
    <Select
      aria-label={kind === "embedding" ? "向量模型" : "生成模型"}
      value={value || undefined}
      placeholder="默认模型"
      allowClear
      onChange={(v) => onChange(v || "")}
      style={{ minWidth: 220, maxWidth: "100%" }}
      options={q.data?.profiles
        .filter((p) => p.kind === kind)
        .map((p) => ({ value: p.id, label: p.label, disabled: !p.available }))}
    />
  );
}
export function useJob(id: string) {
  const q = useLiveQuery<Job>(`/jobs/${id}`, !!id);
  useEffect(() => {
    if (!id || (q.data && !["queued", "running"].includes(q.data.state)))
      return;
    const t = setInterval(() => void q.refetch(), 2000);
    return () => clearInterval(t);
  }, [id, q.data?.state]);
  return q;
}
export function AIDraft({
  kind,
  target,
  onAdopt,
}: {
  kind:
    | "rubric"
    | "grade"
    | "question_generate"
    | "question_analyze"
    | "bank_rubric";
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
}) {
  const action = useAction();
  const [model, setModel] = useState("");
  const bank = [
    "question_generate",
    "question_analyze",
    "bank_rubric",
  ].includes(kind);
  const filters = Object.fromEntries(
    Object.entries(target).filter(
      ([k, v]) =>
        ["question_id", "submission_id", "rubric_id"].includes(k) &&
        typeof v === "string",
    ),
  ) as Record<string, string>;
  const jobs = useLiveQuery<Job[]>(
    `/jobs?${new URLSearchParams({ kind, ...filters })}`,
  );
  const id = jobs.data?.[0]?.id || "";
  const q = useJob(id);
  const stale =
    bank &&
    !!q.data &&
    Object.entries(target).some(([key, value]) => {
      if (key === "evidence_ids") {
        const ids =
          (q.data!.input.evidence_refs as Hit[] | undefined)?.map(
            (h) => h.id,
          ) || [];
        return (
          JSON.stringify([...ids].sort()) !==
          JSON.stringify([...(value as string[])].sort())
        );
      }
      return JSON.stringify(q.data!.input[key]) !== JSON.stringify(value);
    });
  const busy =
    action.busy ||
    (!!id && q.isPending) ||
    ["queued", "running"].includes(q.data?.state || "");
  return (
    <section className="rag-ai-tool">
      <div className="live-inline">
        <ModelSelect kind="chat" value={model} onChange={setModel} />
        <Button
          disabled={busy || jobs.isPending || !!jobs.error || !!q.error}
          onClick={async () => {
            await action.run<Job>(bank ? "/question-bank/jobs" : "/jobs", {
              kind,
              profile_id: model,
              ...target,
            });
          }}
          htmlType="button"
        >
          {busy
            ? "生成中…"
            : bank
              ? labels[kind]
              : kind === "rubric"
                ? "AI起草标准"
                : "AI生成评阅草稿"}
        </Button>
      </div>
      <Feedback
        error={jobs.error || q.error}
        message={action.message}
        failed={action.failed}
      />
      {q.data && (
        <div role="status">
          <p>
            {labels[q.data.state]}
            {q.data.error ? `：${q.data.error}` : ""}
          </p>
          {busy && <Progress percent={q.data.progress} size="small" />}
          {q.data.state === "failed" &&
            typeof q.data.output.raw_response === "string" && (
              <Collapse
                items={[
                  {
                    key: "content",
                    label: <>查看模型原始回复</>,
                    children: (
                      <>
                        <pre className="live-prose">
                          {q.data.output.raw_response}
                        </pre>
                      </>
                    ),
                  },
                ]}
              />
            )}
          {q.data.state === "succeeded" && (
            <>
              <Collapse
                items={[
                  {
                    key: "content",
                    label: <>查看AI草稿</>,
                    children: (
                      <>
                        <DraftPreview output={q.data.output} />
                      </>
                    ),
                  },
                ]}
              />
              <Button
                disabled={busy || stale}
                onClick={() => onAdopt(q.data!.output, id)}
                htmlType="button"
              >
                载入编辑区
              </Button>
              {stale && (
                <p className="live-meta">
                  当前要求或依据已变化，请按当前条件重新生成。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
function DraftPreview({ output }: { output: Record<string, unknown> }) {
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
                children: (
                  <>
                    <RichContent text={q.reference_answer} />
                  </>
                ),
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
export function JobsPanel({ kinds, sourceID = "", expanded = false }: { kinds?: string[]; sourceID?: string; expanded?: boolean }) {
  const [page, setPage] = useState(1);
  const filter = new URLSearchParams({ size: "21", offset: String((page - 1) * 20) });
  if (sourceID) filter.set("source_id", sourceID);
  if (kinds?.length) filter.set("kind", kinds.join(","));
  const query = useLiveQuery<Job[]>(`/jobs?${filter}`, true, true);
  const action = useAction();
  const { reload } = useLearning();
  const rows =
    query.data?.filter((j) => !kinds || kinds.includes(j.kind)) || [];
  const active = rows.some((j) => ["queued", "running"].includes(j.state));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const r = await query.refetch();
      if (
        !r.data?.some(
          (j) =>
            (!kinds || kinds.includes(j.kind)) &&
            ["queued", "running"].includes(j.state),
        )
      )
        await reload();
    }, 2000);
    return () => clearInterval(t);
  }, [active, page, sourceID, query.refetch, reload]);
  return (
    <Collapse
      className="card-panel rag-jobs"
      defaultActiveKey={expanded ? ["content"] : []}
      items={[
        {
          key: "content",
          label: <MetaTags><span>处理任务</span>{active && <StatusTag status="running" label="处理中" />}</MetaTags>,
          children: (
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
                    <strong>{labels[j.kind]}</strong>
                    <MetaTags>
                      <StatusTag status={j.state} label={labels[j.state]} />
                      <span className="live-meta">{when(j.created_at)}</span>
                    </MetaTags>
                    {typeof j.input.source_id === "string" && !sourceID && <Link to={`/teacher/materials?source=${j.input.source_id}&source_view=tasks`}>打开来源与本次处理</Link>}
                    {j.state === "succeeded" && j.kind === "extract" && <Link to={`/teacher/materials?source=${j.input.source_id || ""}&source_view=knowledge&job=${j.id}`}>核对本次知识候选</Link>}
                    {j.state === "succeeded" && j.kind === "parse" && <p className="live-meta">原文已落库，尚需核对、发布和确认知识。索引状态独立查看。</p>}
                    {j.error && <Alert type="error" showIcon role="alert" message={<>{j.error}</>} />}
                  </div>
                  {j.state === "running" && (
                    <Progress percent={j.progress} size="small" />
                  )}
                  {["queued", "running"].includes(j.state) && (
                    <Button
                      disabled={action.busy}
                      onClick={() => action.run(`/jobs/${j.id}/cancel`)}
                    >
                      取消
                    </Button>
                  )}
                  {j.state === "failed" && !!Object.keys(j.output || {}).length && <Collapse items={[{key: "output", label: "查看失败时保留的输出（未采纳）", children: <pre className="job-raw-output">{JSON.stringify(j.output, null, 2)}</pre>}]} />}
                  {j.state === "failed" && !["diagnosis","recommendation"].includes(j.kind) && (
                    <Button
                      disabled={action.busy}
                      onClick={() => action.run(`/jobs/${j.id}/retry`)}
                    >
                      重试
                    </Button>
                  )}
                </article>
              ))}
              <div className="live-inline"><Button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页任务</Button><span>第 {page} 页</span><Button disabled={rows.length <= 20} onClick={() => setPage(page + 1)}>下一页任务</Button></div>
            </>
          ),
        },
      ]}
    />
  );
}
export function MaterialsPage() {
  const sources = useLiveQuery<Source[]>("/sources");
  const [params, setParams] = useSearchParams();
  const selected = params.get("source") || "";
  const setSelected = (id: string) => {
    const next = new URLSearchParams(params);
    next.delete("fragment");
    if (id) next.set("source", id);
    else next.delete("source");
    setParams(next);
  };
  const [upload, setUpload] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [sourceSearch, setSourceSearch] = useLocationValue("search");
  const sourcePage = Math.max(1, Number(params.get("page")) || 1);
  const sourceRows = (sources.data || []).filter(s => `${s.title} ${s.filename}`.toLocaleLowerCase().includes(sourceSearch.toLocaleLowerCase()));
  const imported = (jobs: Job[]) => {
    setUpload(false);
    const id = jobs.find(j => typeof j.input.source_id === "string")?.input.source_id;
    if (typeof id === "string") { const p = new URLSearchParams(params); p.set("source", id); p.set("source_view", "tasks"); p.delete("resource"); p.set("tab", "sources"); setParams(p); }
    void sources.refetch();
  };
  const action = useAction();
  const [embedding, setEmbedding] = useState("");
  const tab =
    params.get("tab") === "published" || (params.has("resource") && !selected)
      ? "published"
      : "sources";
  return (
    <div className="live-page">
      <div className="workspace-heading">
        <Button onClick={() => setUpload(true)} type="primary">
          导入资料
        </Button>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          next.delete("resource");
          next.delete("source");
          next.delete("fragment");
          setParams(next);
        }}
        items={[
          { key: "sources", label: "原始资料" },
          { key: "published", label: "学习内容" },
        ]}
      />
      {tab === "published" ? (
        <CourseWorkspace />
      ) : (
        <>
          <Collapse
            className="card-panel"
            items={[
              {
                key: "content",
                label: <>检索索引</>,
                children: (
                  <>
                    <div className="live-inline">
                      <ModelSelect
                        kind="embedding"
                        value={embedding}
                        onChange={setEmbedding}
                      />
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          action.run("/jobs", {
                            kind: "index",
                            profile_id: embedding,
                          })
                        }
                      >
                        更新检索索引
                      </Button>
                      <Link to="/teacher/retrieval">检索与问答</Link>
                    </div>
                    <Feedback message={action.message} failed={action.failed} />
                  </>
                ),
              },
            ]}
          />
          <div className="material-task-workspace"><aside className="material-object-list" aria-label="原始资料列表">
          <Input.Search aria-label="搜索原始资料" placeholder="搜索资料" value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} />
          {sources.isPending ? (
            <LoadingState />
          ) : sources.error ? (
            <ErrorState
              message={sources.error.message}
              onRetry={() => void sources.refetch()}
            />
          ) : !sources.data?.length ? (
            <Card className="card-panel">
              <EmptyState title="还没有资料">
                导入课程文件后，可核对原文、发布学习内容和提炼知识。
              </EmptyState>
            </Card>
          ) : (
            <div className="rag-source-list">
              {sourceRows.slice((sourcePage - 1) * 10, sourcePage * 10).map((s) => (
                <Button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  aria-pressed={s.id === selected}
                  className={"card-panel rag-source"}
                >
                  <strong>{s.title}</strong>
                  {s.filename !== s.title && <span>{s.filename}</span>}
                  <MetaTags>
                    <StatusTag status={s.state === "archived" ? "archived" : s.parse_state} label={s.state === "archived"
                        ? "已归档"
                        : labels[s.parse_state]} />
                    <MetaTag>{s.fragment_count || 0} 个片段</MetaTag>
                    {!!s.review_count && (
                      <StatusTag status="needs_review" label={`${s.review_count} 个待核对`} />
                    )}
                  </MetaTags>
                  {s.parse_error && <p>{s.parse_error}</p>}
                </Button>
              ))}
            </div>
          )}
          <div className="live-inline"><Button disabled={sourcePage === 1} onClick={() => { const p = new URLSearchParams(params);p.set("page",String(sourcePage-1));setParams(p); }}>上一页</Button><Button disabled={sourcePage * 10 >= sourceRows.length} onClick={() => {const p=new URLSearchParams(params);p.set("page",String(sourcePage+1));setParams(p);}}>下一页</Button></div>
          </aside><section className="material-current-object" aria-label="资料核对与发布">
            {selected ? <SourceWorkspace key={`${selected}:${params.get("fragment") || ""}`} id={selected} fragmentID={params.get("fragment") || ""} /> : <EmptyState title="选择资料开始核对">导入后的对象和处理任务会在这里继续。</EmptyState>}
          </section></div>
          {!selected && <JobsPanel
            kinds={["parse", "index", "extract", "vision", "source_suggest"]}
          />}
        </>
      )}
      <Drawer
        title="导入资料"
        aria-label="导入资料"
        open={upload}
        closable={!uploadBusy}
        maskClosable={!uploadBusy}
        keyboard={!uploadBusy}
        onClose={() => { if (!uploadBusy) setUpload(false); }}
        width={600}
        destroyOnHidden
      >
        <Tabs
          items={[
            {
              key: "files",
              label: "文件",
              disabled: uploadBusy,
              children: (
                <UploadForm
                  onDone={imported}
                  onBusyChange={setUploadBusy}
                />
              ),
            },
            {
              key: "url",
              label: "公开网址",
              disabled: uploadBusy,
              children: (
                <URLImport
                  onDone={job => imported([job])}
                  onBusyChange={setUploadBusy}
                />
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
function UploadForm({
  onDone,
  supersedesID = "",
  onBusyChange,
}: {
  onDone: (jobs: Job[]) => void;
  supersedesID?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { course, reload } = useLearning();
  const { session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<{name:string; jobs:Job[]; error?:string}[]>([]);
  return (
    <Form
      className="live-form"
      onFinish={async () => {
        if (!files.length) {
          setError("请选择文件");
          return;
        }
        if (files.length > 10 || files.some((f) => f.size > 30 * 1024 * 1024)) {
          setError("每批最多10个文件，每个不超过30MiB");
          return;
        }
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        const results: {name:string; jobs:Job[]; error?:string}[] = [];
        for (const file of files) {
          const form = new FormData(); form.append("files", file); form.append("source_note", note); form.append("allow_derived", String(allow));
          if (supersedesID) form.append("supersedes_id", supersedesID);
          try {
            const response = await requestJSON<{data:Job[]}>(`/learning/courses/${course!.id}/sources`, {method:"POST",body:form}, session?.csrf_token);
            results.push({name:file.name,jobs:response.data});
          } catch (err) {
            results.push({name:file.name,jobs:[],error:err instanceof Error?err.message:"上传结果未确认"});
          }
          setReceipts([...results]);
        }
        try { await reload(); } catch { setError("上传回执已保留，列表刷新失败，请刷新后核对。"); } finally { setBusy(false); onBusyChange?.(false); }

      }}
      layout="vertical"
    >
      <Field className="ui-field" label={<>课程文件</>} required={true}>
        <FileUpload
          aria-label="课程文件"
          disabled={busy}
          required
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv"
          onChange={(e) => {setFiles(e);setReceipts([]);}}
        />
      </Field>
      <small>
        每批10个以内，每个30MiB以内；PDF / PPTX最多200页。扫描文字须人工核对。
      </small>
      <Field className="ui-field" label={<>资料来源</>} required={true}>
        <Input.TextArea
          aria-label="资料来源"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="如：课程讲义、教材版本、编写者或来源网址"
        />
      </Field>
      <Checkbox
        className="rag-check"
        checked={allow}
        onChange={(e) => setAllow(e.target.checked)}
      >
        允许从本资料提炼知识候选
      </Checkbox>
      <Feedback error={error ? new Error(error) : undefined} />
      {receipts.map((r,i) => <Alert key={i} showIcon type={r.error?"warning":"success"} message={`${r.name}：${r.error?"未完成／结果待核对":"已接收，解析任务已登记"}`} description={r.error?`${r.error}。请先核对原件列表，勿重复上传已成功文件。`:r.jobs.map(j=>`任务 ${j.id} · ${labels[j.state] || j.state}`).join("；")} action={r.jobs.length ? <Button disabled={busy} onClick={()=>onDone(r.jobs)}>查看此文件处理</Button> : undefined} />)}
      {receipts.some(r=>r.jobs.length) && <Button disabled={busy} onClick={() => onDone(receipts.flatMap(r=>r.jobs))}>继续核对已导入资料</Button>}
      <Button disabled={busy || !!receipts.length} htmlType="submit" type="primary">
        {busy ? "上传中…" : "上传并解析"}
      </Button>
    </Form>
  );
}
export function SourceWorkspace({id, fragmentID}: {id:string; fragmentID:string}) {
  const [params,setParams] = useSearchParams();
  const tab = params.get("source_view") || "original";
  const q = useLiveQuery<SourceDetail>(`/sources/${id}`);
  return <div className="source-task-workspace">
    <div className="workspace-heading"><Typography.Text strong className="item-title">{q.data?.source.title || "资料工作区"}</Typography.Text><ContextAgent context={{kind:"source",id,title:q.data?.source.title || "原件"}} /></div>
    <Tabs activeKey={tab} onChange={v=>{const p=new URLSearchParams(params);p.set("source_view",v);setParams(p);}} items={[{key:"original",label:"原文核对"},{key:"knowledge",label:"知识候选"},{key:"tasks",label:"处理记录"},{key:"publication",label:"学习内容与发布"}]} />
    {tab === "original" && <SourceDocument id={id} fragmentID={fragmentID} />}
    {tab === "knowledge" && <KnowledgePage sourceID={id} embedded />}
    {tab === "tasks" && <JobsPanel sourceID={id} expanded />}
    {tab === "publication" && <CourseWorkspace sourceID={id} />}
  </div>;
}
function SourceDocument({
  id,
  fragmentID,
}: {
  id: string;
  fragmentID: string;
}) {
  const confirm = useConfirm();
  const query = useLiveQuery<SourceDetail>(
    `/sources/${id}${fragmentID ? `?fragment_id=${encodeURIComponent(fragmentID)}` : ""}`,
  );
  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [full, setFull] = useState(false);
  const [model, setModel] = useState("");
  const { course } = useLearning();
  const [replacing, setReplacing] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [point,setPoint] = useState("");
  const [publication,setPublication] = useState<Resource | null>(null);
  const [paperOpen,setPaperOpen] = useState(false);
  const unsaved = useUnsavedChanges();
  const points = useLiveQuery<{points:Point[]}>("");
  const [params,setParams] = useSearchParams();
  if (query.isPending) return <LoadingState />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={query.error?.message || "资料不存在"}
        onRetry={() => void query.refetch()}
      />
    );
  const { source, fragments } = query.data;
  const historical = query.data.display_revision !== source.parse_revision;
  const editable = source.state === "active" && !historical;
  return (
    <div className="live-form">
      <div className="live-inline">
        <Button disabled={replacementBusy} onClick={() => setReplacing(!replacing)}>
          {replacing ? "取消上传新版本" : "上传原件新版本"}
        </Button>
        {editable && (
          <Link
            className="ghost-btn"
            to={`/teacher/question-bank?new=1&source_id=${id}`}
          >
            据此出题
          </Link>
        )}
        <MetaTags>
          <StatusTag status={source.parse_state} label={labels[source.parse_state]} />
          <MetaTag>原文修订 {query.data.display_revision}</MetaTag>
        </MetaTags>
        <Button

          href={`/api/v1/learning/courses/${course!.id}/sources/${id}/download`}
        >
          下载完整原件
        </Button>
        <Button
          disabled={action.busy || source.state === "archived"}
          onClick={async () => {
            if (
              await confirm(
                "归档后原件及关联知识将停止参与检索，历史依据仍保留。继续？",
              )
            )
              void action.run(`/sources/${id}/archive`);
          }}
        >
          归档
        </Button>
      </div>
      <Feedback message={action.message} failed={action.failed} />
      {historical && (
        <p className="rag-tag">
          正在查看引用时的历史原文。
          <Link to={`/teacher/materials?source=${id}`}>查看当前修订</Link>
        </p>
      )}
      <ContentLinks kind="source" id={id} />
      {editable && <SourceSuggestions id={id} />}
      <MaterialAssets
        sourceID={id}
        revision={source.parse_revision}
        editable={editable}
      />
      {editable && fragments.length > 0 && (
        <Button onClick={()=>setPaperOpen(true)}>在此拆分试卷</Button>
      )}
      <DecisionHistory id={id} />
      <Drawer title="当前原件 · 整卷拆题" open={paperOpen} width={1000} destroyOnHidden onClose={async()=>{if(!unsaved || await confirm("收起拆题工作区？未保存的校正保留在当前浏览器。")) setPaperOpen(false);}}>
        {paperOpen && <PaperImport id={id} fragments={fragments}/>}
      </Drawer>
      {replacing && (
        <UploadForm supersedesID={id} onBusyChange={setReplacementBusy} onDone={jobs => {setReplacing(false);const source=jobs[0]?.input.source_id;if (typeof source==="string") setParams(p=>{const next=new URLSearchParams(p);next.set("source",source);next.set("source_view","tasks");next.delete("fragment");return next;});}} />
      )}
      <Checkbox
        className="rag-check"
        checked={source.allow_derived}
        disabled={action.busy}
        onChange={(e) =>
          void action.run(
            `/sources/${id}/derivation`,
            { allow_derived: e.target.checked },
            "PUT",
          )
        }
      >
        允许知识提炼
      </Checkbox>
      {source.parse_error && <Alert type="error" showIcon role="alert" message={<>{source.parse_error}</>} />}
      {!fragments.length && (
        <Button
          disabled={action.busy}
          onClick={() => action.run("/jobs", { kind: "parse", source_id: id })}
        >
          重新解析
        </Button>
      )}
      <div className="rag-fragments">
        {fragments.map((f) => (
          <FragmentEditor
            key={f.id}
            fragment={f}
            editable={editable}
            selected={selected.includes(f.id)}
            onSelect={(v) =>
              setSelected(
                v ? [...selected, f.id] : selected.filter((i) => i !== f.id),
              )
            }
            onSave={async (patch) => {
              const next = fragments.map((x) =>
                x.id === f.id ? { ...x, ...patch } : x,
              );
              const v = await action.run(
                `/sources/${id}/fragments`,
                { revision: source.parse_revision, fragments: next },
                "PUT",
              );
              if (v) {
                setSelected([]);
                await query.refetch();
              }
              return !!v;
            }}
          />
        ))}
      </div>
      {fragments.length > 0 && editable && (
        <Card className="card-panel" title={<>
            选中片段 · {selected.length}/ {fragments.length}
          </>}>

          <div className="live-inline">
            <Button
              onClick={() =>
                setSelected(
                  fragments
                    .filter((f) => f.quality === "ready")
                    .map((f) => f.id),
                )
              }
            >
              选择已核对片段
            </Button>
            <Button onClick={() => setSelected([])}>清除选择</Button>
          </div>
          <Field className="ui-field" label={<>发布标题</>}>
            <Input
              aria-label="发布标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={source.title}
            />
          </Field>
          <Field label="关联知识点"><Select aria-label="发布关联知识点" value={point} onChange={setPoint} options={[{value:"",label:"课程通用资料"},...(points.data?.points.filter(p=>p.kind==="point").map(p=>({value:p.id,label:p.title})) || [])]} /></Field>
          <Checkbox
            className="rag-check"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          >
            发布完整原件（须选中全部片段）
          </Checkbox>
          <Button
            disabled={action.busy || !selected.length}
            onClick={async () => {
              if (!(await confirm(`发布选中的 ${selected.length} 个片段给本课程学生？教师未选原文与私有候选不会开放。`))) return;
              const r = await action.run<Resource>(`/sources/${id}/publish`, {
                title: title || source.title,
                fragment_ids: selected,
                full_source: full,
                knowledge_point_id: point,
              });
              if(r) setPublication(r);
            }}
            type="primary"
          >
            确认并发布到课程学习
          </Button>
          {publication && <Alert showIcon type="success" message={`已发布：${publication.title} · v${publication.version}`} description={<Link to={`/teacher/materials?source=${id}&source_view=publication&resource=${publication.id}`}>查看已发布学习内容与学生可见文本</Link>} />}
          <hr />
          <div className="live-inline">
            <ModelSelect kind="chat" value={model} onChange={setModel} />
            <Button
              disabled={
                action.busy || !selected.length || !source.allow_derived
              }
              onClick={() =>
                action.run("/jobs", {
                  kind: "extract",
                  source_id: id,
                  fragment_ids: selected,
                  profile_id: model,
                })
              }
            >
              AI提炼知识候选
            </Button>
            <Button onClick={()=>{const p=new URLSearchParams(params);p.set("source_view","knowledge");setParams(p);}}>审核当前来源候选</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
function FragmentEditor({
  fragment: f,
  editable,
  selected,
  onSelect,
  onSave,
}: {
  fragment: Fragment;
  editable: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onSave: (p: Partial<Fragment>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const draft = useEditorDraft(`fragment:${f.id}`, f.body);
  const body = draft.value,
    setBody = draft.change;
  const [busy, setBusy] = useState(false);
  return (
    <article className="rag-fragment">
      <DraftNotice {...draft} />
      <div className="live-inline">
        <Checkbox
          className="rag-check"
          checked={selected}
          disabled={!editable || f.quality !== "ready"}
          onChange={(e) => onSelect(e.target.checked)}
        >
          {f.heading || location(f.locator)}
        </Checkbox>
        <span
          className={`rag-tag ${f.quality === "needs_review" ? "rag-warning" : ""}`}
        >
          {f.quality === "needs_review" ? "待人工核对" : "可使用"}
        </span>
      </div>
      {f.heading && <small>{location(f.locator)}</small>}
      {editing ? (
        <Field className="ui-field" label={<>原文校正</>}>
          <Input.TextArea
            aria-label="原文校正"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
          />
        </Field>
      ) : (
        <p className="live-prose">{f.body}</p>
      )}
      {editable && (
        <div className="live-inline">
          <Button disabled={busy} onClick={() => setEditing(!editing)}>
            {editing ? "收起编辑" : "校正原文"}
          </Button>
          {(editing || f.quality === "needs_review") && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (await onSave({ body, quality: "ready" }))
                    draft.saved(body);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存新修订并确认原文
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
export function KnowledgePage({sourceID = "", embedded = false}: {sourceID?:string; embedded?:boolean} = {}) {
  const confirm = useConfirm();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Knowledge[]>("/knowledge", true, true);
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<Knowledge | null>(null);
  const [filter, setFilter] = useLocationValue("knowledge_state");
  const [params] = useSearchParams();
  const sourceFilter = sourceID || params.get("source") || "";
  const extraction = useLiveQuery<Job>(`/jobs/${params.get("job")}`, teacher && !!params.get("job"));
  const candidateIDs = Array.isArray(extraction.data?.output.candidate_ids) ? extraction.data.output.candidate_ids : [];
  const jobMatchesSource = !sourceFilter || extraction.data?.input.source_id === sourceFilter;
  const [topic, setTopic] = useLocationValue("knowledge_topic");
  const [search,setSearch] = useLocationValue("knowledge_search");
  const topics = useLiveQuery<TopicData>("/topics", teacher);
  const action = useAction();
  const rows = query.data?.filter(
    (k) =>
      (!sourceFilter || k.evidence.some(e=>e.source_id === sourceFilter)) &&
      (!params.get("job") || !jobMatchesSource || candidateIDs.includes(k.id)) &&
      (!filter || k.state === filter) &&
      `${k.title} ${k.body}`.toLowerCase().includes(search.toLowerCase()) &&
      (!topic ||
        topics.data?.links.some(
          (l) => l.topic_id === topic && l.knowledge_id === k.id,
        )),
  );
  const linkedID = params.get("knowledge");
  useEffect(() => {
    if (linkedID && query.data) {
      requestAnimationFrame(() =>
        document
          .getElementById(`knowledge-${linkedID}`)
          ?.scrollIntoView({ block: "start" }),
      );
    }
  }, [linkedID, query.data]);
  return (
    <div className="live-page">
      {teacher && (
        <div className="workspace-heading">
          <Button
            onClick={() => {
              setSelected(null);
              setCreating(true);
            }}
            type="primary"
          >
            新建知识
          </Button>
        </div>
      )}
      {teacher && (
        <div className="rag-toolbar card-panel">
          <Input.Search aria-label="搜索知识" placeholder="搜索知识标题与正文" value={search} onChange={e=>setSearch(e.target.value)}/>
          <Select
            aria-label="知识状态"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "", label: "全部状态" },
              { value: "draft", label: "待审核" },
              { value: "confirmed", label: "已确认" },
              { value: "archived", label: "已归档" },
            ]}
          />
          <Select
            aria-label="筛选知识专题"
            value={topic}
            onChange={setTopic}
            options={[
              { value: "", label: "全部专题" },
              ...(topics.data?.topics
                .filter((t) => t.active)
                .map((t) => ({ value: t.id, label: t.title })) || []),
            ]}
          />
          <Link to="/teacher/materials">从资料提炼</Link>
          <Link to="/teacher/retrieval">验证检索</Link>
        </div>
      )}
      {teacher && !embedded && <TopicManager />}
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      {query.isPending ? (
        <LoadingState />
      ) : !rows?.length ? (
        <Card className="card-panel">
          <EmptyState title="暂无知识条目">
            {teacher
              ? "可从资料提炼候选，或手工添加有原文依据的知识。"
              : "教师确认并开放学习的知识会显示在这里。"}
          </EmptyState>
        </Card>
      ) : (
        rows.map((k) => (
          <Card
            key={k.id}
            id={`knowledge-${k.id}`}
            className="card-panel rag-knowledge"
          >
            <div className="workspace-heading">
              <Typography.Text strong className="item-title">{k.title}</Typography.Text>
              <MetaTags>
                <StatusTag status={k.state} label={labels[k.state]} />
                <MetaTag>v{k.version}</MetaTag>
              </MetaTags>
            </div>
            <MetaTags>
              <MetaTag>{kinds.find((v) => v.value === k.content_kind)?.label}</MetaTag>
              {k.origin === "teacher_example" && <MetaTag>教师自编示例</MetaTag>}
              {k.category && <MetaTag>{k.category}</MetaTag>}
              {teacher && <>
                {k.use_for_learning && <MetaTag>用于学习</MetaTag>}
                {k.use_for_grading && <MetaTag>用于评分</MetaTag>}
                <MetaTag>{k.student_visible ? "学生可见" : "教师内部"}</MetaTag>
              </>}
            </MetaTags>
            <RichContent text={k.body} />
            {k.conditions && (
              <p>
                <strong>适用条件：</strong>
                {k.conditions}
              </p>
            )}
            {k.origin !== "teacher_example" && <Collapse
              items={[
                {
                  key: "content",
                  label: <>原文依据（{k.evidence.length}）</>,
                  children: (
                    <>
                      {k.evidence.map((e, i) => (
                        <blockquote key={i}>
                          {e.quote}
                          <small>片段 {e.fragment_id.slice(0, 8)}</small>
                          {teacher && (
                            <Link
                              to={`/teacher/materials?source=${e.source_id}&fragment=${e.fragment_id}`}
                            >
                              查看引用原文
                            </Link>
                          )}
                        </blockquote>
                      ))}
                    </>
                  ),
                },
              ]}
            />}
            {teacher && (
              <div className="live-inline">
                {k.state === "draft" && k.origin !== "teacher_example" && (
                  <Button onClick={() => setReviewing(k)}>比较与处理</Button>
                )}
                {k.state === "confirmed" && k.use_for_grading && (
                  <Link
                    className="ghost-btn"
                    to={`/teacher/question-bank?new=1&knowledge_id=${k.id}`}
                  >
                    据此出题
                  </Link>
                )}
                <ContextAgent context={{kind:"knowledge",id:k.id,title:k.title}} />
                <Button
                  onClick={() => {
                    setSelected(k);
                    setCreating(true);
                  }}
                >
                  {k.state === "draft" ? "编辑候选" : "建立新版本"}
                </Button>
                {k.state === "draft" && (
                  <Button
                    disabled={action.busy}
                    onClick={() =>
                      action.run(`/knowledge/${k.id}/state`, {
                        state: "confirmed",
                        edit_version: k.edit_version,
                      })
                    }
                    type="primary"
                  >
                    确认知识
                  </Button>
                )}
                {k.state !== "archived" && (
                  <Button
                    disabled={action.busy}
                    onClick={async () => {
                      if (await confirm("归档此知识条目？历史版本和引用仍保留。"))
                        void action.run(`/knowledge/${k.id}/state`, {
                          state: "archived",
                          edit_version: k.edit_version,
                        });
                    }}
                  >
                    归档
                  </Button>
                )}
              </div>
            )}
            {teacher && (
              <>
                <ContentLinks kind="knowledge" id={k.id} />
                <DecisionHistory id={k.id} />
              </>
            )}
          </Card>
        ))
      )}
      {teacher && !embedded && <JobsPanel sourceID={sourceFilter} kinds={["extract", "knowledge_compare"]} />}
      <Drawer
        title="知识比较与决策"
        aria-label="知识比较与决策"
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        width={900}
        destroyOnHidden
      >
        {reviewing && (
          <KnowledgeReview
            key={reviewing.id}
            candidate={reviewing}
            onDone={() => setReviewing(null)}
          />
        )}
      </Drawer>
      <Drawer
        title={selected?.state === "draft" ? "编辑知识候选" : "新建知识版本"}
        open={creating}
        onClose={() => setCreating(false)}
        width={760}
        destroyOnHidden
      >
        {creating && (
          <KnowledgeEditor
            key={selected?.id || "new"}
            initial={selected}
            onDone={() => setCreating(false)}
          />
        )}
      </Drawer>
    </div>
  );
}
export function KnowledgeEditor({
  initial,
  onDone,
}: {
  initial: Knowledge | null;
  onDone: () => void;
}) {
  const action = useAction();
  const { course } = useLearning();
  const sources = useLiveQuery<Source[]>("/sources");
  const [sourceID, setSourceID] = useState(
    initial?.evidence[0]?.source_id || "",
  );
  const source = useLiveQuery<SourceDetail>(`/sources/${sourceID}`, !!sourceID);
  const graph = useLiveQuery<{ points: { id: string; title: string }[] }>("");
  const all = useLiveQuery<Knowledge[]>("/knowledge");
  const draft = useEditorDraft(
    `knowledge:${initial?.id || `${course!.id}:new`}`,
    initial || {
      origin: "source" as Knowledge["origin"],
      title: "",
      body: "",
      category: "",
      content_kind: "concept",
      conditions: "",
      evidence: [] as Evidence[],
      student_visible: false,
      use_for_learning: true,
      use_for_grading: false,
      knowledge_point_ids: [] as string[],
      related_ids: [] as string[],
    },
  );
  const v = draft.value;
  const change = (patch: Partial<typeof v>) =>
    draft.change((old) => ({ ...old, ...patch }));
  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const path =
          initial?.state === "draft"
            ? `/knowledge/${initial.id}`
            : "/knowledge";
        if (
          await action.run(
            path,
            {
              ...v,
              supersedes_id: initial?.state !== "draft" ? initial?.id : "",
            },
            initial?.state === "draft" ? "PUT" : "POST",
          )
        ) {
          draft.saved(v);
          onDone();
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} />
      <Feedback message={action.message} failed={action.failed} />
      <Field label="内容来源">
        <Select aria-label="内容来源" disabled={!!initial} value={v.origin || "source"} options={[{ value: "source", label: "资料提炼知识" }, { value: "teacher_example", label: "教师自编教学示例" }]} onChange={(origin: Knowledge["origin"]) => change({ origin, ...(origin === "teacher_example" ? { content_kind: "example", evidence: [], use_for_grading: false } : {}) })} />
      </Field>
      <Field className="ui-field" label={<>标题</>} required={true}>
        <Input
          aria-label="标题"
          required
          value={v.title}
          onChange={(e) => change({ title: e.target.value })}
        />
      </Field>
      <div className="rag-two-fields">
        <Field className="ui-field" label={<>知识类型</>}>
          <Select
            aria-label="知识类型"
            disabled={v.origin === "teacher_example"}
            value={v.content_kind}
            options={kinds}
            onChange={(content_kind) => change({ content_kind })}
          />
        </Field>
        <Field className="ui-field" label={<>分类</>}>
          <Input
            aria-label="分类"
            value={v.category}
            onChange={(e) => change({ category: e.target.value })}
          />
        </Field>
      </div>
      <Field className="ui-field" label={<>知识正文</>} required={true}>
        <Input.TextArea
          aria-label="知识正文"
          required
          rows={6}
          value={v.body}
          onChange={(e) => change({ body: e.target.value })}
        />
      </Field>
      <Field className="ui-field" label={<>适用条件与限制</>}>
        <Input.TextArea
          aria-label="适用条件与限制"
          rows={2}
          value={v.conditions}
          onChange={(e) => change({ conditions: e.target.value })}
        />
      </Field>
      <Field className="ui-field" label={<>关联课程知识点</>}>
        <Select
          aria-label="关联课程知识点"
          mode="multiple"
          optionFilterProp="label"
          value={v.knowledge_point_ids}
          onChange={(knowledge_point_ids) => change({ knowledge_point_ids })}
          options={graph.data?.points.map((p) => ({
            value: p.id,
            label: p.title,
          }))}
        />
      </Field>
      <Field className="ui-field" label={<>相似或相关知识</>}>
        <Select
          aria-label="相似或相关知识"
          mode="multiple"
          optionFilterProp="label"
          value={v.related_ids}
          onChange={(related_ids) => change({ related_ids })}
          options={all.data
            ?.filter((k) => k.id !== initial?.id)
            .map((k) => ({ value: k.id, label: k.title }))}
        />
      </Field>
      {v.origin !== "teacher_example" && <Card size="small" title={<>原文依据</>}>
        {v.evidence.map((ev, i) => (
          <div key={i}>
            <Field
              className="ui-field"
              label={<>逐字引用</>}
              required={true}
            >
              <Input.TextArea
                aria-label="逐字引用"
                required
                value={ev.quote}
                onChange={(e) =>
                  change({
                    evidence: v.evidence.map((old, n) =>
                      n === i ? { ...old, quote: e.target.value } : old,
                    ),
                  })
                }
              />
            </Field>
            <Button
              onClick={() =>
                change({ evidence: v.evidence.filter((_, n) => n !== i) })
              }
              htmlType="button"
            >
              移除这条依据
            </Button>
          </div>
        ))}
        <Field className="ui-field" label={<>来源文件</>}>
          <Select
            aria-label="来源文件"
            value={sourceID || undefined}
            onChange={setSourceID}
            options={sources.data
              ?.filter((s) => s.state === "active" && s.allow_derived)
              .map((s) => ({ value: s.id, label: s.title }))}
          />
        </Field>
        <Feedback error={source.error} />
        {source.data?.fragments
          .filter((f) => f.quality === "ready")
          .map((f) => (
            <Collapse
              key={f.id}
              items={[
                {
                  key: "content",
                  label: <>{f.heading || location(f.locator)}</>,
                  children: (
                    <>
                      <p className="live-prose">{f.body}</p>
                      <Button
                        onClick={() =>
                          change({
                            evidence: [
                              ...v.evidence,
                              {
                                source_id: sourceID,
                                fragment_id: f.id,
                                quote: f.body,
                              },
                            ],
                          })
                        }
                        htmlType="button"
                      >
                        引用此片段
                      </Button>
                    </>
                  ),
                },
              ]}
            />
          ))}
      </Card>}
      <div className="rag-checks">
        {(
          [
            ["student_visible", "学生可见"],
            ["use_for_learning", "用于学习检索"],
            ["use_for_grading", "用于评分依据"],
          ] as const
        ).map(([key, label]) => (
          <Checkbox
            className="rag-check"
            key={key}
            checked={v[key]}
            disabled={key === "use_for_grading" && v.origin === "teacher_example"}
            onChange={(e) => change({ [key]: e.target.checked })}
          >
            {label}
          </Checkbox>
        ))}
      </div>
      <Button
        disabled={action.busy || (v.origin !== "teacher_example" && !v.evidence.length)}
        htmlType="submit"
        type="primary"
      >
        保存待审核版本
      </Button>
    </Form>
  );
}
export function RetrievalPage({resourceID = "", embedded = false}: {resourceID?:string; embedded?:boolean} = {}) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const action = useAction();
  const [params] = useSearchParams();
  const targetResource = resourceID || params.get("resource") || "";
  const [onlyCurrent,setOnlyCurrent] = useState(!!targetResource);
  const readiness = useLiveQuery<{configured:boolean; indexed:boolean; object_index?:{keyword_chunks:number;vector_chunks:number}; latest_index_job?:{state:string;error:string;created_at:string}}>(`/retrieval/status${targetResource?`?resource_id=${encodeURIComponent(targetResource)}`:""}`);
  const assistStatus = useLiveQuery<{configured:boolean}>("/assist");
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("learning");
  const [model, setModel] = useState("");
  const [result, setResult] = useState<{ hits: Hit[]; mode: string } | null>(
    null,
  );
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);
  return (
    <div className="live-page">
      {!embedded && params.get("task") && <Link to={`/student/intervention?task=${params.get("task")}`}>返回原学习任务</Link>}
      {!embedded && targetResource && <Link to={`/${teacher?"teacher/materials?tab=published":"student/course-content?"}&resource=${targetResource}`}>返回当前学习资料</Link>}
      <Alert showIcon type={readiness.error?"warning":"info"} message={readiness.error?"检索状态读取失败，可继续阅读原文":onlyCurrent?"仅在当前已发布学习文本中匹配依据（不依赖向量索引）":!readiness.data?.configured?"课程智能检索未启用，可选择当前资料进行文内检索":readiness.data?.indexed?"课程已有索引空间；不代表每份资料的最新修订已就绪":"课程向量索引尚未就绪；检索可使用已有关键词索引"} description={<>{readiness.data?.object_index && <p>已观察到本资料的关键词片段 {readiness.data.object_index.keyword_chunks} 个、当前空间向量 {readiness.data.object_index.vector_chunks} 个；此计数不表示所有片段均已处理。</p>}{readiness.data?.latest_index_job && <p>最近一次课程索引：{labels[readiness.data.latest_index_job.state] || readiness.data.latest_index_job.state}{readiness.data.latest_index_job.error ? ` · ${readiness.data.latest_index_job.error}` : ""}</p>}</>} />
      {targetResource && <Select aria-label="问答资料范围" value={onlyCurrent?"current":"course"} onChange={v=>{setOnlyCurrent(v==="current");setResult(null);setAnswer(null);}} options={[{value:"current",label:"仅当前学习资料"},{value:"course",label:"全课程可见资料"}]} />}
      <Form
        className="card-panel live-form"
        onFinish={async () => {
          setAnswer(null);
          const r = await action.run<{ hits: Hit[]; mode: string }>(
            "/retrieval",
            { query, purpose, resource_id:onlyCurrent?targetResource:"" },
          );
          if (r) setResult(r);
        }}
        layout="vertical"
      >
        <Field className="ui-field" label={<>课程问题</>} required={true}>
          <Input.TextArea
            aria-label="课程问题"
            required
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        {teacher && (
          <div className="live-inline">
            <Field className="ui-field" label={<>检索用途</>}>
              <Select
                aria-label="检索用途"
                value={purpose}
                onChange={setPurpose}
                options={[
                  { value: "learning", label: "学习资料与知识" },
                  { value: "grading", label: "评分依据" },
                ]}
              />
            </Field>
            <ModelSelect kind="chat" value={model} onChange={setModel} />
          </div>
        )}
        <div className="live-inline">
          <Button disabled={action.busy} htmlType="submit" type="primary">
            检索依据
          </Button>
          <Button
            disabled={action.busy || !query.trim() || purpose === "grading" || !assistStatus.data?.configured}
            onClick={async () => {
              const r = await action.run<AssistAnswer>("/assist", {
                topic: query,
                resource_id:onlyCurrent?targetResource:"",
                profile_id: model,
                request_id: crypto.randomUUID(),
              });
              if (r) {
                setAnswer(r);
                setResult({ hits: r.sources, mode: r.mode });
              }
            }}
            htmlType="button"
          >
            {action.busy ? "处理中…" : "根据资料回答"}
          </Button>
        </div>
        {!assistStatus.data?.configured && <p className="live-meta">生成模型未启用，不能生成回答；正文阅读不受影响。</p>}
        <Feedback message={action.message} failed={action.failed} />
      </Form>
      {answer && (
        <Card className="card-panel" title={<>AI回答</>}>

          <GroundedAnswer answer={answer} />
        </Card>
      )}
      {result && (
        <Card className="card-panel">
          <div className="workspace-heading">
            <Typography.Text strong className="item-title">检索依据 · {result.hits.length}</Typography.Text>
            <span className="live-meta">{result.mode}</span>
          </div>
          {!result.hits.length && <p>没有找到当前可见的依据。</p>}
          {result.hits.map((h) => (
            <article key={h.id} className="rag-hit">
              <Typography.Text strong className="item-title">
                {h.title}
                {h.heading ? ` · ${h.heading}` : ""}
              </Typography.Text>
              <small>{location(h.locator)}</small>
              <p className="live-prose">{h.body}</p>
              {teacher && h.source_id && (
                <Link
                  to={`/teacher/materials?source=${h.source_id}&fragment=${h.fragment_ids?.[0] || ""}`}
                >
                  查看原文
                </Link>
              )}
              {h.resource_id && <Link to={`/${teacher?"teacher/materials?tab=published":"student/course-content?"}&resource=${h.resource_id}`}>查看引用学习资料</Link>}
            </article>
          ))}
        </Card>
      )}
      {!embedded && <RetrievalHistory renderAnswer={saved => <GroundedAnswer answer={saved} />} reuse={(text) => { setQuery(text); setAnswer(null); setResult(null); window.scrollTo({ top: 0, behavior: "auto" }); }} />}
    </div>
  );
}
