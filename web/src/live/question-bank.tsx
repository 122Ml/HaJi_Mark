import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Pagination, Tabs } from "antd";
import {
  PageHeader,
  LoadingState,
  EmptyState,
  ErrorState,
  StatusTag,
} from "../shared/ui";
import {
  Link,
  Feedback,
  useAction,
  useLiveQuery,
  useLearning,
  names,
} from "./context";
import { AIDraft, FrozenEvidence, type Hit } from "./knowledge";
import { DraftNotice, useEditorDraft } from "./editing";
import type { Criterion, RubricVersion } from "./rubrics";
import type { Point } from "./course";
import {
  ContentLinks,
  DecisionHistory,
  type TopicData,
} from "./content-topics";
import { RichContent } from "./content-render";
import { PaperImport } from "./material-assist";

export interface BankVersion {
  id: string;
  bank_id: string;
  title: string;
  prompt: string;
  type: string;
  version: number;
  max_score: number;
  state: string;
  requirements: string;
  reference_answer: string;
  reference_state: string;
  knowledge_point_id: string | null;
  options: string[];
  correct_answer: string;
  evidence_refs: Hit[];
  archived?: boolean;
}
type BankDetail = {
  entry: { id: string; archived: boolean };
  versions: BankVersion[];
  uses: {
    question_id: string;
    bank_question_version_id: string;
    assignment_id: string;
    title: string;
    status: string;
    bound_rubric_id: string | null;
  }[];
};
type Candidate = {
  title: string;
  prompt: string;
  reference_answer: string;
  criteria: Criterion[];
  max_score?: number;
};
function importedCandidates(data: unknown): Candidate[] {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "questions" in data
      ? data.questions
      : [data];
  if (!Array.isArray(raw) || !raw.length || raw.length > 30)
    throw Error("需要1至30个题目对象");
  return raw.map((q) => {
    if (
      !q ||
      typeof q !== "object" ||
      typeof q.title !== "string" ||
      typeof q.prompt !== "string" ||
      (q.reference_answer !== undefined &&
        typeof q.reference_answer !== "string")
    )
      throw Error("题目须含文本title、prompt，reference_answer也须为文本");
    if (
      q.max_score !== undefined &&
      (!Number.isInteger(q.max_score) || q.max_score < 1 || q.max_score > 10000)
    )
      throw Error("max_score须为1至10000的整数");
    const criteria = q.criteria ?? [];
    if (
      !Array.isArray(criteria) ||
      criteria.length > 30 ||
      criteria.some(
        (p) =>
          !p ||
          typeof p !== "object" ||
          typeof p.id !== "string" ||
          typeof p.title !== "string" ||
          typeof p.rule !== "string" ||
          !Number.isInteger(p.max_score) ||
          p.max_score < 1 ||
          [
            "requirement",
            "partial_credit",
            "acceptable_answers",
            "error_conditions",
          ].some((k) => p[k] !== undefined && typeof p[k] !== "string") ||
          (p.evidence_ids !== undefined &&
            (!Array.isArray(p.evidence_ids) ||
              p.evidence_ids.some((id: unknown) => typeof id !== "string"))),
      )
    )
      throw Error("criteria须为完整评分点数组，evidence_ids须为文本数组");
    return {
      title: q.title,
      prompt: q.prompt,
      reference_answer: q.reference_answer || "",
      criteria,
      max_score: q.max_score,
    };
  });
}
const blankPoint = (n: number, max = 1): Criterion => ({
  id: `D${n}`,
  title: "",
  max_score: max,
  rule: "",
  evidence_ids: [],
});
const typeNames: Record<string, string> = {
  subjective: "文本主观题",
  code: "代码文本题",
  quiz: "单选题",
};

function BankProvenance({ id }: { id: string }) {
  const q = useLiveQuery<{
    decisions: { id: string; kind: string; reason: string; created_at: string }[];
    assets: { id: string }[];
  }>(`/question-bank/versions/${id}/provenance`);
  const { course } = useLearning();
  return (
    <details>
      <summary>题图与原始来源</summary>
      <Feedback error={q.error} />
      {q.data?.assets.map((a) => (
        <img
          className="asset-preview"
          key={a.id}
          alt="确认后的题图"
          src={`/api/v1/learning/courses/${course!.id}/assets/${a.id}/file`}
        />
      ))}
      {q.data?.decisions.map((d) => (
        <article key={d.id}>
          <strong>
            {d.kind === "paper_adopt" ? "原卷拆题采纳" : "AI草稿采纳"}
          </strong>
          <p>{d.reason}</p>
          <small>{new Date(d.created_at).toLocaleString()}</small>
        </article>
      ))}
    </details>
  );
}

export function QuestionBankPage() {
  const [params, setParams] = useSearchParams();
  const paperOpen = params.has("paper_source") || params.get("paper") === "1";
  const paperSource = params.get("paper_source") || "";
  const bankID = params.get("bank") || "";
  const linked = useLiveQuery<BankVersion>(
    `/question-bank/versions/${params.get("bank_version")}`,
    !!params.get("bank_version") && !bankID,
  );
  const activeBank = bankID || linked.data?.bank_id || "";
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [type, setType] = useState(""),
    [pointID, setPoint] = useState(""),
    [topicID, setTopic] = useState("");
  const topics = useLiveQuery<TopicData>("/topics"),
    points = useLiveQuery<{ points: Point[] }>("");
  const query = useLiveQuery<{ items: BankVersion[]; total: number }>(
    `/question-bank/search?${new URLSearchParams({ search, state, type, point_id: pointID, topic_id: topicID, page: String(page), page_size: "10" })}`,
  );
  const list = query.data?.items || [];
  function select(id: string) {
    const next = new URLSearchParams(params);
    next.set("bank", id);
    next.delete("version");
    setParams(next);
    setCreating(false);
  }
  return (
    <div className="live-page">
      <PageHeader
        title="题库"
        actions={
          <>
          <button className="ghost-btn" onClick={() => { const next = new URLSearchParams(params); next.set("paper", "1"); setParams(next); }}>整卷导入</button>
          <button
            className="primary-link"
            onClick={() => {
              setCreating(true);
              const next = new URLSearchParams(params);
              next.delete("bank");
              setParams(next);
            }}
          >
            新建题目
          </button>
          </>
        }
      />
      <Drawer title="整卷导入" aria-label="整卷导入" open={paperOpen} width={900} destroyOnHidden onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("paper_source");
        next.delete("paper");
        setParams(next);
      }}>
        <PaperSource selected={paperSource} onSelect={(id) => {
          const next = new URLSearchParams(params);
          next.set("paper_source", id);
          setParams(next);
        }} />
      </Drawer>
      {query.error ? (
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <LoadingState />
      ) : (
        <>
          <div className="live-inline">
            <label>
              搜索题目
              <input
                aria-label="搜索题目"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              题目状态
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部</option>
                <option value="draft">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="archived">已停用</option>
              </select>
            </label>
            <label>
              题型
              <select
                aria-label="筛选题型"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部</option>
                {Object.entries(typeNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              知识点
              <select
                aria-label="筛选知识点"
                value={pointID}
                onChange={(e) => {
                  setPoint(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部</option>
                {points.data?.points
                  .filter((p) => p.kind === "point")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              专题
              <select
                aria-label="筛选专题"
                value={topicID}
                onChange={(e) => {
                  setTopic(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部</option>
                {topics.data?.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <span className="live-meta">{query.data?.total || 0} 道题目</span>
          </div>
          {creating && (
            <section className="card-panel">
              <BankEditor
                onSaved={select}
                onCancel={() => setCreating(false)}
              />
            </section>
          )}
          <Feedback error={linked.error} />
          {!creating && activeBank && (
            <BankDetailView key={activeBank} bankID={activeBank} />
          )}
          <section className="card-panel">
            {!list.length ? (
              <EmptyState title="暂无匹配题目">
                新建题目，或选择资料与知识后由 AI 起草。
              </EmptyState>
            ) : (
              list.map((q) => (
                <article className="live-row" key={q.bank_id}>
                  <div>
                    <h2>{q.title}</h2>
                    <p className="live-meta">
                      {typeNames[q.type]} · v{q.version} · {q.max_score}分 ·{" "}
                      <StatusTag
                        status={q.archived ? "closed" : q.state}
                        label={q.archived ? "已停用" : names[q.state]}
                      />
                    </p>
                  </div>
                  <button
                    className="ghost-btn"
                    onClick={() => select(q.bank_id)}
                  >
                    管理题目
                  </button>
                </article>
              ))
            )}
            <Pagination
              responsive
              showLessItems
              current={page}
              total={query.data?.total || 0}
              pageSize={10}
              showSizeChanger={false}
              onChange={setPage}
            />
          </section>
        </>
      )}
    </div>
  );
}

function PaperSource({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const sources = useLiveQuery<{ id: string; title: string; state: string; fragment_count: number }[]>("/sources");
  const source = useLiveQuery<{ source: { state: string }; fragments: { id: string; body: string }[] }>(`/sources/${selected}`, !!selected);
  return <div className="live-form">
    <Feedback error={sources.error || source.error} />
    <label>试卷原件<select aria-label="试卷原件" value={selected} onChange={(e) => onSelect(e.target.value)}>
      <option value="">选择已解析的原件</option>
      {sources.data?.filter((s) => s.state === "active" && s.fragment_count > 0).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
    </select></label>
    <Link to={selected ? `/teacher/materials?source=${selected}` : "/teacher/materials"}>导入或核对原件</Link>
    {selected && source.isPending && <LoadingState />}
    {source.data?.source.state === "active" && source.data.fragments.length > 0 && <PaperImport key={selected} id={selected} fragments={source.data.fragments} />}
  </div>;
}

function BankDetailView({ bankID }: { bankID: string }) {
  const query = useLiveQuery<BankDetail>(`/question-bank/${bankID}`);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [editRefs, setEditRefs] = useState<Hit[] | null>(null);
  const action = useAction();
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const { entry, versions, uses } = query.data;
  const v =
    versions.find(
      (v) => v.id === (params.get("version") || params.get("bank_version")),
    ) || versions[0];
  if (!v) return null;
  return (
    <section className="card-panel">
      <div className="section-head">
        <h2>{v.title}</h2>
        <div className="live-inline">
          <label>
            题目版本
            <select
              value={v.id}
              onChange={(e) => {
                if (editing && !confirm("切换版本？未保存编辑可在返回时恢复。"))
                  return;
                const next = new URLSearchParams(params);
                next.set("version", e.target.value);
                setParams(next);
                setEditing(false);
              }}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {names[v.state]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-btn"
            disabled={action.busy || entry.archived}
            onClick={() => {
              setEditRefs(null);
              setEditing(!editing);
            }}
          >
            {editing ? "收起编辑" : "另建题目版本"}
          </button>
          <button
            className="ghost-btn"
            disabled={action.busy}
            onClick={() => {
              if (
                confirm(
                  entry.archived
                    ? "恢复此题目？"
                    : "停用后不能加入新作业，历史作业保留。继续？",
                )
              )
                void action.run(`/question-bank/${bankID}/archive`, {
                  archived: !entry.archived,
                });
            }}
          >
            {entry.archived ? "恢复题目" : "停用题目"}
          </button>
        </div>
      </div>
      <Feedback message={action.message} failed={action.failed} />
      <ContentLinks kind="question" id={v.id} />
      <DecisionHistory id={v.id} />
      <BankProvenance id={v.id} />
      {editing ? (
        <BankEditor
          key={v.id}
          initial={editRefs ? { ...v, evidence_refs: editRefs } : v}
          onSaved={(_, id) => {
            const next = new URLSearchParams(params);
            next.set("version", id);
            setParams(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Tabs
          key={v.id}
          items={[
            {
              key: "question",
              label: "题目与参考解答",
              children: (
                <>
                  <RichContent text={v.prompt} />
                  <p className="live-meta">
                    {typeNames[v.type]} · 满分 {v.max_score}
                  </p>
                  {v.requirements && (
                    <p className="live-prose">考查要求：{v.requirements}</p>
                  )}
                  {v.options.map((o, i) => (
                    <p key={i}>{o}</p>
                  ))}
                  {v.type === "quiz" && <p>正确答案：{v.correct_answer}</p>}
                  <div className="live-inline">
                    <StatusTag
                      status={v.state}
                      label={`题目${names[v.state]}`}
                    />
                    {v.state === "draft" && (
                      <button
                        className="primary-link"
                        disabled={action.busy || entry.archived}
                        onClick={() =>
                          void action.run(
                            `/question-bank/versions/${v.id}/confirm`,
                          )
                        }
                      >
                        确认题目
                      </button>
                    )}
                  </div>
                  {v.reference_answer && (
                    <>
                      <h3>参考解答</h3>
                      <p className="live-prose">{v.reference_answer}</p>
                      <div className="live-inline">
                        <StatusTag
                          status={v.reference_state}
                          label={`解答${names[v.reference_state]}`}
                        />
                        {v.reference_state === "draft" && (
                          <button
                            className="ghost-btn"
                            disabled={action.busy || entry.archived}
                            onClick={() =>
                              void action.run(
                                `/question-bank/versions/${v.id}/reference/confirm`,
                              )
                            }
                          >
                            确认参考解答
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              ),
            },
            {
              key: "evidence",
              label: "知识与来源",
              children: (
                <BankAnalysis
                  version={v}
                  archived={entry.archived}
                  onRevise={(refs) => {
                    setEditRefs(refs);
                    setEditing(true);
                  }}
                />
              ),
            },
            {
              key: "rubric",
              label: "评分标准",
              children:
                v.type === "quiz" ? (
                  <p>使用本版本固定的选项与教师答案规则。</p>
                ) : (
                  <BankStandards
                    key={v.id}
                    version={v}
                    archived={entry.archived}
                  />
                ),
            },
            {
              key: "uses",
              label: `使用记录（${uses.length}）`,
              children: uses.length ? (
                uses.map((u) => (
                  <article className="live-row" key={u.question_id}>
                    <div>
                      <Link to={`/teacher/homework/${u.assignment_id}`}>
                        {u.title}
                      </Link>
                      <p className="live-meta">
                        题目 v
                        {
                          versions.find(
                            (v) => v.id === u.bank_question_version_id,
                          )?.version
                        }{" "}
                        · {names[u.status]}
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState title="尚未用于作业" />
              ),
            },
          ]}
        />
      )}
    </section>
  );
}

export function EvidencePicker({
  value,
  onChange,
}: {
  value: Hit[];
  onChange: (hits: Hit[]) => void;
}) {
  const [params] = useSearchParams();
  const sources =
    useLiveQuery<{ id: string; title: string; state: string }[]>("/sources");
  const knowledge =
    useLiveQuery<
      { id: string; title: string; state: string; use_for_grading: boolean }[]
    >("/knowledge");
  const [scope, setScope] = useState(
    params.get("source_id")
      ? `s:${params.get("source_id")}`
      : params.get("knowledge_id")
        ? `k:${params.get("knowledge_id")}`
        : "",
  );
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const action = useAction();
  async function find(e: FormEvent) {
    e.preventDefault();
    const data = await action.run<{ hits: Hit[] }>("/question-bank/evidence", {
      query: search,
      source_id: scope.startsWith("s:") ? scope.slice(2) : "",
      knowledge_id: scope.startsWith("k:") ? scope.slice(2) : "",
    });
    if (data) setHits(data.hits);
  }
  return (
    <div className="bank-evidence">
      <form className="live-form" onSubmit={find}>
        <div className="live-inline">
          <label>
            依据范围
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setHits([]);
              }}
            >
              <option value="">课程内检索</option>
              {sources.data
                ?.filter((s) => s.state === "active")
                .map((s) => (
                  <option key={s.id} value={`s:${s.id}`}>
                    资料：{s.title}
                  </option>
                ))}
              {knowledge.data
                ?.filter((k) => k.state === "confirmed" && k.use_for_grading)
                .map((k) => (
                  <option key={k.id} value={`k:${k.id}`}>
                    知识：{k.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            检索词
            <input
              aria-label="依据检索词"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              required={!scope}
            />
          </label>
          <button className="ghost-btn" disabled={action.busy}>
            查找依据
          </button>
        </div>
      </form>
      <Feedback
        error={sources.error || knowledge.error}
        message={action.message}
        failed={action.failed}
      />
      {hits.length > 0 && (
        <details open>
          <summary>候选依据（{hits.length}）</summary>
          {hits.map((h) => (
            <article className="rag-hit" key={h.id}>
              <label className="rag-check">
                <input
                  type="checkbox"
                  checked={value.some((v) => v.id === h.id)}
                  disabled={
                    !value.some((v) => v.id === h.id) && value.length >= 8
                  }
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...value, h]
                        : value.filter((v) => v.id !== h.id),
                    )
                  }
                />
                {h.title} · {h.heading}
              </label>
              <p className="live-prose">{h.body}</p>
            </article>
          ))}
        </details>
      )}
      {value.length > 0 && (
        <>
          <p className="live-meta">已选 {value.length} 条</p>
          {value.map((h) => (
            <div className="live-inline" key={h.id}>
              <span>
                {h.title} · {h.heading}
              </span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onChange(value.filter((v) => v.id !== h.id))}
              >
                移除此依据
              </button>
            </div>
          ))}
          <FrozenEvidence sources={value} />
        </>
      )}
    </div>
  );
}

function CriteriaEditor({
  value,
  onChange,
  maxScore,
  refs,
}: {
  value: Criterion[];
  onChange: (points: Criterion[]) => void;
  maxScore: number;
  refs: Hit[];
}) {
  function update(i: number, patch: Partial<Criterion>) {
    onChange(value.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  }
  return (
    <div className="live-form">
      {value.map((p, i) => (
        <fieldset key={i}>
          <legend>评分点 {i + 1}</legend>
          <div className="rag-two-fields">
            <label>
              编号
              <input
                required
                value={p.id}
                maxLength={100}
                onChange={(e) => update(i, { id: e.target.value })}
              />
            </label>
            <label>
              评分点满分
              <input
                required
                type="number"
                min={1}
                max={maxScore}
                value={p.max_score}
                onChange={(e) =>
                  update(i, { max_score: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            评分点名称
            <input
              required
              value={p.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
          </label>
          <label>
            给分规则
            <textarea
              required
              value={p.rule}
              onChange={(e) => update(i, { rule: e.target.value })}
            />
          </label>
          <details>
            <summary>部分分、替代表达与依据</summary>
            {(
              [
                ["requirement", "对应考查要求"],
                ["partial_credit", "部分分条件"],
                ["acceptable_answers", "可接受表达或替代解法"],
                ["error_conditions", "错误或矛盾条件"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  value={p[key] || ""}
                  onChange={(e) => update(i, { [key]: e.target.value })}
                />
              </label>
            ))}
            {refs.map((h) => (
              <label className="rag-check" key={h.id}>
                <input
                  type="checkbox"
                  checked={p.evidence_ids?.includes(h.id) || false}
                  onChange={(e) =>
                    update(i, {
                      evidence_ids: e.target.checked
                        ? [...(p.evidence_ids || []), h.id]
                        : (p.evidence_ids || []).filter((id) => id !== h.id),
                    })
                  }
                />
                {h.title} · {h.heading}
              </label>
            ))}
          </details>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            删除评分点
          </button>
        </fieldset>
      ))}
      <div className="live-inline">
        <button
          type="button"
          className="ghost-btn"
          disabled={value.length >= 30}
          onClick={() => onChange([...value, blankPoint(value.length + 1)])}
        >
          添加评分点
        </button>
        <span>
          分值合计 {value.reduce((s, p) => s + p.max_score, 0)} / {maxScore}
        </span>
      </div>
    </div>
  );
}

function BankEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: BankVersion;
  onSaved: (bankID: string, versionID: string) => void;
  onCancel: () => void;
}) {
  const { course } = useLearning();
  const action = useAction();
  const points = useLiveQuery<{ points: Point[] }>("");
  const [params] = useSearchParams();
  const draft = useEditorDraft(`bank:${course?.id}:${initial?.id || "new"}`, {
    title: initial?.title || "",
    prompt: initial?.prompt || "",
    type: initial?.type || "subjective",
    max_score: initial?.max_score || 10,
    requirements: initial?.requirements || "",
    reference_answer: initial?.reference_answer || "",
    knowledge_point_id: initial?.knowledge_point_id || "",
    options: initial?.options || [],
    correct_answer: initial?.correct_answer || "",
    refs: initial?.evidence_refs || ([] as Hit[]),
    criteria: [] as Criterion[],
    ai_job_id: "",
  });
  const v = draft.value;
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidate, setCandidate] = useState(0);
  const [count, setCount] = useState(1);
  const [error, setError] = useState("");
  function change(patch: Partial<typeof v>) {
    draft.change((old) => ({ ...old, ...patch }));
  }
  function load(q: Candidate) {
    change({
      title: q.title,
      prompt: q.prompt,
      reference_answer: q.reference_answer,
      criteria: q.criteria || [],
      type: "subjective",
      ...(q.max_score ? { max_score: q.max_score } : {}),
    });
  }
  function adopt(output: Record<string, unknown>, id: string) {
    if (draft.dirty && !confirm("载入AI候选并替换当前编辑？")) return;
    const qs = output.questions as Candidate[];
    setCandidates(qs);
    setCandidate(0);
    load(qs[0]);
    change({ refs: output.evidence_refs as Hit[], ai_job_id: id });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const snapshot = draft.value;
    const saved = await action.run<BankVersion>(
      initial ? `/question-bank/${initial.bank_id}/versions` : "/question-bank",
      { ...v, evidence_ids: v.refs.map((h) => h.id) },
    );
    if (saved) {
      draft.saved(snapshot);
      onSaved(saved.bank_id, saved.id);
    }
  }
  return (
    <fieldset className="bank-editor" disabled={action.busy}>
      <h2>{initial ? "另建题目版本" : "新建题目"}</h2>
      <DraftNotice {...draft} />
      <details
        open={
          params.has("source_id") || params.has("knowledge_id") || undefined
        }
      >
        <summary>AI 辅助出题与依据选择</summary>
        <label>
          出题要求
          <textarea
            aria-label="AI出题要求"
            value={v.requirements}
            onChange={(e) => change({ requirements: e.target.value })}
          />
        </label>
        <label>
          候选数量
          <input
            type="number"
            min={1}
            max={3}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <EvidencePicker value={v.refs} onChange={(refs) => change({ refs })} />
        <AIDraft
          kind="question_generate"
          target={{
            requirements: v.requirements,
            max_score: v.max_score,
            count,
            evidence_ids: v.refs.map((h) => h.id),
          }}
          onAdopt={adopt}
        />
        {candidates.length > 1 && (
          <label>
            选择候选
            <select
              value={candidate}
              onChange={(e) => {
                if (!confirm("切换候选并替换题目编辑内容？")) return;
                const i = Number(e.target.value);
                setCandidate(i);
                load(candidates[i]);
              }}
            >
              {candidates.map((q, i) => (
                <option value={i} key={i}>
                  {q.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
      <label>
        导入题目 JSON
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const input = e.currentTarget;
            const f = input.files?.[0];
            if (!f) return;
            setError("");
            try {
              if (f.size > 1024 * 1024) throw Error("文件不能超过1MB");
              const items = importedCandidates(JSON.parse(await f.text()));
              if (draft.dirty && !confirm("载入导入内容并替换当前编辑？"))
                return;
              setCandidates(items);
              setCandidate(0);
              load(items[0]);
            } catch (err) {
              setError(err instanceof Error ? err.message : "导入失败");
            } finally {
              input.value = "";
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      <form className="live-form" onSubmit={save}>
        <label>
          题目名称
          <input
            required
            value={v.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <div className="rag-two-fields">
          <label>
            题型
            <select
              value={v.type}
              onChange={(e) => change({ type: e.target.value, criteria: [] })}
            >
              {Object.entries(typeNames).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            满分
            <input
              required
              type="number"
              min={1}
              max={10000}
              value={v.max_score}
              onChange={(e) => change({ max_score: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          题干与条件
          <textarea
            required
            aria-label="题干与条件"
            rows={5}
            value={v.prompt}
            onChange={(e) => change({ prompt: e.target.value })}
          />
        </label>
        <label>
          考查要求
          <textarea
            value={v.requirements}
            onChange={(e) => change({ requirements: e.target.value })}
          />
        </label>
        <label>
          参考解答
          <textarea
            aria-label="参考解答"
            rows={4}
            value={v.reference_answer}
            onChange={(e) => change({ reference_answer: e.target.value })}
          />
        </label>
        {v.type === "quiz" && (
          <>
            <label>
              选项（每行一个）
              <textarea
                required
                value={v.options.join("\n")}
                onChange={(e) =>
                  change({ options: e.target.value.split("\n") })
                }
              />
            </label>
            <label>
              正确答案
              <select
                required
                value={v.correct_answer}
                onChange={(e) => change({ correct_answer: e.target.value })}
              >
                <option value="">选择正确答案</option>
                {v.options.filter(Boolean).map((o, i) => (
                  <option key={i}>{o}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          关联知识点
          <select
            value={v.knowledge_point_id}
            onChange={(e) => change({ knowledge_point_id: e.target.value })}
          >
            <option value="">暂不关联</option>
            {points.data?.points
              .filter((p) => p.kind === "point")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
        <FrozenEvidence sources={v.refs} />
        {v.criteria.length > 0 && (
          <>
            <h3>随题保存的标准草稿</h3>
            <CriteriaEditor
              value={v.criteria}
              onChange={(criteria) => change({ criteria })}
              maxScore={v.max_score}
              refs={v.refs}
            />
          </>
        )}
        <Feedback message={action.message} failed={action.failed} />
        <div className="live-inline">
          <button className="primary-link" disabled={action.busy}>
            保存题目草稿
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              if (!draft.dirty || confirm("收起未保存编辑？返回时可恢复。"))
                onCancel();
            }}
          >
            取消
          </button>
        </div>
      </form>
    </fieldset>
  );
}

function BankAnalysis({
  version: v,
  archived,
  onRevise,
}: {
  version: BankVersion;
  archived: boolean;
  onRevise: (refs: Hit[]) => void;
}) {
  const [refs, setRefs] = useState(v.evidence_refs);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(
    null,
  );
  return (
    <div>
      <EvidencePicker value={refs} onChange={setRefs} />
      <AIDraft
        kind="question_analyze"
        target={{ question_id: v.id, evidence_ids: refs.map((h) => h.id) }}
        onAdopt={setAnalysis}
      />
      {analysis && (
        <>
          <h3>题目分析建议</h3>
          {(analysis.requirements as string[])?.map((s, i) => (
            <p key={`r${i}`}>{s}</p>
          ))}
          {(analysis.issues as string[])?.map((s, i) => (
            <p key={`i${i}`}>待澄清：{s}</p>
          ))}
          {(analysis.associations as { reason: string }[])?.map((s, i) => (
            <p key={`a${i}`}>关联：{s.reason}</p>
          ))}
          <p className="live-meta">
            修改题干或保存新的知识关联，请另建题目版本。
          </p>
        </>
      )}
      <button
        className="ghost-btn"
        disabled={archived}
        onClick={() => onRevise(refs)}
      >
        以所选依据另建题目版本
      </button>
      <FrozenEvidence sources={v.evidence_refs} />
    </div>
  );
}

function BankStandards({
  version: v,
  archived,
}: {
  version: BankVersion;
  archived: boolean;
}) {
  const query = useLiveQuery<RubricVersion[]>(
    `/question-bank/versions/${v.id}/rubrics`,
  );
  const action = useAction();
  const draft = useEditorDraft(`bank-rubric:${v.id}`, {
    criteria: [blankPoint(1, v.max_score)],
    refs: v.evidence_refs,
    ai_job_id: "",
  });
  const [editing, setEditing] = useState(false);
  const { criteria, refs } = draft.value;
  const total = criteria.reduce((s, p) => s + p.max_score, 0);
  return (
    <div>
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <button
        className="ghost-btn"
        disabled={archived}
        onClick={() => setEditing(!editing)}
      >
        {editing ? "收起标准编辑" : "新建标准版本"}
      </button>
      {editing && (
        <>
          <DraftNotice {...draft} />
          <EvidencePicker
            value={refs}
            onChange={(refs) => draft.change((v) => ({ ...v, refs }))}
          />
          <AIDraft
            kind="bank_rubric"
            target={{ question_id: v.id, evidence_ids: refs.map((h) => h.id) }}
            onAdopt={(output, id) => {
              if (draft.dirty && !confirm("载入AI标准并替换当前编辑？")) return;
              draft.change({
                criteria: output.criteria as Criterion[],
                refs: output.evidence_refs as Hit[],
                ai_job_id: id,
              });
            }}
          />
          <form
            className="live-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const snapshot = draft.value;
              const saved = await action.run(
                `/question-bank/versions/${v.id}/rubrics`,
                {
                  criteria,
                  evidence_ids: refs.map((h) => h.id),
                  ai_job_id: draft.value.ai_job_id,
                },
              );
              if (saved && draft.saved(snapshot)) setEditing(false);
            }}
          >
            <CriteriaEditor
              value={criteria}
              onChange={(criteria) => draft.change((v) => ({ ...v, criteria }))}
              maxScore={v.max_score}
              refs={refs}
            />
            <button
              className="primary-link"
              disabled={
                action.busy ||
                archived ||
                !criteria.length ||
                total !== v.max_score
              }
            >
              保存标准草稿
            </button>
          </form>
        </>
      )}
      {query.isPending && <LoadingState />}
      {query.data?.map((r) => (
        <article className="live-revision" key={r.id}>
          <h3>
            标准 v{r.version} · {names[r.state]}
          </h3>
          {r.criteria.map((p) => (
            <div className="rag-hit" key={p.id}>
              <strong>
                {p.id} {p.title} · {p.max_score}分
              </strong>
              <p>{p.rule}</p>
              {p.requirement && <p>考查要求：{p.requirement}</p>}
              {p.partial_credit && <p>部分分：{p.partial_credit}</p>}
              {p.acceptable_answers && (
                <p>可接受表达：{p.acceptable_answers}</p>
              )}
              {p.error_conditions && <p>错误条件：{p.error_conditions}</p>}
              {p.evidence_ids?.map((id) => (
                <p className="live-meta" key={id}>
                  依据：
                  {r.evidence_refs?.find((h) => h.id === id)?.title ||
                    "引用已保留"}
                </p>
              ))}
            </div>
          ))}
          <FrozenEvidence sources={r.evidence_refs} />
          <div className="live-inline">
            {r.state === "draft" && (
              <button
                className="primary-link"
                disabled={action.busy || archived}
                onClick={() => void action.run(`/rubrics/${r.id}/confirm`)}
              >
                确认标准 v{r.version}
              </button>
            )}
            <button
              className="ghost-btn"
              disabled={archived}
              onClick={() => {
                if (draft.dirty && !confirm("复制此标准替换当前编辑？")) return;
                draft.change({
                  criteria: r.criteria,
                  refs: r.evidence_refs || [],
                  ai_job_id: "",
                });
                setEditing(true);
              }}
            >
              复制到新标准版本
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function BankQuestionPicker({
  open,
  onClose,
  onSelect,
  type,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (v: BankVersion, rubric?: RubricVersion) => void;
  type: string;
}) {
  const list = useLiveQuery<BankVersion[]>("/question-bank", open);
  const [bank, setBank] = useState("");
  const [version, setVersion] = useState("");
  const [rubric, setRubric] = useState("");
  const detail = useLiveQuery<BankDetail>(
    `/question-bank/${bank}`,
    !!bank && open,
  );
  const versions =
    detail.data?.versions.filter(
      (v) =>
        v.state === "confirmed" &&
        (v.reference_state === "confirmed" || !v.reference_answer) &&
        v.type === type,
    ) || [];
  const current = versions.find((v) => v.id === version) || versions[0];
  const rubrics = useLiveQuery<RubricVersion[]>(
    `/question-bank/versions/${current?.id}/rubrics`,
    !!current && open && type !== "quiz",
  );
  const confirmed = rubrics.data?.filter((r) => r.state === "confirmed") || [];
  const selected = confirmed.find((r) => r.id === rubric) || confirmed[0];
  return (
    <Drawer
      title="从题库选题"
      aria-label="从题库选题"
      open={open}
      onClose={onClose}
      width={720}
    >
      <Feedback error={list.error || detail.error || rubrics.error} />
      <div className="live-form">
        <label>
          题目
          <select
            aria-label="题目"
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setVersion("");
              setRubric("");
            }}
          >
            <option value="">选择题目</option>
            {list.data
              ?.filter((v) => !v.archived)
              .map((v) => (
                <option key={v.bank_id} value={v.bank_id}>
                  {v.title}
                </option>
              ))}
          </select>
        </label>
        {bank && (
          <label>
            确认版本
            <select
              aria-label="确认版本"
              value={current?.id || ""}
              onChange={(e) => {
                setVersion(e.target.value);
                setRubric("");
              }}
            >
              <option value="">请选择</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {v.max_score}分
                </option>
              ))}
            </select>
          </label>
        )}
        {current && (
          <>
            <p className="live-prose">{current.prompt}</p>
            {type !== "quiz" && (
              <label>
                确认标准
                <select
                  aria-label="确认标准"
                  value={selected?.id || ""}
                  onChange={(e) => setRubric(e.target.value)}
                >
                  <option value="">请选择</option>
                  {confirmed.map((r) => (
                    <option key={r.id} value={r.id}>
                      标准 v{r.version}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <FrozenEvidence
              sources={selected?.evidence_refs || current.evidence_refs}
            />
            <button
              className="primary-link"
              disabled={
                (type !== "quiz" && !selected) ||
                !!detail.error ||
                !!rubrics.error
              }
              onClick={() => {
                onSelect(current, selected);
                onClose();
              }}
            >
              加入作业
            </button>
          </>
        )}
        {bank && !detail.isPending && !versions.length && (
          <p>此题尚无可用确认版本，请先在题库审定题目及参考解答。</p>
        )}
      </div>
    </Drawer>
  );
}
