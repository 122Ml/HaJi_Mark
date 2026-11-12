import { useState } from "react";
import tree from "../replica/student/course-tree.json";
import { chapters } from "../replica/demo";
import { useAction, useLiveQuery, Feedback, Link } from "./context";
import { Tree } from "antd";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "../shared/ui";
import { KnowledgeGraph } from "./graph";
import type { Point } from "./course";
type Node = { key: string; title: string; children: Node[] };
function nodes(points: Point[], parent: string | null = null): Node[] {
  return points.filter((p) => p.parent_id === parent).map((p) => ({ key: p.id, title: p.title, children: nodes(points, p.id) }));
}
export function CurriculumPage() {
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const action = useAction();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("chapter");
  const [parent, setParent] = useState("");
  return <div className="live-page">
    <PageHeader title="课程目录" />
    <Feedback message={action.message} failed={action.failed} />
    {ctx.isPending ? <LoadingState /> : ctx.error ? <ErrorState message={ctx.error.message} onRetry={() => void ctx.refetch()} /> : <>
      <div className="live-grid course-content-grid">
        <section className="card-panel">
          <h2>章节与知识点</h2>
          {ctx.data?.points.length ? <Tree blockNode defaultExpandAll treeData={nodes(ctx.data.points)} /> : <EmptyState title="目录为空">添加章节、小节和知识点。</EmptyState>}
          <Link className="ghost-btn" to="/teacher/materials">管理学习资料</Link>
        </section>
        <section className="card-panel">
          <h2>添加目录节点</h2>
          <form className="live-form" onSubmit={async (e) => {
            e.preventDefault();
            if (await action.run("/points", { title, kind, parent_id: parent, position: ctx.data?.points.length || 0 })) setTitle("");
          }}>
            <label>目录类型<select aria-label="目录类型" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="chapter">章节</option><option value="section">小节</option><option value="point">知识点</option>
            </select></label>
            <label>所属目录<select aria-label="所属目录" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">顶层目录</option>
              {ctx.data?.points.filter((p) => p.kind !== "point").map((p) => <option value={p.id} key={p.id}>{p.title}</option>)}
            </select></label>
            <label>节点名称<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <button className="primary-link" disabled={action.busy}>添加节点</button>
          </form>
        </section>
      </div>
      <details className="card-panel"><summary>知识依赖关系</summary><KnowledgeGraph /></details>
      {!ctx.data?.points.length && <CurriculumTools />}
    </>}
  </div>;
}
export function CurriculumTools() {
  const action = useAction();
  return (
    <details className="card-panel">
      <summary>导入参考目录</summary>
      <Feedback message={action.message} failed={action.failed} />
          <p className="live-meta">大数据课程目录，不含资料与题目。</p>
          <button
            className="ghost-btn"
            disabled={action.busy}
            onClick={() => {
              if (confirm("向当前空课程导入参考课程目录？"))
                void action.run("/curriculum", {
                  chapters: tree.map((sections, i) => ({
                    title: chapters[i],
                    sections: sections.map((s) => ({
                      title: s.title,
                      points: s.points,
                    })),
                  })),
                });
            }}
          >
            导入参考课程目录
          </button>
    </details>
  );
}
