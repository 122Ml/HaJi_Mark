import { useEditorDraft, DraftNotice } from "./editing";
import type { Revision } from "./assessment";
import { useEffect, useState } from "react";
import { Feedback, names, useAction, useLiveQuery } from "./context";

export interface Criterion {
  id: string;
  title: string;
  max_score: number;
  rule: string;
}
export interface RubricVersion {
  id: string;
  version: number;
  state: string;
  criteria: Criterion[];
}
export interface PointFeedback {
  criterion_id: string;
  title: string;
  max_score: number;
  score: number;
  feedback: string;
  quote: string;
}

export function RubricManager({
  questionID,
  maxScore,
}: {
  questionID: string;
  maxScore: number;
}) {
  const query = useLiveQuery<RubricVersion[]>(
    `/questions/${questionID}/rubrics`,
  );
  const action = useAction();
  const draft = useEditorDraft<Criterion[]>(`rubric:${questionID}`, [
    { id: "D1", title: "", max_score: maxScore, rule: "" },
  ]);
  const criteria = draft.value,
    setCriteria = draft.change;
  const [editor, setEditor] = useState(false);
  const total = criteria.reduce((sum, p) => sum + p.max_score, 0);
  function update(index: number, patch: Partial<Criterion>) {
    setCriteria((v) => v.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  return (
    <details className="live-rubrics">
      <summary>逐点评分标准 · 满分 {maxScore}</summary>
      <DraftNotice {...draft} />
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <button
        className="ghost-btn"
        type="button"
        onClick={() => setEditor(true)}
      >
        新建标准版本
      </button>
      {query.data?.slice(0, 1).map((r) => (
        <article key={r.id} className="live-revision">
          <h4>
            标准 v{r.version} · {names[r.state]}
          </h4>
          {r.criteria.map((p) => (
            <p key={p.id}>
              <strong>
                {p.id} {p.title}（{p.max_score}分）
              </strong>
              ：{p.rule}
            </p>
          ))}
          {r.state === "draft" && (
            <button
              type="button"
              className="ghost-btn"
              disabled={action.busy}
              onClick={() => action.run(`/rubrics/${r.id}/confirm`)}
            >
              确认标准 v{r.version}
            </button>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setCriteria(r.criteria.map((p) => ({ ...p })));
              setEditor(true);
            }}
          >
            复制到新版本
          </button>
        </article>
      ))}
      {(query.data?.length || 0) > 1 && (
        <details>
          <summary>历史标准版本（{(query.data?.length || 0) - 1}）</summary>
          {query.data?.slice(1).map((r) => (
            <article key={r.id} className="live-revision">
              <h4>
                标准 v{r.version} · {names[r.state]}
              </h4>
              {r.criteria.map((p) => (
                <p key={p.id}>
                  {p.title}（{p.max_score}分）：{p.rule}
                </p>
              ))}
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setCriteria(r.criteria.map((p) => ({ ...p })));
                  setEditor(true);
                }}
              >
                复制到新版本
              </button>
              {r.state === "draft" && (
                <button
                  className="ghost-btn"
                  onClick={() => action.run(`/rubrics/${r.id}/confirm`)}
                >
                  确认标准 v{r.version}
                </button>
              )}
            </article>
          ))}
        </details>
      )}
      {editor && (
        <form
          className="live-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(`/questions/${questionID}/rubrics`, { criteria })
            ) {
              if (draft.saved(criteria)) setEditor(false);
            }
          }}
        >
          <h4>新增独立标准版本</h4>
          {criteria.map((p, i) => (
            <fieldset key={i} className="live-point-fields">
              <legend>评分点 {i + 1}</legend>
              <label>
                评分点编号
                <input
                  required
                  maxLength={100}
                  value={p.id}
                  onChange={(e) => update(i, { id: e.target.value })}
                />
              </label>
              <label>
                评分点名称
                <input
                  required
                  maxLength={150}
                  value={p.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </label>
              <label>
                评分点满分
                <input
                  required
                  type="number"
                  min={1}
                  max={maxScore}
                  step={1}
                  value={p.max_score}
                  onChange={(e) =>
                    update(i, { max_score: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                给分与部分得分规则
                <textarea
                  required
                  value={p.rule}
                  onChange={(e) => update(i, { rule: e.target.value })}
                />
              </label>
              {criteria.length > 1 && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    setCriteria((v) => v.filter((_, n) => n !== i))
                  }
                >
                  移除此点
                </button>
              )}
            </fieldset>
          ))}
          <div className="live-inline">
            <button
              type="button"
              className="ghost-btn"
              disabled={criteria.length >= 30}
              onClick={() =>
                setCriteria((v) => [
                  ...v,
                  { id: `D${v.length + 1}`, title: "", max_score: 1, rule: "" },
                ])
              }
            >
              添加评分点
            </button>
            <span>
              分值合计 {total} / {maxScore}
            </span>
            <button
              className="primary-link"
              disabled={action.busy || total !== maxScore || !!query.error}
            >
              保存标准草稿
            </button>
          </div>
          <p className="live-meta">
            确认后的版本可用于评分；更改须另建版本，已有评分保留原标准。
          </p>
        </form>
      )}
    </details>
  );
}

export function PointGradeForm({
  rubric,
  submissionID,
  initial,
  quoteRequest,
  onLocate,
  onSaved,
}: {
  rubric: RubricVersion;
  submissionID: string;
  initial?: Revision;
  quoteRequest?: { id: string; text: string; seq: number } | null;
  onLocate?: (quote: string) => void;
  onSaved?: () => void;
}) {
  const action = useAction();
  const draft = useEditorDraft(
    `grade:${submissionID}:${rubric.id}:${initial?.id || "new"}`,
    {
      points: rubric.criteria.map((p) => ({
        criterion_id: p.id,
        score:
          initial?.point_scores?.find((v) => v.criterion_id === p.id)?.score ||
          0,
        feedback:
          initial?.point_scores?.find((v) => v.criterion_id === p.id)
            ?.feedback || "",
        quote:
          initial?.point_scores?.find((v) => v.criterion_id === p.id)?.quote ||
          "",
      })),
      feedback: initial?.feedback || "",
    },
  );
  const { points, feedback } = draft.value;
  const [requestID, setRequestID] = useState(crypto.randomUUID());
  const score = points.reduce((s, p) => s + p.score, 0);
  function change(i: number, patch: Partial<(typeof points)[number]>) {
    draft.change((v) => ({
      ...v,
      points: v.points.map((p, n) => (n === i ? { ...p, ...patch } : p)),
    }));
    setRequestID(crypto.randomUUID());
  }
  useEffect(() => {
    if (quoteRequest) {
      const i = rubric.criteria.findIndex((p) => p.id === quoteRequest.id);
      if (i >= 0) change(i, { quote: quoteRequest.text });
    }
  }, [quoteRequest]);
  return (
    <form
      className="live-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const snapshot = draft.value;
        if (
          await action.run(`/submissions/${submissionID}/revisions`, {
            rubric_id: rubric.id,
            points,
            score,
            feedback,
            request_id: requestID,
          })
        ) {
          draft.saved(snapshot);
          setRequestID(crypto.randomUUID());
          onSaved?.();
        }
      }}
    >
      <DraftNotice {...draft} />
      <Feedback message={action.message} failed={action.failed} />
      {rubric.criteria.map((p, i) => (
        <fieldset
          key={p.id}
          className="live-point-fields"
          disabled={action.busy}
        >
          <legend>
            {p.title} · {p.max_score}分
          </legend>
          <details>
            <summary>给分规则</summary>
            <p>{p.rule}</p>
          </details>
          <label>
            {p.id} 得分
            <input
              aria-label={`${p.id} 得分`}
              required
              type="number"
              step={1}
              min={0}
              max={p.max_score}
              value={points[i].score}
              onChange={(e) => change(i, { score: Number(e.target.value) })}
            />
          </label>
          <label>
            {p.id} 评语
            <textarea
              rows={2}
              aria-label={`${p.id} 评语`}
              required
              value={points[i].feedback}
              onChange={(e) => change(i, { feedback: e.target.value })}
            />
          </label>
          <label>
            {p.id} 原文引用（可选）
            <textarea
              rows={2}
              aria-label={`${p.id} 原文引用`}
              value={points[i].quote}
              onChange={(e) => change(i, { quote: e.target.value })}
            />
          </label>
          {points[i].quote && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onLocate?.(points[i].quote)}
            >
              定位这段原文
            </button>
          )}
        </fieldset>
      ))}
      <label>
        终审评语
        <textarea
          aria-label="终审评语"
          disabled={action.busy}
          required
          value={feedback}
          onChange={(e) => {
            draft.change((v) => ({ ...v, feedback: e.target.value }));
            setRequestID(crypto.randomUUID());
          }}
        />
      </label>
      <div className="grading-actions">
        <strong>逐点合计：{score} 分</strong>
        <button className="primary-link" disabled={action.busy}>
          {action.busy ? "保存中…" : "保存逐点评分草稿"}
        </button>
      </div>
    </form>
  );
}

export function RevisionPoints({
  points,
  onLocate,
}: {
  points?: PointFeedback[];
  onLocate?: (quote: string) => void;
}) {
  if (!points?.length) return null;
  return (
    <ul className="live-point-results">
      {points.map((p) => (
        <li key={p.criterion_id}>
          <strong>
            {p.title}：{p.score} / {p.max_score}
          </strong>
          <p>{p.feedback}</p>
          {p.quote && (
            <blockquote className="live-prose">
              {p.quote}
              {onLocate && (
                <button className="ghost-btn" onClick={() => onLocate(p.quote)}>
                  定位原文
                </button>
              )}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}
