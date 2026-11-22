import { Field } from "../shared/Field";
import { ContextAgent } from "./context-agent";
import { useLocationValue } from "./location-state";
import { useConfirm } from "../shared/confirm";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Drawer,
  Form,
  Input,
  Pagination,
  Select,
  Tag,
  Tree,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import {
  Feedback,
  Link,
  names,
  useAction,
  useLearning,
  useLiveQuery,
  uuid,
  when,
} from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import { KnowledgeGraph } from "./graph";
import { ResourceNotes, type Note } from "./notes";
import { JobsPanel } from "./ai-jobs";
import { RetrievalPage } from "./retrieval";
import { PublishedAssets, RichContent } from "./content-render";
import {
  extractResourceTimeRangeMs,
  formatResourceLocator,
  isVideoSource,
  labelFor,
  stateLabels,
} from "./domain-meta";
import { MediaPlayer } from "./media-player";
import type { Point, Resource } from "./types";
import { hasControlNull, isValidHTTPUrl, utf8ByteLength } from "./validation";

export type { Point, Resource } from "./types";

interface CourseResource extends Resource {
  source_id?: string | null;
}

interface LearningEventItem {
  id: string;
  verb: string;
  resource_id: string | null;
  occurred_at: string;
}

interface ResourceFormDraft {
  title: string;
  content: string;
  source_url: string;
  source_note: string;
  locator: string;
  knowledge_point_id: string;
}

const EMPTY_DRAFT: ResourceFormDraft = {
  title: "",
  content: "",
  source_url: "",
  source_note: "",
  locator: "第1段",
  knowledge_point_id: "",
};

const PAGE_SIZE = 10;

interface CourseTreeNode {
  key: string;
  title: string;
  children: CourseTreeNode[];
}

function buildTree(points: Point[]): CourseTreeNode[] {
  const byID = new Map(points.map((p) => [p.id, p]));
  const childrenMap = new Map<string, Point[]>();
  const roots: Point[] = [];
  for (const p of points) {
    if (p.parent_id && byID.has(p.parent_id) && p.parent_id !== p.id) {
      const list = childrenMap.get(p.parent_id);
      if (list) list.push(p);
      else childrenMap.set(p.parent_id, [p]);
    } else {
      roots.push(p);
    }
  }
  const visit = (node: Point, ancestry: Set<string>): CourseTreeNode => {
    const next = new Set(ancestry);
    next.add(node.id);
    return {
      key: node.id,
      title: node.title,
      children: (childrenMap.get(node.id) || [])
        .filter((child) => !next.has(child.id))
        .map((child) => visit(child, next)),
    };
  };
  return roots.map((r) => visit(r, new Set()));
}

export function CourseWorkspace({ sourceID = "" }: { sourceID?: string } = {}) {
  const confirm = useConfirm();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const { course } = useLearning();
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<CourseResource[]>("/resources");
  const events = useLiveQuery<LearningEventItem[]>("/events", !teacher);
  const notes = useLiveQuery<Note[]>("/notes", !teacher);
  const action = useAction();

  const [params, setParams] = useSearchParams();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<CourseResource | null>(null);
  const [revisionBase, setRevisionBase] = useState<CourseResource | null>(null);
  const [editorError, setEditorError] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [resourceSearch, setResourceSearch] = useLocationValue("resource_search");

  const openedSetRef = useRef<Set<string>>(new Set());
  const seenTreeParentsRef = useRef<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  function updateParams(updates: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  function openResource(r: CourseResource | null) {
    updateParams({ resource: r?.id || "", t: "" });
  }

  const selected = params.get("node") || "";
  const viewID = params.get("resource") || "";
  const taskParam = params.get("task") || "";
  const rawT = params.get("t");
  const requestedSeekMs = useMemo(() => {
    if (!rawT) return null;
    const parsed = Number(rawT);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }, [rawT]);

  // Derive `view` synchronously from URL so navigation blockers stay atomic.
  const view = useMemo(() => {
    if (!viewID || !resources.data) return null;
    return (
      resources.data.find(
        (r) => r.id === viewID && (!sourceID || r.source_id === sourceID),
      ) || null
    );
  }, [viewID, resources.data, sourceID]);

  const viewLocatorFilename = view
    ? (view.locator || "").replace(/\s+\[[\s\S]*\]$/, "").trim()
    : "";
  const viewIsVideo = Boolean(
    course &&
      view?.source_id &&
      (isVideoSource(view.media_type, viewLocatorFilename) ||
        isVideoSource(view.media_type, (view.locator || "").split(" ")[0])),
  );
  const viewClipRange = useMemo(
    () => (view ? extractResourceTimeRangeMs(view.locator) : null),
    [view],
  );
  const viewSeekMs = requestedSeekMs ?? viewClipRange?.startMs ?? null;
  const viewLocatorText = view ? formatResourceLocator(view.locator) : "";

  const missingView = !!viewID && resources.isSuccess && !view;

  // Check RAG availability cleanly before mounting teacher index JobsPanel.
  const ragStatus = useLiveQuery<{ configured: boolean }>(
    "/retrieval/status",
    teacher && !!view,
  );

  // Deduplicated silent `opened` learning event per (course.id, resource.id).
  useEffect(() => {
    if (teacher || !course || !view || view.status !== "published") return;
    const key = `${course.id}:${view.id}`;
    if (openedSetRef.current.has(key)) return;
    openedSetRef.current.add(key);
    void action.run(
      `/resources/${view.id}/events`,
      { verb: "opened", request_id: uuid() },
      "POST",
      undefined,
      { silent: true, invalidate: false },
    );
  }, [teacher, course?.id, view?.id, view?.status]);

  // Separate draft keys for new resource, editing a draft, or revising a published resource.
  const draftKey = editingDraft
    ? `resource-edit:${editingDraft.id}`
    : revisionBase
      ? `resource-rev:${revisionBase.id}`
      : `resource:new:${course?.id || ""}`;

  const initialDraft = useMemo<ResourceFormDraft>(() => {
    const source = editingDraft || revisionBase;
    if (!source) return EMPTY_DRAFT;
    return {
      title: source.title,
      content: source.content,
      source_url: source.source_url,
      source_note: source.source_note,
      locator: source.locator,
      knowledge_point_id: source.knowledge_point_id || "",
    };
  }, [editingDraft, revisionBase]);

  const resourceDraft = useEditorDraft<ResourceFormDraft>(
    draftKey,
    initialDraft,
    !!course,
    { blockNavigation: editorOpen },
  );
  const resource = resourceDraft.value;
  const setResource = resourceDraft.change;

  const points = ctx.data?.points || [];
  const treeData = useMemo(() => buildTree(points), [points]);

  useEffect(() => {
    const parentIDs = new Set<string>();
    for (const p of points) {
      if (p.parent_id) parentIDs.add(p.parent_id);
    }
    const newlySeen: string[] = [];
    for (const id of parentIDs) {
      if (!seenTreeParentsRef.current.has(id)) {
        seenTreeParentsRef.current.add(id);
        newlySeen.push(id);
      }
    }
    if (newlySeen.length > 0) {
      setExpandedKeys((prev) => Array.from(new Set([...prev, ...newlySeen])));
    }
  }, [points]);

  // Group selectable knowledge points (kind === "point") by chapter/section path.
  const pointGroups = useMemo(() => {
    const byID = new Map(points.map((p) => [p.id, p]));
    const ungrouped: Point[] = [];
    const grouped = new Map<string, Point[]>();

    for (const p of points) {
      if (p.kind !== "point") continue;
      if (!p.parent_id || !byID.has(p.parent_id)) {
        ungrouped.push(p);
        continue;
      }
      const ancestors: string[] = [];
      let cur = byID.get(p.parent_id);
      const seen = new Set<string>([p.id]);
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        ancestors.unshift(cur.title);
        cur = cur.parent_id ? byID.get(cur.parent_id) : undefined;
      }
      const groupLabel = ancestors.join(" / ");
      const list = grouped.get(groupLabel);
      if (list) list.push(p);
      else grouped.set(groupLabel, [p]);
    }
    return { ungrouped, grouped: [...grouped.entries()] };
  }, [points]);

  const selectedNodes = useMemo(() => {
    const set = new Set(selected ? [selected] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of points) {
        if (p.parent_id && set.has(p.parent_id) && !set.has(p.id)) {
          set.add(p.id);
          changed = true;
        }
      }
    }
    return set;
  }, [selected, points]);

  const completedSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of events.data || []) {
      if (e.resource_id && e.verb === "completed") set.add(e.resource_id);
    }
    return set;
  }, [events.data]);

  const favoriteSet = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes.data || []) {
      if (n.favorite) set.add(n.resource_id);
    }
    return set;
  }, [notes.data]);

  const supersededIDs = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources.data || []) {
      if (r.supersedes_id) set.add(r.supersedes_id);
    }
    return set;
  }, [resources.data]);

  const list = useMemo(() => {
    const keyword = resourceSearch.trim().toLowerCase();
    return (resources.data || []).filter(
      (r) =>
        (!sourceID || r.source_id === sourceID) &&
        (!selected || selectedNodes.has(r.knowledge_point_id || "")) &&
        (!favoritesOnly || favoriteSet.has(r.id)) &&
        (!keyword || r.title.toLowerCase().includes(keyword)),
    );
  }, [
    resources.data,
    sourceID,
    selected,
    selectedNodes,
    favoritesOnly,
    favoriteSet,
    resourceSearch,
  ]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visibleList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resourceEvents = useMemo(
    () => (events.data || []).filter((e) => !!e.resource_id),
    [events.data],
  );

  function openDraftEditor(target: CourseResource) {
    setEditorError("");
    setRevisionBase(null);
    setEditingDraft(target);
    setEditorOpen(true);
  }

  function openRevisionEditor(target: CourseResource) {
    setEditorError("");
    setEditingDraft(null);
    setRevisionBase(target);
    setEditorOpen(true);
  }

  async function handleArchiveResource(target: CourseResource) {
    if (
      !(await confirm(
        `确认归档学习资料“${target.title}”？归档后不再作为有效学习内容展示。`,
        { danger: true },
      ))
    ) {
      return;
    }
    const archived = await action.run<CourseResource>(
      `/resources/${target.id}/archive`,
      {},
      "POST",
      "资料已归档",
    );
    if (archived && view?.id === target.id) {
      openResource(archived);
    }
  }

  async function handleSaveResource() {
    const trimmedTitle = resource.title.trim();
    const trimmedContent = resource.content.trim();
    const trimmedNote = resource.source_note.trim();
    const trimmedURL = resource.source_url.trim();
    const trimmedLocator = resource.locator.trim();

    if (
      !trimmedTitle ||
      utf8ByteLength(trimmedTitle) > 500 ||
      hasControlNull(trimmedTitle)
    ) {
      setEditorError("请填写资料标题（不能为空且不超过 500 字节）");
      return;
    }
    if (
      !trimmedContent ||
      utf8ByteLength(trimmedContent) > 200_000 ||
      hasControlNull(trimmedContent)
    ) {
      setEditorError("请填写资料原文（不能为空且不超过 200,000 字节）");
      return;
    }
    if (
      !trimmedLocator ||
      utf8ByteLength(trimmedLocator) > 500 ||
      hasControlNull(trimmedLocator)
    ) {
      setEditorError("请填写页码或段落定位（不能为空且不超过 500 字节）");
      return;
    }
    if (hasControlNull(trimmedNote) || Array.from(trimmedNote).length > 200) {
      setEditorError("来源说明不能超过 200 字且不能包含非法空字符");
      return;
    }
    if (!trimmedNote && !trimmedURL) {
      setEditorError("请至少填写来源说明或有效的原始来源链接");
      return;
    }
    if (trimmedURL && !isValidHTTPUrl(trimmedURL)) {
      setEditorError("来源链接必须是完整的 http:// 或 https:// 地址（不超过 2000 字节）");
      return;
    }

    setEditorError("");
    const payload = {
      title: trimmedTitle,
      content: trimmedContent,
      source_url: trimmedURL,
      source_note: trimmedNote,
      locator: trimmedLocator,
      knowledge_point_id: resource.knowledge_point_id || "",
      ...(revisionBase && !editingDraft ? { supersedes_id: revisionBase.id } : {}),
    };

    const created = await action.run<CourseResource>(
      editingDraft
        ? `/resources/${editingDraft.id}`
        : revisionBase
          ? `/resources/${revisionBase.id}/revisions`
          : "/resources",
      payload,
      editingDraft ? "PUT" : "POST",
      editingDraft
        ? "资料草稿已更新"
        : revisionBase
          ? "资料新版本草稿已保存"
          : "资料草稿已保存",
    );
    if (created) {
      resourceDraft.reset(EMPTY_DRAFT);
      setEditingDraft(null);
      setRevisionBase(null);
      setEditorOpen(false);
      if (!sourceID || created.source_id === sourceID) {
        openResource(created);
      }
    }
  }

  const retrievalHref = `/student/retrieval${
    view
      ? `?resource=${encodeURIComponent(view.id)}${taskParam ? `&task=${encodeURIComponent(taskParam)}` : ""}`
      : ""
  }`;

  return (
    <div className="live-page">
      {!teacher && !sourceID && (
        <PageHeader
          title="学习资料"
          subtitle={course?.title}
          extra={
            <Link className="ghost-btn" to={retrievalHref}>
              资料问答
            </Link>
          }
        />
      )}
      {taskParam && (
        <Link
          className="context-banner"
          to={`/${teacher ? "teacher" : "student"}/intervention?task=${encodeURIComponent(taskParam)}`}
        >
          返回补学补练任务，检查完成条件
        </Link>
      )}
      <Feedback
        failed={action.failed}
        error={ctx.error}
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
              <aside>
                <Card className="card-panel" title="课程目录">
                  <Button
                    block
                    type={!selected ? "primary" : "default"}
                    onClick={() => {
                      setPage(1);
                      updateParams({ node: "", resource: "" });
                    }}
                    style={{ marginBottom: 8 }}
                  >
                    全部资料
                  </Button>
                  {ctx.isPending ? (
                    <LoadingState label="正在读取目录…" />
                  ) : points.length > 0 ? (
                    <Tree
                      aria-label="课程目录"
                      blockNode
                      className={
                        treeData.some((n) => n.children.length > 0)
                          ? undefined
                          : "live-flat-tree"
                      }
                      expandedKeys={expandedKeys}
                      onExpand={(keys) => setExpandedKeys(keys.map(String))}
                      selectedKeys={selected ? [selected] : []}
                      onSelect={(keys) => {
                        setPage(1);
                        updateParams({
                          node: String(keys[0] || ""),
                          resource: "",
                        });
                      }}
                      treeData={treeData}
                    />
                  ) : (
                    <p className="live-meta">尚未维护知识点</p>
                  )}
                </Card>
              </aside>
            )}
            <Card className="card-panel">
              {(view || (teacher && !sourceID)) && (
                <div className="section-head">
                  {view && (
                    <>
                      <Typography.Text strong className="item-title">
                        {view.title}
                      </Typography.Text>
                      <ContextAgent
                        context={{
                          kind: "resource",
                          id: view.id,
                          title: view.title,
                        }}
                      />
                    </>
                  )}
                  {teacher && !sourceID && (
                    <Button
                      onClick={() => {
                        setEditorError("");
                        setEditingDraft(null);
                        setRevisionBase(null);
                        setEditorOpen(true);
                      }}
                      type="primary"
                    >
                      新增资料
                    </Button>
                  )}
                </div>
              )}

              {missingView && (
                <Alert
                  type="warning"
                  showIcon
                  message="未找到指定的学习资料或该资料不在当前视图中"
                  action={
                    <Button size="small" onClick={() => openResource(null)}>
                      返回列表
                    </Button>
                  }
                  style={{ marginBottom: 12 }}
                />
              )}

              {!view && (
                <div className="filter-bar is-inline">
                  <Input.Search
                    aria-label="搜索资料"
                    placeholder="搜索资料标题"
                    value={resourceSearch}
                    onChange={(e) => {
                      setResourceSearch(e.target.value);
                      setPage(1);
                    }}
                    allowClear
                  />
                  {!teacher && (
                    <Checkbox
                      checked={favoritesOnly}
                      onChange={(e) => {
                        setFavoritesOnly(e.target.checked);
                        setPage(1);
                      }}
                    >
                      只看收藏{favoriteSet.size > 0 ? `（${favoriteSet.size}）` : ""}
                    </Checkbox>
                  )}
                </div>
              )}

              {view ? (
                <div style={{ display: "grid", gap: 14 }}>
                  <MetaTags>
                    <StatusTag
                      status={view.status}
                      label={labelFor(stateLabels, view.status, names[view.status] || view.status)}
                    />
                    <MetaTag>v{view.version}</MetaTag>
                    {viewLocatorText && <MetaTag>{viewLocatorText}</MetaTag>}
                    {!teacher && (
                      <StatusTag
                        status={
                          completedSet.has(view.id) ? "completed" : "pending"
                        }
                        label={
                          completedSet.has(view.id) ? "已完成学习" : "待学习"
                        }
                      />
                    )}
                    {!teacher && favoriteSet.has(view.id) && (
                      <Tag color="gold">已收藏</Tag>
                    )}
                    {supersededIDs.has(view.id) && <MetaTag>已有新版本</MetaTag>}
                    <span className="live-meta">{when(view.published_at)}</span>
                  </MetaTags>
                  {viewIsVideo && course && view.source_id && (
                    <MediaPlayer
                      src={`/api/v1/learning/courses/${encodeURIComponent(course.id)}/sources/${encodeURIComponent(view.source_id)}/stream`}
                      title={view.title}
                      seekMs={viewSeekMs}
                      clipRange={viewClipRange}
                    />
                  )}
                  <RichContent text={view.content} />
                  <PublishedAssets kind="resources" id={view.id} />
                  {!teacher && (
                    <ResourceNotes key={view.id} resourceId={view.id} />
                  )}
                  {view.status === "published" && (
                    <Collapse
                      items={[
                        {
                          key: "qa",
                          label: "就本资料提问",
                          children: (
                            <RetrievalPage
                              key={view.id}
                              resourceID={view.id}
                              embedded
                            />
                          ),
                        },
                      ]}
                    />
                  )}
                  {teacher && view.status === "draft" && (
                    <div className="live-inline">
                      <Button onClick={() => openDraftEditor(view)}>
                        编辑草稿
                      </Button>
                      <Button
                        type="primary"
                        disabled={action.busy}
                        onClick={async () => {
                          if (
                            await confirm(
                              "确认发布本修订给课程学生？索引由后台单独处理。",
                            )
                          ) {
                            await action.run(
                              `/resources/${view.id}/publish`,
                              {},
                              "POST",
                              "资料已发布，学生现在可以查看",
                            );
                          }
                        }}
                      >
                        审核通过并发布
                      </Button>
                      <Button
                        danger
                        disabled={action.busy}
                        onClick={() => void handleArchiveResource(view)}
                      >
                        归档
                      </Button>
                    </div>
                  )}
                  {teacher && ragStatus.data?.configured && (
                    <JobsPanel kinds={["index"]} />
                  )}
                  <div>
                    <p>
                      资料来源：
                      {view.source_note ||
                        (view.source_url ? (
                          <Typography.Link
                            href={view.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {view.source_url}
                          </Typography.Link>
                        ) : (
                          "尚未登记来源"
                        ))}
                    </p>
                    {view.source_url && view.source_note && (
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
                  </div>
                  <div className="live-inline">
                    <Button onClick={() => openResource(null)}>
                      返回资料列表
                    </Button>
                    {teacher &&
                      view.status === "published" &&
                      !supersededIDs.has(view.id) && (
                        <>
                          <Button onClick={() => openRevisionEditor(view)}>
                            另存资料修订
                          </Button>
                          <Button
                            danger
                            disabled={action.busy}
                            onClick={() => void handleArchiveResource(view)}
                          >
                            归档
                          </Button>
                        </>
                      )}
                    {!teacher && (
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            `/resources/${view.id}/events`,
                            {
                              verb: "completed",
                              request_id: uuid(),
                            },
                            "POST",
                            "已完成本资料学习（记录已保存）",
                          )
                        }
                        type="primary"
                      >
                        标记完成
                      </Button>
                    )}
                  </div>
                </div>
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
                      {favoritesOnly
                        ? "还没有收藏的资料，打开资料后可在笔记区勾选“收藏这份资料”。"
                        : teacher
                          ? sourceID
                            ? "可在“原文核对”页签发布本原件片段。"
                            : "点击“新增资料”，审核后发布给学生。"
                          : selected
                            ? "该目录下暂无资料，可选择“全部资料”查看。"
                            : "教师发布资料后会显示在这里。"}
                    </EmptyState>
                  ) : (
                    <>
                      {visibleList.map((r) => {
                        const completed = completedSet.has(r.id);
                        const favorited = favoriteSet.has(r.id);
                        const superseded = supersededIDs.has(r.id);
                        const loc = formatResourceLocator(r.locator);
                        return (
                          <article className="live-row" key={r.id}>
                            <div>
                              <Typography.Text strong className="item-title">
                                {r.title}
                              </Typography.Text>
                              <MetaTags>
                                <StatusTag
                                  status={r.status}
                                  label={labelFor(
                                    stateLabels,
                                    r.status,
                                    names[r.status] || r.status,
                                  )}
                                />
                                <MetaTag>v{r.version}</MetaTag>
                                {loc && <MetaTag>{loc}</MetaTag>}
                                {!teacher && favorited && (
                                  <Tag color="gold">已收藏</Tag>
                                )}
                                {superseded && <MetaTag>已有新版本</MetaTag>}
                              </MetaTags>
                              {!teacher && (
                                <StatusTag
                                  status={completed ? "completed" : "pending"}
                                  label={completed ? "已完成学习" : "待学习"}
                                />
                              )}
                            </div>
                            <div className="live-inline">
                              <Button onClick={() => openResource(r)}>
                                打开资料
                              </Button>
                              {teacher && r.status === "draft" && (
                                <>
                                  <Button onClick={() => openDraftEditor(r)}>
                                    编辑草稿
                                  </Button>
                                  <Button
                                    disabled={action.busy}
                                    onClick={async () => {
                                      if (
                                        await confirm(
                                          "确认发布这份学习资料？发布后学生可见，索引由后台处理。",
                                        )
                                      ) {
                                        await action.run(
                                          `/resources/${r.id}/publish`,
                                          {},
                                          "POST",
                                          "资料已发布，学生现在可以查看",
                                        );
                                      }
                                    }}
                                    type="primary"
                                  >
                                    审核通过并发布
                                  </Button>
                                  <Button
                                    danger
                                    disabled={action.busy}
                                    onClick={() => void handleArchiveResource(r)}
                                  >
                                    归档
                                  </Button>
                                </>
                              )}
                              {teacher &&
                                r.status === "published" &&
                                !superseded && (
                                  <>
                                    <Button onClick={() => openRevisionEditor(r)}>
                                      另存资料修订
                                    </Button>
                                    <Button
                                      danger
                                      disabled={action.busy}
                                      onClick={() => void handleArchiveResource(r)}
                                    >
                                      归档
                                    </Button>
                                  </>
                                )}
                            </div>
                          </article>
                        );
                      })}
                      <Pagination
                        current={page}
                        pageSize={PAGE_SIZE}
                        total={list.length}
                        onChange={setPage}
                        showSizeChanger={false}
                        hideOnSinglePage
                        responsive
                      />
                    </>
                  )}
                </>
              )}
            </Card>
          </div>
          {teacher && (
            <Drawer
              title={
                editingDraft
                  ? "编辑资料草稿"
                  : revisionBase
                    ? "创建资料新版本"
                    : "添加资料草稿"
              }
              open={editorOpen}
              width={680}
              onClose={async () => {
                if (
                  !resourceDraft.dirty ||
                  (await confirm("关闭编辑器？未保存内容会暂存。"))
                ) {
                  setEditorOpen(false);
                }
              }}
            >
              <section id="resource-editor">
                <DraftNotice
                  restored={resourceDraft.restored}
                  storageError={resourceDraft.storageError}
                  onDiscard={() => {
                    setEditorError("");
                    resourceDraft.reset(initialDraft);
                  }}
                />
                {editorError && (
                  <Alert
                    type="error"
                    showIcon
                    role="alert"
                    message={editorError}
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Form
                  className="live-form"
                  onFinish={() => {
                    void handleSaveResource();
                  }}
                  layout="vertical"
                >
                  <Field className="ui-field" label="资料标题" required>
                    <Input
                      aria-label="资料标题"
                      value={resource.title}
                      onChange={(e) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <Field className="ui-field" label="关联知识点">
                    <Select
                      aria-label="关联知识点"
                      value={resource.knowledge_point_id}
                      onChange={(val) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          knowledge_point_id: val,
                        }));
                      }}
                      showSearch
                      optionFilterProp="children"
                    >
                      <Select.Option value="">课程通用资料</Select.Option>
                      {pointGroups.ungrouped.map((p) => (
                        <Select.Option value={p.id} key={p.id}>
                          {p.title}
                        </Select.Option>
                      ))}
                      {pointGroups.grouped.map(([groupLabel, groupPoints]) => (
                        <Select.OptGroup label={groupLabel} key={groupLabel}>
                          {groupPoints.map((p) => (
                            <Select.Option value={p.id} key={p.id}>
                              {p.title}
                            </Select.Option>
                          ))}
                        </Select.OptGroup>
                      ))}
                    </Select>
                  </Field>
                  <Field className="ui-field" label="资料原文" required>
                    <Input.TextArea
                      aria-label="资料原文"
                      rows={7}
                      value={resource.content}
                      onChange={(e) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          content: e.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <Field
                    className="ui-field"
                    label="来源说明"
                    required={!resource.source_url.trim()}
                  >
                    <Input
                      aria-label="来源说明"
                      maxLength={200}
                      placeholder="如：教师自编讲义，2026年10月版"
                      value={resource.source_note}
                      onChange={(e) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          source_note: e.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <Field className="ui-field" label="来源链接">
                    <Input
                      aria-label="来源链接"
                      placeholder="https://example.com/..."
                      value={resource.source_url}
                      onChange={(e) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          source_url: e.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <Field className="ui-field" label="页码或段落定位" required>
                    <Input
                      aria-label="页码或段落定位"
                      value={resource.locator}
                      onChange={(e) => {
                        setEditorError("");
                        setResource((prev) => ({
                          ...prev,
                          locator: e.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <Button
                    disabled={action.busy}
                    htmlType="submit"
                    type="primary"
                  >
                    {editingDraft ? "保存草稿修改" : "保存资料草稿"}
                  </Button>
                </Form>
              </section>
            </Drawer>
          )}
          {!teacher && (
            <Card className="card-panel" title="学习记录">
              {events.error ? (
                <ErrorState
                  message={events.error.message}
                  onRetry={() => void events.refetch()}
                />
              ) : events.isPending ? (
                <LoadingState label="正在读取学习记录…" />
              ) : !resourceEvents.length ? (
                <EmptyState title="还没有学习记录">
                  打开资料开始学习，记录会显示在这里。
                </EmptyState>
              ) : (
                resourceEvents.slice(0, 20).map((e) => (
                  <p key={e.id}>
                    {e.verb === "completed" ? "完成" : "打开"}：
                    {resources.data?.find((r) => r.id === e.resource_id)
                      ?.title || "资料"}{" "}
                    · {when(e.occurred_at)}
                  </p>
                ))
              )}
            </Card>
          )}
          {!teacher && (
            <Collapse
              className="card-panel"
              items={[
                {
                  key: "content",
                  label: "知识依赖关系",
                  children: <KnowledgeGraph />,
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
