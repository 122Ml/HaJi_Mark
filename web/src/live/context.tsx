import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJSON, APIError } from "../shared/api";
import { useSession } from "../shared/session";
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
  reload: () => void;
} | null>(null);
export function LearningProvider({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const [selected, setSelected] = useState(
    () => sessionStorage.getItem(`haji-course:${session?.user.id}`) || "",
  );
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["courses", session?.user.id],
    queryFn: async () =>
      (await requestJSON<{ data: Course[] }>("/me/courses")).data,
  });
  useEffect(() => {
    if (query.error instanceof APIError && query.error.status === 401)
      refresh();
  }, [query.error, refresh]);
  const courses = query.data || [];
  const course = courses.find((c) => c.id === selected) || courses[0] || null;
  const reload = () => {
    void queryClient.invalidateQueries();
  };
  function select(id: string) {
    setSelected(id);
    sessionStorage.setItem(`haji-course:${session?.user.id}`, id);
  }
  if (query.isPending) return <p role="status">正在读取课程…</p>;
  return (
    <Context.Provider value={{ course, courses, select, reload }}>
      <section className="live-course-bar card-panel">
        <label>
          当前课程
          <select
            aria-label="当前课程"
            value={course?.id || ""}
            onChange={(e) => select(e.target.value)}
          >
            <option value="" disabled>
              选择课程
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.status === "draft" ? "（草稿）" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost-btn" onClick={reload}>
          刷新
        </button>
        {query.isPending && <span role="status">正在读取课程…</span>}
        {query.error && <span role="alert">{query.error.message}</span>}
        {!query.isPending && !course && (
          <span>暂无课程。教师可在课程底座新建，学生需由教师加入课程。</span>
        )}
      </section>
      {children}
    </Context.Provider>
  );
}
export function useLearning() {
  const c = useContext(Context);
  if (!c) throw new Error("LearningProvider required");
  return c;
}
export function useLiveQuery<T>(path: string, enabled = true, freshOnMount = false) {
  const { course } = useLearning();
  return useQuery({
    queryKey: ["live", course?.id, path],
    enabled: !!course && enabled,
    refetchOnMount: freshOnMount ? "always" : true,
    queryFn: async () =>
      (await requestJSON<{ data: T }>(`/learning/courses/${course!.id}${path}`))
        .data,
  });
}
export function useAction() {
  const { course, reload } = useLearning();
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run<T>(
    path: string,
    body: unknown = {},
    method = "POST",
  ): Promise<T | undefined> {
    setBusy(true);
    setMessage("");
    try {
      const r = await requestJSON<{ data: T }>(
        `/learning/courses/${course!.id}${path}`,
        { method, body: JSON.stringify(body) },
        session?.csrf_token,
      );
      reload();
      setMessage("已保存");
      return r.data;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
      if (e instanceof APIError && e.status === 401) refresh();
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, message, setMessage };
}
export function Feedback({
  error,
  message,
}: {
  error?: Error | null;
  message?: string;
}) {
  return error ? (
    <p role="alert" className="live-error">
      {error.message}
    </p>
  ) : message ? (
    <p role="status" className="live-message">
      {message}
    </p>
  ) : null;
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
