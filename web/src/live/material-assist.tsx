import { useState } from "react";
import { Select } from "antd";
import { Feedback, Link, useAction, useLiveQuery } from "./context";
import { WorkflowJob } from "./workflow-job";
import { type TopicData } from "./content-topics";
import { RichContent } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";

export function URLImport({ onDone }: { onDone: () => void }) {
  const [url, setURL] = useState(""),
    [title, setTitle] = useState(""),
    [note, setNote] = useState(""),
    [allow, setAllow] = useState(false),
    action = useAction();
  return (
    <form
      className="live-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await action.run("/sources/url", {
            url,
            title,
            source_note: note,
            allow_derived: allow,
          })
        )
          onDone();
      }}
    >
      <label>
        公开网页／直链文档
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setURL(e.target.value)}
        />
      </label>
      <label>
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        来源说明
        <textarea
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="rag-check">
        <input
          type="checkbox"
          checked={allow}
          onChange={(e) => setAllow(e.target.checked)}
        />
        允许知识提炼
      </label>
      <Feedback message={action.message} failed={action.failed} />
      <button className="primary-link" disabled={action.busy}>
        {action.busy ? "保存快照中…" : "导入并解析"}
      </button>
    </form>
  );
}
type Suggestions = {
  outline: { title: string; fragment_ids: string[] }[];
  topic_ids: string[];
  new_topic_names: string[];
  tags: string[];
  knowledge_point_ids: string[];
  similar_knowledge_ids: string[];
  reason: string;
};
export function SourceSuggestions({ id }: { id: string }) {
  const action = useAction(),
    topics = useLiveQuery<TopicData>("/topics"),
    known = useLiveQuery<{ id: string; title: string }[]>("/knowledge"),
    points = useLiveQuery<{
      points: { id: string; title: string; kind: string }[];
    }>("");
  const [candidate, setCandidate] = useState<Suggestions | null>(null),
    [job, setJob] = useState("");
  const [outline, setOutline] = useState<string[]>([]),
    [topicIDs, setTopics] = useState<string[]>([]),
    [newTopics, setNewTopics] = useState<string[]>([]),
    [tags, setTags] = useState<string[]>([]),
    [pointIDs, setPoints] = useState<string[]>([]);
  return (
    <details className="card-panel">
      <summary>目录与归类建议</summary>
      <WorkflowJob
        kind="source_suggest"
        target={{ source_id: id }}
        onAdopt={(o, j) => {
          const s = o as unknown as Suggestions;
          setCandidate(s);
          setJob(j);
          setOutline([]);
          setTopics(s.topic_ids || []);
          setNewTopics([]);
          setTags(s.tags || []);
          setPoints(s.knowledge_point_ids || []);
        }}
      />
      {candidate && (
        <div className="live-form">
          <p>{candidate.reason}</p>
          <fieldset>
            <legend>追加目录</legend>
            {candidate.outline?.map((s, i) => (
              <label key={i} className="rag-check">
                <input
                  type="checkbox"
                  checked={outline.includes(s.title)}
                  onChange={(e) =>
                    setOutline(
                      e.target.checked
                        ? [...outline, s.title]
                        : outline.filter((v) => v !== s.title),
                    )
                  }
                />
                {s.title}
              </label>
            ))}
          </fieldset>
          <label>
            专题
            <Select
              aria-label="建议专题"
              mode="multiple"
              value={topicIDs}
              onChange={setTopics}
              options={topics.data?.topics
                .filter((t) => t.active)
                .map((t) => ({ value: t.id, label: t.title }))}
            />
          </label>
          {!!candidate.new_topic_names?.length && (
            <fieldset>
              <legend>新增专题</legend>
              {candidate.new_topic_names.map((n) => (
                <label key={n} className="rag-check">
                  <input
                    type="checkbox"
                    checked={newTopics.includes(n)}
                    onChange={(e) =>
                      setNewTopics(
                        e.target.checked
                          ? [...newTopics, n]
                          : newTopics.filter((v) => v !== n),
                      )
                    }
                  />
                  {n}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            标签
            <Select
              aria-label="建议标签"
              mode="tags"
              value={tags}
              onChange={setTags}
            />
          </label>
          <label>
            课程知识点
            <Select
              aria-label="建议知识点"
              mode="multiple"
              value={pointIDs}
              onChange={setPoints}
              options={points.data?.points
                .filter((p) => p.kind === "point")
                .map((p) => ({ value: p.id, label: p.title }))}
            />
          </label>
          {!!candidate.similar_knowledge_ids?.length && (
            <div>
              相似知识：
              {candidate.similar_knowledge_ids.map((k) => (
                <Link key={k} to={`/teacher/knowledge?knowledge=${k}`}>
                  {known.data?.find((v) => v.id === k)?.title ||
                    "查看知识"}{" "}
                </Link>
              ))}
            </div>
          )}
          <button
            className="primary-link"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.run(`/sources/${id}/suggestions/adopt`, {
                  job_id: job,
                  topic_ids: topicIDs,
                  tags,
                  knowledge_point_ids: pointIDs,
                  new_topics: newTopics,
                  outline,
                  reason: "教师核对后采纳所选建议",
                })
              )
                setCandidate(null);
            }}
          >
            采纳所选建议
          </button>
        </div>
      )}
      <Feedback message={action.message} failed={action.failed} />
    </details>
  );
}

type PaperQuestion = {
  title: string;
  prompt: string;
  type: string;
  max_score: number;
  options: string[];
  correct_answer: string;
  reference_answer: string;
  answer_origin: string;
  source_fragment_ids: string[];
  asset_ids: string[];
  uncertain: string[];
};
type Paper = {
  questions: PaperQuestion[];
  excluded: { fragment_id: string; reason: string }[];
  review_status: string;
  job_id?: string;
};
export function PaperImport({
  id,
  fragments,
}: {
  id: string;
  fragments: { id: string; body: string }[];
}) {
  const [job, setJob] = useState("");
  const action = useAction();
  const assets = useLiveQuery<{
    assets: { id: string; kind: string }[];
    revisions: { asset_id: string; state: string }[];
  }>(`/sources/${id}/assets`);
  const draft = useEditorDraft<Paper>(`paper:${id}`, {
      questions: [],
      excluded: [],
      review_status: "pending_teacher_review",
    }),
    p = draft.value;
  const [selected, setSelected] = useState(0);
  const [splitAt, setSplitAt] = useState(0);
  const current = p.questions[selected];
  function update(v: Partial<PaperQuestion>) {
    draft.change({
      ...p,
      questions: p.questions.map((q, i) =>
        i === selected ? { ...q, ...v } : q,
      ),
    });
  }
  function swap(delta: number) {
    const j = selected + delta;
    if (j < 0 || j >= p.questions.length) return;
    const qs = [...p.questions];
    [qs[selected], qs[j]] = [qs[j], qs[selected]];
    draft.change({ ...p, questions: qs });
    setSelected(j);
  }
  const covered = new Set([
      ...p.questions.flatMap((q) => q.source_fragment_ids),
      ...p.excluded.map((x) => x.fragment_id),
    ]),
    missing = fragments.filter((f) => !covered.has(f.id));
  return (
    <details className="card-panel">
      <summary>整卷拆题</summary>
      <WorkflowJob
        kind="paper_split"
        target={{ source_id: id }}
        onAdopt={(o, j) => {
          if (draft.dirty && !confirm("载入拆题候选并替换当前编辑？")) return;
          setJob(j);
          draft.change({ ...(o as unknown as Paper), job_id: j });
          setSelected(0);
        }}
      />
      {!!p.questions.length && (
        <div className="live-form">
          <DraftNotice {...draft} />
          <div className="live-inline">
            <label>
              题目
              <select
                aria-label="题目"
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {p.questions.map((q, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {q.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ghost-btn"
              disabled={!selected}
              onClick={() => swap(-1)}
            >
              上移
            </button>
            <button
              className="ghost-btn"
              disabled={selected === p.questions.length - 1}
              onClick={() => swap(1)}
            >
              下移
            </button>
            <button
              className="ghost-btn"
              disabled={selected === p.questions.length - 1}
              onClick={() => {
                const next = p.questions[selected + 1];
                const qs = p.questions.filter((_, i) => i !== selected + 1);
                qs[selected] = {
                  ...current,
                  prompt: current.prompt + "\n\n" + next.prompt,
                  source_fragment_ids: [
                    ...new Set([
                      ...current.source_fragment_ids,
                      ...next.source_fragment_ids,
                    ]),
                  ],
                  asset_ids: [
                    ...new Set([...current.asset_ids, ...next.asset_ids]),
                  ],
                };
                draft.change({ ...p, questions: qs });
              }}
            >
              与下一题合并
            </button>
          </div>
          {current && (
            <>
              <label>
                题目名称
                <input
                  value={current.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <div className="live-inline">
                <label>
                  题型
                  <select
                    aria-label="题型"
                    value={current.type}
                    onChange={(e) => update({ type: e.target.value })}
                  >
                    <option value="quiz">单选</option>
                    <option value="subjective">主观</option>
                    <option value="code">代码文本</option>
                  </select>
                </label>
                <label>
                  满分
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={current.max_score}
                    onChange={(e) =>
                      update({ max_score: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                题干
                <textarea
                  aria-label="题干"
                  rows={9}
                  value={current.prompt}
                  onChange={(e) => update({ prompt: e.target.value })}
                  onSelect={(e) => setSplitAt(e.currentTarget.selectionStart)}
                />
              </label>
              <button
                className="ghost-btn"
                disabled={splitAt <= 0 || splitAt >= current.prompt.length}
                onClick={() => {
                  const qs = [...p.questions];
                  qs.splice(
                    selected,
                    1,
                    { ...current, prompt: current.prompt.slice(0, splitAt) },
                    {
                      ...current,
                      title: current.title + "（拆分）",
                      prompt: current.prompt.slice(splitAt),
                      reference_answer: "",
                      correct_answer: "",
                      answer_origin: "missing",
                    },
                  );
                  draft.change({ ...p, questions: qs });
                  setSplitAt(0);
                }}
              >
                在光标位置拆题
              </button>
              <RichContent text={current.prompt} />
              {current.type === "quiz" && (
                <>
                  <label>
                    选项（每行一个）
                    <textarea
                      value={current.options.join("\n")}
                      onChange={(e) =>
                        update({ options: e.target.value.split("\n") })
                      }
                    />
                  </label>
                  <label>
                    正确选项
                    <select
                      aria-label="正确选项"
                      value={current.correct_answer}
                      onChange={(e) =>
                        update({
                          correct_answer: e.target.value,
                          answer_origin: "teacher",
                        })
                      }
                    >
                      <option value="">待补全</option>
                      {current.options.map((o, i) => (
                        <option key={i} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label>
                参考解答
                <textarea
                  aria-label="参考解答"
                  value={current.reference_answer}
                  onChange={(e) =>
                    update({
                      reference_answer: e.target.value,
                      answer_origin: "teacher",
                    })
                  }
                />
              </label>
              <label>
                解答来源
                <select
                  aria-label="解答来源"
                  value={current.answer_origin}
                  onChange={(e) => update({ answer_origin: e.target.value })}
                >
                  <option value="missing">原卷未提供</option>
                  <option value="extracted">原卷逐字提取</option>
                  <option value="teacher">教师补录</option>
                </select>
              </label>
              <label>
                出处片段
                <Select
                  aria-label="拆题出处片段"
                  mode="multiple"
                  value={current.source_fragment_ids}
                  onChange={(v) => update({ source_fragment_ids: v })}
                  options={fragments.map((f, i) => ({
                    value: f.id,
                    label: `${i + 1} ${f.body.slice(0, 70)}`,
                  }))}
                />
              </label>
              <label>
                题图
                <Select
                  mode="multiple"
                  aria-label="题目图像"
                  value={current.asset_ids}
                  onChange={(v) => update({ asset_ids: v })}
                  options={assets.data?.assets
                    .filter(
                      (a) =>
                        a.kind !== "page" &&
                        assets.data.revisions.some(
                          (r) => r.asset_id === a.id && r.state === "confirmed",
                        ),
                    )
                    .map((a, i) => ({
                      value: a.id,
                      label: `图${i + 1} · ${a.kind}`,
                    }))}
                />
              </label>
              {!!current.uncertain?.length && (
                <p className="rag-warning">
                  待核对：{current.uncertain.join("；")}
                </p>
              )}
            </>
          )}
          <details>
            <summary>公共说明／排除片段 · {p.excluded.length}</summary>
            {p.excluded.map((x, i) => (
              <label key={x.fragment_id}>
                {fragments
                  .find((f) => f.id === x.fragment_id)
                  ?.body.slice(0, 130)}
                <input
                  aria-label="排除原因"
                  value={x.reason}
                  onChange={(e) =>
                    draft.change({
                      ...p,
                      excluded: p.excluded.map((v, j) =>
                        i === j ? { ...v, reason: e.target.value } : v,
                      ),
                    })
                  }
                />
                <button
                  className="ghost-btn"
                  onClick={() =>
                    draft.change({
                      ...p,
                      excluded: p.excluded.filter((_, j) => j !== i),
                    })
                  }
                >
                  恢复待分配
                </button>
              </label>
            ))}
          </details>
          {!!missing.length && (
            <div role="alert">
              <strong>{missing.length} 个片段未归题</strong>
              {missing.map((f) => (
                <div key={f.id}>
                  <p>{f.body.slice(0, 150)}</p>
                  <button
                    className="ghost-btn"
                    onClick={() =>
                      update({
                        source_fragment_ids: [
                          ...current.source_fragment_ids,
                          f.id,
                        ],
                      })
                    }
                  >
                    加入当前题
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() =>
                      draft.change({
                        ...p,
                        excluded: [
                          ...p.excluded,
                          { fragment_id: f.id, reason: "公共说明（请核对）" },
                        ],
                      })
                    }
                  >
                    标记排除
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="primary-link"
            disabled={action.busy || !!missing.length || !(p.job_id || job)}
            onClick={async () => {
              const snapshot = draft.value;
              const r = await action.run(`/sources/${id}/paper/adopt`, {
                ...p,
                job_id: p.job_id || job,
              });
              if (r) {
                draft.saved(snapshot);
              }
            }}
          >
            保存整组题库草稿
          </button>
          <Link to="/teacher/question-bank">进入题库确认</Link>
        </div>
      )}
      <Feedback message={action.message} failed={action.failed} />
    </details>
  );
}
