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
    <section className="card-panel">
      <h2>知识图谱与前置依赖</h2>
      <Feedback error={query.error} message={action.message} />
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
        <form
          className="live-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run("/edges", { from_id: from, to_id: to });
          }}
        >
          <label>
            前置知识点
            <select
              aria-label="前置知识点"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">请选择</option>
              {nodes.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <span>→</span>
          <label>
            后续知识点
            <select
              aria-label="后续知识点"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">请选择</option>
              {nodes.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-btn" disabled={action.busy}>
            保存依赖
          </button>
        </form>
      )}
    </section>
  );
}
