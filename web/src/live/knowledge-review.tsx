import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { useState } from "react";
import { Select, Card, Collapse, Input, Button } from "antd";
import { Feedback, useAction, useLiveQuery } from "./context";
import { WorkflowJob } from "./workflow-job";
import { type Knowledge } from "./knowledge";
import { RichContent } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";

type Comparison = {
  knowledge_id: string;
  relation: string;
  candidate_quote: string;
  existing_quote: string;
  reason: string;
  suggestion: string;
};
const relations: Record<string, string> = {
  duplicate: "重复",
  supplement: "补充",
  conditional: "条件不同",
  conflict: "可能冲突",
  uncertain: "待判断",
};
export function KnowledgeReview({
  candidate,
  onDone,
}: {
  candidate: Knowledge;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const q = useLiveQuery<Knowledge[]>("/knowledge"),
    action = useAction();
  const known =
    q.data?.filter((k) => k.state === "confirmed" && k.id !== candidate.id) ||
    [];
  const draft = useEditorDraft(
    `knowledge-review:${candidate.id}:${candidate.edit_version}`,
    {
      action: "defer",
      related_ids: [] as string[],
      reason: "",
      title: candidate.title,
      body: candidate.body,
      conditions: candidate.conditions,
      compare_job_id: "",
    },
  );
  const v = draft.value;
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  return (
    <div className="live-form">
      <h2>{candidate.title}</h2>
      <RichContent text={candidate.body} />
      <p>{candidate.conditions}</p>
      <DraftNotice {...draft} />
      <Field className="ui-field" label={<>比较范围</>}>
        <Select
          mode="multiple"
          aria-label="比较已有知识"
          value={v.related_ids}
          onChange={(related_ids) =>
            draft.change({ ...v, related_ids, compare_job_id: "" })
          }
          options={known.map((k) => ({ value: k.id, label: k.title }))}
        />
      </Field>
      <WorkflowJob
        kind="knowledge_compare"
        target={{ knowledge_id: candidate.id, related_ids: v.related_ids }}
        onAdopt={(o, id) => {
          const cs = o.comparisons as Comparison[];
          setComparisons(cs);
          draft.change({
            ...v,
            compare_job_id: id,
            related_ids: cs.map((c) => c.knowledge_id),
          });
        }}
      />
      {comparisons.map((c) => (
        <Card className="card-panel" key={c.knowledge_id}>
          <h3>
            {known.find((k) => k.id === c.knowledge_id)?.title} ·{" "}
            {relations[c.relation]}
          </h3>
          <blockquote>{c.candidate_quote}</blockquote>
          <blockquote>{c.existing_quote}</blockquote>
          <p>{c.reason}</p>
          <p>{c.suggestion}</p>
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
                    const k = known.find((k) => k.id === id);
                    return (
                      k && (
                        <article className="rag-hit" key={id}>
                          <h3>{k.title}</h3>
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
          onChange={(e) => draft.change({ ...v, action: e })}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="defer">暂不处理</Select.Option>
          <Select.Option value="discard">不采纳此候选</Select.Option>
          <Select.Option value="merge">合成新条目</Select.Option>
          <Select.Option value="coexist">按条件并存</Select.Option>
          <Select.Option value="replace">
            确认候选并停用所选旧条目
          </Select.Option>
        </Select>
      </Field>
      {v.action === "merge" && (
        <>
          <Field className="ui-field" label={<>合并标题</>}>
            <Input
              aria-label="合并标题"
              value={v.title}
              onChange={(e) => draft.change({ ...v, title: e.target.value })}
            />
          </Field>
          <Field className="ui-field" label={<>合并正文</>}>
            <Input.TextArea
              aria-label="合并正文"
              rows={8}
              value={v.body}
              onChange={(e) => draft.change({ ...v, body: e.target.value })}
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
          required
          value={v.reason}
          onChange={(e) => draft.change({ ...v, reason: e.target.value })}
        />
      </Field>
      <Feedback
        message={action.message}
        failed={action.failed}
        error={q.error}
      />
      <Button
        disabled={
          action.busy ||
          !v.reason.trim() ||
          (["merge", "coexist", "replace"].includes(v.action) &&
            !v.related_ids.length)
        }
        onClick={async () => {
          if (
            v.action === "replace" &&
            !await confirm("停用所选旧知识的未来用途？历史引用会保留。")
          )
            return;
          const snapshot = v;
          const r = await action.run(`/knowledge/${candidate.id}/decision`, {
            ...v,
            edit_version: candidate.edit_version,
          });
          if (r) {
            draft.saved(snapshot);
            onDone();
          }
        }}
        type="primary"
      >
        保存决定
      </Button>
    </div>
  );
}
