import { Field } from "../shared/Field";
import { Card, Button, Select, Input, Typography, Drawer } from "antd";
import { useState } from "react";
import { Feedback, Link, names as stateNames, useAction, useLiveQuery, useLearning } from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import { EmptyState, LoadingState, MetaTag, MetaTags, StatusTag } from "../shared/ui";
import { DecisionHistory } from "./content-topics";
import { useSearchParams } from "react-router-dom";
import { CreateRegrade, RegradeDetail } from "./regrades";

type Change = {
  kind: string;
  id: string;
  title: string;
  version: number;
  state: string;
  previous_id: string | null;
};
type Impact = {
  changes: Change[];
  items: {
    kind: string;
    id: string;
    title: string;
    state: string;
    version: number;
    parent_id: string | null;
  }[];
};
const names: Record<string, string> = {
  knowledge: "知识",
  question: "题目",
  rubric: "标准",
  assignment: "作业",
  resource: "资料",
  result: "正式结果",
  assignment_question: "作业题目",
};
export function ContentImpactPage() {
  const [params,setParams] = useSearchParams();
  const changes = useLiveQuery<Impact>("/impact");
  const selected = changes.data?.changes.find(c=>c.id===params.get("change") && c.kind===params.get("change_kind")) || null;
  const { course } = useLearning();
  const draft = useEditorDraft(`impact:${course?.id}:${params.get("change_kind") || ""}:${params.get("change") || ""}`, {decision:"no_action",reason:""}, !!selected);
  const { decision, reason } = draft.value;
  const setDecision = (decision:string) => draft.change(v=>({...v,decision}));
  const setReason = (reason:string) => draft.change(v=>({...v,reason}));
  const action = useAction();
  const [regrade,setRegrade] = useState<{assignmentID:string;questionID:string;reason:string}|null>(null);
  const [batch,setBatch] = useState("");
  const q = useLiveQuery<Impact>(
    `/impact?${new URLSearchParams(selected ? { [selected.kind === "source" ? "source_id" : "knowledge_id"]: selected.previous_id || selected.id } : {})}`,
  );
  function path(i: Impact["items"][number]) {
    switch (i.kind) {
      case "knowledge":
        return `/teacher/knowledge?knowledge=${i.id}`;
      case "question":
        return `/teacher/question-bank?bank_version=${i.id}`;
      case "rubric":
        return `/teacher/question-bank?bank_version=${i.parent_id}`;
      case "assignment":
        return `/teacher/homework/${i.id}`;
      case "assignment_question":
        return `/teacher/homework/${i.parent_id}`;
      case "resource":
        return `/teacher/materials?resource=${i.id}`;
      case "result":
        return `/teacher/homework/${i.parent_id}/submissions`;
      default:
        return "/teacher/dashboard";
    }
  }
  return (
    <div className="live-page">
      <header className="workspace-heading">

        <Link className="ghost-btn" to="/teacher/regrades">
          整组重评
        </Link>
      </header>
      <Feedback error={q.error} />
      <Card className="card-panel">
        {q.isPending ? <LoadingState /> : q.data?.changes.length ? (
          q.data.changes.map((c) => (
            <div key={c.id} className="live-row">
              <div>
                <Typography.Text strong className="item-title">{c.title}</Typography.Text>
                <MetaTags>
                  <StatusTag status={c.state} label={c.state === "archived" ? "已归档" : "版本／许可变更"} />
                  <MetaTag>v{c.version}</MetaTag>
                </MetaTags>
              </div>
              <Button
                onClick={() => {
                  setParams(p=>{const next=new URLSearchParams(p);next.set("change",c.id);next.set("change_kind",c.kind);return next;});
                }}
              >
                查看影响
              </Button>
            </div>
          ))
        ) : (
          <EmptyState title="暂无内容变更" />
        )}
      </Card>
      {selected && draft.ready && (
        <Card className="card-panel live-form" title={<>{selected.title} · 引用影响</>}>
          <DraftNotice {...draft}/>

          {q.data?.items.map((i) => (
            <div className="live-row" key={`${i.kind}:${i.id}`}>
              <div>
                <Typography.Text strong className="item-title">{i.title}</Typography.Text>
                <MetaTags>
                  <StatusTag status={i.state} label={stateNames[i.state] || i.state} />
                  <MetaTag>{names[i.kind]}</MetaTag>
                  <MetaTag>v{i.version}</MetaTag>
                </MetaTags>
              </div>
              <div className="live-inline"><Link to={path(i)}>查看</Link>
                {i.kind === "assignment_question" && i.state === "closed" && <Button disabled={!reason.trim()} onClick={()=>{setBatch("");setRegrade({assignmentID:i.parent_id!,questionID:i.id,reason:`${reason}\n内容变更：${selected.title} v${selected.version}（${selected.kind}:${selected.id}）`});}}>就此题建立整组重评</Button>}
              </div>
            </div>
          ))}
          {!q.data?.items.length && <EmptyState title="未查到关联内容" />}
          <Field className="ui-field" label={<>处理决定</>}>
            <Select
              aria-label="处理决定"
              value={decision}
              onChange={(e) => setDecision(e)}
              showSearch
              optionFilterProp="children"
            >
              <Select.Option value="no_action">无需处理历史内容</Select.Option>
              <Select.Option value="future_version">
                后续任务选用新版
              </Select.Option>
              <Select.Option value="regrade">安排整组重评</Select.Option>
            </Select>
          </Field>
          <Field className="ui-field" label={<>处理原因</>}>
            <Input.TextArea
              aria-label="处理原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Feedback message={action.message} failed={action.failed} />
          <Button
            disabled={action.busy || !reason.trim()}
            onClick={async () => {
              const snapshot = draft.value;
              if (await action.run("/impact/decisions", {
                kind: selected.kind,
                id: selected.id,
                action: decision,
                reason,
              })) draft.saved(snapshot);
            }}
            type="primary"
          >
            保存处理决定
          </Button>
          {decision === "regrade" && (
            <p>填写原因后，在上方已关闭的作业题目旁建立批次；预览、冻结、逐份确认和统一发布均须分别执行。</p>
          )}
          <DecisionHistory id={selected.id} />
        </Card>
      )}
      <Drawer title="内容变更 · 整组重评" open={!!regrade} width={900} destroyOnHidden onClose={()=>setRegrade(null)}>
        {batch ? <RegradeDetail id={batch}/> : regrade && <CreateRegrade initial={regrade} onCreated={setBatch}/>}
      </Drawer>
    </div>
  );
}
