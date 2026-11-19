import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  Pagination,
  Select,
  Space,
  Tabs,
  Typography,
} from "antd";
import { Database, Upload } from "lucide-react";
import { requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import { Field } from "../shared/Field";
import { FileUpload } from "../shared/FileUpload";
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
import { JobsPanel, ModelSelect, useJob } from "./ai-jobs";
import { ContentLinks, DecisionHistory } from "./content-topics";
import { ContextAgent } from "./context-agent";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { formatLocator, labelFor, stateLabels } from "./domain-meta";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { useLocationValue } from "./location-state";
import { MaterialAssets } from "./material-assets";
import { PaperImport, SourceSegments, SourceSuggestions, URLImport } from "./material-assist";
import type {
  Fragment,
  Job,
  Point,
  Resource,
  Source,
  SourceDetail,
} from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";
import "./knowledge.css";

const LazyCourseWorkspace = lazy(() =>
  import("./course").then((m) => ({ default: m.CourseWorkspace })),
);
const LazyKnowledgePage = lazy(() =>
  import("./knowledge").then((m) => ({ default: m.KnowledgePage })),
);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".csv",
]);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_BATCH_FILES = 10;
const FRAGMENTS_PAGE_SIZE = 20;
const SOURCES_PAGE_SIZE = 10;

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function parseContentDispositionFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // Ignore malformed encoding and fall through.
    }
  }
  const plainMatch = header.match(/filename="([^"]+)"/i);
  return plainMatch?.[1] || fallback;
}

export function MaterialsPage() {
  const { course } = useLearning();
  const sources = useLiveQuery<Source[]>("/sources");
  const indexJobs = useLiveQuery<Job[]>("/jobs?kind=index&size=1");
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const selected = params.get("source") || "";
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);

  const setSelected = useCallback(
    (id: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("fragment");
        next.delete("job");
        next.delete("resource");
        if (id) next.set("source", id);
        else next.delete("source");
        return next;
      });
    },
    [setParams],
  );

  const [upload, setUpload] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [sourceSearch, setSourceSearch] = useLocationValue("search");
  const [searchInput, setSearchInput] = useState(sourceSearch);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchInput(sourceSearch);
  }, [sourceSearch, location.key]);

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
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      setSourceSearch(value);
    }, 150);
  }

  function flushSearch(value: string) {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchInput(value);
    setSourceSearch(value);
  }

  const rawPage = Number(params.get("page"));
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const sourceRows = useMemo(() => {
    const needle = searchInput.trim().toLocaleLowerCase();
    const list = sources.data || [];
    if (!needle) return list;
    return list.filter((s) =>
      `${s.title} ${s.filename}`.toLocaleLowerCase().includes(needle),
    );
  }, [sources.data, searchInput]);

  const totalPages = Math.max(
    1,
    Math.ceil(sourceRows.length / SOURCES_PAGE_SIZE),
  );
  const sourcePage = Math.min(requestedPage, totalPages);

  const imported = useCallback(
    (jobs: Job[]) => {
      setUpload(false);
      const id = jobs.find(
        (j) => typeof j.input?.source_id === "string",
      )?.input?.source_id;
      if (typeof id === "string") {
        setParams((prev) => {
          const p = new URLSearchParams(prev);
          p.set("source", id);
          p.set("source_view", "tasks");
          p.delete("resource");
          p.delete("fragment");
          p.delete("job");
          p.set("tab", "sources");
          return p;
        });
      }
    },
    [setParams],
  );

  const action = useAction();
  const [embedding, setEmbedding] = useState("");
  const tab =
    params.get("tab") === "published" || (params.has("resource") && !selected)
      ? "published"
      : "sources";

  const latestIndexSummary = indexJobs.data?.[0];
  const pollingIndexID =
    latestIndexSummary &&
    (latestIndexSummary.state === "queued" ||
      latestIndexSummary.state === "running")
      ? latestIndexSummary.id
      : "";
  const polledIndexJob = useJob(pollingIndexID);
  const latestIndexJob = polledIndexJob.data || latestIndexSummary;
  const indexJobActive =
    !!latestIndexJob &&
    (latestIndexJob.state === "queued" || latestIndexJob.state === "running");

  const switchTab = (value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", value);
      next.delete("resource");
      next.delete("source");
      next.delete("fragment");
      next.delete("source_view");
      next.delete("job");
      next.delete("page");
      return next;
    });
  };

  return (
    <div className="live-page is-wide-workspace">
      <PageHeader
        title="学习资料"
        subtitle={course?.title}
        meta={
          latestIndexJob ? (
            <StatusTag
              status={latestIndexJob.state}
              label={`最近索引：${labelFor(stateLabels, latestIndexJob.state)}`}
            />
          ) : undefined
        }
        extra={
          <>
            <Button
              htmlType="button"
              icon={<Database size={14} aria-hidden="true" />}
              onClick={() => setIndexDrawerOpen(true)}
            >
              检索索引
            </Button>
            <Button
              htmlType="button"
              icon={<Upload size={14} aria-hidden="true" />}
              onClick={() => setUpload(true)}
              type="primary"
            >
              导入资料
            </Button>
          </>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={switchTab}
        items={[
          { key: "sources", label: "原始资料" },
          { key: "published", label: "学习内容" },
        ]}
      />
      {tab === "published" ? (
        <Suspense fallback={<LoadingState label="正在加载学习内容…" />}>
          <LazyCourseWorkspace />
        </Suspense>
      ) : sources.error && isFeatureDisabledError(sources.error) ? (
        <FeatureNotice
          title="资料智能解析与检索索引尚未启用"
          description="当前环境未配置模型或检索服务，您仍可在「学习内容」页签维护和发布课程资料。"
          action={
            <Button
              size="small"
              type="primary"
              htmlType="button"
              onClick={() => switchTab("published")}
            >
              切换到学习内容
            </Button>
          }
        />
      ) : (
        <div className="material-task-workspace">
            <aside className="material-object-list" aria-label="原始资料列表">
              <Input.Search
                aria-label="搜索原始资料"
                placeholder="搜索资料"
                allowClear
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                onSearch={flushSearch}
              />
              {sources.isPending ? (
                <LoadingState />
              ) : sources.error ? (
                <ErrorState
                  message={sources.error.message}
                  onRetry={() => void sources.refetch()}
                />
              ) : !sources.data?.length ? (
                <Card className="card-panel">
                  <EmptyState title="还没有资料">
                    导入课程文件后，可核对原文、发布学习内容和提炼知识。
                  </EmptyState>
                </Card>
              ) : !sourceRows.length ? (
                <Card className="card-panel">
                  <EmptyState
                    title="没有匹配的原始资料"
                    action={
                      <Button
                        htmlType="button"
                        onClick={() => flushSearch("")}
                      >
                        清除筛选
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <>
                  <div className="rag-source-list">
                    {sourceRows
                      .slice(
                        (sourcePage - 1) * SOURCES_PAGE_SIZE,
                        sourcePage * SOURCES_PAGE_SIZE,
                      )
                      .map((s) => (
                        <Button
                          key={s.id}
                          htmlType="button"
                          onClick={() => setSelected(s.id)}
                          aria-pressed={s.id === selected}
                          className="card-panel rag-source"
                        >
                          <strong>{s.title}</strong>
                          {s.filename !== s.title && <span>{s.filename}</span>}
                          <MetaTags>
                            <StatusTag
                              status={
                                s.state === "archived"
                                  ? "archived"
                                  : s.parse_state
                              }
                              label={
                                s.state === "archived"
                                  ? "已归档"
                                  : labelFor(stateLabels, s.parse_state)
                              }
                            />
                            <MetaTag>{s.fragment_count || 0} 个片段</MetaTag>
                            {!!s.review_count && (
                              <StatusTag
                                status="needs_review"
                                label={`${s.review_count} 个待核对`}
                              />
                            )}
                          </MetaTags>
                          {s.parse_error && (
                            <span className="live-meta">{s.parse_error}</span>
                          )}
                        </Button>
                      ))}
                  </div>
                  {sourceRows.length > SOURCES_PAGE_SIZE && (
                    <div className="live-inline">
                      <Button
                        htmlType="button"
                        disabled={sourcePage <= 1}
                        onClick={() =>
                          setParams((prev) => {
                            const p = new URLSearchParams(prev);
                            p.set("page", String(sourcePage - 1));
                            return p;
                          })
                        }
                      >
                        上一页
                      </Button>
                      <span className="live-meta">
                        第 {sourcePage} / {totalPages} 页
                      </span>
                      <Button
                        htmlType="button"
                        disabled={sourcePage >= totalPages}
                        onClick={() =>
                          setParams((prev) => {
                            const p = new URLSearchParams(prev);
                            p.set("page", String(sourcePage + 1));
                            return p;
                          })
                        }
                      >
                        下一页
                      </Button>
                    </div>
                  )}
                </>
              )}
            </aside>
            <section
              className="material-current-object"
              aria-label="资料核对与发布"
            >
              {selected ? (
                <SourceWorkspace
                  key={`${selected}:${params.get("fragment") || ""}`}
                  id={selected}
                  fragmentID={params.get("fragment") || ""}
                />
              ) : (
                <Card className="card-panel">
                  <EmptyState title="选择资料开始核对">
                    导入后的对象和处理任务会在这里继续。
                  </EmptyState>
                </Card>
              )}
            </section>
          </div>
      )}
      <Drawer
        title="检索索引与处理任务"
        open={indexDrawerOpen}
        onClose={() => setIndexDrawerOpen(false)}
        width={540}
      >
        <Space direction="vertical" className="live-full-width" size="middle">
          <div className="live-inline">
            <ModelSelect
              kind="embedding"
              value={embedding}
              onChange={setEmbedding}
            />
            <Button
              htmlType="button"
              type="primary"
              disabled={action.busy || indexJobActive}
              onClick={() =>
                void action.run(
                  "/jobs",
                  {
                    kind: "index",
                    profile_id: embedding,
                  },
                  "POST",
                  undefined,
                  {
                    invalidatePrefixes: [
                      "jobs",
                      "sources",
                      "knowledge",
                      "models",
                      "retrieval",
                    ],
                  },
                )
              }
            >
              {indexJobActive ? "索引更新中…" : "更新检索索引"}
            </Button>
            <Link to="/teacher/retrieval">检索与问答</Link>
          </div>
          {latestIndexJob && (
            <p className="live-meta">
              最近一次课程索引：
              {labelFor(stateLabels, latestIndexJob.state)} ·{" "}
              {when(latestIndexJob.created_at)}
              {latestIndexJob.error ? ` · ${latestIndexJob.error}` : ""}
            </p>
          )}
          <Feedback message={action.message} failed={action.failed} />
          <JobsPanel
            kinds={[
              "parse",
              "index",
              "extract",
              "vision",
              "source_suggest",
              "source_segment",
            ]}
          />
        </Space>
      </Drawer>
      <Drawer
        title="导入资料"
        aria-label="导入资料"
        open={upload}
        closable={!uploadBusy}
        maskClosable={!uploadBusy}
        keyboard={!uploadBusy}
        onClose={() => {
          if (!uploadBusy) setUpload(false);
        }}
        width="min(100vw, 600px)"
        destroyOnHidden
      >
        <Tabs
          items={[
            {
              key: "files",
              label: "文件",
              disabled: uploadBusy,
              children: (
                <UploadForm onDone={imported} onBusyChange={setUploadBusy} />
              ),
            },
            {
              key: "url",
              label: "公开网址",
              disabled: uploadBusy,
              children: (
                <URLImport
                  onDone={(job) => imported([job])}
                  onBusyChange={setUploadBusy}
                />
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}

function UploadForm({
  onDone,
  supersedesID = "",
  onBusyChange,
}: {
  onDone: (jobs: Job[]) => void;
  supersedesID?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { course, reload } = useLearning();
  const { session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [note, setNote] = useState("");
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<
    { name: string; jobs: Job[]; error?: string }[]
  >([]);

  const mountedRef = useRef(true);
  const busyCbRef = useRef(onBusyChange);
  busyCbRef.current = onBusyChange;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyCbRef.current?.(false);
    };
  }, []);

  function validateUpload(): string {
    if (!course) return "请先选择当前课程后再上传";
    if (!files.length) return "请选择文件";
    if (supersedesID && files.length !== 1) {
      return "替换原件时一次只能上传一个文件";
    }
    if (files.length > MAX_BATCH_FILES) {
      return `每批最多 ${MAX_BATCH_FILES} 个文件`;
    }
    for (const file of files) {
      const ext = fileExtension(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return `文件「${file.name}」类型不支持（仅支持 PDF/DOCX/PPTX/TXT/MD/HTML/CSV）`;
      }
      if (file.size <= 0) {
        return `文件「${file.name}」为空文件，无法导入`;
      }
      if (file.size > MAX_FILE_BYTES) {
        return `文件「${file.name}」超过 30MiB 限制`;
      }
    }
    const trimmedNote = note.trim();
    if (!trimmedNote) return "请登记资料来源";
    if (hasControlNull(trimmedNote) || utf8ByteLength(trimmedNote) > 1000) {
      return "资料来源说明不能超过 1000 字节";
    }
    return "";
  }

  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const err = validateUpload();
        if (err || !course) {
          setError(err || "请先选择当前课程后再上传");
          return;
        }
        setBusy(true);
        busyCbRef.current?.(true);
        setError("");
        const results: { name: string; jobs: Job[]; error?: string }[] = [];
        const trimmedNote = note.trim();
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (mountedRef.current) {
            setProgressText(
              `正在上传第 ${i + 1} / ${files.length} 份：${file.name}`,
            );
          }
          const form = new FormData();
          form.append("files", file);
          form.append("source_note", trimmedNote);
          form.append("allow_derived", String(allow));
          if (supersedesID) form.append("supersedes_id", supersedesID);
          try {
            const response = await requestJSON<{ data: Job[] }>(
              `/learning/courses/${course.id}/sources`,
              { method: "POST", body: form },
              session?.csrf_token,
            );
            results.push({ name: file.name, jobs: response.data || [] });
          } catch (uploadErr) {
            results.push({
              name: file.name,
              jobs: [],
              error:
                uploadErr instanceof Error
                  ? uploadErr.message
                  : "上传结果未确认",
            });
          }
          if (mountedRef.current) {
            setReceipts([...results]);
          }
        }
        try {
          await reload();
        } catch {
          if (mountedRef.current) {
            setError("上传回执已保留，列表刷新失败，请刷新后核对。");
          }
        } finally {
          if (mountedRef.current) {
            setBusy(false);
            setProgressText("");
          }
          busyCbRef.current?.(false);
        }
      }}
      layout="vertical"
    >
      <Field className="ui-field" label={<>课程文件</>} required={true}>
        <FileUpload
          aria-label="课程文件"
          disabled={busy}
          required
          multiple={!supersedesID}
          resetKey={resetKey}
          accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv"
          onChange={(nextFiles) => {
            setFiles(nextFiles);
            setReceipts([]);
            setError("");
          }}
        />
      </Field>
      <small>
        {supersedesID
          ? "替换原件一次仅支持上传 1 个文件，不超过 30MiB；PDF / PPTX 最多 200 页。"
          : "每批10个以内，每个30MiB以内；PDF / PPTX最多200页。扫描文字须人工核对。"}
      </small>
      <Field className="ui-field" label={<>资料来源</>} required={true}>
        <Input.TextArea
          aria-label="资料来源"
          required
          disabled={busy}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError("");
          }}
          placeholder="如：课程讲义、教材版本、编写者或来源网址"
        />
      </Field>
      <Checkbox
        className="rag-check"
        disabled={busy}
        checked={allow}
        onChange={(e) => setAllow(e.target.checked)}
      >
        允许从本资料提炼知识候选
      </Checkbox>
      {busy && progressText && (
        <Alert type="info" showIcon role="status" message={progressText} />
      )}
      <Feedback error={error ? new Error(error) : undefined} />
      {receipts.map((r, i) => (
        <Alert
          key={`${r.name}:${i}`}
          showIcon
          type={r.error ? "warning" : "success"}
          message={`${r.name}：${r.error ? "未完成／结果待核对" : "已接收，解析任务已登记"}`}
          description={
            r.error
              ? `${r.error}。请先核对原件列表，勿重复上传已成功文件。`
              : r.jobs
                  .map(
                    (j) =>
                      `任务 ${j.id} · ${labelFor(stateLabels, j.state)}`,
                  )
                  .join("；")
          }
          action={
            r.jobs.length ? (
              <Button
                htmlType="button"
                disabled={busy}
                onClick={() => onDone(r.jobs)}
              >
                查看此文件处理
              </Button>
            ) : undefined
          }
        />
      ))}
      <Space wrap>
        {receipts.some((r) => r.jobs.length) && (
          <Button
            htmlType="button"
            disabled={busy}
            onClick={() => onDone(receipts.flatMap((r) => r.jobs))}
          >
            继续核对已导入资料
          </Button>
        )}
        {!busy && receipts.length > 0 && (
          <Button
            htmlType="button"
            onClick={() => {
              setFiles([]);
              setReceipts([]);
              setError("");
              setResetKey((k) => k + 1);
            }}
          >
            重新选择文件
          </Button>
        )}
        <Button
          disabled={busy || !!receipts.length}
          htmlType="submit"
          type="primary"
        >
          {busy ? "上传中…" : "上传并解析"}
        </Button>
      </Space>
    </Form>
  );
}

export function SourceWorkspace({
  id,
  fragmentID = "",
  embedded = false,
}: {
  id: string;
  fragmentID?: string;
  embedded?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [localTab, setLocalTab] = useState("original");
  const [localFragmentID, setLocalFragmentID] = useState(fragmentID);

  useEffect(() => {
    setLocalFragmentID(fragmentID);
  }, [fragmentID, id]);

  const tab = embedded ? localTab : params.get("source_view") || "original";
  const activeFragmentID = embedded ? localFragmentID : fragmentID;

  const setTab = useCallback(
    (nextTab: string) => {
      if (embedded) {
        setLocalTab(nextTab);
        return;
      }
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set("source_view", nextTab);
        return p;
      });
    },
    [embedded, setParams],
  );

  const detailPath = `/sources/${id}${activeFragmentID ? `?fragment_id=${encodeURIComponent(activeFragmentID)}` : ""}`;
  const query = useLiveQuery<SourceDetail>(detailPath, !!id);

  return (
    <div className="source-task-workspace">
      <div className="workspace-heading">
        <Typography.Text strong className="item-title">
          {query.data?.source.title || "资料工作区"}
        </Typography.Text>
        <ContextAgent
          context={{
            kind: "source",
            id,
            title: query.data?.source.title || "原件",
          }}
        />
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "original", label: "原文核对" },
          { key: "knowledge", label: "知识候选" },
          { key: "tasks", label: "处理记录" },
          { key: "publication", label: "学习内容与发布" },
        ]}
      />
      {tab === "original" && (
        <SourceDocument
          id={id}
          fragmentID={activeFragmentID}
          query={query}
          embedded={embedded}
          onOpenTab={setTab}
          onClearFragment={() => {
            if (embedded) {
              setLocalFragmentID("");
            } else {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("fragment");
                return next;
              });
            }
          }}
          onSelectReplacedSource={(newSourceID) => {
            if (embedded) {
              setLocalTab("tasks");
              return;
            }
            setParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set("source", newSourceID);
              next.set("source_view", "tasks");
              next.delete("fragment");
              return next;
            });
          }}
        />
      )}
      {tab === "knowledge" && (
        <Suspense fallback={<LoadingState label="正在加载知识候选…" />}>
          <LazyKnowledgePage sourceID={id} embedded />
        </Suspense>
      )}
      {tab === "tasks" && <JobsPanel sourceID={id} expanded />}
      {tab === "publication" && (
        <Suspense fallback={<LoadingState label="正在加载学习内容…" />}>
          <LazyCourseWorkspace sourceID={id} />
        </Suspense>
      )}
    </div>
  );
}

function SourceDocument({
  id,
  fragmentID,
  query,
  embedded,
  onOpenTab,
  onClearFragment,
  onSelectReplacedSource,
}: {
  id: string;
  fragmentID: string;
  query: ReturnType<typeof useLiveQuery<SourceDetail>>;
  embedded: boolean;
  onOpenTab: (tab: string) => void;
  onClearFragment: () => void;
  onSelectReplacedSource: (newSourceID: string) => void;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [full, setFull] = useState(false);
  const [model, setModel] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [point, setPoint] = useState("");
  const [publication, setPublication] = useState<Resource | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperDirty, setPaperDirty] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [fragmentSearch, setFragmentSearch] = useState("");
  const [fragmentPage, setFragmentPage] = useState(1);
  const dirtyFragmentsRef = useRef<Set<number>>(new Set());
  const points = useLiveQuery<{ points: Point[] }>("");

  const source = query.data?.source;
  const fragments = query.data?.fragments || [];
  const displayRevision = query.data?.display_revision ?? 0;

  useEffect(() => {
    setSelected([]);
    dirtyFragmentsRef.current.clear();
  }, [source?.parse_revision, displayRevision]);

  const indexedFragments = useMemo(
    () => fragments.map((fragment, index) => ({ fragment, index })),
    [fragments],
  );

  const filteredFragments = useMemo(() => {
    const needle = fragmentSearch.trim().toLowerCase();
    if (!needle) return indexedFragments;
    return indexedFragments.filter(({ fragment }) =>
      `${fragment.heading} ${fragment.body}`.toLowerCase().includes(needle),
    );
  }, [indexedFragments, fragmentSearch]);

  useEffect(() => {
    if (!fragmentID || !filteredFragments.length) return;
    const matchIdx = filteredFragments.findIndex(
      ({ fragment }) => fragment.id === fragmentID,
    );
    if (matchIdx >= 0) {
      const targetPage = Math.floor(matchIdx / FRAGMENTS_PAGE_SIZE) + 1;
      setFragmentPage(targetPage);
      requestAnimationFrame(() => {
        document
          .getElementById(`fragment-${fragmentID}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, [fragmentID, filteredFragments]);

  const activeFragmentAssetIDs = useMemo(() => {
    const set = new Set<string>();
    for (const f of fragments) {
      const aid = f.locator?.asset_id;
      if (typeof aid === "string" && aid) set.add(aid);
    }
    return set;
  }, [fragments]);

  const selectedPublishBytes = useMemo(() => {
    const selectedSet = new Set(selected);
    let total = 0;
    for (const f of fragments) {
      if (selectedSet.has(f.id)) {
        total += utf8ByteLength(f.heading) + utf8ByteLength(f.body) + 3;
      }
    }
    return total;
  }, [fragments, selected]);

  if (!course) {
    return <EmptyState title="请先选择当前课程" />;
  }
  if (query.isPending) return <LoadingState />;
  if (query.error || !query.data || !source) {
    return (
      <ErrorState
        message={query.error?.message || "资料不存在"}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const historical = displayRevision !== source.parse_revision;
  const editable = source.state === "active" && !historical;
  const isParsing =
    source.parse_state === "queued" || source.parse_state === "running";
  const publishTitle = (title || source.title).trim();
  const publishTitleTooLong =
    !publishTitle ||
    utf8ByteLength(publishTitle) > 500 ||
    hasControlNull(publishTitle);
  const fullMismatch = full && selected.length !== fragments.length;
  const publishTooLarge = selectedPublishBytes > 200000;
  const extractTooLarge = selectedPublishBytes > 60000;

  const totalFragmentPages = Math.max(
    1,
    Math.ceil(filteredFragments.length / FRAGMENTS_PAGE_SIZE),
  );
  const safeFragmentPage = Math.min(fragmentPage, totalFragmentPages);
  const visibleFragments = filteredFragments.slice(
    (safeFragmentPage - 1) * FRAGMENTS_PAGE_SIZE,
    safeFragmentPage * FRAGMENTS_PAGE_SIZE,
  );

  async function handleDownload() {
    if (!course || !source) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(
        `/api/v1/learning/courses/${encodeURIComponent(course.id)}/sources/${encodeURIComponent(id)}/download`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.error?.message || `下载失败（HTTP ${response.status}）`,
        );
      }
      const blob = await response.blob();
      const filename = parseContentDispositionFilename(
        response.headers.get("Content-Disposition"),
        source.filename || `${source.title}.bin`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "原件下载失败");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="live-form">
      <div className="live-inline">
        <Button
          htmlType="button"
          disabled={!editable || replacementBusy}
          onClick={() => setReplacing(!replacing)}
        >
          {replacing ? "取消上传新版本" : "上传原件新版本"}
        </Button>
        {editable && (
          <Link
            className="ghost-btn"
            to={`/teacher/question-bank?new=1&source_id=${encodeURIComponent(id)}`}
          >
            据此出题
          </Link>
        )}
        <MetaTags>
          <StatusTag
            status={
              source.state === "archived" ? "archived" : source.parse_state
            }
            label={
              source.state === "archived"
                ? "已归档"
                : labelFor(stateLabels, source.parse_state)
            }
          />
          <MetaTag>原文修订 {displayRevision}</MetaTag>
        </MetaTags>
        <Button
          htmlType="button"
          loading={downloading}
          onClick={() => void handleDownload()}
        >
          下载完整原件
        </Button>
        <Button
          htmlType="button"
          danger
          disabled={action.busy || source.state === "archived"}
          onClick={async () => {
            if (
              await confirm(
                "归档后原件及关联知识将停止参与检索，历史依据仍保留。继续？",
                { danger: true },
              )
            ) {
              void action.run(
                `/sources/${id}/archive`,
                undefined,
                "POST",
                undefined,
                {
                  invalidatePrefixes: [
                    "sources",
                    "resources",
                    "knowledge",
                    "jobs",
                    "topics",
                    "impact",
                    "",
                  ],
                },
              );
            }
          }}
        >
          归档
        </Button>
      </div>
      <Feedback
        error={downloadError ? new Error(downloadError) : undefined}
        message={action.message}
        failed={action.failed}
      />
      {action.error?.status === 409 && (
        <Alert
          type="warning"
          showIcon
          message="原文修订版本已变化，请刷新后再保存。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => void query.refetch()}
            >
              刷新原件
            </Button>
          }
        />
      )}
      {historical && (
        <Alert
          type="info"
          showIcon
          message="正在查看引用时的历史原文。"
          action={
            embedded ? (
              <Button size="small" htmlType="button" onClick={onClearFragment}>
                查看当前修订
              </Button>
            ) : (
              <Link to={`/teacher/materials?source=${encodeURIComponent(id)}`}>
                查看当前修订
              </Link>
            )
          }
        />
      )}
      <ContentLinks kind="source" id={id} />
      {editable && <SourceSuggestions id={id} />}
      {editable && <SourceSegments id={id} />}
      <MaterialAssets
        sourceID={id}
        revision={source.parse_revision}
        editable={editable}
        activeFragmentAssetIDs={activeFragmentAssetIDs}
      />
      {editable && fragments.length > 0 && (
        <Button htmlType="button" onClick={() => setPaperOpen(true)}>
          在此拆分试卷
        </Button>
      )}
      <DecisionHistory id={id} />
      <Drawer
        title="当前原件 · 整卷拆题"
        open={paperOpen}
        width="min(100vw, 1000px)"
        destroyOnHidden
        onClose={async () => {
          if (
            !paperDirty ||
            (await confirm("收起拆题工作区？未保存的校正保留在当前浏览器。"))
          ) {
            setPaperOpen(false);
            setPaperDirty(false);
          }
        }}
      >
        {paperOpen && (
          <EditorScope onDirtyChange={setPaperDirty}>
            <PaperImport
              id={id}
              fragments={fragments}
              parseRevision={source.parse_revision}
              defaultExpanded
            />
          </EditorScope>
        )}
      </Drawer>
      {replacing && editable && (
        <UploadForm
          supersedesID={id}
          onBusyChange={setReplacementBusy}
          onDone={(jobs) => {
            setReplacing(false);
            const nextSource = jobs[0]?.input?.source_id;
            if (typeof nextSource === "string") {
              onSelectReplacedSource(nextSource);
            }
          }}
        />
      )}
      <Checkbox
        className="rag-check"
        checked={source.allow_derived}
        disabled={action.busy || !editable}
        onChange={(e) =>
          void action.run(
            `/sources/${id}/derivation`,
            { allow_derived: e.target.checked },
            "PUT",
            undefined,
            {
              invalidatePrefixes: [
                "sources",
                "resources",
                "knowledge",
                "jobs",
                "topics",
                "impact",
                "",
              ],
            },
          )
        }
      >
        允许知识提炼
      </Checkbox>
      {source.parse_error && (
        <Alert type="error" showIcon role="alert" message={source.parse_error} />
      )}
      {!fragments.length && editable && !isParsing && (
        <Button
          htmlType="button"
          disabled={action.busy}
          onClick={() =>
            void action.run("/jobs", { kind: "parse", source_id: id })
          }
        >
          重新解析
        </Button>
      )}
      {fragments.length > FRAGMENTS_PAGE_SIZE && (
        <Input.Search
          aria-label="筛选原文片段"
          placeholder={`在 ${fragments.length} 个片段中搜索原文`}
          allowClear
          value={fragmentSearch}
          onChange={(e) => {
            setFragmentSearch(e.target.value);
            setFragmentPage(1);
          }}
        />
      )}
      <div className="rag-fragments">
        {visibleFragments.map(({ fragment: f, index }) => (
          <FragmentEditor
            key={`${source.parse_revision}:${index}:${f.id}`}
            courseID={course.id}
            sourceID={id}
            sourceRevision={displayRevision}
            position={index}
            fragment={f}
            editable={editable}
            highlighted={f.id === fragmentID}
            selected={selected.includes(f.id)}
            onDirtyChange={(dirty) => {
              if (dirty) dirtyFragmentsRef.current.add(index);
              else dirtyFragmentsRef.current.delete(index);
            }}
            onSelect={(checked) =>
              setSelected((prev) =>
                checked
                  ? prev.includes(f.id)
                    ? prev
                    : [...prev, f.id]
                  : prev.filter((item) => item !== f.id),
              )
            }
            onSave={async (patch) => {
              const otherDirty = [...dirtyFragmentsRef.current].some(
                (pos) => pos !== index,
              );
              if (
                otherDirty &&
                !(await confirm(
                  "还有其他片段包含未保存的校正。单条保存将生成新修订并重置其他片段的编辑区，确认继续？",
                ))
              ) {
                return false;
              }
              const next = fragments.map((x) =>
                x.id === f.id ? { ...x, ...patch } : x,
              );
              const saved = await action.run(
                `/sources/${id}/fragments`,
                { revision: source.parse_revision, fragments: next },
                "PUT",
              );
              if (saved) {
                setSelected([]);
                dirtyFragmentsRef.current.clear();
              }
              return !!saved;
            }}
          />
        ))}
      </div>
      {filteredFragments.length > FRAGMENTS_PAGE_SIZE && (
        <Pagination
          hideOnSinglePage
          current={safeFragmentPage}
          pageSize={FRAGMENTS_PAGE_SIZE}
          total={filteredFragments.length}
          showSizeChanger={false}
          onChange={setFragmentPage}
        />
      )}
      {fragments.length > 0 && editable && (
        <Card
          className="card-panel"
          title={
            <>
              选中片段 · {selected.length}/ {fragments.length}
            </>
          }
        >
          <div className="live-inline">
            <Button
              htmlType="button"
              onClick={() =>
                setSelected(
                  fragments
                    .filter((f) => f.quality === "ready")
                    .map((f) => f.id),
                )
              }
            >
              选择已核对片段
            </Button>
            <Button htmlType="button" onClick={() => setSelected([])}>
              清除选择
            </Button>
          </div>
          <Field className="ui-field" label={<>发布标题</>}>
            <Input
              aria-label="发布标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={source.title}
            />
          </Field>
          {publishTitleTooLong && (
            <Alert
              type="warning"
              showIcon
              message="发布标题不能为空，且不能超过 500 字节。"
            />
          )}
          <Field label="关联知识点">
            <Select
              aria-label="发布关联知识点"
              optionFilterProp="label"
              showSearch
              value={point}
              onChange={setPoint}
              options={[
                { value: "", label: "课程通用资料" },
                ...(points.data?.points
                  .filter((p) => p.kind === "point")
                  .map((p) => ({ value: p.id, label: p.title })) || []),
              ]}
            />
          </Field>
          <Checkbox
            className="rag-check"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          >
            发布完整原件（须选中全部片段）
          </Checkbox>
          {fullMismatch && (
            <Alert
              type="warning"
              showIcon
              message={`发布完整原件须选中全部 ${fragments.length} 个片段（当前已选 ${selected.length} 个）。`}
            />
          )}
          {publishTooLarge && (
            <Alert
              type="warning"
              showIcon
              message={`所选片段总计 ${selectedPublishBytes} 字节，超过单次发布 200000 字节上限，请分批发布。`}
            />
          )}
          <Button
            htmlType="button"
            disabled={
              action.busy ||
              !selected.length ||
              fullMismatch ||
              publishTooLarge ||
              publishTitleTooLong
            }
            onClick={async () => {
              if (
                !(await confirm(
                  `发布选中的 ${selected.length} 个片段给本课程学生？教师未选原文与私有候选不会开放。`,
                ))
              ) {
                return;
              }
              const r = await action.run<Resource>(`/sources/${id}/publish`, {
                title: publishTitle,
                fragment_ids: selected,
                full_source: full,
                knowledge_point_id: point,
                parse_revision: source.parse_revision,
              });
              if (r) setPublication(r);
            }}
            type="primary"
          >
            确认并发布到课程学习
          </Button>
          {publication && (
            <Alert
              showIcon
              type="success"
              message={`已发布：${publication.title} · v${publication.version}`}
              description={
                <Link
                  to={`/teacher/materials?source=${encodeURIComponent(id)}&source_view=publication&resource=${encodeURIComponent(publication.id)}`}
                >
                  查看已发布学习内容与学生可见文本
                </Link>
              }
            />
          )}
          <hr />
          {extractTooLarge && selected.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={`当前所选片段约 ${selectedPublishBytes} 字节，单次提炼建议控制在 60000 字节以内。`}
            />
          )}
          <div className="live-inline">
            <ModelSelect kind="chat" value={model} onChange={setModel} />
            <Button
              htmlType="button"
              disabled={
                action.busy || !selected.length || !source.allow_derived
              }
              onClick={() =>
                void action.run("/jobs", {
                  kind: "extract",
                  source_id: id,
                  fragment_ids: selected,
                  profile_id: model,
                })
              }
            >
              AI提炼知识候选
            </Button>
            <Button
              htmlType="button"
              onClick={() => onOpenTab("knowledge")}
            >
              审核当前来源候选
            </Button>
          </div>
          <Feedback message={action.message} failed={action.failed} />
        </Card>
      )}
    </div>
  );
}

function FragmentEditor({
  courseID,
  sourceID,
  sourceRevision,
  position,
  fragment: f,
  editable,
  highlighted,
  selected,
  onDirtyChange,
  onSelect,
  onSave,
}: {
  courseID: string;
  sourceID: string;
  sourceRevision: number;
  position: number;
  fragment: Fragment;
  editable: boolean;
  highlighted: boolean;
  selected: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSelect: (v: boolean) => void;
  onSave: (p: Partial<Fragment>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [validationError, setValidationError] = useState("");
  const initialDraft = useMemo(
    () => ({ heading: f.heading, body: f.body }),
    [f.heading, f.body],
  );
  const draft = useEditorDraft(
    `fragment:${courseID}:${sourceID}:${sourceRevision}:${position}`,
    initialDraft,
    editable,
  );
  const { heading, body } = draft.value;
  const [busy, setBusy] = useState(false);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  useEffect(() => {
    onDirtyChangeRef.current(draft.dirty);
    return () => onDirtyChangeRef.current(false);
  }, [draft.dirty]);

  useEffect(() => {
    if (draft.restored && editable) {
      setEditing(true);
    }
  }, [draft.restored, editable]);

  const loc = formatLocator(f.locator);
  const displayHeading = draft.dirty ? heading : f.heading;
  const displayBody = draft.dirty ? body : f.body;

  return (
    <article
      id={`fragment-${f.id}`}
      className="rag-fragment"
      style={
        highlighted
          ? {
              borderLeft: "4px solid var(--teal)",
              paddingLeft: 12,
              background: "var(--mint-soft)",
            }
          : undefined
      }
    >
      <DraftNotice
        {...draft}
        onDiscard={() => {
          draft.reset(initialDraft);
          setValidationError("");
        }}
      />
      <div className="live-inline">
        <Checkbox
          className="rag-check"
          checked={selected}
          disabled={!editable || f.quality !== "ready"}
          onChange={(e) => onSelect(e.target.checked)}
        >
          {displayHeading || loc || `片段 ${position + 1}`}
        </Checkbox>
        <MetaTags>
          <StatusTag
            status={f.quality === "needs_review" ? "needs_review" : "ready"}
            label={f.quality === "needs_review" ? "待人工核对" : "可使用"}
          />
          {highlighted && (
            <StatusTag status="processing" label="当前引用片段" />
          )}
          {draft.dirty && !editing && (
            <StatusTag status="warning" label="有未保存编辑" />
          )}
        </MetaTags>
      </div>
      {displayHeading && loc && <small>{loc}</small>}
      {editing ? (
        <>
          <Field className="ui-field" label={<>片段标题</>}>
            <Input
              aria-label="片段标题"
              value={heading}
              onChange={(e) => {
                draft.change((v) => ({ ...v, heading: e.target.value }));
                if (validationError) setValidationError("");
              }}
            />
          </Field>
          <Field className="ui-field" label={<>原文校正</>} required>
            <Input.TextArea
              aria-label="原文校正"
              value={body}
              onChange={(e) => {
                draft.change((v) => ({ ...v, body: e.target.value }));
                if (validationError) setValidationError("");
              }}
              rows={8}
            />
          </Field>
          {validationError && (
            <Alert type="error" showIcon role="alert" message={validationError} />
          )}
        </>
      ) : (
        <p className="live-prose">{displayBody}</p>
      )}
      {editable && (
        <div className="live-inline">
          <Button
            htmlType="button"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "收起编辑" : "校正原文"}
          </Button>
          {(editing || draft.dirty || f.quality === "needs_review") && (
            <Button
              htmlType="button"
              disabled={busy}
              onClick={async () => {
                if (!body.trim()) {
                  setValidationError("片段正文不能为空");
                  setEditing(true);
                  return;
                }
                if (hasControlNull(body) || utf8ByteLength(body) > 500000) {
                  setValidationError("片段正文不能超过 500000 字节或包含非法字符");
                  setEditing(true);
                  return;
                }
                if (hasControlNull(heading) || utf8ByteLength(heading) > 500) {
                  setValidationError("片段标题不能超过 500 字节或包含非法字符");
                  setEditing(true);
                  return;
                }
                setValidationError("");
                setBusy(true);
                const snapshot = draft.value;
                try {
                  if (
                    await onSave({
                      heading: snapshot.heading,
                      body: snapshot.body,
                      quality: "ready",
                    })
                  ) {
                    draft.saved(snapshot);
                    setEditing(false);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存新修订并确认原文
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
