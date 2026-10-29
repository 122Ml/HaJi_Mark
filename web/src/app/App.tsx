import { ErrorBoundary } from "../shared/ErrorBoundary";
import { useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button } from "antd";
import { studentNavigation, teacherNavigation } from "./navigation";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Login } from "./Login";
import { SessionProvider, RequireSession, useSession } from "../shared/session";
import { LearningProvider } from "../live/context";
import { LiveRoutes } from "../live/routes";
import "../live/styles.css";
function Shell({ teacher = false }: { teacher?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = teacher ? "/teacher" : "/student";
  const home = `${root}/${teacher ? "dashboard" : "home"}`;
  const groups = teacher ? teacherNavigation : studentNavigation;
  const current = groups.find((group) => group.links.some(([path]) => pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`)));
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    const label = pathname.endsWith("/profile") ? "个人设置" : current?.label || "工作台";
    document.title = `${label} · HaJi Mark`;
  }, [pathname, current]);
  return (
    <div className="layout-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to={home}><span className="brand-mark" aria-hidden="true">H</span>HaJi Mark</Link>
          <nav className="primary-nav" aria-label={teacher ? "教师导航" : "学生导航"}>
            {groups.map((group) => <Link key={group.label} to={`${root}/${group.links[0][0]}`} className={current === group ? "is-active" : ""} aria-current={current === group ? "true" : undefined}>{group.label}</Link>)}
          </nav>
          <div className="nav-user">
            <NavLink className="account-link" to={`${root}/profile`} aria-label="个人设置">
              <Avatar size={32} style={{ background: "var(--mint)", color: "var(--teal)" }}>{session?.user.display_name.slice(0, 1)}</Avatar>
              <span className="nav-user-name">{session?.user.display_name}</span>
            </NavLink>
            <Button loading={busy} onClick={async () => {
              setBusy(true); setError("");
              try { await logout(); navigate("/login", { replace: true }); }
              catch (e) { setError((e as Error).message); }
              finally { setBusy(false); }
            }}>退出登录</Button>
          </div>
        </div>
      </header>
      <div className="workspace-subnav">
        <span className="workspace-role">{teacher ? "教师工作台" : "学生工作台"}</span>
        <nav aria-label="当前功能导航">
          {(current?.links || [["profile", "个人设置"]]).map(([path, label]) => <NavLink key={path} to={`${root}/${path}`} className={({ isActive }) => isActive ? "is-active" : ""}>{label}</NavLink>)}
        </nav>
      </div>
      <main ref={main} tabIndex={-1} id="main-content" className="page-container">
        {error && <Alert type="error" message={error} role="alert" showIcon />}
        <LearningProvider key={session?.user.id}><LiveRoutes teacher={teacher} /></LearningProvider>
      </main>
      <footer className="workspace-footer" aria-label="工作台页脚">
        <div><Link className="brand" to={home}>HaJi Mark</Link><span>{teacher ? "教师工作台" : "学生工作台"}</span></div>
        {groups.map((group) => <div key={group.label}><strong>{group.label}</strong>{group.links.map(([path, label]) => <Link key={path} to={`${root}/${path}`} aria-label={`前往${label}`}>{label}</Link>)}</div>)}
      </footer>
    </div>
  );
}
export function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Navigate replace to="/login" />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/student"
            element={<Navigate replace to="/student/home" />}
          />
          <Route
            path="/teacher"
            element={<Navigate replace to="/teacher/dashboard" />}
          />
          <Route
            path="/student/*"
            element={
              <RequireSession role="student">
                <Shell />
              </RequireSession>
            }
          />
          <Route
            path="/teacher/*"
            element={
              <RequireSession role="teacher">
                <Shell teacher />
              </RequireSession>
            }
          />
          <Route
            path="*"
            element={
              <div className="page-container">
                <h1>页面不存在</h1>
                <Link to="/login">返回登录</Link>
              </div>
            }
          />
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
