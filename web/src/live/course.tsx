import { Field } from "../shared/Field";
import { ContextAgent } from "./context-agent";
import { useLocationValue } from "./location-state";
import { useConfirm } from "../shared/confirm";
import {
  Drawer,
  Tree,
  Input,
  Card,
  Button,
  Form,
  Select,
  Collapse,
  Typography,
} from "antd";
import { Link } from "./context";
import { useEditorDraft, DraftNotice } from "./editing";
import { KnowledgeGraph } from "./graph";
import { EmptyState, ErrorState, LoadingState, StatusTag, MetaTag, MetaTags } from "../shared/ui";
import { useSearchParams } from "react-router-dom";
import { ResourceNotes } from "./notes";
import { RetrievalPage, JobsPanel } from "./knowledge";
import { RichContent, PublishedAssets } from "./content-render";
import { useEffect, useState } from "react";
import { useSession } from "../shared/session";
import {
  useLearning,
  useLiveQuery,
  useAction,
  Feedback,
  names,
  when,
} from "./context";
export interface Point {
  id: string;
  title: string;
  position: number;
  kind: string;
  parent_id: string | null;
  description: string;
}
export interface Resource {
  id: string;
  title: string;
  content: string;
  source_url: string;
  source_note: string;
  locator: string;
  status: string;
  version: number;
  knowledge_point_id?: string;
  published_at?: string;
  source_id?: string | null;
}
interface Event {
  id: string;
  verb: string;
  resource_id: string;
  occurred_at: string;
}
export function CourseWorkspace({sourceID = ""}: {sourceID?:string} = {}) {
  const confirm = useConfirm();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const { course } = useLearning();
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<Resource[]>("/resources");
  const events = useLiveQuery<Event[]>("/events", !teacher);
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const [editorOpen, setEditorOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useLocationValue("resource_search");
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  function openResource(r: Resource | null) {
    setView(r);
    setParam("resource", r?.id || "");
  }
  const selected = params.get("node") || "";
  const resourceDraft = useEditorDraft(`resource:${course?.id}`, {
    revision_id: "",
    title: "",
    content: "",
    source_url: "",
    source_note: "",
    locator: "第1段",
    knowledge_point_id: "",
  });
  const resource = resourceDraft.value,
    setResource = resourceDraft.change;
  const revisionBase = resource.revision_id;
  const setRevisionBase = (revision_id: string) =>
    resourceDraft.change((v) => ({ ...v, revision_id }));
  const [view, setView] = useState<Resource | null>(null);
  useEffect(() => {
    const id = params.get("resource");
    if (id && resources.data) {
      const found = resources.data.find((r) => r.id === id && (!sourceID || r.source_id === sourceID));
      setView(found || null);
    } else if (!id) setView(null);
  }, [params, resources.data]);
  const selectedNodes = new Set(selected ? [selected] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of ctx.data?.points || []) {
      if (
        p.parent_id &&
        selectedNodes.has(p.parent_id) &&
        !selectedNodes.has(p.id)
      ) {
        selectedNodes.add(p.id);
        changed = true;
      }
    }
  }
  const list = (resources.data || []).filter(
    (r) =>
      (!sourceID || r.source_id === sourceID) &&
      (!selected || selectedNodes.has(r.knowledge_point_id || "")) &&
      r.title.toLowerCase().includes(resourceSearch.toLowerCase()),
  );
  return (
    <div className="live-page">
      {params.get("task") && (
        <Link
          className="context-banner"
          to={`/${teacher ? "teacher" : "student"}/intervention?task=${params.get("task")}`}
        >
          返回补学补练任务，检查完成条件
        </Link>
      )}
      <Feedback
        failed={action.failed}
        error={ctx.error || resources.error}
        message={action.message}
      />
      {course && (
        <>
          <div
            className={
              teacher ? "published-materials" : "live-grid course-content-grid"
            }
          >
            {!teacher && (
              <Card className="card-panel" title={<>课程目录</>}>

                <Button
                  onClick={() => {
                    setParam("node", "");
                  }}
                >
                  全部资料
                </Button>
                <Tree
                  blockNode
                  selectedKeys={selected ? [selected] : []}
                  onSelect={(keys) => {
                    setParam("node", String(keys[0] || ""));
                  }}
                  treeData={buildTree(ctx.data?.points || [])}
                />
                {!ctx.data?.points.length && (
                  <p className="live-meta">尚未维护知识点</p>
                )}
              </Card>
            )}
            <Card className="card-panel">
              <div className="section-head">
                {view && <><Typography.Text strong className="item-title">{view.title}</Typography.Text><ContextAgent context={{kind:"resource",id:view.id,title:view.title}} /></>}
                {teacher && (
                  <Button onClick={() => setEditorOpen(true)} type="primary">
                    新增资料
                  </Button>
                )}
              </div>
              {!view && (
                <Input.Search
                  aria-label="搜索资料"
                  placeholder="搜索资料标题"
                  value={resourceSearch}
                  onChange={(e) => setResourceSearch(e.target.value)}
                  allowClear
                />
              )}
              {view ? (
                <>
                  <MetaTags>
                    <MetaTag>v{view.version}</MetaTag>
                    {view.locator && <MetaTag>{view.locator}</MetaTag>}
                    <span className="live-meta">{when(view.published_at)}</span>
                  </MetaTags>
                  <RichContent text={view.content} />
                  <PublishedAssets kind="resources" id={view.id} />
                  {!teacher && <ResourceNotes key={view.id} resourceId={view.id} />}
                  {view.status === "published" && <Collapse items={[{key:"qa",label:"就本资料提问",children:<RetrievalPage key={view.id} resourceID={view.id} embedded />}]} />}
                  {teacher && view.status === "draft" && <Button type="primary" disabled={action.busy} onClick={async()=>{if(await confirm("确认发布本修订给课程学生？索引由后台单独处理。")) await action.run(`/resources/${view.id}/publish`);}}>审核通过并发布</Button>}
                  {teacher && <JobsPanel kinds={["index"]} />}
                  <p>
                    资料来源：
                    {view.source_note || view.source_url || "尚未登记来源"}
                  </p>
                  {view.source_url && (
                    <p>
                      <Typography.Link
                        href={view.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看原始来源
                      </Typography.Link>
                    </p>
                  )}
                  <div className="live-inline">
                    <Button onClick={() => openResource(null)}>
                      返回资料列表
                    </Button>
                    {!teacher && (
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          action.run(`/resources/${view.id}/events`, {
                            verb: "completed",
                            request_id: crypto.randomUUID(),
                          })
                        }
                        type="primary"
                      >
                        标记完成
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {resources.error ? (
                    <ErrorState
                      message={resources.error.message}
                      onRetry={() => void resources.refetch()}
                    />
                  ) : resources.isPending ? (
                    <LoadingState label="正在读取资料…" />
                  ) : !list.length ? (
                    <EmptyState title="当前没有可用资料">
                      {teacher
                        ? "点击“新增资料”，审核后发布给学生。"
                        : selected
                          ? "该目录下暂无资料，可选择“全部资料”查看。"
                          : "教师发布资料后会显示在这里。"}
                    </EmptyState>
                  ) : (
                    list.map((r) => (
                      <article className="live-row" key={r.id}>
                        <div>
                          <Typography.Text strong className="item-title">{r.title}</Typography.Text>
                          <MetaTags>
                            <StatusTag
                              status={r.status}
                              label={names[r.status]}
                            />
                            <MetaTag>v{r.version}</MetaTag>
                            {r.locator && <MetaTag>{r.locator}</MetaTag>}
                          </MetaTags>
                          {!teacher && (
                            <StatusTag
                              status={events.data?.some(e => e.resource_id === r.id && e.verb === "completed") ? "completed" : "pending"}
                              label={events.data?.some(
                                (e) =>
                                  e.resource_id === r.id &&
                                  e.verb === "completed",
                              )
                                ? "已完成学习"
                                : "待学习"}
                            />
                          )}
                        </div>
                        <div className="live-inline">
                          <Button
                            disabled={action.busy}
                            onClick={async () => {
                              if (!teacher)
                                await action.run(`/resources/${r.id}/events`, {
                                  verb: "opened",
                                  request_id: crypto.randomUUID(),
                                });
                              openResource(r);
                            }}
                          >
                            打开资料
                          </Button>
                          {teacher && r.status === "draft" && (
                            <Button
                              disabled={action.busy}
                              onClick={async () => { if (await confirm("确认发布这份学习资料？发布后学生可见，索引由后台处理。")) await action.run(`/resources/${r.id}/publish`); }}
                              type="primary"
                            >
                              审核通过并发布
                            </Button>
                          )}
                          {teacher && r.status === "published" && (
                            <Button
                              onClick={() => {
                                setRevisionBase(r.id);
                                setEditorOpen(true);
                                setResource({
                                  revision_id: r.id,
                                  title: r.title,
                                  content: r.content,
                                  source_url: r.source_url,
                                  source_note: r.source_note,
                                  locator: r.locator,
                                  knowledge_point_id:
                                    r.knowledge_point_id || "",
                                });
                                document
                                  .getElementById("resource-editor")
                                  ?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              另存资料修订
                            </Button>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </>
              )}
            </Card>
          </div>
          {teacher && (
            <>
              <Drawer
                title={revisionBase ? "创建资料新版本" : "添加资料草稿"}
                open={editorOpen}
                width={680}
                onClose={async () => {
                  if (
                    !resourceDraft.dirty ||
                    await confirm("关闭编辑器？未保存内容会暂存。")
                  )
                    setEditorOpen(false);
                }}
              >
                <section id="resource-editor">
                  <DraftNotice {...resourceDraft} />
                  <Typography.Text strong className="item-title">{revisionBase ? "创建资料新版本" : "添加资料草稿"}</Typography.Text>
                  <Form
                    className="live-form"
                    onFinish={async () => {
                      const created = await action.run<Resource>(
                          revisionBase
                            ? `/resources/${revisionBase}/revisions`
                            : "/resources",
                          resource,
                        );
                      if (created) {
                        if (resourceDraft.saved(resource)) {
                          resourceDraft.reset({
                            revision_id: "",
                            title: "",
                            content: "",
                            source_url: "",
                            source_note: "",
                            locator: "第1段",
                            knowledge_point_id: "",
                          });
                          setEditorOpen(false);
                          openResource(created);
                        }
                      }
                    }}
                    layout="vertical"
                  >
                    <Field
                      className="ui-field"
                      label={<>资料标题</>}
                      required={true}
                    >
                      <Input
                        aria-label="资料标题"
                        required
                        value={resource.title}
                        onChange={(e) =>
                          setResource({ ...resource, title: e.target.value })
                        }
                      />
                    </Field>
                    <Field className="ui-field" label={<>关联知识点</>}>
                      <Select
                        aria-label="关联知识点"
                        value={resource.knowledge_point_id}
                        onChange={(e) =>
                          setResource({
                            ...resource,
                            knowledge_point_id: e,
                          })
                        }
                        showSearch
                        optionFilterProp="children"
                      >
                        <Select.Option value="">课程通用资料</Select.Option>
                        {ctx.data?.points.map((p) => (
                          <Select.Option value={p.id} key={p.id}>
                            {p.title}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      className="ui-field"
                      label={<>资料原文</>}
                      required={true}
                    >
                      <Input.TextArea
                        aria-label="资料原文"
                        required
                        rows={7}
                        value={resource.content}
                        onChange={(e) =>
                          setResource({ ...resource, content: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      className="ui-field"
                      label={<>来源说明</>}
                      required={!resource.source_url}
                    >
                      <Input
                        aria-label="来源说明"
                        maxLength={200}
                        required={!resource.source_url}
                        placeholder="如：教师自编讲义，2026年10月版"
                        value={resource.source_note}
                        onChange={(e) =>
                          setResource({
                            ...resource,
                            source_note: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field className="ui-field" label={<>来源链接</>}>
                      <Input
                        aria-label="来源链接"
                        type="url"
                        value={resource.source_url}
                        onChange={(e) =>
                          setResource({
                            ...resource,
                            source_url: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field
                      className="ui-field"
                      label={<>页码或段落定位</>}
                      required={true}
                    >
                      <Input
                        aria-label="页码或段落定位"
                        required
                        value={resource.locator}
                        onChange={(e) =>
                          setResource({ ...resource, locator: e.target.value })
                        }
                      />
                    </Field>
                    <Button
                      disabled={action.busy}
                      htmlType="submit"
                      type="primary"
                    >
                      保存资料草稿
                    </Button>
                  </Form>
                </section>
              </Drawer>
            </>
          )}
          {!teacher && (
            <Card className="card-panel" title={<>学习记录</>}>

              {events.data
                ?.filter((e) => e.resource_id)
                .slice(0, 20)
                .map((e) => (
                  <p key={e.id}>
                    {e.verb === "completed" ? "完成" : "打开"}：
                    {resources.data?.find((r) => r.id === e.resource_id)
                      ?.title || "资料"}{" "}
                    · {when(e.occurred_at)}
                  </p>
                ))}
              {!events.data?.length && (
                <EmptyState title="还没有学习记录">
                  打开资料开始学习，记录会显示在这里。
                </EmptyState>
              )}
            </Card>
          )}
        </>
      )}
      {course && (
        <>
          {!teacher && (
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
          )}
          {!teacher && (
            <Link className="ghost-btn" to={`/student/retrieval${view?`?resource=${view.id}${params.get("task")?`&task=${params.get("task")}`:""}`:""}`}>
              资料问答
            </Link>
          )}
        </>
      )}
    </div>
  );
}

type CourseTreeNode = {
  key: string;
  title: string;
  children: CourseTreeNode[];
};
function buildTree(
  points: Point[],
  parent: string | null = null,
): CourseTreeNode[] {
  return points
    .filter((p) => p.parent_id === parent)
    .map((p) => ({
      key: p.id,
      title: p.title,
      children: buildTree(points, p.id),
    }));
}
