import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { Collapse, Button, Form, Card, Input, InputNumber } from "antd";
import { useEditorDraft, DraftNotice } from "./editing";
import type { Revision } from "./assessment";
import { useEffect, useState } from "react";
import { Feedback, names, useAction, useLiveQuery } from "./context";
import { AIDraft, FrozenEvidence, type Hit } from "./knowledge";
import { MetaTag, MetaTags, StatusTag } from "../shared/ui";

export interface Criterion {
  id: string;
  title: string;
  max_score: number;
  rule: string;
  requirement?: string;
  partial_credit?: string;
  acceptable_answers?: string;
  error_conditions?: string;
  evidence_ids?: string[];
}
export interface RubricVersion {
  id: string;
  version: number;
  state: string;
  criteria: Criterion[];
  evidence_refs?: Hit[];
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
  const confirm = useConfirm();
  const query = useLiveQuery<RubricVersion[]>(
    `/questions/${questionID}/rubrics`,
  );
  const action = useAction();
  const draft = useEditorDraft<
    { criteria: Criterion[]; ai_job_id: string } | Criterion[]
  >(`rubric:${questionID}`, {
    criteria: [{ id: "D1", title: "", max_score: maxScore, rule: "" }],
    ai_job_id: "",
  });
  const criteria = Array.isArray(draft.value)
    ? draft.value
    : draft.value.criteria;
  const aiJobID = Array.isArray(draft.value) ? "" : draft.value.ai_job_id;
  function setCriteria(
    next: Criterion[] | ((v: Criterion[]) => Criterion[]),
    origin = aiJobID,
  ) {
    draft.change({
      criteria: typeof next === "function" ? next(criteria) : next,
      ai_job_id: origin,
    });
  }
  const [editor, setEditor] = useState(false);
  const total = criteria.reduce((sum, p) => sum + p.max_score, 0);
  function update(index: number, patch: Partial<Criterion>) {
    setCriteria((v) => v.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  return (
    <Collapse
      className="live-rubrics"
      items={[
        {
          key: "content",
          label: <MetaTags><span>逐点评分标准</span><MetaTag>满分 {maxScore}</MetaTag></MetaTags>,
          children: (
            <>
              <DraftNotice {...draft} />
              <AIDraft
                kind="rubric"
                target={{ question_id: questionID }}
                onAdopt={async (output, id) => {
                  if (draft.dirty && !await confirm("用AI草稿替换当前编辑内容？"))
                    return;
                  setCriteria(output.criteria as Criterion[], id);
                  setEditor(true);
                }}
              />
              <Feedback
                error={query.error}
                message={action.message}
                failed={action.failed}
              />
              <Button onClick={() => setEditor(true)} htmlType="button">
                新建标准版本
              </Button>
              {query.data?.slice(0, 1).map((r) => (
                <article key={r.id} className="live-revision">
                  <div className="section-head">
                    <h4>标准 v{r.version}</h4>
                    <StatusTag status={r.state} label={names[r.state]} />
                  </div>
                  {r.criteria.map((p) => (
                    <p key={p.id}>
                      <strong>
                        {p.id}
                        {p.title}（{p.max_score}分）
                      </strong>
                      ：{p.rule}
                    </p>
                  ))}
                  <FrozenEvidence sources={r.evidence_refs} />
                  {r.state === "draft" && (
                    <Button
                      disabled={action.busy}
                      onClick={() => action.run(`/rubrics/${r.id}/confirm`)}
                      htmlType="button"
                    >
                      确认标准 v{r.version}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setCriteria(
                        r.criteria.map((p) => ({ ...p })),
                        "",
                      );
                      setEditor(true);
                    }}
                    htmlType="button"
                  >
                    复制到新版本
                  </Button>
                </article>
              ))}
              {(query.data?.length || 0) > 1 && (
                <Collapse
                  items={[
                    {
                      key: "content",
                      label: (
                        <>历史标准版本（{(query.data?.length || 0) - 1}）</>
                      ),
                      children: (
                        <>
                          {query.data?.slice(1).map((r) => (
                            <article key={r.id} className="live-revision">
                              <div className="section-head">
                                <h4>标准 v{r.version}</h4>
                                <StatusTag status={r.state} label={names[r.state]} />
                              </div>
                              {r.criteria.map((p) => (
                                <p key={p.id}>
                                  {p.title}（{p.max_score}分）：{p.rule}
                                </p>
                              ))}
                              <FrozenEvidence sources={r.evidence_refs} />
                              <Button
                                onClick={() => {
                                  setCriteria(
                                    r.criteria.map((p) => ({ ...p })),
                                    "",
                                  );
                                  setEditor(true);
                                }}
                                htmlType="button"
                              >
                                复制到新版本
                              </Button>
                              {r.state === "draft" && (
                                <Button
                                  onClick={() =>
                                    action.run(`/rubrics/${r.id}/confirm`)
                                  }
                                >
                                  确认标准 v{r.version}
                                </Button>
                              )}
                            </article>
                          ))}
                        </>
                      ),
                    },
                  ]}
                />
              )}
              {editor && (
                <Form
                  className="live-form"
                  onFinish={async () => {
                    const snapshot = draft.value;
                    if (
                      await action.run(`/questions/${questionID}/rubrics`, {
                        criteria,
                        ai_job_id: aiJobID,
                      })
                    ) {
                      if (draft.saved(snapshot)) setEditor(false);
                    }
                  }}
                  layout="vertical"
                >
                  <h4>新增独立标准版本</h4>
                  {criteria.map((p, i) => (
                    <Card
                      size="small"
                      key={i}
                      className="live-point-fields"
                      title={<>评分点 {i + 1}</>}
                    >
                      <Field
                        className="ui-field"
                        label={<>评分点编号</>}
                        required={true}
                      >
                        <Input
                          aria-label="评分点编号"
                          required
                          maxLength={100}
                          value={p.id}
                          onChange={(e) => update(i, { id: e.target.value })}
                        />
                      </Field>
                      <Field
                        className="ui-field"
                        label={<>评分点名称</>}
                        required={true}
                      >
                        <Input
                          aria-label="评分点名称"
                          required
                          maxLength={150}
                          value={p.title}
                          onChange={(e) => update(i, { title: e.target.value })}
                        />
                      </Field>
                      <Field
                        className="ui-field"
                        label={<>评分点满分</>}
                        required={true}
                      >
                        <InputNumber
                          aria-label="评分点满分"
                          required
                          min={1}
                          max={maxScore}
                          step={1}
                          value={p.max_score}
                          onChange={(e) =>
                            update(i, { max_score: Number(String(e ?? "")) })
                          }
                        />
                      </Field>
                      <Field
                        className="ui-field"
                        label={<>给分与部分得分规则</>}
                        required={true}
                      >
                        <Input.TextArea
                          aria-label="给分与部分得分规则"
                          required
                          value={p.rule}
                          onChange={(e) => update(i, { rule: e.target.value })}
                        />
                      </Field>
                      {criteria.length > 1 && (
                        <Button
                          onClick={() =>
                            setCriteria((v) => v.filter((_, n) => n !== i))
                          }
                          htmlType="button"
                        >
                          移除此点
                        </Button>
                      )}
                    </Card>
                  ))}
                  <div className="live-inline">
                    <Button
                      disabled={criteria.length >= 30}
                      onClick={() =>
                        setCriteria((v) => [
                          ...v,
                          {
                            id: `D${v.length + 1}`,
                            title: "",
                            max_score: 1,
                            rule: "",
                          },
                        ])
                      }
                      htmlType="button"
                    >
                      添加评分点
                    </Button>
                    <span>
                      分值合计 {total}/ {maxScore}
                    </span>
                    <Button
                      disabled={
                        action.busy || total !== maxScore || !!query.error
                      }
                      htmlType="submit"
                      type="primary"
                    >
                      保存标准草稿
                    </Button>
                  </div>
                  <p className="live-meta">
                    确认后的版本可用于评分；更改须另建版本，已有评分保留原标准。
                  </p>
                </Form>
              )}
            </>
          ),
        },
      ]}
    />
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
  const confirm = useConfirm();
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
      ai_job_id: "",
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
    <Form
      className="live-form"
      onFinish={async () => {
        const snapshot = draft.value;
        if (
          await action.run(`/submissions/${submissionID}/revisions`, {
            rubric_id: rubric.id,
            points,
            score,
            feedback,
            request_id: requestID,
            ai_job_id: draft.value.ai_job_id || "",
          })
        ) {
          draft.saved(snapshot);
          setRequestID(crypto.randomUUID());
          onSaved?.();
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} />
      <FrozenEvidence sources={rubric.evidence_refs} />
      <AIDraft
        kind="grade"
        target={{ submission_id: submissionID, rubric_id: rubric.id }}
        onAdopt={async (output, id) => {
          if (draft.dirty && !await confirm("用AI草稿替换当前编辑内容？")) return;
          draft.change({
            points: output.points as typeof points,
            feedback: String(output.feedback),
            ai_job_id: id,
          });
          setRequestID(crypto.randomUUID());
        }}
      />
      <Feedback message={action.message} failed={action.failed} />
      {rubric.criteria.map((p, i) => (
        <Card
          size="small"
          key={p.id}
          className="live-point-fields"
          title={
            <>
              {p.title} · {p.max_score}分
            </>
          }
        >
          <Collapse
            items={[
              {
                key: "content",
                label: <>给分规则</>,
                children: (
                  <>
                    <p>{p.rule}</p>
                    {p.requirement && <p>考查要求：{p.requirement}</p>}
                    {p.partial_credit && <p>部分分：{p.partial_credit}</p>}
                    {p.acceptable_answers && (
                      <p>可接受表达：{p.acceptable_answers}</p>
                    )}
                    {p.error_conditions && (
                      <p>错误条件：{p.error_conditions}</p>
                    )}
                  </>
                ),
              },
            ]}
          />
          <Field
            className="ui-field"
            label={<>{p.id}得分</>}
            required={true}
          >
            <InputNumber
              aria-label={`${p.id} 得分`}
              required
              step={1}
              min={0}
              max={p.max_score}
              value={points[i].score}
              onChange={(e) => change(i, { score: Number(String(e ?? "")) })}
              disabled={action.busy}
            />
          </Field>
          <Field
            className="ui-field"
            label={<>{p.id}评语</>}
            required={true}
          >
            <Input.TextArea
              rows={2}
              aria-label={`${p.id} 评语`}
              required
              value={points[i].feedback}
              onChange={(e) => change(i, { feedback: e.target.value })}
              disabled={action.busy}
            />
          </Field>
          <Field className="ui-field" label={<>{p.id}原文引用（可选）</>}>
            <Input.TextArea
              rows={2}
              aria-label={`${p.id} 原文引用`}
              value={points[i].quote}
              onChange={(e) => change(i, { quote: e.target.value })}
              disabled={action.busy}
            />
          </Field>
          {points[i].quote && (
            <Button
              onClick={() => onLocate?.(points[i].quote)}
              htmlType="button"
              disabled={action.busy}
            >
              定位这段原文
            </Button>
          )}
        </Card>
      ))}
      <Field className="ui-field" label={<>终审评语</>} required={true}>
        <Input.TextArea
          aria-label="终审评语"
          disabled={action.busy}
          required
          value={feedback}
          onChange={(e) => {
            draft.change((v) => ({ ...v, feedback: e.target.value }));
            setRequestID(crypto.randomUUID());
          }}
        />
      </Field>
      <div className="grading-actions">
        <strong>逐点合计：{score}分</strong>
        <Button disabled={action.busy} htmlType="submit" type="primary">
          {action.busy ? "保存中…" : "保存逐点评分草稿"}
        </Button>
      </div>
    </Form>
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
            {p.title}：{p.score}/ {p.max_score}
          </strong>
          <p>{p.feedback}</p>
          {p.quote && (
            <blockquote className="live-prose">
              {p.quote}
              {onLocate && (
                <Button onClick={() => onLocate(p.quote)}>定位原文</Button>
              )}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}
