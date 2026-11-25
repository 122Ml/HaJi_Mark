import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
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
  Space,
  Typography,
} from "antd";
import { Plus } from "lucide-react";
import { useConfirm } from "../shared/confirm";
import { Field } from "../shared/Field";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import {
  EmptyState,
  ErrorState,
  FeatureNotice,
  isFeatureDisabledError,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { AIDraft, JobsPanel, ModelSelect, useJob } from "./ai-jobs";
import { FrozenEvidence, GroundedAnswer } from "./citations";
import { RichContent } from "./content-render";
import {
  ContentLinks,
  DecisionHistory,
  TopicManager,
  type TopicData,
} from "./content-topics";
import { ContextAgent } from "./context-agent";
import { Feedback, Link, useAction, useLearning, useLiveQuery } from "./context";
import {
  formatLocator,
  knowledgeContentKinds,
  knowledgeStateLabels,
  labelFor,
} from "./domain-meta";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { KnowledgeReview } from "./knowledge-review";
import { useLocationValue } from "./location-state";
import { MaterialsPage, SourceWorkspace } from "./materials";
import { RetrievalPage } from "./retrieval";
import type {
  AssistAnswer,
  Evidence,
  Hit,
  Job,
  Knowledge,
  Point,
  Source,
  SourceDetail,
} from "./types";
import { dedupeStrings, hasControlNull, utf8ByteLength } from "./validation";

export {
  MaterialsPage,
  SourceWorkspace,
  RetrievalPage,
  AIDraft,
  FrozenEvidence,
  GroundedAnswer,
  JobsPanel,
  ModelSelect,
  useJob,
};
export type { Hit, Job, Knowledge, AssistAnswer };

const KNOWLEDGE_PAGE_SIZE = 15;
const EVIDENCE_FRAGMENT_PAGE_SIZE = 10;

export function KnowledgePage({
  sourceID = "",
  embedded = false,
}: {
  sourceID?: string;
  embedded?: boolean;
} = {}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Knowledge[]>("/knowledge", true, true);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [reviewingID, setReviewingID] = useState<string | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [filter, setFilter] = useLocationValue("knowledge_state");
  const [kindFilter, setKindFilter] = useState("");
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [page, setPage] = useState(1);

  const sourceFilter = teacher ? sourceID || params.get("source") || "" : "";
  const jobParam = teacher ? params.get("job") || "" : "";
  const extraction = useLiveQuery<Job>(`/jobs/${jobParam}`, !!jobParam);
  const candidateIDs = Array.isArray(extraction.data?.output?.candidate_ids)
    ? (extraction.data.output.candidate_ids as string[])
    : [];
  const jobMatchesSource =
    !sourceFilter || extraction.data?.input?.source_id === sourceFilter;

  const [topic, setTopic] = useLocationValue("knowledge_topic");
  const [search, setSearch] = useLocationValue("knowledge_search");
  const [searchInput, setSearchInput] = useState(search);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchInput(search);
  }, [search, location.key]);

  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    },
    [],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      setSearch(value);
    }, 150);
  }

  function flushSearch(value: string) {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchInput(value);
    setSearch(value);
    setPage(1);
  }

  const topics = useLiveQuery<TopicData>("/topics", teacher);
  const action = useAction();

  const effectiveStateFilter = teacher ? filter : "";
  const effectiveTopicFilter = teacher ? topic : "";

  const rows = useMemo(() => {
    const list = query.data || [];
    const needle = searchInput.trim().toLowerCase();
    return list.filter(
      (k) =>
        (!sourceFilter ||
          k.evidence.some((e) => e.source_id === sourceFilter)) &&
        (!jobParam ||
          extraction.isPending ||
          !jobMatchesSource ||
          candidateIDs.includes(k.id)) &&
        (!effectiveStateFilter || k.state === effectiveStateFilter) &&
        (!kindFilter || k.content_kind === kindFilter) &&
        (!needle ||
          `${k.title} ${k.body}`.toLowerCase().includes(needle)) &&
        (!effectiveTopicFilter ||
          topics.data?.links.some(
            (l) => l.topic_id === effectiveTopicFilter && l.knowledge_id === k.id,
          )),
    );
  }, [
    query.data,
    sourceFilter,
    jobParam,
    extraction.isPending,
    jobMatchesSource,
    candidateIDs,
    effectiveStateFilter,
    kindFilter,
    searchInput,
    effectiveTopicFilter,
    topics.data?.links,
  ]);

  const linkedID = params.get("knowledge") || "";
  const linkedExistsInAll =
    !!linkedID && !!query.data?.some((k) => k.id === linkedID);
  const linkedIndexInRows = linkedID
    ? rows.findIndex((k) => k.id === linkedID)
    : -1;

  useEffect(() => {
    if (linkedID && linkedIndexInRows >= 0) {
      const targetPage = Math.floor(linkedIndexInRows / KNOWLEDGE_PAGE_SIZE) + 1;
      setPage(targetPage);
      requestAnimationFrame(() =>
        document
          .getElementById(`knowledge-${linkedID}`)
          ?.scrollIntoView({ block: "start" }),
      );
    }
  }, [linkedID, linkedIndexInRows]);

  const selected = useMemo(
    () =>
      selectedID ? query.data?.find((k) => k.id === selectedID) || null : null,
    [selectedID, query.data],
  );
  const reviewing = useMemo(
    () =>
      reviewingID
        ? query.data?.find((k) => k.id === reviewingID) || null
        : null,
    [reviewingID, query.data],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / KNOWLEDGE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice(
    (safePage - 1) * KNOWLEDGE_PAGE_SIZE,
    safePage * KNOWLEDGE_PAGE_SIZE,
  );

  function clearJobFilter() {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("job");
      return next;
    });
  }

  function clearAllFilters() {
    flushSearch("");
    setKindFilter("");
    if (teacher) {
      setFilter("");
      setTopic("");
      clearJobFilter();
    }
  }

  return (
    <div className="live-page">
      {!embedded && (
        <PageHeader
          title="知识库"
          subtitle={course?.title}
          meta={!query.isPending && !query.error ? <MetaTag>{rows.length} 条知识</MetaTag> : undefined}
          extra={
            teacher ? (
              <>
                <Link className="ghost-btn" to="/teacher/materials">
                  从资料提炼
                </Link>
                <Link className="ghost-btn" to="/teacher/retrieval">
                  验证检索
                </Link>
                <Button
                  htmlType="button"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => {
                    setSelectedID(null);
                    setEditorDirty(false);
                    setCreating(true);
                  }}
                  type="primary"
                >
                  新建知识
                </Button>
              </>
            ) : undefined
          }
        />
      )}
      <div className="filter-bar">
        <Input.Search
          aria-label="搜索知识"
          placeholder="搜索知识标题与正文"
          allowClear
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          onSearch={flushSearch}
        />
        {teacher && (
          <>
            <Select
              aria-label="知识状态"
              value={filter}
              onChange={(val) => {
                setFilter(val);
                setPage(1);
              }}
              options={[
                { value: "", label: "全部状态" },
                { value: "draft", label: "待审核" },
                { value: "confirmed", label: "已确认" },
                { value: "archived", label: "已归档" },
              ]}
            />
            <Select
              aria-label="知识类型筛选"
              value={kindFilter}
              onChange={(val) => {
                setKindFilter(val);
                setPage(1);
              }}
              options={[
                { value: "", label: "全部类型" },
                ...knowledgeContentKinds.map((k) => ({
                  value: k.value,
                  label: k.label,
                })),
              ]}
            />
            <Select
              aria-label="筛选知识专题"
              optionFilterProp="label"
              showSearch
              value={topic}
              onChange={(val) => {
                setTopic(val);
                setPage(1);
              }}
              options={[
                { value: "", label: "全部专题" },
                ...(topics.data?.topics
                  .filter((t) => t.active)
                  .map((t) => ({ value: t.id, label: t.title })) || []),
              ]}
            />
            {embedded && (
              <>
                <span className="filter-bar-spacer" />
                <Link to="/teacher/retrieval">验证检索</Link>
                <Button
                  htmlType="button"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => {
                    setSelectedID(null);
                    setEditorDirty(false);
                    setCreating(true);
                  }}
                  type="primary"
                >
                  新建知识
                </Button>
              </>
            )}
          </>
        )}
      </div>
      {teacher && jobParam && (
        <Alert
          type={extraction.error ? "warning" : "info"}
          showIcon
          message={
            extraction.isPending
              ? "正在加载本次提炼任务生成的知识候选…"
              : extraction.error
                ? `本次提炼任务读取失败：${extraction.error.message}`
                : `正在仅查看本次提炼生成的知识候选（${candidateIDs.length} 条）`
          }
          action={
            <Button size="small" htmlType="button" onClick={clearJobFilter}>
              查看全部知识
            </Button>
          }
        />
      )}
      {linkedExistsInAll && linkedIndexInRows < 0 && (
        <Alert
          type="info"
          showIcon
          message="当前筛选条件隐藏了目标知识条目。"
          action={
            <Button size="small" htmlType="button" onClick={clearAllFilters}>
              清除筛选
            </Button>
          }
        />
      )}
      {teacher && !embedded && <TopicManager />}
      <Feedback message={action.message} failed={action.failed} />
      {query.isPending || (!!jobParam && extraction.isPending) ? (
        <LoadingState />
      ) : query.error ? (
        isFeatureDisabledError(query.error) ? (
          <FeatureNotice
            title="知识库智能提炼服务尚未启用"
            description="当前环境未开启检索与提炼服务，启用模型服务后即可从资料提炼并检索知识点。"
          />
        ) : (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        )
      ) : !rows.length ? (
        <Card className="card-panel">
          <EmptyState title="暂无知识条目">
            {teacher
              ? "可从资料提炼候选，或手工添加有原文依据的知识。"
              : "教师确认并开放学习的知识会显示在这里。"}
          </EmptyState>
        </Card>
      ) : (
        <>
          {pagedRows.map((k) => {
            const isLinked = k.id === linkedID;
            return (
              <Card
                key={k.id}
                id={`knowledge-${k.id}`}
                className="card-panel rag-knowledge"
                style={
                  isLinked
                    ? { borderColor: "var(--teal)", borderWidth: 2 }
                    : undefined
                }
              >
                <div className="workspace-heading">
                  <Typography.Text strong className="item-title">
                    {k.title}
                  </Typography.Text>
                  <MetaTags>
                    {isLinked && (
                      <StatusTag status="processing" label="当前定位" />
                    )}
                    <StatusTag
                      status={k.state}
                      label={labelFor(knowledgeStateLabels, k.state)}
                    />
                    <MetaTag>v{k.version}</MetaTag>
                  </MetaTags>
                </div>
                <MetaTags>
                  <MetaTag>
                    {knowledgeContentKinds.find((v) => v.value === k.content_kind)
                      ?.label || k.content_kind}
                  </MetaTag>
                  {k.origin === "teacher_example" && (
                    <MetaTag>教师自编示例</MetaTag>
                  )}
                  {k.category && <MetaTag>{k.category}</MetaTag>}
                  {teacher && (
                    <>
                      {k.use_for_learning && <MetaTag>用于学习</MetaTag>}
                      {k.use_for_grading && <MetaTag>用于评分</MetaTag>}
                      <MetaTag>
                        {k.student_visible ? "学生可见" : "教师内部"}
                      </MetaTag>
                    </>
                  )}
                </MetaTags>
                <RichContent text={k.body} />
                {k.conditions && (
                  <p>
                    <strong>适用条件：</strong>
                    {k.conditions}
                  </p>
                )}
                {k.origin !== "teacher_example" && (
                  <Collapse
                    items={[
                      {
                        key: "content",
                        label: <>原文依据（{k.evidence.length}）</>,
                        children: (
                          <>
                            {k.evidence.map((e, i) => (
                              <blockquote key={`${e.fragment_id}:${i}`}>
                                {e.quote}
                                {teacher ? (
                                  <>
                                    <small>
                                      片段 {e.fragment_id.slice(0, 8)}
                                    </small>
                                    <Link
                                      to={`/teacher/materials?source=${encodeURIComponent(e.source_id)}&fragment=${encodeURIComponent(e.fragment_id)}`}
                                    >
                                      查看引用原文
                                    </Link>
                                  </>
                                ) : (
                                  <small>课程原文依据 {i + 1}</small>
                                )}
                              </blockquote>
                            ))}
                          </>
                        ),
                      },
                    ]}
                  />
                )}
                {teacher && (
                  <div className="live-inline">
                    {k.state === "draft" && k.origin !== "teacher_example" && (
                      <Button
                        htmlType="button"
                        onClick={() => {
                          setReviewDirty(false);
                          setReviewingID(k.id);
                        }}
                      >
                        比较与处理
                      </Button>
                    )}
                    {k.state === "confirmed" && k.use_for_grading && (
                      <Link
                        className="ghost-btn"
                        to={`/teacher/question-bank?new=1&knowledge_id=${encodeURIComponent(k.id)}`}
                      >
                        据此出题
                      </Link>
                    )}
                    <ContextAgent
                      context={{ kind: "knowledge", id: k.id, title: k.title }}
                    />
                    <Button
                      htmlType="button"
                      onClick={() => {
                        setSelectedID(k.id);
                        setEditorDirty(false);
                        setCreating(true);
                      }}
                    >
                      {k.state === "draft" ? "编辑候选" : "建立新版本"}
                    </Button>
                    {k.state === "draft" && (
                      <Button
                        htmlType="button"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            `/knowledge/${k.id}/state`,
                            {
                              state: "confirmed",
                              edit_version: k.edit_version,
                            },
                            "POST",
                            undefined,
                            {
                              invalidatePrefixes: [
                                "knowledge",
                                "jobs",
                                "topics",
                                "impact",
                              ],
                            },
                          )
                        }
                        type="primary"
                      >
                        确认知识
                      </Button>
                    )}
                    {k.state !== "archived" && (
                      <Button
                        htmlType="button"
                        disabled={action.busy}
                        onClick={async () => {
                          if (
                            await confirm(
                              "归档此知识条目？历史版本和引用仍保留。",
                              { danger: true },
                            )
                          ) {
                            void action.run(
                              `/knowledge/${k.id}/state`,
                              {
                                state: "archived",
                                edit_version: k.edit_version,
                              },
                              "POST",
                              undefined,
                              {
                                invalidatePrefixes: [
                                  "knowledge",
                                  "jobs",
                                  "topics",
                                  "impact",
                                ],
                              },
                            );
                          }
                        }}
                      >
                        归档
                      </Button>
                    )}
                  </div>
                )}
                {teacher && (
                  <>
                    <ContentLinks kind="knowledge" id={k.id} />
                    <DecisionHistory id={k.id} />
                  </>
                )}
              </Card>
            );
          })}
          {rows.length > KNOWLEDGE_PAGE_SIZE && (
            <Pagination
              hideOnSinglePage
              current={safePage}
              pageSize={KNOWLEDGE_PAGE_SIZE}
              total={rows.length}
              showSizeChanger={false}
              onChange={setPage}
            />
          )}
        </>
      )}
      {teacher && !embedded && (
        <JobsPanel
          sourceID={sourceFilter}
          kinds={["extract", "knowledge_compare"]}
        />
      )}
      <Drawer
        title="知识比较与决策"
        aria-label="知识比较与决策"
        open={!!reviewing}
        onClose={async () => {
          if (
            reviewDirty &&
            !(await confirm("关闭比较与决策抽屉？未提交草稿将保留在当前浏览器。"))
          ) {
            return;
          }
          setReviewingID(null);
          setReviewDirty(false);
        }}
        width="min(100vw, 900px)"
        destroyOnHidden
      >
        {reviewing && (
          <EditorScope onDirtyChange={setReviewDirty}>
            <KnowledgeReview
              key={reviewing.id}
              candidate={reviewing}
              onDone={() => {
                setReviewingID(null);
                setReviewDirty(false);
              }}
            />
          </EditorScope>
        )}
      </Drawer>
      <Drawer
        title={selected?.state === "draft" ? "编辑知识候选" : "新建知识版本"}
        open={creating}
        onClose={async () => {
          if (
            editorDirty &&
            !(await confirm("关闭知识编辑抽屉？未提交草稿将保留在当前浏览器。"))
          ) {
            return;
          }
          setCreating(false);
          setEditorDirty(false);
        }}
        width="min(100vw, 760px)"
        destroyOnHidden
      >
        {creating && (
          <EditorScope onDirtyChange={setEditorDirty}>
            <KnowledgeEditor
              key={selected?.id || "new"}
              initial={selected}
              defaultSourceID={sourceFilter}
              onDone={() => {
                setCreating(false);
                setEditorDirty(false);
              }}
            />
          </EditorScope>
        )}
      </Drawer>
    </div>
  );
}

type KnowledgeDraft = {
  origin: Knowledge["origin"];
  title: string;
  body: string;
  category: string;
  content_kind: string;
  conditions: string;
  evidence: Evidence[];
  student_visible: boolean;
  use_for_learning: boolean;
  use_for_grading: boolean;
  knowledge_point_ids: string[];
  related_ids: string[];
};

export function KnowledgeEditor({
  initial,
  defaultSourceID = "",
  onDone,
}: {
  initial: Knowledge | null;
  defaultSourceID?: string;
  onDone: () => void;
}) {
  const action = useAction();
  const { course } = useLearning();
  const sources = useLiveQuery<Source[]>("/sources");
  const [sourceID, setSourceID] = useState(
    initial?.evidence[0]?.source_id || defaultSourceID || "",
  );
  const [fragmentSearch, setFragmentSearch] = useState("");
  const [fragmentPage, setFragmentPage] = useState(1);
  const [validationError, setValidationError] = useState("");
  const [concurrentEditNotice, setConcurrentEditNotice] = useState(false);

  const source = useLiveQuery<SourceDetail>(`/sources/${sourceID}`, !!sourceID);
  const graph = useLiveQuery<{ points: Point[] }>("");
  const all = useLiveQuery<Knowledge[]>("/knowledge");

  const defaultDraft = useMemo<KnowledgeDraft>(
    () =>
      initial
        ? {
            origin: initial.origin || "source",
            title: initial.title,
            body: initial.body,
            category: initial.category,
            content_kind: initial.content_kind,
            conditions: initial.conditions,
            evidence: initial.evidence || [],
            student_visible: initial.student_visible,
            use_for_learning: initial.use_for_learning,
            use_for_grading: initial.use_for_grading,
            knowledge_point_ids: dedupeStrings(
              initial.knowledge_point_ids || [],
            ),
            related_ids: dedupeStrings(initial.related_ids || []).filter(
              (id) => id !== initial.id,
            ),
          }
        : {
            origin: "source",
            title: "",
            body: "",
            category: "",
            content_kind: "concept",
            conditions: "",
            evidence: [],
            student_visible: false,
            use_for_learning: true,
            use_for_grading: false,
            knowledge_point_ids: [],
            related_ids: [],
          },
    [initial],
  );

  const draftKey = initial
    ? `knowledge:${course?.id || ""}:${initial.id}:${initial.state}:${initial.edit_version}`
    : `knowledge:${course?.id || ""}:new`;

  const draft = useEditorDraft<KnowledgeDraft>(
    draftKey,
    defaultDraft,
    !!course,
  );
  const v = draft.value;
  const change = (patch: Partial<KnowledgeDraft>) => {
    draft.change((old) => ({ ...old, ...patch }));
    if (validationError) setValidationError("");
    if (concurrentEditNotice) setConcurrentEditNotice(false);
  };

  const pointOptions = useMemo(() => {
    const allPoints = graph.data?.points || [];
    const byID = new Map(allPoints.map((p) => [p.id, p]));
    return allPoints
      .filter((p) => p.kind === "point")
      .map((p) => {
        const parent = p.parent_id ? byID.get(p.parent_id) : undefined;
        return {
          value: p.id,
          label: parent ? `${parent.title} / ${p.title}` : p.title,
        };
      });
  }, [graph.data?.points]);

  const validPointIDs = useMemo(
    () => new Set(pointOptions.map((o) => o.value)),
    [pointOptions],
  );

  const sourceTitleByID = useMemo(
    () => new Map((sources.data || []).map((s) => [s.id, s.title])),
    [sources.data],
  );

  const readyFragments = useMemo(() => {
    const list = (source.data?.fragments || []).filter(
      (f) => f.quality === "ready",
    );
    const needle = fragmentSearch.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((f) =>
      `${f.heading} ${f.body}`.toLowerCase().includes(needle),
    );
  }, [source.data?.fragments, fragmentSearch]);

  const totalFragPages = Math.max(
    1,
    Math.ceil(readyFragments.length / EVIDENCE_FRAGMENT_PAGE_SIZE),
  );
  const safeFragPage = Math.min(fragmentPage, totalFragPages);
  const pagedReadyFragments = readyFragments.slice(
    (safeFragPage - 1) * EVIDENCE_FRAGMENT_PAGE_SIZE,
    safeFragPage * EVIDENCE_FRAGMENT_PAGE_SIZE,
  );

  if (!course) {
    return <EmptyState title="请先选择当前课程" />;
  }

  const staleConflict = action.error?.status === 409;

  function validateSubmit(): string {
    const title = v.title.trim();
    const body = v.body.trim();
    const category = v.category.trim();
    const conditions = v.conditions.trim();
    if (!title) return "请填写知识标题";
    if (utf8ByteLength(title) > 500 || hasControlNull(title)) {
      return "知识标题不能超过 500 字节";
    }
    if (!body) return "请填写知识正文";
    if (utf8ByteLength(body) > 60000 || hasControlNull(body)) {
      return "知识正文不能超过 60000 字节";
    }
    if (utf8ByteLength(category) > 200 || hasControlNull(category)) {
      return "分类不能超过 200 字节";
    }
    if (utf8ByteLength(conditions) > 10000 || hasControlNull(conditions)) {
      return "适用条件不能超过 10000 字节";
    }
    if (v.origin !== "teacher_example") {
      if (!v.evidence.length) return "资料提炼知识至少需要 1 条原文依据";
      if (v.evidence.length > 30) return "原文依据最多 30 条";
      if (v.evidence.some((ev) => !ev.quote.trim() || !ev.source_id || !ev.fragment_id)) {
        return "每条原文依据都必须包含来源片段与非空逐字引用";
      }
    }
    if (v.knowledge_point_ids.length > 100) return "关联知识点最多 100 项";
    if (v.related_ids.length > 30) return "相关知识最多 30 项";
    return "";
  }

  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const err = validateSubmit();
        if (err) {
          setValidationError(err);
          return;
        }
        setValidationError("");
        const snapshot = v;
        const cleanPointIDs = dedupeStrings(v.knowledge_point_ids).filter(
          (pid) => !graph.data || validPointIDs.has(pid),
        );
        const cleanRelatedIDs = dedupeStrings(v.related_ids).filter(
          (rid) => rid !== initial?.id,
        );
        const isEditDraft = initial?.state === "draft";
        const path = isEditDraft ? `/knowledge/${initial.id}` : "/knowledge";
        const payload = {
          origin: v.origin || "source",
          title: v.title.trim(),
          body: v.body.trim(),
          category: v.category.trim(),
          content_kind:
            v.origin === "teacher_example" ? "example" : v.content_kind,
          conditions: v.conditions.trim(),
          evidence:
            v.origin === "teacher_example"
              ? []
              : v.evidence.map((ev) => ({
                  source_id: ev.source_id,
                  fragment_id: ev.fragment_id,
                  quote: ev.quote,
                })),
          student_visible: v.student_visible,
          use_for_learning: v.use_for_learning,
          use_for_grading:
            v.origin === "teacher_example" ? false : v.use_for_grading,
          knowledge_point_ids: cleanPointIDs,
          related_ids: cleanRelatedIDs,
          edit_version: isEditDraft ? initial.edit_version : undefined,
          supersedes_id: initial && !isEditDraft ? initial.id : "",
        };
        const saved = await action.run(
          path,
          payload,
          isEditDraft ? "PUT" : "POST",
          undefined,
          { invalidatePrefixes: ["knowledge", "jobs", "topics", "impact"] },
        );
        if (saved) {
          if (draft.saved(snapshot)) {
            onDone();
          } else {
            setConcurrentEditNotice(true);
          }
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} onDiscard={() => draft.reset(defaultDraft)} />
      <Feedback
        error={validationError ? new Error(validationError) : undefined}
        message={action.message}
        failed={action.failed}
      />
      {staleConflict && (
        <Alert
          type="warning"
          showIcon
          message="此知识条目已被其他操作修改或状态已变化，请刷新后再保存。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => void all.refetch()}
            >
              刷新最新数据
            </Button>
          }
        />
      )}
      {concurrentEditNotice && (
        <Alert
          type="info"
          showIcon
          message="保存期间编辑区有新的改动，已保留您的最新草稿；请核对后再次保存或关闭抽屉。"
        />
      )}
      <Field className="ui-field" label="内容来源">
        <Select
          aria-label="内容来源"
          disabled={!!initial}
          value={v.origin || "source"}
          options={[
            { value: "source", label: "资料提炼知识" },
            { value: "teacher_example", label: "教师自编教学示例" },
          ]}
          onChange={(origin: Knowledge["origin"]) =>
            change({
              origin,
              ...(origin === "teacher_example"
                ? {
                    content_kind: "example",
                    evidence: [],
                    use_for_grading: false,
                  }
                : {}),
            })
          }
        />
      </Field>
      <Field className="ui-field" label={<>标题</>} required={true}>
        <Input
          aria-label="标题"
          required
          value={v.title}
          onChange={(e) => change({ title: e.target.value })}
        />
      </Field>
      <div className="rag-two-fields">
        <Field className="ui-field" label={<>知识类型</>}>
          <Select
            aria-label="知识类型"
            disabled={v.origin === "teacher_example"}
            value={v.content_kind}
            options={knowledgeContentKinds.map((k) => ({
              value: k.value,
              label: k.label,
            }))}
            onChange={(content_kind) => change({ content_kind })}
          />
        </Field>
        <Field className="ui-field" label={<>分类</>}>
          <Input
            aria-label="分类"
            value={v.category}
            onChange={(e) => change({ category: e.target.value })}
          />
        </Field>
      </div>
      <Field className="ui-field" label={<>知识正文</>} required={true}>
        <Input.TextArea
          aria-label="知识正文"
          required
          rows={6}
          value={v.body}
          onChange={(e) => change({ body: e.target.value })}
        />
      </Field>
      <Field className="ui-field" label={<>适用条件与限制</>}>
        <Input.TextArea
          aria-label="适用条件与限制"
          rows={2}
          value={v.conditions}
          onChange={(e) => change({ conditions: e.target.value })}
        />
      </Field>
      <Field className="ui-field" label={<>关联课程知识点</>}>
        <Select
          aria-label="关联课程知识点"
          mode="multiple"
          optionFilterProp="label"
          value={v.knowledge_point_ids}
          onChange={(knowledge_point_ids) =>
            change({ knowledge_point_ids: dedupeStrings(knowledge_point_ids) })
          }
          options={pointOptions}
        />
      </Field>
      <Field className="ui-field" label={<>相似或相关知识</>}>
        <Select
          aria-label="相似或相关知识"
          mode="multiple"
          optionFilterProp="label"
          value={v.related_ids.filter((id) => id !== initial?.id)}
          onChange={(related_ids) =>
            change({
              related_ids: dedupeStrings(related_ids).filter(
                (id) => id !== initial?.id,
              ),
            })
          }
          options={all.data
            ?.filter((k) => k.id !== initial?.id)
            .map((k) => ({ value: k.id, label: k.title }))}
        />
      </Field>
      {v.origin !== "teacher_example" && (
        <Card size="small" title={<>原文依据（{v.evidence.length}）</>}>
          <div className="live-stack">
            <p className="live-meta" style={{ margin: 0 }}>
              引用文本须为对应原文片段的连续逐字子串；若勾选「学生可见」，所引用片段须已发布为学生学习内容。
            </p>
            {v.evidence.map((ev, i) => (
              <div
                key={`${ev.source_id}:${ev.fragment_id}:${i}`}
                style={{
                  display: "grid",
                  gap: 10,
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <MetaTags>
                  <MetaTag>
                    来源：{sourceTitleByID.get(ev.source_id) || "原始资料"}
                  </MetaTag>
                  <MetaTag>片段 {ev.fragment_id.slice(0, 8)}</MetaTag>
                </MetaTags>
                <Field
                  className="ui-field"
                  label={<>逐字引用</>}
                  required={true}
                >
                  <Input.TextArea
                    aria-label="逐字引用"
                    required
                    value={ev.quote}
                    onChange={(e) =>
                      change({
                        evidence: v.evidence.map((old, n) =>
                          n === i ? { ...old, quote: e.target.value } : old,
                        ),
                      })
                    }
                  />
                </Field>
                <Space wrap>
                  <Button
                    onClick={() =>
                      change({ evidence: v.evidence.filter((_, n) => n !== i) })
                    }
                    htmlType="button"
                  >
                    移除这条依据
                  </Button>
                </Space>
              </div>
            ))}
            <Field className="ui-field" label={<>来源文件</>}>
              <Select
                aria-label="来源文件"
                showSearch
                optionFilterProp="label"
                value={sourceID || undefined}
                onChange={(nextID) => {
                  setSourceID(nextID);
                  setFragmentSearch("");
                  setFragmentPage(1);
                }}
                options={sources.data
                  ?.filter((s) => s.state === "active" && s.allow_derived)
                  .map((s) => ({ value: s.id, label: s.title }))}
              />
            </Field>
            <Feedback error={source.error} />
            {(source.data?.fragments?.length || 0) >
              EVIDENCE_FRAGMENT_PAGE_SIZE && (
              <Input.Search
                aria-label="筛选来源片段"
                placeholder="按关键词筛选来源片段"
                allowClear
                value={fragmentSearch}
                onChange={(e) => {
                  setFragmentSearch(e.target.value);
                  setFragmentPage(1);
                }}
              />
            )}
            {pagedReadyFragments.map((f) => {
              const alreadyCited = v.evidence.some(
                (ev) => ev.source_id === sourceID && ev.fragment_id === f.id,
              );
              return (
                <Collapse
                  key={f.id}
                  items={[
                    {
                      key: "content",
                      label: (
                        <Space wrap size="small">
                          <span>{f.heading || formatLocator(f.locator) || "原文片段"}</span>
                          {alreadyCited && <MetaTag>已引用</MetaTag>}
                        </Space>
                      ),
                      children: (
                        <div className="live-stack" style={{ gap: 10 }}>
                          <p className="live-prose" style={{ margin: 0 }}>
                            {f.body}
                          </p>
                          <Space wrap>
                            <Button
                              disabled={alreadyCited}
                              onClick={() =>
                                change({
                                  evidence: [
                                    ...v.evidence,
                                    {
                                      source_id: sourceID,
                                      fragment_id: f.id,
                                      quote: f.body,
                                    },
                                  ],
                                })
                              }
                              htmlType="button"
                            >
                              {alreadyCited ? "已引用此片段" : "引用此片段"}
                            </Button>
                          </Space>
                        </div>
                      ),
                    },
                  ]}
                />
              );
            })}
            {readyFragments.length > EVIDENCE_FRAGMENT_PAGE_SIZE && (
              <Pagination
                hideOnSinglePage
                current={safeFragPage}
                pageSize={EVIDENCE_FRAGMENT_PAGE_SIZE}
                total={readyFragments.length}
                showSizeChanger={false}
                onChange={setFragmentPage}
              />
            )}
          </div>
        </Card>
      )}
      <div className="rag-checks">
        {(
          [
            ["student_visible", "学生可见"],
            ["use_for_learning", "用于学习检索"],
            ["use_for_grading", "用于评分依据"],
          ] as const
        ).map(([key, label]) => (
          <Checkbox
            className="rag-check"
            key={key}
            checked={v[key]}
            disabled={key === "use_for_grading" && v.origin === "teacher_example"}
            onChange={(e) => change({ [key]: e.target.checked })}
          >
            {label}
          </Checkbox>
        ))}
      </div>
      <Button
        disabled={
          action.busy ||
          !v.title.trim() ||
          !v.body.trim() ||
          (v.origin !== "teacher_example" && !v.evidence.length)
        }
        htmlType="submit"
        type="primary"
      >
        保存待审核版本
      </Button>
    </Form>
  );
}
