import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { APIError, requestJSON } from "./api";

export interface Actor {
  id: string;
  username: string;
  display_name: string;
  role: "teacher" | "student";
}
interface Session {
  user: Actor;
  csrf_token: string;
}
interface SessionContext {
  session: Session | null;
  loading: boolean;
  error: string;
  login: (username: string, password: string) => Promise<Actor>;
  logout: () => Promise<void>;
  refresh: () => void;
}
const Context = createContext<SessionContext | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pendingRefresh = useRef<AbortController | null>(null);
  const actorID = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    pendingRefresh.current = controller;
    requestJSON<{ data: Session }>("/me", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          if (actorID.current !== null && actorID.current !== data.user.id)
            queryClient.clear();
          actorID.current = data.user.id;
          setSession(data);
          setError("");
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof APIError && err.status === 401) {
          actorID.current = null;
          setSession(null);
          setError("");
          queryClient.clear();
        } else
          setError(err instanceof Error ? err.message : "身份服务连接失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, queryClient]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  async function login(username: string, password: string) {
    const { data } = await requestJSON<{ data: Session }>("/sessions", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    pendingRefresh.current?.abort();
    actorID.current = data.user.id;
    queryClient.clear();
    setSession(data);
    setError("");
    setLoading(false);
    return data.user;
  }
  async function logout() {
    try {
      await requestJSON(
        "/sessions/current",
        { method: "DELETE" },
        session?.csrf_token,
      );
    } catch (err) {
      if (!(err instanceof APIError && err.status === 401)) throw err;
    }
    pendingRefresh.current?.abort();
    actorID.current = null;
    queryClient.clear();
    setSession(null);
    setError("");
    setLoading(false);
  }
  return (
    <Context.Provider
      value={{ session, loading, error, login, logout, refresh }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider is required");
  return value;
}
export function homeFor(user: Actor) {
  return user.role === "teacher" ? "/teacher/dashboard" : "/student/home";
}
export function RequireSession({
  role,
  children,
}: {
  role: "teacher" | "student";
  children: ReactNode;
}) {
  const { session, loading, error, refresh } = useSession();
  if (loading)
    return (
      <div className="page-container">
        <div className="state-block">
          <span className="state-spinner" aria-hidden="true" />
          <span role="status">正在验证登录状态…</span>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="page-container">
        <div className="state-block is-error" role="alert">
          <span className="state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 4l9 16H3z M12 10v4 M12 17h.01" /></svg>
          </span>
          <strong>连接失败</strong>
          <p>{error}</p>
          <button className="ghost-btn" onClick={refresh}>重新连接</button>
        </div>
      </div>
    );
  if (!session) return <Navigate replace to="/login" />;
  if (session.user.role !== role)
    return (
      <div className="page-plain">
        <h1>无权访问</h1>
        <p>当前账户为 {session.user.display_name}（{role === "teacher" ? "学生" : "教师"}角色）。</p>
        <p>修改地址栏不会改变账户身份，请使用对应角色的账号登录。</p>
        <p><a href={homeFor(session.user)}>返回我的工作台</a></p>
      </div>
    );
  return children;
}
