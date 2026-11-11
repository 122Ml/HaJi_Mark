import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Select, Progress } from "antd";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { LoadingState, ErrorState, EmptyState } from "../shared/ui";
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

type Profile = { id: string; label: string; kind: string; available: boolean };
type ModelInfo = {
  profiles: Profile[];
  budget: {
    limit_micro_cny: number;
    reserved_micro_cny: number;
    spent_micro_cny: number;
  };
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
type Knowledge = {
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
    <details>
      <summary>引用依据（{sources.length}）</summary>
      {sources.map((hit) => (
        <article className="rag-hit" key={hit.id}>
          <strong>{hit.title}</strong>
          <small>{location(hit.locator)}</small>
          <p className="live-prose">{hit.body}</p>
          {hit.source_id && (
            <Link to={`/teacher/materials?source=${hit.source_id}&fragment=${hit.fragment_ids?.[0] || ""}`}>
              查看引用原文
            </Link>
          )}
          {hit.knowledge_id && <Link to="/teacher/knowledge">查看知识库</Link>}
        </article>
      ))}
    </details>
  );
}
export function GroundedAnswer({ answer }: { answer: AssistAnswer }) {
  const { session } = useSession();
  return (
    <>
      <p className="live-prose">{answer.text}</p>
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
function useJob(id: string) {
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
  kind: "rubric" | "grade" | "question_generate" | "question_analyze" | "bank_rubric";
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
}) {
  const action = useAction();
  const [model, setModel] = useState("");
  const bank = ["question_generate", "question_analyze", "bank_rubric"].includes(kind);
  const filters = Object.fromEntries(Object.entries(target).filter(([k,v]) => ["question_id", "submission_id", "rubric_id"].includes(k) && typeof v === "string")) as Record<string,string>;
  const jobs = useLiveQuery<Job[]>(
    `/jobs?${new URLSearchParams({ kind, ...filters })}`,
  );
  const id = jobs.data?.[0]?.id || "";
  const q = useJob(id);
  const stale = bank && !!q.data && Object.entries(target).some(([key,value]) => {
    if (key === "evidence_ids") {
      const ids = (q.data!.input.evidence_refs as Hit[] | undefined)?.map(h=>h.id) || [];
      return JSON.stringify([...ids].sort()) !== JSON.stringify([...(value as string[])].sort());
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
        <button
          type="button"
          className="ghost-btn"
          disabled={busy || jobs.isPending || !!jobs.error || !!q.error}
          onClick={async () => {
            await action.run<Job>(bank ? "/question-bank/jobs" : "/jobs", {
              kind,
              profile_id: model,
              ...target,
            });
          }}
        >
          {busy
            ? "生成中…"
            : bank ? labels[kind] : kind === "rubric"
              ? "AI起草标准"
              : "AI生成评阅草稿"}
        </button>
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
          {q.data.state === "failed" && typeof q.data.output.raw_response === "string" && <details><summary>查看模型原始回复</summary><pre className="live-prose">{q.data.output.raw_response}</pre></details>}
          {q.data.state === "succeeded" && (
            <>
              <details>
                <summary>查看AI草稿</summary>
                <DraftPreview output={q.data.output} />
              </details>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy || stale}
                onClick={() => onAdopt(q.data!.output, id)}
              >
                载入编辑区
              </button>
              {stale && <p className="live-meta">当前要求或依据已变化，请按当前条件重新生成。</p>}
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
      {(output.questions as { title: string; prompt: string; reference_answer: string }[] | undefined)?.map((q,i) => <article key={i}><strong>{q.title}</strong><p className="live-prose">{q.prompt}</p><details><summary>参考解答</summary><p className="live-prose">{q.reference_answer}</p></details></article>)}
      {(output.requirements as string[] | undefined)?.map((r,i) => <p key={`r${i}`}>回答要求：{r}</p>)}
      {(output.issues as string[] | undefined)?.map((r,i) => <p key={`i${i}`}>待澄清：{r}</p>)}
      {(output.associations as {evidence_id:string;reason:string}[] | undefined)?.map((r,i) => <p key={`a${i}`}>关联理由：{r.reason}</p>)}
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
      <span className="rag-tag">待教师审核</span>
    </div>
  );
}
export function JobsPanel() {
  const query = useLiveQuery<Job[]>("/jobs");
  const action = useAction();
  const { reload } = useLearning();
  const active = query.data?.some((j) =>
    ["queued", "running"].includes(j.state),
  );
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const r = await query.refetch();
      if (!r.data?.some((j) => ["queued", "running"].includes(j.state)))
        await reload();
    }, 2000);
    return () => clearInterval(t);
  }, [active]);
  return (
    <details className="card-panel rag-jobs">
      <summary>处理任务{active ? " · 处理中" : ""}</summary>
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      {!query.data?.length && <p>暂无处理任务。</p>}
      {query.data?.slice(0, 15).map((j) => (
        <article key={j.id} className="rag-job">
          <div>
            <strong>{labels[j.kind]}</strong>
            <span>
              {labels[j.state]} · {when(j.created_at)}
            </span>
            {j.error && <p role="alert">{j.error}</p>}
          </div>
          {j.state === "running" && (
            <Progress percent={j.progress} size="small" />
          )}
          {["queued", "running"].includes(j.state) && (
            <button
              className="ghost-btn"
              disabled={action.busy}
              onClick={() => action.run(`/jobs/${j.id}/cancel`)}
            >
              取消
            </button>
          )}
          {j.state === "failed" && (
            <button
              className="ghost-btn"
              disabled={action.busy}
              onClick={() => action.run(`/jobs/${j.id}/retry`)}
            >
              重试
            </button>
          )}
        </article>
      ))}
    </details>
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
  const models = useLiveQuery<ModelInfo>("/models");
  return (
    <div className="live-page">
      <div className="workspace-heading">
        <div>
          <h1>学习资料</h1>
        </div>
        <button className="primary-link" onClick={() => setUpload(true)}>
          导入资料
        </button>
      </div>
      <div className="rag-toolbar card-panel">
        <div className="live-inline">
          <ModelSelect
            kind="embedding"
            value={embedding}
            onChange={setEmbedding}
          />
          <button
            className="ghost-btn"
            disabled={action.busy}
            onClick={() =>
              action.run("/jobs", { kind: "index", profile_id: embedding })
            }
          >
            更新检索索引
          </button>
          <Link to="/teacher/retrieval">检索验证</Link>
        </div>
        {models.data && (
          <small>
            联调记账 ¥
            {(
              (models.data.budget.spent_micro_cny +
                models.data.budget.reserved_micro_cny) /
              1e6
            ).toFixed(3)}{" "}
            / ¥{models.data.budget.limit_micro_cny / 1e6}（保守估算）
          </small>
        )}
        <Feedback message={action.message} failed={action.failed} />
      </div>
      {sources.isPending ? (
        <LoadingState />
      ) : sources.error ? (
        <ErrorState
          message={sources.error.message}
          onRetry={() => void sources.refetch()}
        />
      ) : !sources.data?.length ? (
        <section className="card-panel">
          <EmptyState title="还没有资料">
            导入课程文件后，可核对原文、发布章节和提炼知识。
          </EmptyState>
        </section>
      ) : (
        <div className="rag-source-list">
          {sources.data.map((s) => (
            <button
              key={s.id}
              className="card-panel rag-source"
              onClick={() => setSelected(s.id)}
            >
              <strong>{s.title}</strong>
              <span>{s.filename}</span>
              <div className="live-inline">
                <span className="rag-tag">
                  {s.state === "archived" ? "已归档" : labels[s.parse_state]}
                </span>
                <span>{s.fragment_count || 0} 个片段</span>
                {!!s.review_count && (
                  <span className="rag-warning">{s.review_count} 个待核对</span>
                )}
              </div>
              {s.parse_error && <p>{s.parse_error}</p>}
            </button>
          ))}
        </div>
      )}
      <JobsPanel />
      <Drawer
        title="导入资料"
        open={upload}
        onClose={() => setUpload(false)}
        width={600}
        destroyOnHidden
      >
        <UploadForm
          onDone={() => {
            setUpload(false);
            void sources.refetch();
          }}
        />
      </Drawer>
      <Drawer
        title="资料核对与发布"
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
    <form
      className="live-form"
      onSubmit={async (e) => {
        e.preventDefault();
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
    >
      <label>
        课程文件
        <input
          required
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </label>
      <small>
        每批10个以内，每个30MiB以内；PDF / PPTX最多200页。扫描文字须人工核对。
      </small>
      <label>
        资料来源
        <textarea
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="如：课程讲义、教材版本、编写者或来源网址"
        />
      </label>
      <label className="rag-check">
        <input
          type="checkbox"
          checked={allow}
          onChange={(e) => setAllow(e.target.checked)}
        />
        允许从本资料提炼知识候选
      </label>
      <Feedback error={error ? new Error(error) : undefined} />
      <button className="primary-link" disabled={busy}>
        {busy ? "上传中…" : "上传并解析"}
      </button>
    </form>
  );
}
function SourceWorkspace({
  id,
  fragmentID,
}: {
  id: string;
  fragmentID: string;
}) {
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
        <button className="ghost-btn" onClick={() => setReplacing(!replacing)}>
          {replacing ? "取消上传新版本" : "上传原件新版本"}
        </button>
        {editable && <Link className="ghost-btn" to={`/teacher/question-bank?new=1&source_id=${id}`}>据此出题</Link>}
        <span className="rag-tag">
          {labels[source.parse_state]} · 原文修订 {query.data.display_revision}
        </span>
        <a
          className="ghost-btn"
          href={`/api/v1/learning/courses/${course!.id}/sources/${id}/download`}
        >
          下载完整原件
        </a>
        <button
          className="ghost-btn"
          disabled={action.busy || source.state === "archived"}
          onClick={() => {
            if (
              confirm(
                "归档后原件及关联知识将停止参与检索，历史依据仍保留。继续？",
              )
            )
              void action.run(`/sources/${id}/archive`);
          }}
        >
          归档
        </button>
      </div>
      <Feedback message={action.message} failed={action.failed} />
      {historical && (
        <p className="rag-tag">
          正在查看引用时的历史原文。
          <Link to={`/teacher/materials?source=${id}`}>查看当前修订</Link>
        </p>
      )}
      {replacing && (
        <UploadForm supersedesID={id} onDone={() => setReplacing(false)} />
      )}
      <label className="rag-check">
        <input
          type="checkbox"
          checked={source.allow_derived}
          disabled={action.busy}
          onChange={(e) =>
            void action.run(
              `/sources/${id}/derivation`,
              { allow_derived: e.target.checked },
              "PUT",
            )
          }
        />
        允许知识提炼
      </label>
      {source.parse_error && <p role="alert">{source.parse_error}</p>}
      {!fragments.length && (
        <button
          className="ghost-btn"
          disabled={action.busy}
          onClick={() => action.run("/jobs", { kind: "parse", source_id: id })}
        >
          重新解析
        </button>
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
        <section className="card-panel">
          <h2>
            选中片段 · {selected.length} / {fragments.length}
          </h2>
          <div className="live-inline">
            <button
              className="ghost-btn"
              onClick={() =>
                setSelected(
                  fragments
                    .filter((f) => f.quality === "ready")
                    .map((f) => f.id),
                )
              }
            >
              选择已核对片段
            </button>
            <button className="ghost-btn" onClick={() => setSelected([])}>
              清除选择
            </button>
          </div>
          <label>
            发布标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={source.title}
            />
          </label>
          <label className="rag-check">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
            />
            发布完整原件（须选中全部片段）
          </label>
          <button
            className="primary-link"
            disabled={action.busy || !selected.length}
            onClick={() =>
              action.run(`/sources/${id}/publish`, {
                title: title || source.title,
                fragment_ids: selected,
                full_source: full,
              })
            }
          >
            确认并发布到课程学习
          </button>
          <hr />
          <div className="live-inline">
            <ModelSelect kind="chat" value={model} onChange={setModel} />
            <button
              className="ghost-btn"
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
            </button>
            <Link to="/teacher/knowledge">审核知识候选</Link>
          </div>
        </section>
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
        <label className="rag-check">
          <input
            type="checkbox"
            checked={selected}
            disabled={!editable || f.quality !== "ready"}
            onChange={(e) => onSelect(e.target.checked)}
          />
          {f.heading || location(f.locator)}
        </label>
        <span
          className={`rag-tag ${f.quality === "needs_review" ? "rag-warning" : ""}`}
        >
          {f.quality === "needs_review" ? "待人工核对" : "可使用"}
        </span>
      </div>
      {f.heading && <small>{location(f.locator)}</small>}
      {editing ? (
        <label>
          原文校正
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
          />
        </label>
      ) : (
        <p className="live-prose">{f.body}</p>
      )}
      {editable && (
        <div className="live-inline">
          <button
            className="ghost-btn"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "收起编辑" : "校正原文"}
          </button>
          {(editing || f.quality === "needs_review") && (
            <button
              className="ghost-btn"
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
            </button>
          )}
        </div>
      )}
    </article>
  );
}
export function KnowledgePage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Knowledge[]>("/knowledge");
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const action = useAction();
  const rows = query.data?.filter((k) => !filter || k.state === filter);
  return (
    <div className="live-page">
      <div className="workspace-heading">
        <div>
          <h1>知识库</h1>
        </div>
        {teacher && (
          <button
            className="primary-link"
            onClick={() => {
              setSelected(null);
              setCreating(true);
            }}
          >
            新建知识
          </button>
        )}
      </div>
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
          <Link to="/teacher/materials">从资料提炼</Link>
          <Link to="/teacher/retrieval">验证检索</Link>
        </div>
      )}
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      {query.isPending ? (
        <LoadingState />
      ) : !rows?.length ? (
        <section className="card-panel">
          <EmptyState title="暂无知识条目">
            {teacher
              ? "可从资料提炼候选，或手工添加有原文依据的知识。"
              : "教师确认并开放学习的知识会显示在这里。"}
          </EmptyState>
        </section>
      ) : (
        rows.map((k) => (
          <article key={k.id} className="card-panel rag-knowledge">
            <div className="workspace-heading">
              <h2>{k.title}</h2>
              <span className="rag-tag">
                {labels[k.state]} · v{k.version}
              </span>
            </div>
            <p className="live-meta">
              {kinds.find((v) => v.value === k.content_kind)?.label} ·{" "}
              {k.category}
              {teacher
                ? ` · ${k.use_for_learning ? "学习" : ""} ${k.use_for_grading ? "评分" : ""} · ${k.student_visible ? "学生可见" : "教师内部"}`
                : ""}
            </p>
            <p className="live-prose">{k.body}</p>
            {k.conditions && (
              <p>
                <strong>适用条件：</strong>
                {k.conditions}
              </p>
            )}
            <details>
              <summary>原文依据（{k.evidence.length}）</summary>
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
            </details>
            {teacher && (
              <div className="live-inline">
                {k.state === "confirmed" && k.use_for_grading && <Link className="ghost-btn" to={`/teacher/question-bank?new=1&knowledge_id=${k.id}`}>据此出题</Link>}
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setSelected(k);
                    setCreating(true);
                  }}
                >
                  {k.state === "draft" ? "编辑候选" : "建立新版本"}
                </button>
                {k.state === "draft" && (
                  <button
                    className="primary-link"
                    disabled={action.busy}
                    onClick={() =>
                      action.run(`/knowledge/${k.id}/state`, {
                        state: "confirmed",
                        edit_version: k.edit_version,
                      })
                    }
                  >
                    确认知识
                  </button>
                )}
                {k.state !== "archived" && (
                  <button
                    className="ghost-btn"
                    disabled={action.busy}
                    onClick={() => {
                      if (confirm("归档此知识条目？历史版本和引用仍保留。"))
                        void action.run(`/knowledge/${k.id}/state`, {
                          state: "archived",
                          edit_version: k.edit_version,
                        });
                    }}
                  >
                    归档
                  </button>
                )}
              </div>
            )}
          </article>
        ))
      )}
      {teacher && <JobsPanel />}
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
    <form
      className="live-form"
      onSubmit={async (e) => {
        e.preventDefault();
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
    >
      <DraftNotice {...draft} />
      <Feedback message={action.message} failed={action.failed} />
      <label>
        标题
        <input
          required
          value={v.title}
          onChange={(e) => change({ title: e.target.value })}
        />
      </label>
      <div className="rag-two-fields">
        <label>
          知识类型
          <Select
            value={v.content_kind}
            options={kinds}
            onChange={(content_kind) => change({ content_kind })}
          />
        </label>
        <label>
          分类
          <input
            value={v.category}
            onChange={(e) => change({ category: e.target.value })}
          />
        </label>
      </div>
      <label>
        知识正文
        <textarea
          required
          rows={6}
          value={v.body}
          onChange={(e) => change({ body: e.target.value })}
        />
      </label>
      <label>
        适用条件与限制
        <textarea
          rows={2}
          value={v.conditions}
          onChange={(e) => change({ conditions: e.target.value })}
        />
      </label>
      <label>
        关联课程知识点
        <Select
          mode="multiple"
          value={v.knowledge_point_ids}
          onChange={(knowledge_point_ids) => change({ knowledge_point_ids })}
          options={graph.data?.points.map((p) => ({
            value: p.id,
            label: p.title,
          }))}
        />
      </label>
      <label>
        相似或相关知识
        <Select
          mode="multiple"
          value={v.related_ids}
          onChange={(related_ids) => change({ related_ids })}
          options={all.data
            ?.filter((k) => k.id !== initial?.id)
            .map((k) => ({ value: k.id, label: k.title }))}
        />
      </label>
      <fieldset>
        <legend>原文依据</legend>
        {v.evidence.map((ev, i) => (
          <div key={i}>
            <label>
              逐字引用
              <textarea
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
            </label>
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                change({ evidence: v.evidence.filter((_, n) => n !== i) })
              }
            >
              移除这条依据
            </button>
          </div>
        ))}
        <label>
          来源文件
          <Select
            value={sourceID || undefined}
            onChange={setSourceID}
            options={sources.data
              ?.filter((s) => s.state === "active" && s.allow_derived)
              .map((s) => ({ value: s.id, label: s.title }))}
          />
        </label>
        <Feedback error={source.error} />
        {source.data?.fragments
          .filter((f) => f.quality === "ready")
          .map((f) => (
            <details key={f.id}>
              <summary>{f.heading || location(f.locator)}</summary>
              <p className="live-prose">{f.body}</p>
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  change({
                    evidence: [
                      ...v.evidence,
                      { source_id: sourceID, fragment_id: f.id, quote: f.body },
                    ],
                  })
                }
              >
                引用此片段
              </button>
            </details>
          ))}
      </fieldset>
      <div className="rag-checks">
        {(
          [
            ["student_visible", "学生可见"],
            ["use_for_learning", "用于学习检索"],
            ["use_for_grading", "用于评分依据"],
          ] as const
        ).map(([key, label]) => (
          <label className="rag-check" key={key}>
            <input
              type="checkbox"
              checked={v[key]}
              onChange={(e) => change({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <button
        className="primary-link"
        disabled={action.busy || !v.evidence.length}
      >
        保存待审核版本
      </button>
    </form>
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
      <div className="workspace-heading">
        <h1>{teacher ? "检索与问答验证" : "资料问答"}</h1>
      </div>
      <form
        className="card-panel live-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setAnswer(null);
          const r = await action.run<{ hits: Hit[]; mode: string }>(
            "/retrieval",
            { query, purpose },
          );
          if (r) setResult(r);
        }}
      >
        <label>
          课程问题
          <textarea
            required
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {teacher && (
          <div className="live-inline">
            <label>
              检索用途
              <Select
                value={purpose}
                onChange={setPurpose}
                options={[
                  { value: "learning", label: "学习资料与知识" },
                  { value: "grading", label: "评分依据" },
                ]}
              />
            </label>
            <ModelSelect kind="chat" value={model} onChange={setModel} />
          </div>
        )}
        <div className="live-inline">
          <button className="primary-link" disabled={action.busy}>
            检索依据
          </button>
          <button
            type="button"
            className="ghost-btn"
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
          >
            {action.busy ? "处理中…" : "根据资料回答"}
          </button>
        </div>
        <Feedback message={action.message} failed={action.failed} />
      </form>
      {answer && (
        <section className="card-panel">
          <h2>AI回答</h2>
          <GroundedAnswer answer={answer} />
        </section>
      )}
      {result && (
        <section className="card-panel">
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
        </section>
      )}
    </div>
  );
}
