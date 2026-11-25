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
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Dropdown,
  Form,
  Input,
  Pagination,
  Progress,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
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
  ActionToolbar,
  CollapsibleProse,
  EmptyState,
  ErrorState,
  FeatureNotice,
  isFeatureDisabledError,
  LoadingState,
  MetaTag,
  MetaTags,
  SectionSummaryBar,
  StatusTag,
} from "../shared/ui";
import { JobsPanel, ModelSelect, useJob } from "./ai-jobs";
import { ContentLinks, DecisionHistory } from "./content-topics";
import { ContextAgent } from "./context-agent";
import {
  Feedback,
  Link,
  useAction,
  useCourseNavigate,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import {
  VIDEO_EXTENSIONS,
  extractTimeRangeMs,
  formatLocator,
  formatTimeRangeMs,
  isVideoSource,
  labelFor,
  stateLabels,
} from "./domain-meta";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { useLocationValue } from "./location-state";
import { MaterialAssets } from "./material-assets";
import { PaperImport, SourceSegments, SourceSuggestions, URLImport } from "./material-assist";
import { MediaPlayer } from "./media-player";
import type {
  Fragment,
  Job,
  Point,
  Resource,
  Source,
  SourceDetail,
} from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

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
  ...VIDEO_EXTENSIONS,
]);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_BATCH_FILES = 10;
const FRAGMENTS_PAGE_SIZE = 12;

function isAssetStub(f: Fragment): boolean {
  const trimmed = f.body.trim();
  return trimmed === "[图文资产待核对]" || trimmed.startsWith("[图文资产");
}
const SOURCES_PAGE_SIZE = 10;

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function isVideoFilename(name: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(fileExtension(name));
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
                            {isVideoSource(s.media_type, s.filename) && (
                              <Tag color="purple">视频</Tag>
                            )}
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
        width="min(100%, 540px)"
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
  const { course } = useLearning();
  const queryClient = useQueryClient();
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
    let videoCount = 0;
    let docCount = 0;
    for (const file of files) {
      const ext = fileExtension(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return `文件「${file.name}」类型不支持（仅支持 PDF/DOCX/PPTX/TXT/MD/HTML/CSV 与 MP4/MOV/MKV/WEBM/M4V 视频）`;
      }
      if (file.size <= 0) {
        return `文件「${file.name}」为空文件，无法导入`;
      }
      if (isVideoFilename(file.name)) {
        videoCount += 1;
        if (file.size > MAX_VIDEO_BYTES) {
          return `视频文件「${file.name}」超过 512MiB 限制`;
        }
      } else {
        docCount += 1;
        if (file.size > MAX_FILE_BYTES) {
          return `文件「${file.name}」超过 30MiB 限制`;
        }
      }
    }
    if (videoCount > 0 && docCount > 0) {
      return "不能在同一批次中混传视频和文档文件，请分开上传";
    }
    if (videoCount > 1) {
      return "视频文件每次只能上传 1 个";
    }
    if (files.length > MAX_BATCH_FILES) {
      return `每批最多 ${MAX_BATCH_FILES} 个文件`;
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
          const filters = {
            predicate: (q: { queryKey: readonly unknown[] }) =>
              q.queryKey[0] === "live" &&
              q.queryKey[1] === course.id &&
              ["sources", "jobs"].includes(
                String(q.queryKey[2] || "")
                  .split("/")[1]
                  ?.split("?")[0] || "",
              ),
          };
          await queryClient.cancelQueries(filters);
          await queryClient.invalidateQueries(filters);
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
          accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv,.mp4,.mov,.mkv,.webm,.m4v"
          onChange={(nextFiles) => {
            setFiles(nextFiles);
            setReceipts([]);
            setError("");
          }}
        />
      </Field>
      <small>
        {supersedesID
          ? "替换原件一次仅支持 1 个文件：文档 30MiB 以内（PDF / PPTX 最多 200 页），视频（MP4/MOV/MKV/WEBM/M4V）512MiB 以内。"
          : "文档每批 10 个以内、单个 30MiB 以内（PDF / PPTX 最多 200 页）；视频每次仅限 1 个、512MiB 以内，不可与文档混传。"}
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

const VALID_SOURCE_VIEWS = new Set([
  "original",
  "publication",
  "knowledge",
  "tasks",
]);

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

  const rawView = params.get("source_view");
  const tab = embedded
    ? localTab
    : rawView && VALID_SOURCE_VIEWS.has(rawView)
      ? rawView
      : "original";
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

  const clearFragment = useCallback(() => {
    if (embedded) {
      setLocalFragmentID("");
    } else {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("fragment");
        return next;
      });
    }
  }, [embedded, setParams]);

  const selectReplacedSource = useCallback(
    (newSourceID: string) => {
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
    },
    [embedded, setParams],
  );

  return (
    <div className="source-task-workspace">
      <div className="workspace-heading">
        <Typography.Text strong className="item-title">
          {query.data?.source.title || "资料工作区"}
        </Typography.Text>
        {!embedded && (
          <ContextAgent
            context={{
              kind: "source",
              id,
              title: query.data?.source.title || "原件",
            }}
          />
        )}
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "original", label: "原文核对" },
          { key: "publication", label: "分段与发布" },
          { key: "knowledge", label: "知识候选" },
          { key: "tasks", label: "任务与记录" },
        ]}
      />
      {tab === "original" && (
        <SourceOriginalTab
          id={id}
          fragmentID={activeFragmentID}
          query={query}
          embedded={embedded}
          onClearFragment={clearFragment}
          onSelectReplacedSource={selectReplacedSource}
        />
      )}
      {tab === "publication" && (
        <SourcePublicationTab
          id={id}
          query={query}
          embedded={embedded}
          onOpenTab={setTab}
          onClearFragment={clearFragment}
        />
      )}
      {tab === "knowledge" && (
        <SourceKnowledgeTab id={id} query={query} />
      )}
      {tab === "tasks" && (
        <div className="live-stack">
          <JobsPanel sourceID={id} expanded />
          <DecisionHistory id={id} defaultExpanded />
        </div>
      )}
    </div>
  );
}

function SourceOriginalTab({
  id,
  fragmentID,
  query,
  embedded,
  onClearFragment,
  onSelectReplacedSource,
}: {
  id: string;
  fragmentID: string;
  query: ReturnType<typeof useLiveQuery<SourceDetail>>;
  embedded: boolean;
  onClearFragment: () => void;
  onSelectReplacedSource: (newSourceID: string) => void;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const courseNavigate = useCourseNavigate();
  const action = useAction();

  const [replacing, setReplacing] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperDirty, setPaperDirty] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [fragmentSearch, setFragmentSearch] = useState("");
  const [fragmentFilter, setFragmentFilter] = useState<
    "auto" | "text" | "review" | "all"
  >("auto");
  const [fragmentPage, setFragmentPage] = useState(1);

  const [searchParams] = useSearchParams();
  const rawT = searchParams.get("t");
  const initialSeekMs = useMemo(() => {
    if (!rawT) return null;
    const parsed = Number(rawT);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }, [rawT]);
  const [seekState, setSeekState] = useState<{
    ms: number | null;
    nonce: number;
  }>(() => ({ ms: initialSeekMs, nonce: 0 }));
  const handleSeek = useCallback((ms: number) => {
    setSeekState((prev) => ({ ms, nonce: prev.nonce + 1 }));
  }, []);
  const dirtyFragmentsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    setSeekState((prev) => ({ ms: initialSeekMs, nonce: prev.nonce + 1 }));
  }, [id, initialSeekMs]);

  useEffect(() => {
    if (fragmentID) {
      setFragmentFilter("all");
      setFragmentSearch("");
    }
  }, [fragmentID]);

  const source = query.data?.source;
  const fragments = query.data?.fragments || [];
  const displayRevision = query.data?.display_revision ?? 0;

  useEffect(() => {
    dirtyFragmentsRef.current.clear();
  }, [source?.parse_revision, displayRevision]);

  const indexedFragments = useMemo(
    () => fragments.map((fragment, index) => ({ fragment, index })),
    [fragments],
  );

  const needsReviewCount = useMemo(
    () => fragments.filter((f) => f.quality === "needs_review").length,
    [fragments],
  );

  const assetStubCount = useMemo(
    () => fragments.filter(isAssetStub).length,
    [fragments],
  );
  const textFragmentCount = fragments.length - assetStubCount;
  const effectiveFilter: "text" | "review" | "all" =
    fragmentFilter === "auto"
      ? assetStubCount > 0 && textFragmentCount > 0
        ? "text"
        : "all"
      : fragmentFilter;

  const filteredFragments = useMemo(() => {
    const needle = fragmentSearch.trim().toLowerCase();
    return indexedFragments.filter(({ fragment }) => {
      if (effectiveFilter === "text" && isAssetStub(fragment)) return false;
      if (effectiveFilter === "review" && fragment.quality !== "needs_review") {
        return false;
      }
      if (
        needle &&
        !`${fragment.heading} ${fragment.body}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [indexedFragments, fragmentSearch, effectiveFilter]);

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
  const videoSource = isVideoSource(source.media_type, source.filename);
  const isParsing =
    source.parse_state === "queued" || source.parse_state === "running";

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

  async function confirmAllNeedsReview() {
    if (!needsReviewCount || !source) return;
    const nonStubCount = fragments.filter(
      (f) => f.quality === "needs_review" && !isAssetStub(f),
    ).length;
    const msg =
      assetStubCount > 0
        ? `确认将本原件全部 ${needsReviewCount} 个待核对片段（含 ${nonStubCount} 个正文片段）直接标记为「可使用」？`
        : `确认将本原件全部 ${needsReviewCount} 个待核对片段标记为「可使用」？`;
    if (!(await confirm(msg))) return;
    const next = fragments.map((x) =>
      x.quality === "needs_review" ? { ...x, quality: "ready" as const } : x,
    );
    const saved = await action.run(
      `/sources/${id}/fragments`,
      { revision: source.parse_revision, fragments: next },
      "PUT",
      "已批量确认全部待核对片段",
    );
    if (saved) {
      dirtyFragmentsRef.current.clear();
      if (effectiveFilter === "review") setFragmentFilter("text");
    }
  }

  return (
    <div className="live-form">
      <ActionToolbar
        left={
          <>
            <Button
              htmlType="button"
              type="primary"
              disabled={!editable || replacementBusy}
              onClick={() => setReplacing(!replacing)}
            >
              {replacing ? "取消上传新版本" : "上传原件新版本"}
            </Button>
            {editable && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "question",
                      label: "据此出题",
                      onClick: () =>
                        courseNavigate(
                          `/teacher/question-bank?new=1&source_id=${encodeURIComponent(id)}`,
                        ),
                    },
                    {
                      key: "paper",
                      label:
                        videoSource || !fragments.length
                          ? "在此拆分试卷（仅非视频且有片段可用）"
                          : "在此拆分试卷",
                      disabled: videoSource || !fragments.length,
                      onClick: () => setPaperOpen(true),
                    },
                  ],
                }}
              >
                <Button htmlType="button">出题 / 拆卷</Button>
              </Dropdown>
            )}
          </>
        }
        right={
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "download",
                  label: downloading ? "下载中…" : "下载完整原件",
                  disabled: downloading,
                  onClick: () => void handleDownload(),
                },
                {
                  key: "classify",
                  label: "归类与标签",
                  onClick: () => setClassifyOpen(true),
                },
                {
                  key: "archive",
                  label: source.state === "archived" ? "已归档" : "归档原件",
                  danger: true,
                  disabled: action.busy || source.state === "archived",
                  onClick: async () => {
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
                  },
                },
              ],
            }}
          >
            <Button htmlType="button">更多操作</Button>
          </Dropdown>
        }
      />

      <SectionSummaryBar
        left={
          <MetaTags>
            {videoSource && <Tag color="purple">视频</Tag>}
            <StatusTag
              status={source.state === "archived" ? "archived" : source.parse_state}
              label={
                source.state === "archived"
                  ? "已归档"
                  : labelFor(stateLabels, source.parse_state)
              }
            />
            <MetaTag>修订 {displayRevision}</MetaTag>
            <MetaTag>{fragments.length} 片段</MetaTag>
            {needsReviewCount > 0 && (
              <StatusTag
                status="needs_review"
                label={`${needsReviewCount} 待核对`}
              />
            )}
          </MetaTags>
        }
        right={
          editable && needsReviewCount > 0 ? (
            <Button
              size="small"
              type="primary"
              htmlType="button"
              disabled={action.busy}
              onClick={() => void confirmAllNeedsReview()}
            >
              一键确认全部待核对（{needsReviewCount}）
            </Button>
          ) : undefined
        }
      />

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

      {source.parse_error && (
        <Alert type="error" showIcon role="alert" message={source.parse_error} />
      )}

      {!fragments.length && editable && !isParsing && (
        <Space wrap>
          <Button
            htmlType="button"
            disabled={action.busy}
            onClick={() =>
              void action.run("/jobs", { kind: "parse", source_id: id })
            }
          >
            重新解析
          </Button>
        </Space>
      )}

      {videoSource && (
        <MediaPlayer
          src={`/api/v1/learning/courses/${encodeURIComponent(course.id)}/sources/${encodeURIComponent(id)}/stream`}
          title={source.title}
          seekMs={seekState.ms}
          seekNonce={seekState.nonce}
        />
      )}

      <MaterialAssets
        sourceID={id}
        revision={source.parse_revision}
        editable={editable}
        activeFragmentAssetIDs={activeFragmentAssetIDs}
        isVideo={videoSource}
      />

      {fragments.length > 0 && (
        <ActionToolbar
          left={
            <>
              <Input.Search
                aria-label="筛选原文片段"
                placeholder={`搜索 ${fragments.length} 个片段`}
                allowClear
                value={fragmentSearch}
                style={{ width: 220, maxWidth: "100%" }}
                onChange={(e) => {
                  setFragmentSearch(e.target.value);
                  setFragmentPage(1);
                }}
              />
              <Segmented
                size="small"
                value={effectiveFilter}
                onChange={(val) => {
                  setFragmentFilter(val as "text" | "review" | "all");
                  setFragmentPage(1);
                }}
                options={[
                  { value: "text", label: `仅正文 (${textFragmentCount})` },
                  { value: "review", label: `待核对 (${needsReviewCount})` },
                  { value: "all", label: `全部 (${fragments.length})` },
                ]}
              />
            </>
          }
          right={
            assetStubCount > 0 && effectiveFilter === "text" ? (
              <MetaTag>已折叠 {assetStubCount} 条图文占位</MetaTag>
            ) : undefined
          }
        />
      )}

      {fragments.length > 0 && !filteredFragments.length ? (
        <EmptyState
          title={
            effectiveFilter === "review"
              ? "当前没有「待人工核对」的片段"
              : effectiveFilter === "text"
                ? "当前仅包含图文资产占位片段"
                : "没有匹配的原文片段"
          }
          action={
            <Button
              htmlType="button"
              onClick={() => {
                setFragmentFilter("all");
                setFragmentSearch("");
                setFragmentPage(1);
              }}
            >
              查看全部片段
            </Button>
          }
        />
      ) : (
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
              onSeek={videoSource ? handleSeek : undefined}
              onDirtyChange={(dirty) => {
                if (dirty) dirtyFragmentsRef.current.add(index);
                else dirtyFragmentsRef.current.delete(index);
              }}
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
                  dirtyFragmentsRef.current.clear();
                }
                return !!saved;
              }}
            />
          ))}
        </div>
      )}

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

      <Drawer
        title="归类与标签"
        open={classifyOpen}
        width="min(100%, 600px)"
        destroyOnHidden
        onClose={() => setClassifyOpen(false)}
      >
        <Space direction="vertical" size="middle" className="live-full-width">
          <ContentLinks kind="source" id={id} defaultExpanded />
          {editable && <SourceSuggestions id={id} defaultExpanded />}
        </Space>
      </Drawer>

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
    </div>
  );
}

function SourcePublicationTab({
  id,
  query,
  embedded,
  onOpenTab,
  onClearFragment,
}: {
  id: string;
  query: ReturnType<typeof useLiveQuery<SourceDetail>>;
  embedded: boolean;
  onOpenTab: (tab: string) => void;
  onClearFragment: () => void;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const action = useAction();
  const points = useLiveQuery<{ points: Point[] }>("");

  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [selected, setSelected] = useState<string[]>([]);
  const [previewOnly, setPreviewOnly] = useState(true);
  const [title, setTitle] = useState("");
  const [point, setPoint] = useState("");
  const [full, setFull] = useState(false);
  const [publication, setPublication] = useState<Resource | null>(null);
  const [seekState, setSeekState] = useState<{
    ms: number | null;
    nonce: number;
  }>({ ms: null, nonce: 0 });
  const handleSeek = useCallback((ms: number) => {
    setSeekState((prev) => ({ ms, nonce: prev.nonce + 1 }));
  }, []);

  const source = query.data?.source;
  const fragments = query.data?.fragments || [];
  const displayRevision = query.data?.display_revision ?? 0;

  useEffect(() => {
    setSelected([]);
    setPublication(null);
  }, [source?.parse_revision, displayRevision, id]);

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

  const needsReviewCount = useMemo(
    () => fragments.filter((f) => f.quality === "needs_review").length,
    [fragments],
  );

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
  const videoSource = isVideoSource(source.media_type, source.filename);
  const publishTitle = (title || source.title).trim();
  const publishTitleTooLong =
    !publishTitle ||
    utf8ByteLength(publishTitle) > 500 ||
    hasControlNull(publishTitle);
  const fullMismatch = full && selected.length !== fragments.length;
  const publishTooLarge = selectedPublishBytes > 200000;

  return (
    <div className="live-stack">
      {historical && (
        <Alert
          type="info"
          showIcon
          message="正在查看引用时的历史修订，切换回当前修订后可进行分段与发布。"
          action={
            embedded ? (
              <Button size="small" htmlType="button" onClick={onClearFragment}>
                查看当前修订
              </Button>
            ) : (
              <Link to={`/teacher/materials?source=${encodeURIComponent(id)}&source_view=publication`}>
                查看当前修订
              </Link>
            )
          }
        />
      )}

      {!editable && !historical && (
        <Alert
          type="info"
          showIcon
          message="当前原件已归档，仅可查看下方已发布的学习内容。"
        />
      )}

      {editable && (
        <>
          <Space wrap>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as "ai" | "manual")}
              options={[
                { value: "ai", label: "AI 智能分段发布" },
                { value: "manual", label: "手动自选片段发布" },
              ]}
            />
          </Space>

          {videoSource && seekState.ms !== null && (
            <MediaPlayer
              src={`/api/v1/learning/courses/${encodeURIComponent(course.id)}/sources/${encodeURIComponent(id)}/stream`}
              title={source.title}
              seekMs={seekState.ms}
              seekNonce={seekState.nonce}
            />
          )}

          {mode === "ai" ? (
            <SourceSegments
              id={id}
              parseRevision={source.parse_revision}
              fragments={fragments}
              editable={editable}
              onSeek={videoSource ? handleSeek : undefined}
              onGoOriginal={() => onOpenTab("original")}
            />
          ) : (
            <Card
              className="card-panel"
              title={
                <>
                  手动自选片段发布 · 已选 {selected.length} / {fragments.length}
                </>
              }
            >
              {!fragments.length ? (
                <EmptyState title="当前原件暂无可发布的已解析片段" />
              ) : (
                <Form layout="vertical" component={false} className="live-stack">
                  <Space wrap>
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
                      全选已核对
                    </Button>
                    <Button htmlType="button" onClick={() => setSelected([])}>
                      清空
                    </Button>
                    <Checkbox
                      className="rag-check"
                      checked={previewOnly}
                      onChange={(e) => setPreviewOnly(e.target.checked)}
                    >
                      仅看标题与前 60 字预览
                    </Checkbox>
                  </Space>

                  {needsReviewCount > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`有 ${needsReviewCount} 个片段「待人工核对」，需先在原文核对中确认后才可勾选发布。`}
                      action={
                        <Button
                          size="small"
                          htmlType="button"
                          onClick={() => onOpenTab("original")}
                        >
                          前往原文核对
                        </Button>
                      }
                    />
                  )}

                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      maxHeight: 340,
                      overflowY: "auto",
                      padding: 12,
                      border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--surface)",
                    }}
                  >
                    {fragments.map((f, index) => {
                      const loc = formatLocator(f.locator);
                      const labelTitle = f.heading || loc || `片段 ${index + 1}`;
                      const previewText = previewOnly
                        ? `${f.body.slice(0, 60)}${f.body.length > 60 ? "…" : ""}`
                        : f.body;
                      return (
                        <div
                          key={f.id}
                          style={{
                            paddingBottom: 8,
                            borderBottom: "1px solid var(--line)",
                            minWidth: 0,
                          }}
                        >
                          <Checkbox
                            className="rag-check"
                            checked={selected.includes(f.id)}
                            disabled={f.quality !== "ready"}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? prev.includes(f.id)
                                    ? prev
                                    : [...prev, f.id]
                                  : prev.filter((item) => item !== f.id),
                              )
                            }
                          >
                            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                              <Space wrap size="small">
                                <strong>{labelTitle}</strong>
                                {f.quality === "needs_review" && (
                                  <StatusTag
                                    status="needs_review"
                                    label="待人工核对"
                                  />
                                )}
                              </Space>
                              <div
                                className="live-meta"
                                style={{ overflowWrap: "anywhere", marginTop: 2 }}
                              >
                                {previewText}
                              </div>
                            </div>
                          </Checkbox>
                        </div>
                      );
                    })}
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

                  <Field className="ui-field" label="关联知识点">
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

                  <Space wrap>
                    <Button
                      htmlType="button"
                      type="primary"
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
                        const r = await action.run<Resource>(
                          `/sources/${id}/publish`,
                          {
                            title: publishTitle,
                            fragment_ids: selected,
                            full_source: full,
                            knowledge_point_id: point,
                            parse_revision: source.parse_revision,
                          },
                        );
                        if (r) setPublication(r);
                      }}
                    >
                      确认并发布到课程学习
                    </Button>
                  </Space>

                  <Feedback message={action.message} failed={action.failed} />

                  {publication && (
                    <Alert
                      showIcon
                      type="success"
                      message={`已发布：${publication.title} · v${publication.version}`}
                      description="已同步更新到下方「本原件已发布的学习内容」。"
                    />
                  )}
                </Form>
              )}
            </Card>
          )}
        </>
      )}

      <div className="live-stack" style={{ gap: 12 }}>
        <Typography.Text strong className="item-title" style={{ margin: 0 }}>
          本原件已发布的学习内容
        </Typography.Text>
        <Suspense fallback={<LoadingState label="正在加载学习内容…" />}>
          <LazyCourseWorkspace sourceID={id} />
        </Suspense>
      </div>
    </div>
  );
}

function SourceKnowledgeTab({
  id,
  query,
}: {
  id: string;
  query: ReturnType<typeof useLiveQuery<SourceDetail>>;
}) {
  const { course } = useLearning();
  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [extractJobID, setExtractJobID] = useState("");
  const extractJob = useJob(extractJobID);

  const source = query.data?.source;
  const fragments = query.data?.fragments || [];
  const displayRevision = query.data?.display_revision ?? 0;

  useEffect(() => {
    setSelected([]);
    setExtractJobID("");
  }, [source?.parse_revision, displayRevision, id]);

  const readyFragments = useMemo(
    () => fragments.filter((f) => f.quality === "ready"),
    [fragments],
  );

  const selectedBytes = useMemo(() => {
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
  const extractTooLarge = selectedBytes > 60000;
  const extractJobActive =
    !!extractJob.data &&
    (extractJob.data.state === "queued" || extractJob.data.state === "running");

  return (
    <div className="live-stack">
      <Card className="card-panel" title="原件 → 知识库提炼">
        <div className="live-stack" style={{ gap: 12 }}>
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
            允许从本资料提炼知识候选
          </Checkbox>

          {!source.allow_derived && (
            <Typography.Text type="secondary">
              开启「允许从本资料提炼知识候选」后，可选中已核对片段发起 AI 知识提炼。
            </Typography.Text>
          )}

          {editable && fragments.length > 0 && (
            <>
              <Space wrap>
                <Button
                  size="small"
                  htmlType="button"
                  disabled={!source.allow_derived || !readyFragments.length}
                  onClick={() =>
                    setSelected(
                      readyFragments.slice(0, 200).map((f) => f.id),
                    )
                  }
                >
                  全选已核对（{readyFragments.length}）
                </Button>
                <Button
                  size="small"
                  htmlType="button"
                  disabled={!selected.length}
                  onClick={() => setSelected([])}
                >
                  清空
                </Button>
                <Typography.Text type="secondary">
                  已选 {selected.length} / {fragments.length} 个片段（约{" "}
                  {selectedBytes} 字节）
                </Typography.Text>
              </Space>

              <Field className="ui-field" label="选择提炼片段">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  aria-label="选择提炼片段"
                  disabled={!source.allow_derived}
                  placeholder="选择已核对片段（最多 200 个）"
                  value={selected}
                  onChange={(vals) => setSelected(vals)}
                  options={fragments.map((f, index) => {
                    const loc = formatLocator(f.locator);
                    const head = f.heading || loc || `片段 ${index + 1}`;
                    return {
                      value: f.id,
                      disabled: f.quality !== "ready",
                      label: `${index + 1}. ${head}${
                        f.quality === "needs_review" ? "（待人工核对）" : ""
                      } · ${f.body.slice(0, 36)}`,
                    };
                  })}
                />
              </Field>

              {extractTooLarge && selected.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  message={`当前所选片段约 ${selectedBytes} 字节，单次提炼建议控制在 60000 字节以内。`}
                />
              )}
              {selected.length > 200 && (
                <Alert
                  type="warning"
                  showIcon
                  message="单次提炼最多支持 200 个片段，请适当精简选择。"
                />
              )}

              <div className="live-inline">
                <ModelSelect kind="chat" value={model} onChange={setModel} />
                <Button
                  htmlType="button"
                  type="primary"
                  loading={extractJobActive}
                  disabled={
                    action.busy ||
                    extractJobActive ||
                    !selected.length ||
                    selected.length > 200 ||
                    !source.allow_derived
                  }
                  onClick={async () => {
                    const j = await action.run<Job>("/jobs", {
                      kind: "extract",
                      source_id: id,
                      fragment_ids: selected,
                      profile_id: model,
                    });
                    if (j) setExtractJobID(j.id);
                  }}
                >
                  AI提炼知识候选
                </Button>
              </div>
            </>
          )}

          {extractJob.data && (
            <div className="live-stack" style={{ gap: 8 }}>
              <MetaTags>
                <StatusTag
                  status={extractJob.data.state}
                  label={`提炼任务：${labelFor(stateLabels, extractJob.data.state)}`}
                />
              </MetaTags>
              {extractJobActive && (
                <Progress percent={extractJob.data.progress} size="small" />
              )}
              {extractJob.data.state === "failed" && extractJob.data.error && (
                <Alert
                  type="error"
                  showIcon
                  role="alert"
                  message={extractJob.data.error}
                />
              )}
            </div>
          )}

          <Feedback message={action.message} failed={action.failed} />
        </div>
      </Card>

      <Suspense fallback={<LoadingState label="正在加载知识候选…" />}>
        <LazyKnowledgePage sourceID={id} embedded />
      </Suspense>
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
  onSeek,
  onDirtyChange,
  onSave,
}: {
  courseID: string;
  sourceID: string;
  sourceRevision: number;
  position: number;
  fragment: Fragment;
  editable: boolean;
  highlighted: boolean;
  onSeek?: (ms: number) => void;
  onDirtyChange: (dirty: boolean) => void;
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
  const timeRange = extractTimeRangeMs(f.locator);
  const displayHeading = draft.dirty ? heading : f.heading;
  const displayBody = draft.dirty ? body : f.body;

  async function saveFragmentRevision(markReady: boolean) {
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
          quality: markReady ? "ready" : f.quality,
        })
      ) {
        draft.saved(snapshot);
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      size="small"
      id={`fragment-${f.id}`}
      className={highlighted ? "rag-fragment-card is-highlighted" : "rag-fragment-card"}
    >
      <DraftNotice
        {...draft}
        onDiscard={() => {
          draft.reset(initialDraft);
          setValidationError("");
        }}
      />
      <div className="rag-fragment-head">
        <div className="rag-fragment-title">
          <MetaTag>#{position + 1}</MetaTag>
          <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
            {displayHeading || loc || `片段 ${position + 1}`}
          </Typography.Text>
          {displayHeading && loc && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {loc}
            </Typography.Text>
          )}
          <StatusTag
            status={f.quality === "needs_review" ? "needs_review" : "ready"}
            label={f.quality === "needs_review" ? "待人工核对" : "可使用"}
          />
          {highlighted && <StatusTag status="processing" label="当前引用" />}
          {draft.dirty && !editing && (
            <StatusTag status="warning" label="有未保存编辑" />
          )}
          {onSeek && timeRange && (
            <Button
              type="link"
              size="small"
              htmlType="button"
              onClick={() => onSeek(timeRange.startMs)}
            >
              {`跳转 ${formatTimeRangeMs(timeRange.startMs, timeRange.endMs)}`}
            </Button>
          )}
        </div>
        {editable && (
          <div className="rag-fragment-actions">
            {!editing && (f.quality === "needs_review" || draft.dirty) && (
              <Button
                size="small"
                type="primary"
                htmlType="button"
                disabled={busy}
                onClick={() => void saveFragmentRevision(true)}
              >
                确认可用
              </Button>
            )}
            <Button
              size="small"
              htmlType="button"
              disabled={busy}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "收起" : "编辑"}
            </Button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        {editing ? (
          <div className="live-stack" style={{ gap: 10 }}>
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
                rows={6}
              />
            </Field>
            {validationError && (
              <Alert
                type="error"
                showIcon
                role="alert"
                message={validationError}
              />
            )}
            <div className="live-inline">
              <Button
                size="small"
                type="primary"
                htmlType="button"
                disabled={busy}
                onClick={() => void saveFragmentRevision(true)}
              >
                保存修订并确认原文
              </Button>
              <Button
                size="small"
                htmlType="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <CollapsibleProse text={displayBody} maxChars={220} />
        )}
      </div>
    </Card>
  );
}
