import { Select, Button, Alert, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useLocation,
  useNavigate,
  useLinkClickHandler,
  useHref,
  type LinkProps,
  type NavigateOptions,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJSON, APIError } from "../shared/api";
import { ErrorState, LoadingState } from "../shared/ui";
import { useSession } from "../shared/session";
import { teacherNavigation, studentNavigation } from "../app/navigation";

export interface Course {
  id: string;
  title: string;
  status: string;
  version: number;
  knowledge_point_count: number;
}

const Context = createContext<{
  course: Course | null;
  courses: Course[];
  select: (id: string) => void;
  reload: () => Promise<void>;
} | null>(null);

function safeSessionGet(key: string): string {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore private-mode storage restrictions.
  }
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function LearningProvider({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const storageKey = `haji-course:${session?.user.id}`;
  const [selected, setSelected] = useState(() => safeSessionGet(storageKey));
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get("course");
  const query = useQuery({
    queryKey: ["courses", session?.user.id],
    queryFn: async () =>
      (await requestJSON<{ data: Course[] }>("/me/courses")).data,
  });
  const globalPage = [
    "/teacher/courses",
    "/teacher/profile",
    "/student/profile",
  ].includes(location.pathname);
  useEffect(() => {
    if (query.error instanceof APIError && query.error.status === 401)
      refresh();
  }, [query.error, refresh]);
  const courses = query.data || [];
  const course = requested
    ? courses.find((c) => c.id === requested) || null
    : courses.find((c) => c.id === selected) || courses[0] || null;
  useEffect(() => {
    if (course && !requested && !globalPage) {
      const params = new URLSearchParams(location.search);
      params.set("course", course.id);
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    }
    if (course && requested === course.id) {
      setSelected(course.id);
      safeSessionSet(storageKey, course.id);
    }
  }, [
    course,
    requested,
    globalPage,
    location.pathname,
    location.search,
    navigate,
    storageKey,
  ]);
  const reload = useCallback(async () => {
    // A first read may still contain a pre-write snapshot. Cancel it before refetching.
    await queryClient.cancelQueries({ queryKey: ["live", course?.id] });
    await queryClient.invalidateQueries({ queryKey: ["live", course?.id] });
    await queryClient.invalidateQueries({
      queryKey: ["courses", session?.user.id],
    });
  }, [queryClient, course?.id, session?.user.id]);
  const select = useCallback(
    (id: string) => {
      const root = session?.user.role === "teacher" ? "/teacher" : "/student";
      const links = (
        session?.user.role === "teacher" ? teacherNavigation : studentNavigation
      ).flatMap((g) => g.links);
      const current = links.find(
        ([path]) =>
          location.pathname === `${root}/${path}` ||
          location.pathname.startsWith(`${root}/${path}/`),
      );
      navigate({
        pathname: current
          ? `${root}/${current[0]}`
          : `${root}/${session?.user.role === "teacher" ? "dashboard" : "home"}`,
        search: `?course=${encodeURIComponent(id)}`,
      });
    },
    [session?.user.role, location.pathname, navigate],
  );
  const value = useMemo(
    () => ({ course, courses, select, reload }),
    [course, courses, select, reload],
  );
  if (query.isPending)
    return (
      <LoadingState label="正在读取课程…" />
    );
  if (query.error && !courses.length)
    return (
      <Context.Provider value={value}>
        <div className="page-container">
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        </div>
      </Context.Provider>
    );
  return (
    <Context.Provider value={value}>
      {query.error && (
        <Alert type="error" showIcon role="alert" message={query.error.message} />
      )}
      {children}
    </Context.Provider>
  );
}

export function CourseSelector() {
  const { course, courses, select, reload } = useLearning();
  const { pathname } = useLocation();
  if (pathname.endsWith("/profile")) return null;
  return (
    <div className="workspace-course-select" title={course?.title || undefined}>
      <label htmlFor="current-course">当前课程</label>
      <Select
        id="current-course"
        aria-label="当前课程"
        value={course?.id || undefined}
        placeholder="选择课程"
        onChange={select}
        showSearch
        optionFilterProp="label"
        options={courses.map((c) => ({
          value: c.id,
          label: `${c.title}${c.status === "draft" ? "（草稿）" : ""}`,
        }))}
      />
      <Tooltip title="刷新当前课程数据">
        <Button
          onClick={() => void reload()}
          htmlType="button"
          className="lab-icon-btn"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          aria-label="刷新"
        />
      </Tooltip>
    </div>
  );
}

export function useLearning() {
  const c = useContext(Context);
  if (!c) throw new Error("LearningProvider required");
  return c;
}

export function useLiveQuery<T>(
  path: string,
  enabled = true,
  freshOnMount = false,
) {
  const { course } = useLearning();
  return useQuery({
    queryKey: ["live", course?.id, path],
    enabled: !!course && enabled,
    refetchOnMount: freshOnMount ? "always" : true,
    queryFn: async ({ signal }) =>
      (
        await requestJSON<{ data: T }>(
          `/learning/courses/${course!.id}${path}`,
          { signal },
        )
      ).data,
  });
}

const RELATED_PREFIXES: Record<string, string[]> = {
  state: [""],
  sources: ["sources", "sections", "resources", "knowledge", "jobs", "topics", ""],
  sections: ["sources", "sections", "resources", "topics", "jobs", ""],
  assets: ["sources", "resources", "jobs"],
  paper: ["sources", "question-bank", "jobs"],
  "diagnosis-labels": ["diagnosis-labels", "intelligence", "overview"],
  regrades: [
    "regrades",
    "submissions",
    "assignments",
    "assignment-worklist",
    "evidence",
    "overview",
    "intelligence",
  ],
  topics: ["topics", "question-bank"],
  impact: ["impact"],
  knowledge: ["knowledge", "jobs", "topics"],
  jobs: ["jobs", "sources", "knowledge", "models", "intelligence", "regrades"],
  resources: [
    "resources",
    "jobs",
    "events",
    "activity",
    "overview",
    "notes",
    "interventions",
  ],
  assignments: [
    "assignments",
    "assignment-worklist",
    "evidence",
    "overview",
    "activity",
    "interventions",
    "submissions",
  ],
  submissions: [
    "submissions",
    "assignments",
    "assignment-worklist",
    "evidence",
    "overview",
    "intelligence",
  ],
  revisions: [
    "submissions",
    "assignments",
    "assignment-worklist",
    "evidence",
    "overview",
    "intelligence",
  ],
  questions: ["questions", "assignments"],
  rubrics: ["questions", "question-bank", "assignments"],
  "question-bank": ["question-bank", "jobs", "assignments", "questions"],
  interventions: ["interventions", "overview"],
  interactions: ["interactions", "overview"],
  intelligence: ["intelligence", "jobs", "overview"],
  assist: ["assist"],
  research: ["research"],
  industry: ["industry"],
  members: ["members", "overview"],
  students: ["members", "overview"],
  curriculum: ["", "graph", "path"],
  points: ["", "graph", "path"],
  edges: ["graph", "path"],
  path: ["path"],
};

export interface ActionOptions {
  invalidate?: boolean;
  silent?: boolean;
  invalidatePrefixes?: string[];
}

export function useAction() {
  const { course } = useLearning();
  const cache = useQueryClient();
  const { session, refresh } = useSession();
  const pendingRef = useRef(0);
  const reqSeqRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<APIError | null>(null);

  const clearError = useCallback(() => {
    reqSeqRef.current += 1;
    setFailed(false);
    setError(null);
    setMessage("");
  }, []);

  async function run<T>(
    path: string,
    body?: unknown,
    method = "POST",
    successMessage?: string,
    options?: ActionOptions,
  ): Promise<T | undefined> {
    if (!course) {
      setFailed(true);
      setMessage("请先选择当前课程后再操作");
      return undefined;
    }
    const silent = Boolean(options?.silent);
    const seq = silent ? 0 : ++reqSeqRef.current;
    pendingRef.current += 1;
    setBusy(true);
    if (!silent) {
      setMessage("");
      setFailed(false);
      setError(null);
    }
    try {
      const hasBody = method !== "GET" && method !== "HEAD" && !(method === "DELETE" && body === undefined);
      const init: RequestInit = { method };
      if (hasBody) {
        init.body = JSON.stringify(body ?? {});
      }
      const r = await requestJSON<{ data: T } | undefined>(
        `/learning/courses/${course.id}${path}`,
        init,
        session?.csrf_token,
      );
      const prefix = path.split("/")[1]?.split("?")[0] || "";
      const shouldInvalidate = options?.invalidate ?? (prefix !== "retrieval");
      if (shouldInvalidate) {
        const roots = options?.invalidatePrefixes || RELATED_PREFIXES[prefix] || [prefix];
        const filters = {
          predicate: (q: { queryKey: readonly unknown[] }) =>
            q.queryKey[0] === "live" &&
            q.queryKey[1] === course.id &&
            roots.includes(
              String(q.queryKey[2] || "")
                .split("/")[1]
                ?.split("?")[0] || "",
            ),
        };
        await cache.cancelQueries(filters);
        await cache.invalidateQueries(filters);
        if (!prefix || prefix === "publish" || prefix === "state") {
          await cache.invalidateQueries({
            queryKey: ["courses", session?.user.id],
          });
        }
      }
      const data = r?.data;
      if (!silent && seq === reqSeqRef.current) {
        const saved = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
        const nextState = body && typeof body === "object" && "state" in body ? String((body as { state?: unknown }).state) : String(saved.state || saved.status || "");
        setMessage(successMessage || (
          path.endsWith("/cancel") ? "已请求取消，请核对任务最终状态" :
          path.endsWith("/retry") || path === "/jobs" || path.endsWith("/jobs") || (path === "/intelligence" && method === "POST") ? "已排队处理，请在当前对象的任务记录中核对结果" :
          nextState === "released" ? "已正式发布，学生可查看反馈" :
          nextState === "confirmed" ? (path.includes("/revisions/") ? "评分已确认，尚未发布给学生" : path.includes("/knowledge") ? "知识已确认；索引由后台处理" : "已确认当前版本") :
          nextState === "assigned" ? "任务已下发给指定学生" :
          nextState === "submitted" ? "执行结果已提交，等待教师复查" :
          nextState === "reviewed" ? "教师复查已完成" :
          nextState === "closed" ? "作业已关闭，停止接收新提交" :
          nextState === "archived" && prefix === "state" ? "课程已归档" :
          nextState === "published" && prefix === "state" ? "课程已发布，学生可见并可参与学习" :
          nextState === "published" && path.includes("/assignments/") ? "作业已发布，题目与标准版本已冻结" :
          path.includes("/publish") ? "已发布；检索是否就绪请核对索引任务状态" :
          path === "/interactions" ? "内容已发布到当前课程" :
          path === "/retrieval" ? "已返回当前权限范围的检索结果" :
          path === "/assist" ? "已返回回答，请核对引用依据" :
          nextState === "draft" ? "草稿已保存，尚未发布或下发" :
          method === "DELETE" ? "已删除" : "已保存修改"
        ));
      }
      return data;
    } catch (e) {
      if (!silent && seq === reqSeqRef.current) {
        setFailed(true);
        setError(e instanceof APIError ? e : null);
        setMessage(e instanceof Error ? e.message : "保存失败");
      }
      if (e instanceof APIError && e.status === 401) refresh();
      return undefined;
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (pendingRef.current === 0) setBusy(false);
    }
  }
  return { run, busy, message, failed, error, setMessage, clearError, reset: clearError };
}

export function Feedback({
  error,
  message,
  failed = false,
}: {
  error?: Error | null;
  message?: string;
  failed?: boolean;
}) {
  if (error || (failed && message)) {
    return (
      <Alert type="error" showIcon role="alert" message={error?.message || message} />
    );
  }
  if (message) {
    return (
      <Alert type="success" showIcon role="status" message={message} />
    );
  }
  return null;
}

export const names: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
  assigned: "待执行",
  submitted: "已提交",
  reviewed: "已复查",
  graded: "已评分",
  confirmed: "已确认",
  released: "已发布",
  subjective: "主观题",
  quiz: "客观测验",
  code: "代码题",
  archived: "已归档",
  canceled: "已取消",
  failed: "失败",
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
};

export function when(value?: string | null) {
  if (!value) return "未设置";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "未设置";
  return d.toLocaleString("zh-CN");
}

export function useCourseURL() {
  const { course } = useLearning();
  return useCallback(
    (to: string) => {
      const url = new URL(to, window.location.origin);
      if (course) url.searchParams.set("course", course.id);
      return url.pathname + url.search + url.hash;
    },
    [course],
  );
}

export function Link({ to, ...props }: LinkProps) {
  const url = useCourseURL();
  const resolved = typeof to === "string" ? url(to) : to;
  return <ActionLink {...props} to={resolved} />;
}

function ActionLink({ to, className, replace, state, target, preventScrollReset, relative, reloadDocument, viewTransition, onClick, color: _color, type: _type, ...props }: LinkProps) {
  const href = useHref(to, { relative });
  const navigate = useLinkClickHandler(to, { replace, state, target, preventScrollReset, relative, viewTransition });
  const onNavigate = (event: React.MouseEvent<HTMLElement>) => {
    const click = event as React.MouseEvent<HTMLAnchorElement>;
    onClick?.(click);
    if (!click.defaultPrevented && !reloadDocument) navigate(click);
  };
  if (typeof className === "string" && /primary-link|ghost-btn/.test(className)) return <Button {...props} className={className.split(/\s+/).filter(c => c !== "primary-link" && c !== "ghost-btn").join(" ")} href={href} target={target} type={className.includes("primary-link") ? "primary" : "default"} onClick={onNavigate} />;
  return <a {...props} className={className} href={href} target={target} onClick={onNavigate} />;
}

export function useCourseNavigate() {
  const navigate = useNavigate();
  const url = useCourseURL();
  return useCallback(
    (to: string, options?: NavigateOptions) => navigate(url(to), options),
    [navigate, url],
  );
}
