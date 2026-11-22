import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Alert, Button, Card, Collapse, Form, Input, Space, Typography } from "antd";
import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { MetaTag, MetaTags, StatusTag } from "../shared/ui";
import { AIDraft } from "./ai-jobs";
import { FrozenEvidence } from "./citations";
import { Feedback, useAction, useLiveQuery, uuid } from "./context";
import { labelFor, stateLabels } from "./domain-meta";
import { DraftNotice, useEditorDraft } from "./editing";
import { CriteriaEditor, IntegerInput } from "./shared-editors";
import type { Criterion, PointFeedback, Revision, RubricVersion } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

export type { Criterion, PointFeedback, RubricVersion } from "./types";

export type LiveRevision = Revision & {
  revision?: number;
  rubric_id?: string | null;
  point_scores?: PointFeedback[];
  method?: string;
  released_at?: string | null;
};

export interface PointEntry {
  criterion_id: string;
  score: number;
  feedback: string;
  quote: string;
}

export function normalizePointScores(
  criteria: Criterion[],
  raw?: readonly Partial<PointEntry>[] | null,
): PointEntry[] {
  const byID = new Map<string, Partial<PointEntry>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item.criterion_id === "string" && item.criterion_id.trim()) {
        byID.set(item.criterion_id.trim(), item);
      }
    }
  }
  return criteria.map((criterion, index) => {
    const matched = byID.get(criterion.id) ?? (Array.isArray(raw) ? raw[index] : undefined);
    const rawScore = Number(matched?.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(criterion.max_score, Math.round(rawScore)))
      : 0;
    return {
      criterion_id: criterion.id,
      score,
      feedback: typeof matched?.feedback === "string" ? matched.feedback : "",
      quote: typeof matched?.quote === "string" ? matched.quote : "",
    };
  });
}

function validateCriteriaList(criteria: Criterion[], maxScore: number): string | null {
  if (!criteria.length || criteria.length > 30) {
    return "请填写 1 至 30 个评分点。";
  }
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i < criteria.length; i += 1) {
    const item = criteria[i];
    const id = item.id.trim();
    const title = item.title.trim();
    const rule = item.rule.trim();
    if (!id || utf8ByteLength(id) > 100 || hasControlNull(id)) {
      return `第 ${i + 1} 个评分点编号无效或超过 100 字节。`;
    }
    if (seen.has(id)) {
      return `评分点编号「${id}」重复，请保持唯一。`;
    }
    seen.add(id);
    if (!title || utf8ByteLength(title) > 300 || hasControlNull(title)) {
      return `评分点 ${id} 名称不能为空且不能超过 300 字节。`;
    }
    if (!rule || utf8ByteLength(rule) > 5000 || hasControlNull(rule)) {
      return `评分点 ${id} 评分规则不能为空且不能超过 5000 字节。`;
    }
    if (!Number.isInteger(item.max_score) || item.max_score < 1 || item.max_score > maxScore) {
      return `评分点 ${id} 分值须为 1 至 ${maxScore} 的整数。`;
    }
    total += item.max_score;
  }
  if (total !== maxScore) {
    return `评分点分值合计（${total} 分）必须等于本题满分（${maxScore} 分）。`;
  }
  return null;
}

interface RubricSeed {
  seq: number;
  criteria: Criterion[];
  ai_job_id: string;
}

function RubricDraftEditor({
  questionID,
  maxScore,
  seed,
  disabled,
  onDirtyChange,
  onSaved,
  onCancel,
}: {
  questionID: string;
  maxScore: number;
  seed: RubricSeed | null;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const confirm = useConfirm();
  const action = useAction();
  const defaultValue = useMemo(
    () => ({
      criteria: [
        { id: "D1", title: "", max_score: maxScore, rule: "" } as Criterion,
      ],
      ai_job_id: "",
    }),
    [maxScore],
  );
  const draft = useEditorDraft<{ criteria: Criterion[]; ai_job_id: string } | Criterion[]>(
    `rubric:${questionID}`,
    defaultValue,
  );
  const [validationError, setValidationError] = useState("");
  const appliedSeedRef = useRef(0);

  useEffect(() => {
    onDirtyChange(draft.dirty);
    return () => onDirtyChange(false);
  }, [draft.dirty, onDirtyChange]);

  useEffect(() => {
    if (!seed || seed.seq === appliedSeedRef.current) return;
    appliedSeedRef.current = seed.seq;
    draft.change({
      criteria: seed.criteria.map((c) => ({ ...c })),
      ai_job_id: seed.ai_job_id,
    });
    setValidationError("");
  }, [seed, draft]);

  const criteria = Array.isArray(draft.value) ? draft.value : draft.value.criteria;
  const aiJobID = Array.isArray(draft.value) ? "" : draft.value.ai_job_id;
  const total = criteria.reduce((sum, p) => sum + (Number(p.max_score) || 0), 0);

  function setCriteria(next: Criterion[], origin?: string) {
    setValidationError("");
    draft.change((prev) => {
      const currentJob = Array.isArray(prev) ? "" : prev.ai_job_id;
      return {
        criteria: next,
        ai_job_id: origin !== undefined ? origin : currentJob,
      };
    });
  }

  return (
    <Form
      className="live-form"
      layout="vertical"
      onFinish={async () => {
        const err = validateCriteriaList(criteria, maxScore);
        if (err) {
          setValidationError(err);
          return;
        }
        setValidationError("");
        const snapshot = draft.value;
        const normalized = criteria.map((item) => ({
          ...item,
          id: item.id.trim(),
          title: item.title.trim(),
          rule: item.rule.trim(),
        }));
        const created = await action.run(
          `/questions/${questionID}/rubrics`,
          { criteria: normalized, ai_job_id: aiJobID },
          "POST",
          "评分标准草稿已保存",
        );
        if (created && draft.saved(snapshot)) {
          onSaved();
        }
      }}
    >
      <Typography.Text strong className="item-title">
        新增独立标准版本
      </Typography.Text>
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          draft.reset(defaultValue);
          setValidationError("");
        }}
      />
      <CriteriaEditor
        criteria={criteria}
        maxScore={maxScore}
        onChange={(next) => setCriteria(next)}
        extended
        disabled={action.busy || disabled}
      />
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      <Feedback message={action.message} failed={action.failed} />
      <Space wrap>
        <Button
          disabled={action.busy || disabled || total !== maxScore}
          htmlType="submit"
          type="primary"
        >
          保存标准草稿
        </Button>
        <Button
          disabled={action.busy}
          htmlType="button"
          onClick={async () => {
            if (
              !draft.dirty ||
              (await confirm("取消编辑评分标准？未保存内容可在重新打开时恢复。"))
            ) {
              onCancel();
            }
          }}
        >
          取消
        </Button>
      </Space>
    </Form>
  );
}

export function RubricManager({
  questionID,
  maxScore,
}: {
  questionID: string;
  maxScore: number;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const query = useLiveQuery<RubricVersion[]>(
    `/questions/${questionID}/rubrics`,
    expanded,
  );
  const action = useAction();
  const [editor, setEditor] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [seed, setSeed] = useState<RubricSeed | null>(null);

  const openWithSeed = useCallback(
    async (criteria: Criterion[], aiJobID: string, promptText: string) => {
      if (editor && editorDirty && !(await confirm(promptText))) {
        return;
      }
      setSeed({
        seq: Date.now(),
        criteria: criteria.map((p) => ({ ...p })),
        ai_job_id: aiJobID,
      });
      setEditor(true);
    },
    [confirm, editor, editorDirty],
  );

  return (
    <Collapse
      className="live-rubrics"
      onChange={(keys) =>
        setExpanded(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: (
            <MetaTags>
              <span>逐点评分标准</span>
              <MetaTag>满分 {maxScore}</MetaTag>
            </MetaTags>
          ),
          children: (
            <>
              <AIDraft
                kind="rubric"
                target={{ question_id: questionID }}
                onAdopt={async (output, id) => {
                  const list = Array.isArray(output.criteria)
                    ? (output.criteria as Criterion[])
                    : [];
                  if (!list.length) return;
                  await openWithSeed(list, id, "用 AI 草稿替换当前编辑内容？");
                }}
              />
              <Feedback
                error={query.error}
                message={action.message}
                failed={action.failed}
              />
              <Button
                disabled={action.busy}
                onClick={() => setEditor(true)}
                htmlType="button"
              >
                新建标准版本
              </Button>
              {query.data?.slice(0, 1).map((r) => (
                <article key={r.id} className="live-revision">
                  <div className="section-head">
                    <Typography.Text strong className="item-title">
                      标准 v{r.version}
                    </Typography.Text>
                    <StatusTag
                      status={r.state}
                      label={labelFor(stateLabels, r.state)}
                    />
                  </div>
                  {r.criteria.map((p) => (
                    <p key={p.id}>
                      <strong>
                        {p.id} · {p.title}（{p.max_score}分）
                      </strong>
                      ：{p.rule}
                    </p>
                  ))}
                  <FrozenEvidence sources={r.evidence_refs} />
                  <Space wrap size="small">
                    {r.state === "draft" && (
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            `/rubrics/${r.id}/confirm`,
                            undefined,
                            "POST",
                            "评分标准已确认",
                          )
                        }
                        htmlType="button"
                        type="primary"
                      >
                        确认标准 v{r.version}
                      </Button>
                    )}
                    <Button
                      disabled={action.busy}
                      onClick={() =>
                        void openWithSeed(
                          r.criteria,
                          "",
                          "当前有未保存的标准草稿，确认替换为所复制的版本？",
                        )
                      }
                      htmlType="button"
                    >
                      复制到新版本
                    </Button>
                  </Space>
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
                                <Typography.Text strong className="item-title">
                                  标准 v{r.version}
                                </Typography.Text>
                                <StatusTag
                                  status={r.state}
                                  label={labelFor(stateLabels, r.state)}
                                />
                              </div>
                              {r.criteria.map((p) => (
                                <p key={p.id}>
                                  <strong>
                                    {p.id} · {p.title}（{p.max_score}分）
                                  </strong>
                                  ：{p.rule}
                                </p>
                              ))}
                              <FrozenEvidence sources={r.evidence_refs} />
                              <Space wrap size="small">
                                <Button
                                  disabled={action.busy}
                                  onClick={() =>
                                    void openWithSeed(
                                      r.criteria,
                                      "",
                                      "当前有未保存的标准草稿，确认替换为所复制的版本？",
                                    )
                                  }
                                  htmlType="button"
                                >
                                  复制到新版本
                                </Button>
                                {r.state === "draft" && (
                                  <Button
                                    disabled={action.busy}
                                    onClick={() =>
                                      void action.run(
                                        `/rubrics/${r.id}/confirm`,
                                        undefined,
                                        "POST",
                                        "评分标准已确认",
                                      )
                                    }
                                    htmlType="button"
                                  >
                                    确认标准 v{r.version}
                                  </Button>
                                )}
                              </Space>
                            </article>
                          ))}
                        </>
                      ),
                    },
                  ]}
                />
              )}
              {editor && (
                <RubricDraftEditor
                  questionID={questionID}
                  maxScore={maxScore}
                  seed={seed}
                  disabled={!!query.error}
                  onDirtyChange={setEditorDirty}
                  onSaved={() => {
                    setEditor(false);
                    setSeed(null);
                  }}
                  onCancel={() => {
                    setEditor(false);
                    setSeed(null);
                  }}
                />
              )}
            </>
          ),
        },
      ]}
    />
  );
}

interface PointGradeDraft {
  points: PointEntry[];
  feedback: string;
  ai_job_id: string;
  request_id: string;
}

export function PointGradeForm({
  rubric,
  submissionID,
  initial,
  quoteRequest,
  onLocate,
  onSaved,
  onDirtyChange,
  saveRef,
}: {
  rubric: RubricVersion;
  submissionID: string;
  initial?: LiveRevision;
  quoteRequest?: { id: string; text: string; seq: number } | null;
  onLocate?: (quote: string) => void;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: MutableRefObject<(() => void) | null>;
}) {
  const confirm = useConfirm();
  const action = useAction();
  const [validationError, setValidationError] = useState("");
  const [adoptNotice, setAdoptNotice] = useState("");
  const lastQuoteSeqRef = useRef<number>(0);

  const initialDraft = useMemo<PointGradeDraft>(() => {
    const sourcePoints = initial?.point_scores ?? initial?.point_results;
    return {
      points: normalizePointScores(rubric.criteria, sourcePoints),
      feedback: initial?.feedback || "",
      ai_job_id: "",
      request_id: uuid(),
    };
  }, [rubric.criteria, initial?.id, initial?.feedback, initial?.point_scores, initial?.point_results]);

  const draft = useEditorDraft<PointGradeDraft>(
    `grade:${submissionID}:${rubric.id}:${initial?.id || "new"}`,
    initialDraft,
  );

  useEffect(() => {
    onDirtyChange?.(draft.dirty);
    return () => onDirtyChange?.(false);
  }, [draft.dirty, onDirtyChange]);

  const normalizedPoints = useMemo(
    () => normalizePointScores(rubric.criteria, draft.value.points),
    [rubric.criteria, draft.value.points],
  );
  const pointByID = useMemo(
    () => new Map(normalizedPoints.map((p) => [p.criterion_id, p])),
    [normalizedPoints],
  );
  const feedback = draft.value.feedback || "";
  const requestID = draft.value.request_id || initialDraft.request_id;
  const maxTotal = rubric.criteria.reduce((sum, c) => sum + c.max_score, 0);
  const score = normalizedPoints.reduce((sum, p) => sum + p.score, 0);
  const delta = maxTotal - score;

  const updateCriterion = useCallback(
    (criterionID: string, patch: Partial<PointEntry>) => {
      setValidationError("");
      draft.change((prev) => {
        const current = normalizePointScores(rubric.criteria, prev.points);
        return {
          ...prev,
          points: current.map((entry) =>
            entry.criterion_id === criterionID ? { ...entry, ...patch } : entry,
          ),
          request_id: uuid(),
        };
      });
    },
    [draft, rubric.criteria],
  );

  useEffect(() => {
    if (!quoteRequest || quoteRequest.seq === lastQuoteSeqRef.current) return;
    lastQuoteSeqRef.current = quoteRequest.seq;
    const targetCriterion = rubric.criteria.find((c) => c.id === quoteRequest.id);
    if (!targetCriterion) return;
    const existingQuote = pointByID.get(targetCriterion.id)?.quote || "";
    const apply = async () => {
      if (
        existingQuote.trim() &&
        existingQuote !== quoteRequest.text &&
        !(await confirm(`评分点 ${targetCriterion.id} 已有原文引用，确认替换为新选中文本？`))
      ) {
        return;
      }
      updateCriterion(targetCriterion.id, { quote: quoteRequest.text });
    };
    void apply();
  }, [quoteRequest, rubric.criteria, pointByID, confirm, updateCriterion]);

  const submitGrade = useCallback(async () => {
    for (const criterion of rubric.criteria) {
      const entry = pointByID.get(criterion.id);
      if (!entry) {
        setValidationError(`评分点 ${criterion.id} 缺失，请重新核对。`);
        return;
      }
      if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > criterion.max_score) {
        setValidationError(`评分点 ${criterion.id} 得分须在 0 至 ${criterion.max_score} 之间。`);
        return;
      }
      if (!entry.feedback.trim() || hasControlNull(entry.feedback)) {
        setValidationError(`请填写评分点 ${criterion.id} 的评语。`);
        return;
      }
      if (hasControlNull(entry.quote)) {
        setValidationError(`评分点 ${criterion.id} 的原文引用包含非法字符。`);
        return;
      }
    }
    if (!feedback.trim() || hasControlNull(feedback)) {
      setValidationError("请填写终审评语。");
      return;
    }
    setValidationError("");
    const snapshot = draft.value;
    const res = await action.run(
      `/submissions/${submissionID}/revisions`,
      {
        rubric_id: rubric.id,
        points: normalizedPoints,
        score,
        feedback: feedback.trim(),
        request_id: requestID,
        ai_job_id: draft.value.ai_job_id || "",
      },
      "POST",
      "逐点评分草稿已保存",
    );
    if (res) {
      draft.saved(snapshot);
      draft.reset({
        points: normalizedPoints,
        feedback: feedback.trim(),
        ai_job_id: "",
        request_id: uuid(),
      });
      onSaved?.();
    }
  }, [
    action,
    draft,
    feedback,
    normalizedPoints,
    onSaved,
    pointByID,
    requestID,
    rubric.criteria,
    rubric.id,
    score,
    submissionID,
  ]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => {
      if (!action.busy) void submitGrade();
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, action.busy, submitGrade]);

  return (
    <Form
      className="live-form"
      onFinish={() => void submitGrade()}
      layout="vertical"
    >
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          draft.reset({ ...initialDraft, request_id: uuid() });
          setValidationError("");
          setAdoptNotice("");
        }}
      />
      <FrozenEvidence sources={rubric.evidence_refs} />
      <AIDraft
        kind="grade"
        target={{ submission_id: submissionID, rubric_id: rubric.id }}
        onAdopt={async (output, id) => {
          if (draft.dirty && !(await confirm("用 AI 草稿替换当前编辑内容？"))) {
            return;
          }
          const rawPoints = Array.isArray(output.points)
            ? (output.points as Partial<PointEntry>[])
            : [];
          const rawIDs = new Set(
            rawPoints
              .map((p) => (typeof p?.criterion_id === "string" ? p.criterion_id.trim() : ""))
              .filter(Boolean),
          );
          const missing = rubric.criteria
            .filter((c) => !rawIDs.has(c.id))
            .map((c) => c.id);
          const nextPoints = normalizePointScores(rubric.criteria, rawPoints);
          draft.change({
            points: nextPoints,
            feedback: typeof output.feedback === "string" ? output.feedback : "",
            ai_job_id: id,
            request_id: uuid(),
          });
          setValidationError("");
          setAdoptNotice(
            missing.length
              ? `已按评分点编号匹配载入 AI 草稿；以下评分点未在 AI 输出中出现，已置为 0 分待补充：${missing.join("、")}`
              : "",
          );
        }}
      />
      {adoptNotice && <Alert type="warning" showIcon message={adoptNotice} />}
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      <Feedback message={action.message} failed={action.failed} />
      {action.error?.code === "request_conflict" && (
        <Alert
          type="warning"
          showIcon
          message="当前评分请求号与历史请求冲突，可重置请求号后重新保存。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => {
                draft.change((prev) => ({ ...prev, request_id: uuid() }));
                action.setMessage("");
              }}
            >
              重置请求号
            </Button>
          }
        />
      )}
      {rubric.criteria.map((p) => {
        const entry = pointByID.get(p.id) ?? {
          criterion_id: p.id,
          score: 0,
          feedback: "",
          quote: "",
        };
        return (
          <Card
            size="small"
            key={p.id}
            className="live-point-fields"
            title={
              <>
                {p.id} · {p.title} · {p.max_score}分
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
              <IntegerInput
                aria-label={`${p.id} 得分`}
                min={0}
                max={p.max_score}
                value={entry.score}
                onChange={(val) => updateCriterion(p.id, { score: val })}
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
                value={entry.feedback}
                onChange={(e) =>
                  updateCriterion(p.id, { feedback: e.target.value })
                }
                disabled={action.busy}
              />
            </Field>
            <Field className="ui-field" label={<>{p.id}原文引用（可选）</>}>
              <Input.TextArea
                rows={2}
                aria-label={`${p.id} 原文引用`}
                value={entry.quote}
                onChange={(e) =>
                  updateCriterion(p.id, { quote: e.target.value })
                }
                disabled={action.busy}
              />
            </Field>
            {entry.quote && (
              <Button
                onClick={() => onLocate?.(entry.quote)}
                htmlType="button"
                disabled={action.busy}
              >
                定位这段原文
              </Button>
            )}
          </Card>
        );
      })}
      <Field className="ui-field" label={<>终审评语</>} required={true}>
        <Input.TextArea
          aria-label="终审评语"
          disabled={action.busy}
          value={feedback}
          onChange={(e) => {
            setValidationError("");
            draft.change((v) => ({
              ...v,
              feedback: e.target.value,
              request_id: uuid(),
            }));
          }}
        />
      </Field>
      <div className="grading-actions">
        <Space wrap size="small">
          <strong>
            逐点合计：{score} / {maxTotal} 分
          </strong>
          <span className="live-meta">
            {delta === 0 ? "（已达满分）" : `（距满分差 ${delta} 分）`}
          </span>
        </Space>
        <Button disabled={action.busy} htmlType="submit" type="primary">
          {action.busy ? "保存中…" : "保存逐点评分草稿"}
        </Button>
      </div>
    </Form>
  );
}

export { RevisionPoints } from "./revision-points";
