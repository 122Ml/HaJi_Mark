import { Field } from "../shared/Field";
import { Card, Button, Select, Input } from "antd";
import { useState } from "react";
import { Feedback, Link, useAction, useLiveQuery } from "./context";
import { DecisionHistory } from "./content-topics";

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
};
export function ContentImpactPage() {
  const [selected, setSelected] = useState<Change | null>(null),
    [decision, setDecision] = useState("no_action"),
    [reason, setReason] = useState(""),
    action = useAction();
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
        {q.data?.changes.length ? (
          q.data.changes.map((c) => (
            <div key={c.id} className="live-row">
              <div>
                <h2>{c.title}</h2>
                <p>
                  v{c.version} ·{" "}
                  {c.state === "archived" ? "已归档" : "版本／许可变更"}
                </p>
              </div>
              <Button
                onClick={() => {
                  setSelected(c);
                  setReason("");
                }}
              >
                查看影响
              </Button>
            </div>
          ))
        ) : (
          <p>暂无内容变更</p>
        )}
      </Card>
      {selected && (
        <Card className="card-panel live-form" title={<h2>{selected.title} · 引用影响</h2>}>

          {q.data?.items.map((i) => (
            <div className="live-row" key={`${i.kind}:${i.id}`}>
              <div>
                <strong>
                  {names[i.kind]} · {i.title}
                </strong>
                <p>
                  v{i.version} · {i.state}
                </p>
              </div>
              <Link to={path(i)}>查看</Link>
            </div>
          ))}
          {!q.data?.items.length && <p>未查到关联内容</p>}
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
            onClick={() =>
              action.run("/impact/decisions", {
                kind: selected.kind,
                id: selected.id,
                action: decision,
                reason,
              })
            }
            type="primary"
          >
            保存处理决定
          </Button>
          {decision === "regrade" && (
            <Link to="/teacher/regrades">选择关闭作业并建立批次</Link>
          )}
          <DecisionHistory id={selected.id} />
        </Card>
      )}
    </div>
  );
}
