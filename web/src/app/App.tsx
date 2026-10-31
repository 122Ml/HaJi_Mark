import { useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button } from "antd";
import { studentNavigation, teacherNavigation, findGroup } from "./navigation";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Login } from "./Login";
import { SessionProvider, RequireSession, useSession } from "../shared/session";
import { LearningProvider } from "../live/context";
import { LiveRoutes } from "../live/routes";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import "../live/styles.css";

function Shell({ teacher = false }: { teacher?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const root = teacher ? "/teacher" : "/student";
  const home = `${root}/${teacher ? "dashboard" : "home"}`;
  const groups = teacher ? teacherNavigation : studentNavigation;
  const current = findGroup(groups, root, pathname);
  const roleLabel = teacher ? "教师工作台" : "学生工作台";

  useEffect(() => {
    setNavOpen(false);
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    const label = pathname.endsWith("/profile") ? "个人设置" : current?.label || "工作台";
    document.title = `${label} · HaJi Mark`;
  }, [pathname, current]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  async function handleLogout() {
    setBusy(true);
    setError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "退出失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <div className={`layout-shell${navOpen ? " nav-open" : ""}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="menu-toggle" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-controls="workspace-nav" aria-label={navOpen ? "关闭导航" : "打开导航"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d={navOpen ? "M6 6l12 12 M18 6L6 18" : "M4 7h16 M4 12h16 M4 17h16"} />
            </svg>
          </button>
          <Link className="brand" to={home}><span className="brand-mark" aria-hidden="true">H</span>HaJi Mark</Link>
          <span className="topbar-role">{roleLabel}</span>
          <span className="topbar-spacer" />
          <div className="nav-user">
            <NavLink className="account-link" to={`${root}/profile`} aria-label="个人设置">
              <Avatar size={30} style={{ background: "var(--mint)", color: "var(--teal)" }}>{session?.user.display_name.slice(0, 1)}</Avatar>
              <span className="nav-user-name">{session?.user.display_name}</span>
            </NavLink>
            <Button loading={busy} onClick={handleLogout}>退出登录</Button>
          </div>
        </div>
      </header>
      <div className="shell-body">
        <nav id="workspace-nav" className="sidebar" aria-label={teacher ? "教师导航" : "学生导航"}>
          {groups.map((group) => (
            <div key={group.label} className="sidebar-group" role="group" aria-label={group.label}>
              <p className="sidebar-title">{group.label}</p>
              <ul>
                {group.links.map(([path, label]) => (
                  <li key={path}><NavLink to={`${root}/${path}`} className={linkClass}>{label}</NavLink></li>
                ))}
              </ul>
            </div>
          ))}
          <div className="sidebar-group" role="group" aria-label="账户">
            <p className="sidebar-title">账户</p>
            <ul><li><NavLink to={`${root}/profile`} className={linkClass}>个人设置</NavLink></li></ul>
          </div>
        </nav>
        <button type="button" className="sidebar-backdrop" tabIndex={-1} aria-hidden="true" onClick={() => setNavOpen(false)} />
        <div className="shell-content">
          <main ref={main} tabIndex={-1} id="main-content" className="page-container">
            {error && <Alert type="error" message={error} role="alert" showIcon closable onClose={() => setError("")} />}
            <LearningProvider key={session?.user.id}><LiveRoutes teacher={teacher} /></LearningProvider>
          </main>
          <footer className="workspace-footer">
            <span>HaJi Mark · {roleLabel}</span>
            <span>课程 · 作答 · 反馈 · 补学复查</span>
          </footer>
        </div>
      </div>
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
          <Route path="/student" element={<Navigate replace to="/student/home" />} />
          <Route path="/teacher" element={<Navigate replace to="/teacher/dashboard" />} />
          <Route path="/student/*" element={<RequireSession role="student"><Shell /></RequireSession>} />
          <Route path="/teacher/*" element={<RequireSession role="teacher"><Shell teacher /></RequireSession>} />
          <Route path="*" element={<Navigate replace to="/login" />} />
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
