import { useMemo, useState } from "react";
import { Alert, Button, Card, Collapse, Input, Select, Typography } from "antd";
import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { AIJobRunner } from "./ai-jobs";
import { Feedback, useAction, useLiveQuery } from "./context";
import { RichContent } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";
import type { Knowledge } from "./types";
import { dedupeStrings, hasControlNull, utf8ByteLength } from "./validation";

type Comparison = {
  knowledge_id: string;
  relation: string;
  candidate_quote: string;
  existing_quote: string;
  reason: string;
  suggestion: string;
};

type ReviewDraft = {
  action: string;
  related_ids: string[];
  reason: string;
  title: string;
  body: string;
  conditions: string;
  compare_job_id: string;
  comparisons: Comparison[];
};

const relations: Record<string, string> = {
  duplicate: "重复",
  supplement: "补充",
  conditional: "条件不同",
  conflict: "可能冲突",
  uncertain: "待判断",
};

const ACTION_OPTIONS = [
  { value: "defer", label: "暂不处理" },
  { value: "discard", label: "不采纳此候选" },
  { value: "merge", label: "合成新条目" },
  { value: "coexist", label: "按条件并存" },
  { value: "replace", label: "确认候选并停用所选旧条目" },
];

function parseComparisons(raw: unknown): Comparison[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      knowledge_id:
        typeof item.knowledge_id === "string" ? item.knowledge_id : "",
      relation: typeof item.relation === "string" ? item.relation : "uncertain",
      candidate_quote:
        typeof item.candidate_quote === "string" ? item.candidate_quote : "",
      existing_quote:
        typeof item.existing_quote === "string" ? item.existing_quote : "",
      reason: typeof item.reason === "string" ? item.reason : "",
      suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
    }))
    .filter((item) => item.knowledge_id.length > 0);
}

export function KnowledgeReview({
  candidate,
  onDone,
}: {
  candidate: Knowledge;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const q = useLiveQuery<Knowledge[]>("/knowledge");
  const action = useAction();
  const [validationError, setValidationError] = useState("");

  const known = useMemo(
    () =>
      (q.data || []).filter(
        (k) =>
          k.state === "confirmed" &&
          k.id !== candidate.id &&
          k.origin !== "teacher_example",
      ),
    [q.data, candidate.id],
  );

  const initialDraft = useMemo<ReviewDraft>(
    () => ({
      action: "defer",
      related_ids: [],
      reason: "",
      title: candidate.title,
      body: candidate.body,
      conditions: candidate.conditions,
      compare_job_id: "",
      comparisons: [],
    }),
    [
      candidate.id,
      candidate.edit_version,
      candidate.title,
      candidate.body,
      candidate.conditions,
    ],
  );

  const draft = useEditorDraft<ReviewDraft>(
    `knowledge-review:${candidate.id}:${candidate.edit_version}`,
    initialDraft,
  );
  const v = draft.value;
  const comparisons = Array.isArray(v.comparisons) ? v.comparisons : [];

  const needsRelated = ["merge", "coexist", "replace"].includes(v.action);
  const missingEvidence =
    candidate.origin !== "teacher_example" &&
    candidate.evidence.length === 0 &&
    ["merge", "coexist", "replace"].includes(v.action);
  const staleConflict = action.error?.status === 409;

  function validateDecision(): string {
    const trimmedReason = v.reason.trim();
    if (!trimmedReason) return "请填写处理理由";
    if (utf8ByteLength(trimmedReason) > 5000 || hasControlNull(trimmedReason)) {
      return "处理理由不能超过 5000 字节";
    }
    if (v.related_ids.length > 12) {
      return "比较与关联范围最多选择 12 条知识";
    }
    if (needsRelated && !v.related_ids.length) {
      return "请先选择需要处理的已有知识";
    }
    if (missingEvidence) {
      return "当前知识候选缺少原文依据，请先编辑补齐依据后再确认或合并";
    }
    if (v.action === "merge") {
      const title = v.title.trim();
      const body = v.body.trim();
      if (!title || utf8ByteLength(title) > 500 || hasControlNull(title)) {
        return "请填写不超过 500 字节的合并标题";
      }
      if (!body || utf8ByteLength(body) > 60000 || hasControlNull(body)) {
        return "请填写不超过 60000 字节的合并正文";
      }
      if (
        utf8ByteLength(v.conditions) > 10000 ||
        hasControlNull(v.conditions)
      ) {
        return "适用条件不能超过 10000 字节";
      }
    }
    return "";
  }

  return (
    <div className="live-form">
      <Typography.Text strong className="item-title">
        {candidate.title}
      </Typography.Text>
      <RichContent text={candidate.body} />
      {candidate.conditions && (
        <p>
          <strong>适用条件：</strong>
          {candidate.conditions}
        </p>
      )}
      {missingEvidence && (
        <Alert
          type="warning"
          showIcon
          message="此候选尚无原文依据，合并、并存或替换前请先在编辑抽屉中补齐原文引用。"
        />
      )}
      <DraftNotice {...draft} onDiscard={() => draft.reset(initialDraft)} />
      <Field className="ui-field" label={<>比较范围</>}>
        <Select
          mode="multiple"
          maxCount={12}
          optionFilterProp="label"
          aria-label="比较已有知识"
          placeholder="留空则由比较任务自动召回相关已确认知识（最多 12 条）"
          value={v.related_ids}
          onChange={(related_ids) => {
            const cleanIDs = dedupeStrings(related_ids).slice(0, 12);
            draft.change({
              ...v,
              related_ids: cleanIDs,
              compare_job_id: "",
              comparisons: [],
            });
            if (validationError) setValidationError("");
          }}
          options={known.map((k) => ({ value: k.id, label: k.title }))}
        />
      </Field>
      <AIJobRunner
        kind="knowledge_compare"
        showPreview={false}
        target={{ knowledge_id: candidate.id, related_ids: v.related_ids }}
        onAdopt={(o, id) => {
          const cs = parseComparisons(o.comparisons);
          const relatedIDs = dedupeStrings(
            cs.map((c) => c.knowledge_id),
          ).slice(0, 12);
          draft.change({
            ...v,
            compare_job_id: id,
            related_ids: relatedIDs,
            comparisons: cs,
          });
          if (validationError) setValidationError("");
        }}
      />
      {comparisons.map((c) => (
        <Card className="card-panel" key={c.knowledge_id}>
          <Typography.Text strong className="item-title">
            {known.find((k) => k.id === c.knowledge_id)?.title || "关联知识"} ·{" "}
            {relations[c.relation] || c.relation || "待判断"}
          </Typography.Text>
          <div>
            <strong>候选原文引用</strong>
            <blockquote>{c.candidate_quote || "（未提供引用）"}</blockquote>
          </div>
          <div>
            <strong>已有知识引用</strong>
            <blockquote>{c.existing_quote || "（未提供引用）"}</blockquote>
          </div>
          {c.reason && <p>{c.reason}</p>}
          {c.suggestion && <p>{c.suggestion}</p>}
        </Card>
      ))}
      {!!v.related_ids.length && (
        <Collapse
          items={[
            {
              key: "content",
              label: <>已有知识原文</>,
              children: (
                <>
                  {v.related_ids.map((id) => {
                    const k = known.find((item) => item.id === id);
                    return (
                      k && (
                        <article className="rag-hit" key={id}>
                          <Typography.Text strong className="item-title">
                            {k.title}
                          </Typography.Text>
                          <RichContent text={k.body} />
                          <p>条件：{k.conditions || "未单列"}</p>
                        </article>
                      )
                    );
                  })}
                </>
              ),
            },
          ]}
        />
      )}
      <Field className="ui-field" label={<>处理决定</>}>
        <Select
          aria-label="处理决定"
          value={v.action}
          onChange={(nextAction) => {
            draft.change({ ...v, action: nextAction });
            if (validationError) setValidationError("");
          }}
          showSearch
          optionFilterProp="label"
          options={ACTION_OPTIONS}
        />
      </Field>
      {v.action === "merge" && (
        <>
          <Alert
            type="info"
            showIcon
            message="合成新条目将自动确认并归档当前候选；「学生可见」「用于学习」「用于评分」将取所选条目与候选的交集。"
          />
          <Field className="ui-field" label={<>合并标题</>} required>
            <Input
              aria-label="合并标题"
              value={v.title}
              onChange={(e) => {
                draft.change({ ...v, title: e.target.value });
                if (validationError) setValidationError("");
              }}
            />
          </Field>
          <Field className="ui-field" label={<>合并正文</>} required>
            <Input.TextArea
              aria-label="合并正文"
              rows={8}
              value={v.body}
              onChange={(e) => {
                draft.change({ ...v, body: e.target.value });
                if (validationError) setValidationError("");
              }}
            />
          </Field>
          <Field className="ui-field" label={<>适用条件</>}>
            <Input.TextArea
              aria-label="适用条件"
              value={v.conditions}
              onChange={(e) =>
                draft.change({ ...v, conditions: e.target.value })
              }
            />
          </Field>
        </>
      )}
      <Field className="ui-field" label={<>处理理由</>} required={true}>
        <Input.TextArea
          aria-label="处理理由"
          value={v.reason}
          onChange={(e) => {
            draft.change({ ...v, reason: e.target.value });
            if (validationError) setValidationError("");
          }}
        />
      </Field>
      <Feedback
        message={action.message}
        failed={action.failed}
        error={
          q.error || (validationError ? new Error(validationError) : undefined)
        }
      />
      {staleConflict && (
        <Alert
          type="warning"
          showIcon
          message="候选或关联知识版本已改变，请刷新后重新核对或重新比较。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => void q.refetch()}
            >
              刷新最新知识
            </Button>
          }
        />
      )}
      <Button
        htmlType="button"
        disabled={
          action.busy ||
          !v.reason.trim() ||
          missingEvidence ||
          (needsRelated && !v.related_ids.length) ||
          (v.action === "merge" && (!v.title.trim() || !v.body.trim()))
        }
        onClick={async () => {
          const err = validateDecision();
          if (err) {
            setValidationError(err);
            return;
          }
          setValidationError("");
          if (
            v.action === "replace" &&
            !(await confirm("停用所选旧知识的未来用途？历史引用会保留。", {
              danger: true,
            }))
          ) {
            return;
          }
          if (
            v.action === "discard" &&
            !(await confirm("不采纳并归档此知识候选？", { danger: true }))
          ) {
            return;
          }
          if (
            v.action === "merge" &&
            !(await confirm("确认合成并自动发布新知识条目，同时归档当前候选？"))
          ) {
            return;
          }
          const snapshot = v;
          const keepRelated =
            needsRelated || !!v.compare_job_id;
          const payload = {
            action: v.action,
            edit_version: candidate.edit_version,
            compare_job_id: v.compare_job_id,
            reason: v.reason.trim(),
            title: v.title.trim(),
            body: v.body.trim(),
            conditions: v.conditions.trim(),
            related_ids: keepRelated
              ? dedupeStrings(v.related_ids).filter((id) => id !== candidate.id)
              : [],
          };
          const r = await action.run(
            `/knowledge/${candidate.id}/decision`,
            payload,
            "POST",
            undefined,
            {
              invalidatePrefixes: [
                "knowledge",
                "decisions",
                "impact",
                "topics",
                "jobs",
              ],
            },
          );
          if (r) {
            if (draft.saved(snapshot)) {
              onDone();
            }
          }
        }}
        type="primary"
      >
        保存决定
      </Button>
    </div>
  );
}
