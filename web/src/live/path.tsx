import { Button, Card, Collapse, List, Tag } from "antd";
import { LoadingState, ErrorState, EmptyState, MetaTag, MetaTags, StatusTag } from "../shared/ui";
import { Link } from "./context";
import { useLiveQuery, useAction, Feedback, when } from "./context";
import type { Resource } from "./course";
import type { Knowledge } from "./knowledge";
interface PathData {
  path: { id: string; created_at: string; rule_version: string };
  items: {
    knowledge_point_id: string;
    title: string;
    description: string;
    reason: string;
    position: number;
  }[];
}
export function StudyPath() {
  const query = useLiveQuery<PathData | null>("/path");
  const resources = useLiveQuery<Resource[]>("/resources");
  const knowledge = useLiveQuery<Knowledge[]>("/knowledge");
  const events =
    useLiveQuery<{ resource_id: string; verb: string }[]>("/events");
  const action = useAction();
  if (query.isPending || resources.isPending || events.isPending || knowledge.isPending)
    return <LoadingState />;
  if (query.error || resources.error || events.error || knowledge.error)
    return (
      <ErrorState
        message={(query.error || resources.error || events.error || knowledge.error)!.message}
        onRetry={() => {
          void query.refetch();
          void resources.refetch();
          void events.refetch();
          void knowledge.refetch();
        }}
      />
    );
  return (
    <div className="live-page">
      <header className="page-actions">
        <Button
          disabled={action.busy}
          onClick={() => action.run("/path")}
          type="primary"
        >
          {query.data ? "重新规划" : "生成学习路径"}
        </Button>
      </header>
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      {query.data ? (
        <>
          <Card className="card-panel" title={<h2>当前路径</h2>}>

            <p>规划于 {when(query.data.path.created_at)}</p>
            <Collapse
              items={[
                {
                  key: "content",
                  label: <>查看规划依据</>,
                  children: (
                    <>
                      <p>
                        优先学习尚无评分或表现低于60%的知识点，并补齐前置知识。
                      </p>
                      <p>{query.data.path.rule_version}</p>
                    </>
                  ),
                },
              ]}
            />
          </Card>
          {!query.data.items.length && (
            <Card className="card-panel">
              <EmptyState title="已完成当前学习路径" />
            </Card>
          )}
          {query.data.items.map((p, i) => {
            const linked =
              resources.data?.filter(
                (r) => r.knowledge_point_id === p.knowledge_point_id,
              ) || [];
            const relatedKnowledge = (knowledge.data || []).filter(k => k.knowledge_point_ids.includes(p.knowledge_point_id));
            return (
              <Card className="card-panel" key={p.knowledge_point_id} title={<h2>
                  {i + 1}. {p.title}
                </h2>}>

                <p>{p.reason}</p>
                <p>{p.description}</p>
                <Collapse items={[{ key: "knowledge", label: `关联精炼知识（${relatedKnowledge.length}）`, children: relatedKnowledge.length ?
                  <List dataSource={relatedKnowledge} pagination={{ pageSize: 5, size: "small" }} renderItem={k => <List.Item actions={[<Link key="read" to={`/student/knowledge?knowledge=${k.id}`}>阅读知识</Link>]}><List.Item.Meta title={<>{k.title} <Tag>v{k.version}</Tag></>} description={k.conditions || "按教师确认的知识点关联推荐"} /></List.Item>} /> :
                  <EmptyState title="暂无可见的关联知识">教师确认并关联知识点后会显示在这里，现有资料学习不受影响。</EmptyState> }]} />
                {linked.length ? (
                  linked.map((r) => (
                    <div className="live-row" key={r.id}>
                      <div>
                        <Link to={`/student/course-content?node=${p.knowledge_point_id}&resource=${r.id}`}>
                          {r.title}
                        </Link>
                        <MetaTags>
                          <StatusTag
                            status={events.data?.some(e => e.resource_id === r.id && e.verb === "completed") ? "completed" : "pending"}
                            label={events.data?.some(e => e.resource_id === r.id && e.verb === "completed") ? "已完成学习" : "待学习"}
                          />
                          {r.locator && <MetaTag>{r.locator}</MetaTag>}
                        </MetaTags>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>当前缺少已审核的对应学习资料，请联系教师补充。</p>
                )}
                <Link to={`/student/homework?point=${p.knowledge_point_id}`}>
                  查看相关作业与反馈
                </Link>
              </Card>
            );
          })}
        </>
      ) : (
        <Card className="card-panel">
          <EmptyState title="尚未生成学习路径" />
        </Card>
      )}
    </div>
  );
}
