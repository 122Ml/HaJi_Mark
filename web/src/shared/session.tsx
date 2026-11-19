import { Button, Result } from "antd";
import { ErrorState, LoadingState } from "./ui";
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
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
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
  clearSession: () => void;
  refresh: () => void;
}
const Context = createContext<SessionContext | null>(null);

export function clearSessionDrafts() {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("haji-")) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // Ignore storage access restrictions in private browsing modes.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pendingRefresh = useRef<AbortController | null>(null);
  const actorID = useRef<string | null>(null);
  const lastRefreshAt = useRef<number>(0);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now();
    setRevision((value) => value + 1);
  }, []);
  const clearSession = useCallback(() => {
    pendingRefresh.current?.abort();
    actorID.current = null;
    clearSessionDrafts();
    queryClient.clear();
    setSession(null);
    setError("");
    setLoading(false);
  }, [queryClient]);
  useEffect(() => {
    const controller = new AbortController();
    pendingRefresh.current = controller;
    lastRefreshAt.current = Date.now();
    requestJSON<{ data: Session }>("/me", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          if (actorID.current !== null && actorID.current !== data.user.id) {
            clearSessionDrafts();
            queryClient.clear();
          }
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
        } else if (!sessionRef.current) {
          // Only block the screen on initial boot; background refresh failures must not unmount active work.
          setError(err instanceof Error ? err.message : "身份服务连接失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, queryClient]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshAt.current > 30_000) {
        refresh();
      }
    };
    const onUnauthorized = () => {
      if (sessionRef.current) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("haji:unauthorized", onUnauthorized);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("haji:unauthorized", onUnauthorized);
    };
  }, [refresh]);
  const login = useCallback(async (username: string, password: string) => {
    const { data } = await requestJSON<{ data: Session }>("/sessions", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    pendingRefresh.current?.abort();
    if (actorID.current && actorID.current !== data.user.id) clearSessionDrafts();
    actorID.current = data.user.id;
    queryClient.clear();
    setSession(data);
    setError("");
    setLoading(false);
    return data.user;
  }, [queryClient]);
  const logout = useCallback(async () => {
    try {
      await requestJSON(
        "/sessions/current",
        { method: "DELETE" },
        sessionRef.current?.csrf_token,
      );
    } catch (err) {
      if (!(err instanceof APIError && err.status === 401)) throw err;
    }
    clearSession();
  }, [clearSession]);
  const value = useMemo(
    () => ({ session, loading, error, login, logout, clearSession, refresh }),
    [session, loading, error, login, logout, clearSession, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
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
  const location = useLocation();
  const navigate = useNavigate();
  if (loading)
    return (
      <div className="page-container">
        <LoadingState label="正在验证登录状态…" />
      </div>
    );
  if (error && !session)
    return (
      <div className="page-container">
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  if (!session) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to="/login" state={{ from }} />;
  }
  if (session.user.role !== role)
    return (
      <Result
        status="403"
        title="无权访问"
        extra={
          <Button type="primary" onClick={() => navigate(homeFor(session.user), { replace: true })}>
            返回我的工作台
          </Button>
        }
      />
    );
  return children;
}
