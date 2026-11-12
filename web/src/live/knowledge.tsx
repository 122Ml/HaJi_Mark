import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { FileUpload } from "../shared/FileUpload";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Select, Progress, Tabs, Collapse, Button, Card, Form, Input, Checkbox, Alert } from "antd";
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
import { useEditorDraft, DraftNotice } from "./editing";
import "./knowledge.css";
import {
  ContentLinks,
  TopicManager,
  DecisionHistory,
  type TopicData,
} from "./content-topics";
import { MaterialAssets } from "./material-assets";
import { URLImport, SourceSuggestions } from "./material-assist";
import { KnowledgeReview } from "./knowledge-review";
import { RichContent } from "./content-render";
import { CourseWorkspace } from "./course";

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
                  {hit.source_id && (
                    <Link
                      to={`/teacher/materials?source=${hit.source_id}&fragment=${hit.fragment_ids?.[0] || ""}`}
                    >
                      查看引用原文
                    </Link>
                  )}
                  {hit.knowledge_id && (
                    <Link to="/teacher/knowledge">查看知识库</Link>
                  )}
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
export function JobsPanel({ kinds }: { kinds?: string[] }) {
  const query = useLiveQuery<Job[]>("/jobs");
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
  }, [active]);
  return (
    <Collapse
      className="card-panel rag-jobs"
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
              {rows.slice(0, 15).map((j) => (
                <article key={j.id} className="rag-job">
                  <div>
                    <strong>{labels[j.kind]}</strong>
                    <MetaTags>
                      <StatusTag status={j.state} label={labels[j.state]} />
                      <span className="live-meta">{when(j.created_at)}</span>
                    </MetaTags>
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
                  {j.state === "failed" && (
                    <Button
                      disabled={action.busy}
                      onClick={() => action.run(`/jobs/${j.id}/retry`)}
                    >
                      重试
                    </Button>
                  )}
                </article>
              ))}
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
  const action = useAction();
  const [embedding, setEmbedding] = useState("");
  const tab =
    params.get("tab") === "published" || params.has("resource")
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
              {sources.data.map((s) => (
                <Button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
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
          <JobsPanel
            kinds={["parse", "index", "extract", "vision", "source_suggest"]}
          />
        </>
      )}
      <Drawer
        title="导入资料"
        aria-label="导入资料"
        open={upload}
        onClose={() => setUpload(false)}
        width={600}
        destroyOnHidden
      >
        <Tabs
          items={[
            {
              key: "files",
              label: "文件",
              children: (
                <UploadForm
                  onDone={() => {
                    setUpload(false);
                    void sources.refetch();
                  }}
                />
              ),
            },
            {
              key: "url",
              label: "公开网址",
              children: (
                <URLImport
                  onDone={() => {
                    setUpload(false);
                    void sources.refetch();
                  }}
                />
              ),
            },
          ]}
        />
      </Drawer>
      <Drawer
        title="资料核对与发布"
        aria-label="资料核对与发布"
        open={!!selected}
        onClose={() => setSelected("")}
        width={1000}
        destroyOnHidden
      >
        {selected && (
          <SourceWorkspace
            key={`${selected}:${params.get("fragment") || ""}`}
            id={selected}
            fragmentID={params.get("fragment") || ""}
          />
        )}
      </Drawer>
    </div>
  );
}
function UploadForm({
  onDone,
  supersedesID = "",
}: {
  onDone: () => void;
  supersedesID?: string;
}) {
  const { course, reload } = useLearning();
  const { session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        setError("");
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        form.append("source_note", note);
        form.append("allow_derived", String(allow));
        if (supersedesID) form.append("supersedes_id", supersedesID);
        try {
          await requestJSON(
            `/learning/courses/${course!.id}/sources`,
            { method: "POST", body: form },
            session?.csrf_token,
          );
          await reload();
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "上传失败");
        } finally {
          setBusy(false);
        }
      }}
      layout="vertical"
    >
      <Field className="ui-field" label={<>课程文件</>} required={true}>
        <FileUpload
          aria-label="课程文件"
          required
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv"
          onChange={(e) => setFiles(e)}
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
      <Button disabled={busy} htmlType="submit" type="primary">
        {busy ? "上传中…" : "上传并解析"}
      </Button>
    </Form>
  );
}
function SourceWorkspace({
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
        <Button onClick={() => setReplacing(!replacing)}>
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
        <Link
          className="ghost-btn"
          to={`/teacher/question-bank?paper_source=${id}`}
        >
          到题库拆分试卷
        </Link>
      )}
      <DecisionHistory id={id} />
      {replacing && (
        <UploadForm supersedesID={id} onDone={() => setReplacing(false)} />
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
        <Card className="card-panel" title={<h2>
            选中片段 · {selected.length}/ {fragments.length}
          </h2>}>

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
          <Checkbox
            className="rag-check"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          >
            发布完整原件（须选中全部片段）
          </Checkbox>
          <Button
            disabled={action.busy || !selected.length}
            onClick={() =>
              action.run(`/sources/${id}/publish`, {
                title: title || source.title,
                fragment_ids: selected,
                full_source: full,
              })
            }
            type="primary"
          >
            确认并发布到课程学习
          </Button>
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
            <Link to="/teacher/knowledge">审核知识候选</Link>
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
export function KnowledgePage() {
  const confirm = useConfirm();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Knowledge[]>("/knowledge");
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<Knowledge | null>(null);
  const [filter, setFilter] = useState("");
  const [params] = useSearchParams();
  const [topic, setTopic] = useState("");
  const topics = useLiveQuery<TopicData>("/topics", teacher);
  const action = useAction();
  const rows = query.data?.filter(
    (k) =>
      (!filter || k.state === filter) &&
      (!topic ||
        topics.data?.links.some(
          (l) => l.topic_id === topic && l.knowledge_id === k.id,
        )),
  );
  const linkedID = params.get("knowledge");
  useEffect(() => {
    if (linkedID && query.data) {
      setFilter("");
      setTopic("");
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
      {teacher && <TopicManager />}
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
              <h2>{k.title}</h2>
              <MetaTags>
                <StatusTag status={k.state} label={labels[k.state]} />
                <MetaTag>v{k.version}</MetaTag>
              </MetaTags>
            </div>
            <MetaTags>
              <MetaTag>{kinds.find((v) => v.value === k.content_kind)?.label}</MetaTag>
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
            <Collapse
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
            />
            {teacher && (
              <div className="live-inline">
                {k.state === "draft" && (
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
      {teacher && <JobsPanel kinds={["extract", "knowledge_compare"]} />}
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
function KnowledgeEditor({
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
          value={v.related_ids}
          onChange={(related_ids) => change({ related_ids })}
          options={all.data
            ?.filter((k) => k.id !== initial?.id)
            .map((k) => ({ value: k.id, label: k.title }))}
        />
      </Field>
      <Card size="small" title={<>原文依据</>}>
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
      </Card>
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
            onChange={(e) => change({ [key]: e.target.checked })}
          >
            {label}
          </Checkbox>
        ))}
      </div>
      <Button
        disabled={action.busy || !v.evidence.length}
        htmlType="submit"
        type="primary"
      >
        保存待审核版本
      </Button>
    </Form>
  );
}
export function RetrievalPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const action = useAction();
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("learning");
  const [model, setModel] = useState("");
  const [result, setResult] = useState<{ hits: Hit[]; mode: string } | null>(
    null,
  );
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);
  return (
    <div className="live-page">

      <Form
        className="card-panel live-form"
        onFinish={async () => {
          setAnswer(null);
          const r = await action.run<{ hits: Hit[]; mode: string }>(
            "/retrieval",
            { query, purpose },
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
            disabled={action.busy || !query.trim() || purpose === "grading"}
            onClick={async () => {
              const r = await action.run<AssistAnswer>("/assist", {
                topic: query,
                profile_id: model,
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
        <Feedback message={action.message} failed={action.failed} />
      </Form>
      {answer && (
        <Card className="card-panel" title={<h2>AI回答</h2>}>

          <GroundedAnswer answer={answer} />
        </Card>
      )}
      {result && (
        <Card className="card-panel">
          <div className="workspace-heading">
            <h2>检索依据 · {result.hits.length}</h2>
            <span className="live-meta">{result.mode}</span>
          </div>
          {!result.hits.length && <p>没有找到当前可见的依据。</p>}
          {result.hits.map((h) => (
            <article key={h.id} className="rag-hit">
              <h3>
                {h.title}
                {h.heading ? ` · ${h.heading}` : ""}
              </h3>
              <small>{location(h.locator)}</small>
              <p className="live-prose">{h.body}</p>
              {teacher && h.source_id && (
                <Link
                  to={`/teacher/materials?source=${h.source_id}&fragment=${h.fragment_ids?.[0] || ""}`}
                >
                  查看原文
                </Link>
              )}
            </article>
          ))}
        </Card>
      )}
    </div>
  );
}
