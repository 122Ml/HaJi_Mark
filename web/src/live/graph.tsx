import { Field } from "../shared/Field";
import { Card, Form, Select, Button } from "antd";
import { useState } from "react";
import { useSession } from "../shared/session";
import { useLiveQuery, useAction, Feedback } from "./context";
import type { Point } from "./course";
export function KnowledgeGraph() {
  const query = useLiveQuery<{
    nodes: Point[];
    edges: { from_id: string; to_id: string }[];
  }>("/graph");
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const action = useAction();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const nodes = query.data?.nodes.filter((p) => p.kind === "point") || [];
  return (
    <Card className="card-panel" title={<h2>知识图谱与前置依赖</h2>}>

      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <div className="live-graph">
        {nodes.map((p) => (
          <article className="live-graph-node" key={p.id}>
            <strong>{p.title}</strong>
            <p>{p.description || "课程知识点"}</p>
            <small>
              前置：
              {query.data?.edges
                .filter((e) => e.to_id === p.id)
                .map((e) => nodes.find((n) => n.id === e.from_id)?.title)
                .join("、") || "无已登记依赖"}
            </small>
          </article>
        ))}
      </div>
      {!nodes.length && <p>尚未维护知识点。</p>}
      {teacher && (
        <Form
          className="live-inline"
          onFinish={() => {
            void action.run("/edges", { from_id: from, to_id: to });
          }}
          layout="vertical"
        >
          <Field
            className="ui-field"
            label={<>前置知识点</>}
            name="from" getValueProps={() => ({ value: from })}
            rules={[{ validator: async () => { if (!from) throw Error("请选择前置知识点"); } }]}
            required={true}
          >
            <Select
              aria-label="前置知识点"
              value={from}
              onChange={(e) => setFrom(e)}
              showSearch
              optionFilterProp="children"
            >
              <Select.Option value="">请选择</Select.Option>
              {nodes.map((p) => (
                <Select.Option value={p.id} key={p.id}>
                  {p.title}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <span>→</span>
          <Field
            className="ui-field"
            label={<>后续知识点</>}
            name="to" getValueProps={() => ({ value: to })}
            rules={[{ validator: async () => { if (!to) throw Error("请选择后续知识点"); } }]}
            required={true}
          >
            <Select
              aria-label="后续知识点"
              value={to}
              onChange={(e) => setTo(e)}
              showSearch
              optionFilterProp="children"
            >
              <Select.Option value="">请选择</Select.Option>
              {nodes.map((p) => (
                <Select.Option value={p.id} key={p.id}>
                  {p.title}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Button disabled={action.busy} htmlType="submit">
            保存依赖
          </Button>
        </Form>
      )}
    </Card>
  );
}
