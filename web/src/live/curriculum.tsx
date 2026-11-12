import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { useState } from "react";
import tree from "../replica/student/course-tree.json";
import { chapters } from "../replica/demo";
import { useAction, useLiveQuery, Feedback, Link } from "./context";
import { Tree, Card, Form, Select, Input, Button, Collapse } from "antd";
import { LoadingState, ErrorState, EmptyState } from "../shared/ui";
import { KnowledgeGraph } from "./graph";
import type { Point } from "./course";
type Node = { key: string; title: string; children: Node[] };
function nodes(points: Point[], parent: string | null = null): Node[] {
  return points
    .filter((p) => p.parent_id === parent)
    .map((p) => ({ key: p.id, title: p.title, children: nodes(points, p.id) }));
}
export function CurriculumPage() {
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const action = useAction();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("chapter");
  const [parent, setParent] = useState("");
  return (
    <div className="live-page">
      <Feedback message={action.message} failed={action.failed} />
      {ctx.isPending ? (
        <LoadingState />
      ) : ctx.error ? (
        <ErrorState
          message={ctx.error.message}
          onRetry={() => void ctx.refetch()}
        />
      ) : (
        <>
          <div className="live-grid course-content-grid">
            <Card className="card-panel" title={<h2>章节与知识点</h2>}>

              {ctx.data?.points.length ? (
                <Tree
                  blockNode
                  defaultExpandAll
                  treeData={nodes(ctx.data.points)}
                />
              ) : (
                <EmptyState title="目录为空">
                  添加章节、小节和知识点。
                </EmptyState>
              )}
              <Link className="ghost-btn" to="/teacher/materials">
                管理学习资料
              </Link>
            </Card>
            <Card className="card-panel" title={<h2>添加目录节点</h2>}>

              <Form
                className="live-form"
                onFinish={async () => {
                  if (
                    await action.run("/points", {
                      title,
                      kind,
                      parent_id: parent,
                      position: ctx.data?.points.length || 0,
                    })
                  )
                    setTitle("");
                }}
                layout="vertical"
              >
                <Field className="ui-field" label={<>目录类型</>}>
                  <Select
                    aria-label="目录类型"
                    value={kind}
                    onChange={(e) => setKind(e)}
                    showSearch
                    optionFilterProp="children"
                  >
                    <Select.Option value="chapter">章节</Select.Option>
                    <Select.Option value="section">小节</Select.Option>
                    <Select.Option value="point">知识点</Select.Option>
                  </Select>
                </Field>
                <Field className="ui-field" label={<>所属目录</>}>
                  <Select
                    aria-label="所属目录"
                    value={parent}
                    onChange={(e) => setParent(e)}
                    showSearch
                    optionFilterProp="children"
                  >
                    <Select.Option value="">顶层目录</Select.Option>
                    {ctx.data?.points
                      .filter((p) => p.kind !== "point")
                      .map((p) => (
                        <Select.Option value={p.id} key={p.id}>
                          {p.title}
                        </Select.Option>
                      ))}
                  </Select>
                </Field>
                <Field
                  className="ui-field"
                  label={<>节点名称</>}
                  required={true}
                >
                  <Input
                    aria-label="节点名称"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Button disabled={action.busy} htmlType="submit" type="primary">
                  添加节点
                </Button>
              </Form>
            </Card>
          </div>
          <Collapse
            className="card-panel"
            items={[
              {
                key: "content",
                label: <>知识依赖关系</>,
                children: (
                  <>
                    <KnowledgeGraph />
                  </>
                ),
              },
            ]}
          />
          {!ctx.data?.points.length && <CurriculumTools />}
        </>
      )}
    </div>
  );
}
export function CurriculumTools() {
  const confirm = useConfirm();
  const action = useAction();
  return (
    <Collapse
      className="card-panel"
      items={[
        {
          key: "content",
          label: <>导入参考目录</>,
          children: (
            <>
              <Feedback message={action.message} failed={action.failed} />
              <p className="live-meta">大数据课程目录，不含资料与题目。</p>
              <Button
                disabled={action.busy}
                onClick={async () => {
                  if (await confirm("向当前空课程导入参考课程目录？"))
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
              </Button>
            </>
          ),
        },
      ]}
    />
  );
}
