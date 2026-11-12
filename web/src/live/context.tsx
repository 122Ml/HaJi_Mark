import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  type LinkProps,
  type NavigateOptions,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJSON, APIError } from "../shared/api";
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
export function LearningProvider({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const [selected, setSelected] = useState(
    () => sessionStorage.getItem(`haji-course:${session?.user.id}`) || "",
  );
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get("course");
  const query = useQuery({
    queryKey: ["courses", session?.user.id],
    queryFn: async () =>
      (await requestJSON<{ data: Course[] }>("/me/courses")).data,
  });
  const globalPage = ["/teacher/courses", "/teacher/profile", "/student/profile"].includes(location.pathname);
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
      sessionStorage.setItem(`haji-course:${session?.user.id}`, course.id);
    }
  }, [course, requested, globalPage, location.pathname, location.search, navigate]);
  const reload = async () => {
    // A first read may still contain a pre-write snapshot. Cancel it before refetching.
    await queryClient.cancelQueries({ queryKey: ["live", course?.id] });
    await queryClient.invalidateQueries({ queryKey: ["live", course?.id] });
    await queryClient.invalidateQueries({
      queryKey: ["courses", session?.user.id],
    });
  };
  function select(id: string) {
    const root = session?.user.role === "teacher" ? "/teacher" : "/student";
    const links = (session?.user.role === "teacher" ? teacherNavigation : studentNavigation).flatMap((g) => g.links);
    const current = links.find(([path]) => location.pathname === `${root}/${path}` || location.pathname.startsWith(`${root}/${path}/`));
    navigate({
      pathname: current ? `${root}/${current[0]}` : `${root}/${session?.user.role === "teacher" ? "dashboard" : "home"}`,
      search: `?course=${encodeURIComponent(id)}`,
    });
  }
  if (query.isPending)
    return (
      <div className="state-block" role="status">
        <span className="state-spinner" aria-hidden="true" />
        <span>正在读取课程…</span>
      </div>
    );
  return (
    <Context.Provider value={{ course, courses, select, reload }}>
      {query.error && <p role="alert" className="live-error">{query.error.message}</p>}
      {children}
    </Context.Provider>
  );
}
export function CourseSelector() {
  const { course, courses, select, reload } = useLearning();
  const { pathname } = useLocation();
  if (pathname.endsWith("/profile")) return null;
  return <div className="workspace-course-select">
    <label htmlFor="current-course">当前课程</label>
    <select id="current-course" aria-label="当前课程" value={course?.id || ""} onChange={(e) => select(e.target.value)}>
      <option value="" disabled>选择课程</option>
      {courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status === "draft" ? "（草稿）" : ""}</option>)}
    </select>
    <button type="button" className="ghost-btn" onClick={() => void reload()}>刷新</button>
  </div>;
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
export function useAction() {
  const { course } = useLearning();
  const cache = useQueryClient();
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function run<T>(
    path: string,
    body: unknown = {},
    method = "POST",
  ): Promise<T | undefined> {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const r = await requestJSON<{ data: T }>(
        `/learning/courses/${course!.id}${path}`,
        { method, body: JSON.stringify(body) },
        session?.csrf_token,
      );
      const prefix = path.split("/")[1]?.split("?")[0];
      const related: Record<string, string[]> = {
        sources: ["sources", "resources", "knowledge", "jobs", "topics", ""],
        assets: ["sources", "resources", "jobs"],
        regrades: [
          "regrades",
          "submissions",
          "assignments",
          "assignment-worklist",
          "evidence",
          "overview",
        ],
        topics: ["topics", "question-bank"],
        impact: ["impact"],
        knowledge: ["knowledge", "jobs"],
        jobs: ["jobs", "sources", "knowledge", "models"],
        resources: [
          "resources",
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
        ],
        submissions: [
          "submissions",
          "assignments",
          "assignment-worklist",
          "evidence",
          "overview",
        ],
        revisions: [
          "submissions",
          "assignments",
          "assignment-worklist",
          "evidence",
          "overview",
        ],
        questions: ["questions"],
        rubrics: ["questions", "question-bank"],
        "question-bank": ["question-bank", "jobs", "assignments", "questions"],
        interventions: ["interventions", "overview"],
        members: ["members", "overview"],
        students: ["members", "overview"],
        curriculum: ["", "graph"],
        points: ["", "graph"],
        edges: ["graph"],
        path: ["path"],
      };
      const roots = related[prefix] || [prefix];
      const filters = {
        predicate: (q: { queryKey: readonly unknown[] }) =>
          q.queryKey[0] === "live" &&
          q.queryKey[1] === course?.id &&
          roots.includes(
            String(q.queryKey[2] || "")
              .split("/")[1]
              ?.split("?")[0] || "",
          ),
      };
      await cache.cancelQueries(filters);
      await cache.invalidateQueries(filters);
      if (!prefix || prefix === "publish")
        await cache.invalidateQueries({
          queryKey: ["courses", session?.user.id],
        });
      setMessage("已保存");
      return r.data;
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "保存失败");
      if (e instanceof APIError && e.status === 401) refresh();
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, message, failed, setMessage };
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
      <p role="alert" className="live-error">
        {error?.message || message}
      </p>
    );
  }
  if (message) {
    return (
      <p role="status" className="live-message">
        {message}
      </p>
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
};
export function when(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未设置";
}

export function useCourseURL() {
  const { course } = useLearning();
  return (to: string) => {
    const url = new URL(to, window.location.origin);
    if (course) url.searchParams.set("course", course.id);
    return url.pathname + url.search + url.hash;
  };
}
export function Link({ to, ...props }: LinkProps) {
  const url = useCourseURL();
  return <RouterLink {...props} to={typeof to === "string" ? url(to) : to} />;
}
export function useCourseNavigate() {
  const navigate = useNavigate();
  const url = useCourseURL();
  return (to: string, options?: NavigateOptions) => navigate(url(to), options);
}
