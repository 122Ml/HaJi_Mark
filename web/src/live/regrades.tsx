import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { Button, Card, Select, Input, InputNumber, Alert, Typography } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Feedback, Link, useAction, useLiveQuery } from "./context";
import { LoadingState, EmptyState, MetaTag, MetaTags, StatusTag } from "../shared/ui";
import { ModelSelect, FrozenEvidence, useJob, type Job } from "./knowledge";
import { DraftNotice, useEditorDraft } from "./editing";
import { RichContent } from "./content-render";
import type { RubricVersion } from "./rubrics";
import type { BankVersion } from "./question-bank";

type Question = {
  id: string;
  prompt: string;
  type: string;
  max_score: number;
  options: string[];
  bank_question_version_id: string | null;
};
type Batch = {
  id: string;
  question_id: string;
  state: string;
  reason: string;
  rubric_id: string | null;
  correct_answer: string;
  question_snapshot: Question;
};
type Item = {
  submission_id: string;
  answer_text: string;
  answer_sha256: string;
  display_name: string;
  attempt: number;
  score: number | null;
  feedback: string;
  point_scores: {
    criterion_id: string;
    score: number;
    feedback: string;
    quote: string;
  }[];
  confirmed: boolean;
  edit_version: number;
  ai_job_id: string | null;
};
type Detail = { batch: Batch; items: Item[]; rubric: RubricVersion | null };
const stateNames: Record<string, string> = {
  active: "待复核",
  released: "已统一发布",
  canceled: "已取消",
};
export function RegradesPage() {
  const q = useLiveQuery<Batch[]>("/regrades"),
    [params, setParams] = useSearchParams();
  const creating = params.get("new") === "1";
  const setCreating = (v:boolean) => setParams(p=>{ const next=new URLSearchParams(p); v ? next.set("new","1") : next.delete("new"); return next; });
  const id = params.get("batch") || "";
  return (
    <div className="live-page">
      <header className="workspace-heading">
        <Button onClick={() => setCreating(!creating)} type="primary">
          {creating ? "收起" : "建立重评批次"}
        </Button>
      </header>
      <Feedback error={q.error} />
      {creating && (
        <CreateRegrade
          onCreated={(id) => {
            const p = new URLSearchParams(params);
            p.set("batch", id);
            p.delete("new");
            setParams(p);
          }}
        />
      )}
      <Card className="card-panel">
        {q.isPending ? <LoadingState /> : q.data?.length ? (
          q.data.map((b) => (
            <div className="live-row" key={b.id}>
              <div>
                <Typography.Text strong className="item-title">{b.question_snapshot.prompt.slice(0, 100)}</Typography.Text>
                <p>{b.reason}</p>
                <StatusTag status={b.state} label={stateNames[b.state]} />
              </div>
              <Button
                onClick={() => {
                  const p = new URLSearchParams(params);
                  p.set("batch", b.id);
                  setParams(p);
                }}
              >
                查看批次
              </Button>
            </div>
          ))
        ) : (
          <EmptyState title="暂无重评批次" />
        )}
      </Card>
      {id && <RegradeDetail key={id} id={id} />}
    </div>
  );
}
export function CreateRegrade({ onCreated, initial }: { onCreated: (id: string) => void; initial?: {assignmentID:string;questionID:string;reason:string} }) {
  const [params] = useSearchParams();
  const assignments =
    useLiveQuery<{ id: string; title: string; status: string }[]>(
      "/assignments",
    );
  const [assignment, setAssignment] = useState(initial?.assignmentID || params.get("assignment") || ""),
    [question, setQuestion] = useState(initial?.questionID || params.get("question") || ""),
    [version, setVersion] = useState(""),
    [rubric, setRubric] = useState(""),
    [answer, setAnswer] = useState(""),
    [reason, setReason] = useState(initial?.reason || params.get("reason") || "");
  const [preview, setPreview] = useState<{ count: number } | null>(null),
    action = useAction();
  const detail = useLiveQuery<{ questions: Question[] }>(
      `/assignments/${assignment}`,
      !!assignment,
    ),
    current = detail.data?.questions.find((q) => q.id === question);
  const original = useLiveQuery<BankVersion>(
    `/question-bank/versions/${current?.bank_question_version_id}`,
    !!current?.bank_question_version_id,
  );
  const bank = useLiveQuery<{ versions: BankVersion[] }>(
    `/question-bank/${original.data?.bank_id}`,
    !!original.data?.bank_id,
  );
  const rubrics = useLiveQuery<RubricVersion[]>(
    current?.bank_question_version_id
      ? `/question-bank/versions/${version || current.bank_question_version_id}/rubrics`
      : `/questions/${question}/rubrics`,
    !!current && current.type !== "quiz",
  );
  const payload = {
    question_id: question,
    rubric_id: current?.type === "quiz" ? "" : rubric,
    correct_answer: answer,
    reason,
  };
  const previewKey = JSON.stringify(payload);
  useEffect(()=>setPreview(null),[previewKey]);
  return (
    <Card className="card-panel live-form" onChange={() => setPreview(null)} title={<>冻结本题有效提交</>}>

      <Field className="ui-field" label={<>已关闭作业</>}>
        <Select
          aria-label="已关闭作业"
          value={assignment}
          onChange={(e) => {
            setAssignment(e);
            setQuestion("");
            setRubric("");
            setVersion("");
          }}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">请选择</Select.Option>
          {assignments.data
            ?.filter((a) => a.status === "closed")
            .map((a) => (
              <Select.Option key={a.id} value={a.id}>
                {a.title}
              </Select.Option>
            ))}
        </Select>
      </Field>
      <Field className="ui-field" label={<>题目</>}>
        <Select
          aria-label="重评题目"
          value={question}
          onChange={(e) => {
            setQuestion(e);
            setRubric("");
            setVersion("");
            setAnswer("");
          }}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">请选择</Select.Option>
          {detail.data?.questions.map((q) => (
            <Select.Option key={q.id} value={q.id}>
              {q.prompt.slice(0, 100)}
            </Select.Option>
          ))}
        </Select>
      </Field>
      {current?.type === "quiz" ? (
        <Field className="ui-field" label={<>更正答案</>}>
          <Select
            aria-label="更正答案"
            value={answer}
            onChange={(e) => setAnswer(e)}
            showSearch
            optionFilterProp="children"
          >
            <Select.Option value="">请选择</Select.Option>
            {current.options.map((o, i) => (
              <Select.Option key={i} value={o}>
                {o}
              </Select.Option>
            ))}
          </Select>
        </Field>
      ) : (
        current && (
          <>
            {current.bank_question_version_id && (
              <Field className="ui-field" label={<>题库确认版本</>}>
                <Select
                  aria-label="题库确认版本"
                  value={version || current.bank_question_version_id}
                  onChange={(e) => {
                    setVersion(e);
                    setRubric("");
                  }}
                  showSearch
                  optionFilterProp="children"
                >
                  {bank.data?.versions
                    .filter((v) => v.state === "confirmed")
                    .map((v) => (
                      <Select.Option key={v.id} value={v.id}>
                        v{v.version} · {v.title}
                      </Select.Option>
                    ))}
                </Select>
              </Field>
            )}
            <Field className="ui-field" label={<>统一新标准</>}>
              <Select
                aria-label="统一新标准"
                value={rubric}
                onChange={(e) => setRubric(e)}
                showSearch
                optionFilterProp="children"
              >
                <Select.Option value="">请选择已确认标准</Select.Option>
                {rubrics.data
                  ?.filter((r) => r.state === "confirmed")
                  .map((r) => (
                    <Select.Option key={r.id} value={r.id}>
                      标准 v{r.version} ·{" "}
                      {r.criteria.map((c) => c.title).join("、")}
                    </Select.Option>
                  ))}
              </Select>
            </Field>
          </>
        )
      )}
      <Field className="ui-field" label={<>重评原因</>}>
        <Input.TextArea
          aria-label="重评原因"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Feedback
        error={detail.error || rubrics.error}
        message={action.message}
        failed={action.failed}
      />
      <Button
        disabled={
          action.busy ||
          !question ||
          !reason.trim() ||
          !(current?.type === "quiz" ? answer : rubric)
        }
        onClick={async () => {
          const p = await action.run<{ count: number }>("/regrades", {
            ...payload,
            preview: true,
          });
          if (p) setPreview(p);
        }}
      >
        预览范围
      </Button>
      {preview && (
        <div>
          <p>
            本题 {preview.count}{" "}
            份有效提交；每名学生取最新正式提交，未交不补零。
          </p>
          <Button
            disabled={action.busy}
            onClick={async () => {
              const b = await action.run<Batch>("/regrades", payload);
              if (b) onCreated(b.id);
            }}
            type="primary"
          >
            确认冻结并建立批次
          </Button>
        </div>
      )}
    </Card>
  );
}
export function RegradeDetail({ id }: { id: string }) {
  const confirm = useConfirm();
  const q = useLiveQuery<Detail>(`/regrades/${id}`),
    action = useAction(),
    [selected, setSelected] = useState("");
  const d = q.data;
  if (q.isPending) return <LoadingState />;
  if (!d) return <Feedback error={q.error} />;
  const item = d.items.find((i) => i.submission_id === selected) || d.items[0],
    done = d.items.filter((i) => i.confirmed).length;
  return (
    <Card className="card-panel live-form">
      <div className="workspace-heading">
        <MetaTags>
          <StatusTag status={d.batch.state} label={stateNames[d.batch.state]} />
          <MetaTag>已确认 {done}/{d.items.length}</MetaTag>
        </MetaTags>
        <div className="live-inline">
          <Button
            disabled={
              action.busy ||
              d.batch.state !== "active" ||
              done !== d.items.length
            }
            onClick={async () => {
              if (await confirm("统一发布整组新结果？"))
                void action.run(`/regrades/${id}/state`, { state: "released" });
            }}
            type="primary"
          >
            整组发布
          </Button>
          <Button
            disabled={action.busy || d.batch.state !== "active"}
            onClick={async () => {
              if (await confirm("取消批次并保留原有正式结果？"))
                void action.run(`/regrades/${id}/state`, { state: "canceled" });
            }}
          >
            取消批次
          </Button>
        </div>
      </div>
      <RichContent text={d.batch.question_snapshot.prompt} />
      <p>{d.batch.reason}</p>
      <FrozenEvidence sources={d.rubric?.evidence_refs} />
      <Feedback message={action.message} failed={action.failed} />
      <Field className="ui-field" label={<>冻结名单</>}>
        <Select
          aria-label="冻结名单"
          value={item?.submission_id || ""}
          onChange={(e) => setSelected(e)}
          showSearch
          optionFilterProp="children"
        >
          {d.items.map((i) => (
            <Select.Option key={i.submission_id} value={i.submission_id}>
              {i.display_name} · 第{i.attempt}次 ·{" "}
              {i.confirmed ? "已确认" : "待复核"}
            </Select.Option>
          ))}
        </Select>
      </Field>
      {item && (
        <RegradeEditor
          key={`${item.submission_id}:${item.edit_version}`}
          batch={d.batch}
          item={item}
          rubric={d.rubric}
        />
      )}
    </Card>
  );
}
function RegradeEditor({
  batch,
  item,
  rubric,
}: {
  batch: Batch;
  item: Item;
  rubric: RubricVersion | null;
}) {
  const confirm = useConfirm();
  const action = useAction(),
    [model, setModel] = useState(""),
    [job, setJob] = useState("");
  const ai = useJob(job);
  const draft = useEditorDraft(
    `regrade:${batch.id}:${item.submission_id}:${item.edit_version}`,
    {
      score: item.score || 0,
      feedback: item.feedback,
      points:
        rubric?.criteria.map(
          (c) =>
            item.point_scores.find((p) => p.criterion_id === c.id) || {
              criterion_id: c.id,
              score: 0,
              feedback: "",
              quote: "",
            },
        ) || [],
      ai_job_id: item.ai_job_id || "",
    },
  );
  const v = draft.value;
  const max = batch.question_snapshot.max_score;
  function point(index: number, patch: Partial<(typeof v.points)[number]>) {
    draft.change({
      ...v,
      points: v.points.map((p, i) => (index === i ? { ...p, ...patch } : p)),
    });
  }
  const total = rubric
    ? v.points.reduce((a, b) => a + b.score, 0)
    : item.answer_text === batch.correct_answer
      ? max
      : 0;
  return (
    <div className="regrade-editor">
      <article>
        <Typography.Text strong className="item-title">{item.display_name} · 作答原文</Typography.Text>
        <pre className="live-prose">{item.answer_text || "（空白）"}</pre>
        <Link to={`/teacher/homework/submissions/${item.submission_id}/grade`}>
          查看原有评分历史
        </Link>
      </article>
      <div className="live-form">
        <DraftNotice {...draft} />
        {batch.state === "active" && rubric && (
          <div className="rag-ai-tool">
            <div className="live-inline">
              <ModelSelect kind="chat" value={model} onChange={setModel} />
              <Button
                disabled={
                  action.busy ||
                  ["queued", "running"].includes(ai.data?.state || "")
                }
                onClick={async () => {
                  const j = await action.run<Job>(
                    `/regrades/${batch.id}/items/${item.submission_id}/ai`,
                    { profile_id: model },
                  );
                  if (j) setJob(j.id);
                }}
              >
                生成本份重评草稿
              </Button>
            </div>
            {ai.data?.state === "failed" && <Alert type="error" showIcon role="alert" message={<>{ai.data.error}</>} />}
            {ai.data?.state === "succeeded" && (
              <Button
                onClick={async () => {
                  if (draft.dirty && !await confirm("载入AI草稿？")) return;
                  const o = ai.data!.output as {
                    score: number;
                    feedback: string;
                    points: typeof v.points;
                  };
                  draft.change({ ...o, ai_job_id: job });
                }}
              >
                载入评分草稿
              </Button>
            )}
          </div>
        )}
        {rubric?.criteria.map((c, i) => (
          <Card
            size="small"
            key={c.id}
            title={
              <>
                {c.title} · {c.max_score}分
              </>
            }
          >
            <p>{c.rule}</p>
            <Field className="ui-field" label={<>得分</>}>
              <InputNumber
                aria-label="得分"
                min={0}
                max={c.max_score}
                value={v.points[i]?.score || 0}
                onChange={(e) => point(i, { score: Number(String(e ?? "")) })}
                disabled={batch.state !== "active"}
              />
            </Field>
            <Field className="ui-field" label={<>学生原文引用</>}>
              <Input.TextArea
                aria-label="学生原文引用"
                value={v.points[i]?.quote || ""}
                onChange={(e) => point(i, { quote: e.target.value })}
                disabled={batch.state !== "active"}
              />
            </Field>
            <Field className="ui-field" label={<>逐点反馈</>}>
              <Input.TextArea
                aria-label="逐点反馈"
                value={v.points[i]?.feedback || ""}
                onChange={(e) => point(i, { feedback: e.target.value })}
                disabled={batch.state !== "active"}
              />
            </Field>
          </Card>
        ))}
        <strong>
          总分 {total}/{max}
        </strong>
        {!rubric && <p>按本批固定答案「{batch.correct_answer}」判分</p>}
        <Field className="ui-field" label={<>总反馈</>}>
          <Input.TextArea
            aria-label="总反馈"
            disabled={batch.state !== "active"}
            value={v.feedback}
            onChange={(e) => draft.change({ ...v, feedback: e.target.value })}
          />
        </Field>
        <Feedback
          error={ai.error}
          message={action.message}
          failed={action.failed}
        />
        <div className="live-inline">
          {[false, true].map((confirmed) => (
            <Button
              key={String(confirmed)}
              disabled={
                action.busy || batch.state !== "active" || !v.feedback.trim()
              }
              onClick={async () => {
                const snapshot = v;
                const r = await action.run(
                  `/regrades/${batch.id}/items/${item.submission_id}`,
                  {
                    ...v,
                    score: total,
                    confirmed,
                    edit_version: item.edit_version,
                  },
                  "PUT",
                );
                if (r) draft.saved(snapshot);
              }}
              type={confirmed ? "primary" : "default"}
            >
              {confirmed ? "确认本份" : "保存草稿"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
