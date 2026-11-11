import { Tabs, Drawer, Tree, Input } from "antd";
import { Link } from "./context";
import { useEditorDraft, DraftNotice } from "./editing";
import { KnowledgeGraph } from "./graph";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusTag,
} from "../shared/ui";
import { CurriculumTools } from "./curriculum";
import { useSearchParams } from "react-router-dom";
import { ResourceNotes } from "./notes";
import { LearningAssistant } from "./assistant";
import { RichContent, PublishedAssets } from "./content-render";
import { useEffect, useState } from "react";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
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
}
interface Member {
  id: string;
  display_name: string;
  username: string;
}
interface Event {
  id: string;
  verb: string;
  resource_id: string;
  occurred_at: string;
}
export function CourseWorkspace() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const { course, reload } = useLearning();
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<Resource[]>("/resources");
  const events = useLiveQuery<Event[]>("/events");
  const members = useLiveQuery<Member[]>("/members", teacher);
  const action = useAction();
  const [newCourse, setNewCourse] = useState("");
  const [point, setPoint] = useState("");
  const [username, setUsername] = useState("");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "content";
  const [editorOpen, setEditorOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useState("");
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
  const [nodeKind, setNodeKind] = useState("point");
  const [parentID, setParentID] = useState("");
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
  const [notice, setNotice] = useState("");
  const revisionBase = resource.revision_id;
  const setRevisionBase = (revision_id: string) =>
    resourceDraft.change((v) => ({ ...v, revision_id }));
  const [student, setStudent] = useState({
    username: "",
    display_name: "",
    password: "",
  });
  const [view, setView] = useState<Resource | null>(null);
  useEffect(() => {
    const id = params.get("resource");
    if (id && resources.data) {
      const found = resources.data.find((r) => r.id === id);
      setView(found || null);
    } else if (!id) setView(null);
  }, [params, resources.data]);
  async function createCourse() {
    try {
      await requestJSON(
        "/learning/courses",
        { method: "POST", body: JSON.stringify({ title: newCourse }) },
        session?.csrf_token,
      );
      setNewCourse("");
      reload();
      setNotice("课程已创建，请从顶部选择新课程");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
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
      (!selected || selectedNodes.has(r.knowledge_point_id || "")) &&
      r.title.toLowerCase().includes(resourceSearch.toLowerCase()),
  );
  return (
    <div className="live-page">
      <PageHeader
        eyebrow={teacher ? "课程与资源" : "课程学习"}
        title={teacher ? "课程与资料" : "学习中心"}
      />
      {params.get("task") && (
        <Link
          className="context-banner"
          to={`/${teacher ? "teacher" : "student"}/intervention?task=${params.get("task")}`}
        >
          返回补学补练任务，检查完成条件
        </Link>
      )}
      {teacher && course && (
        <Tabs
          activeKey={tab}
          onChange={(v) => setParam("tab", v)}
          items={[
            { key: "content", label: "内容与目录" },
            { key: "work", label: "作业与标准" },
            { key: "members", label: "学生与进度" },
            { key: "settings", label: "课程设置" },
          ]}
        />
      )}
      {teacher && tab === "work" && (
        <section className="card-panel">
          <h2>作业与评分标准</h2>
          <div className="live-inline">
            <Link className="primary-link" to="/teacher/homework">
              管理作业与标准
            </Link>
            <Link className="ghost-btn" to="/teacher/quiz">
              管理测验
            </Link>
          </div>
        </section>
      )}
      <Feedback
        failed={action.failed}
        error={ctx.error || resources.error}
        message={notice || action.message}
      />
      {teacher && (tab === "settings" || !course) && (
        <section className="card-panel">
          <h2>课程管理</h2>
          <div className="live-inline">
            <label>
              新课程名称
              <input
                value={newCourse}
                onChange={(e) => setNewCourse(e.target.value)}
              />
            </label>
            <button
              className="primary-link"
              disabled={!newCourse.trim()}
              onClick={createCourse}
            >
              新建课程
            </button>
            {course?.status === "draft" && (
              <button
                className="ghost-btn"
                disabled={action.busy}
                onClick={() => action.run("/publish")}
              >
                发布课程底座
              </button>
            )}
          </div>
        </section>
      )}
      {course && (
        <>
          {teacher && tab === "settings" && <CurriculumTools />}
          {(!teacher || tab === "content") && (
            <div className="live-grid course-content-grid">
              <aside className="card-panel">
                <h2>课程目录</h2>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setParam("node", "");
                  }}
                >
                  全部资料
                </button>
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
                {teacher && (
                  <details>
                    <summary>添加目录节点</summary>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await action.run("/points", {
                            title: point,
                            position: ctx.data?.points.length || 0,
                            kind: nodeKind,
                            parent_id: parentID,
                          })
                        )
                          setPoint("");
                      }}
                    >
                      <label>
                        目录类型
                        <select
                          aria-label="目录类型"
                          value={nodeKind}
                          onChange={(e) => setNodeKind(e.target.value)}
                        >
                          <option value="point">知识点</option>
                          <option value="chapter">章节</option>
                          <option value="section">小节</option>
                        </select>
                      </label>
                      <label>
                        所属目录
                        <select
                          aria-label="所属目录"
                          value={parentID}
                          onChange={(e) => setParentID(e.target.value)}
                        >
                          <option value="">顶层目录</option>
                          {ctx.data?.points
                            .filter((p) => p.kind !== "point")
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        知识点名称
                        <input
                          required
                          value={point}
                          onChange={(e) => setPoint(e.target.value)}
                        />
                      </label>
                      <button className="ghost-btn" disabled={action.busy}>
                        添加知识点
                      </button>
                    </form>
                  </details>
                )}
              </aside>
              <section className="card-panel">
                <div className="section-head">
                  <h2>{view ? view.title : "学习资料"}</h2>
                  {teacher && (
                    <button
                      className="primary-link"
                      onClick={() => setEditorOpen(true)}
                    >
                      新增资料
                    </button>
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
                    <p className="live-meta">
                      {view.locator} · v{view.version} ·{" "}
                      {when(view.published_at)}
                    </p>
                    <RichContent text={view.content} />
                    <PublishedAssets kind="resources" id={view.id} />
                    {!teacher && (
                      <ResourceNotes key={view.id} resourceId={view.id} />
                    )}
                    <p>
                      资料来源：
                      {view.source_note || view.source_url || "尚未登记来源"}
                    </p>
                    {view.source_url && (
                      <p>
                        <a
                          href={view.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看原始来源
                        </a>
                      </p>
                    )}
                    <div className="live-inline">
                      <button
                        className="ghost-btn"
                        onClick={() => openResource(null)}
                      >
                        返回资料列表
                      </button>
                      {!teacher && (
                        <button
                          className="primary-link"
                          disabled={action.busy}
                          onClick={() =>
                            action.run(`/resources/${view.id}/events`, {
                              verb: "completed",
                              request_id: crypto.randomUUID(),
                            })
                          }
                        >
                          标记完成
                        </button>
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
                            <h3>{r.title}</h3>
                            <p>
                              <StatusTag
                                status={r.status}
                                label={names[r.status]}
                              />{" "}
                              {r.locator} · v{r.version}
                            </p>
                            {!teacher && (
                              <small>
                                {events.data?.some(
                                  (e) =>
                                    e.resource_id === r.id &&
                                    e.verb === "completed",
                                )
                                  ? "已完成学习"
                                  : "待学习"}
                              </small>
                            )}
                          </div>
                          <div className="live-inline">
                            <button
                              className="ghost-btn"
                              disabled={action.busy}
                              onClick={async () => {
                                if (!teacher)
                                  await action.run(
                                    `/resources/${r.id}/events`,
                                    {
                                      verb: "opened",
                                      request_id: crypto.randomUUID(),
                                    },
                                  );
                                openResource(r);
                              }}
                            >
                              打开资料
                            </button>
                            {teacher && r.status === "draft" && (
                              <button
                                className="primary-link"
                                disabled={action.busy}
                                onClick={() =>
                                  action.run(`/resources/${r.id}/publish`)
                                }
                              >
                                审核通过并发布
                              </button>
                            )}
                            {teacher && r.status === "published" && (
                              <button
                                className="ghost-btn"
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
                              </button>
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </>
                )}
              </section>
            </div>
          )}
          {teacher && (
            <>
              <Drawer
                title={revisionBase ? "创建资料新版本" : "添加资料草稿"}
                open={editorOpen}
                width={680}
                onClose={() => {
                  if (
                    !resourceDraft.dirty ||
                    confirm("关闭编辑器？未保存内容会暂存。")
                  )
                    setEditorOpen(false);
                }}
              >
                <section id="resource-editor">
                  <DraftNotice {...resourceDraft} />
                  <h2>{revisionBase ? "创建资料新版本" : "添加资料草稿"}</h2>
                  <form
                    className="live-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await action.run(
                          revisionBase
                            ? `/resources/${revisionBase}/revisions`
                            : "/resources",
                          resource,
                        )
                      ) {
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
                        }
                      }
                    }}
                  >
                    <label>
                      资料标题
                      <input
                        required
                        value={resource.title}
                        onChange={(e) =>
                          setResource({ ...resource, title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      关联知识点
                      <select
                        aria-label="关联知识点"
                        value={resource.knowledge_point_id}
                        onChange={(e) =>
                          setResource({
                            ...resource,
                            knowledge_point_id: e.target.value,
                          })
                        }
                      >
                        <option value="">课程通用资料</option>
                        {ctx.data?.points.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      资料原文
                      <textarea
                        aria-label="资料原文"
                        required
                        rows={7}
                        value={resource.content}
                        onChange={(e) =>
                          setResource({ ...resource, content: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      来源说明
                      <input
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
                    </label>
                    <label>
                      来源链接
                      <input
                        type="url"
                        value={resource.source_url}
                        onChange={(e) =>
                          setResource({
                            ...resource,
                            source_url: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      页码或段落定位
                      <input
                        required
                        value={resource.locator}
                        onChange={(e) =>
                          setResource({ ...resource, locator: e.target.value })
                        }
                      />
                    </label>
                    <button className="primary-link" disabled={action.busy}>
                      保存资料草稿
                    </button>
                  </form>
                </section>
              </Drawer>
              {tab === "members" && (
                <section className="card-panel">
                  <h2>课程成员</h2>
                  <Feedback error={members.error} />
                  <form
                    className="live-inline"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await action.run("/members", { username }))
                        setUsername("");
                    }}
                  >
                    <label>
                      学生用户名
                      <input
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </label>
                    <button className="ghost-btn" disabled={action.busy}>
                      加入课程
                    </button>
                  </form>
                  {!!members.data?.length && (
                    <ul className="member-list">
                      {members.data.map((m) => (
                        <li key={m.id}>
                          <Link to={`/teacher/dashboard?student=${m.id}`}>
                            {m.display_name}
                          </Link>{" "}
                          · {m.username}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3>新建学生账号并加入本课程</h3>
                  <form
                    className="live-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await action.run("/students", student))
                        setStudent({
                          username: "",
                          display_name: "",
                          password: "",
                        });
                    }}
                  >
                    <label>
                      新学生用户名
                      <input
                        required
                        value={student.username}
                        onChange={(e) =>
                          setStudent({ ...student, username: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      学生姓名
                      <input
                        required
                        value={student.display_name}
                        onChange={(e) =>
                          setStudent({
                            ...student,
                            display_name: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      初始密码
                      <input
                        required
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={student.password}
                        onChange={(e) =>
                          setStudent({ ...student, password: e.target.value })
                        }
                      />
                    </label>
                    <button className="ghost-btn" disabled={action.busy}>
                      创建学生账号
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          {!teacher && (
            <section className="card-panel">
              <h2>学习记录</h2>
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
            </section>
          )}
        </>
      )}
      {course && (
        <>
          {(!teacher || tab === "settings") && (
            <details className="card-panel">
              <summary>知识依赖关系</summary>
              <KnowledgeGraph />
            </details>
          )}
          {!teacher && (
            <details className="card-panel">
              <summary>学习帮助</summary>
              <LearningAssistant />
            </details>
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
