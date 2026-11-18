import { useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button, Modal, Menu } from "antd";
import { studentNavigation, teacherNavigation, findGroup } from "./navigation";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Login } from "./Login";
import { SessionProvider, RequireSession, useSession } from "../shared/session";
import { EditingProvider, useUnsavedChanges } from "../live/editing";
import { LearningProvider, CourseSelector } from "../live/context";
import { LiveRoutes } from "../live/routes";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import "../live/styles.css";
import "../live/workspace.css";

function Shell({ teacher = false }: { teacher?: boolean }) {
  const { session, logout } = useSession();
  const dirty = useUnsavedChanges();
  const [modal, modalContext] = Modal.useModal();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const courseID = new URLSearchParams(search).get("course");
  const withCourse = (path: string) =>
    courseID ? `${path}?course=${encodeURIComponent(courseID)}` : path;
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
    const label = pathname.endsWith("/profile")
      ? "个人设置"
      : current?.links.find(
          ([path]) =>
            pathname === `${root}/${path}` ||
            pathname.startsWith(`${root}/${path}/`),
        )?.[1] || "工作台";
    document.title = `${label} · HaJi Mark`;
  }, [pathname, current]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  async function handleLogout() {
    if (
      dirty &&
      !(await modal.confirm({
        title: "还有未保存的内容，确认退出？",
        content: "未保存编辑仅暂存在当前浏览器会话。",
        okText: "退出登录",
        cancelText: "继续编辑",
      }))
    )
      return;
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


  return (
    <div className={`layout-shell${navOpen ? " nav-open" : ""}`}>
      {modalContext}
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Button
            onClick={() => setNavOpen(!navOpen)}
            aria-expanded={navOpen}
            aria-controls="workspace-nav"
            aria-label={navOpen ? "关闭导航" : "打开导航"}
            htmlType="button"
            className={"menu-toggle"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path
                d={
                  navOpen
                    ? "M6 6l12 12 M18 6L6 18"
                    : "M4 7h16 M4 12h16 M4 17h16"
                }
              />
            </svg>
          </Button>
          <Link className="brand" to={withCourse(home)}>
            <span className="brand-mark" aria-hidden="true">
              H
            </span>
            HaJi Mark
          </Link>
          <span className="topbar-role">{roleLabel}</span>
          <CourseSelector />
          <span className="topbar-spacer" />
          <div className="nav-user">
            <NavLink
              className="account-link"
              to={withCourse(`${root}/profile`)}
              aria-label="个人设置"
            >
              <Avatar
                size={30}
                style={{ background: "var(--mint)", color: "var(--teal)" }}
              >
                {session?.user.display_name.slice(0, 1)}
              </Avatar>
              <span className="nav-user-name">
                {session?.user.display_name}
              </span>
            </NavLink>
            <Button loading={busy} onClick={handleLogout}>
              退出登录
            </Button>
          </div>
        </div>
      </header>
      <div className="shell-body">
        <nav
          id="workspace-nav"
          className="sidebar"
          aria-label={teacher ? "教师导航" : "学生导航"}
        >
          <Menu mode="inline" selectedKeys={[pathname.endsWith("/profile") ? "account" : current?.label || ""]}
            items={[
              ...groups.map(group => ({ key: group.label, label: <Link to={withCourse(`${root}/${group.links[0][0]}`)}>{group.label}</Link> })),
              { key: "account", label: <Link to={withCourse(`${root}/profile`)}>个人设置</Link> },
            ]}
          />
        </nav>
        <Button
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
          htmlType="button"
          className={"sidebar-backdrop"}
        />
        <div className="shell-content">
          <main
            ref={main}
            tabIndex={-1}
            id="main-content"
            className="page-container"
          >
            {error && (
              <Alert
                type="error"
                message={error}
                role="alert"
                showIcon
                closable
                onClose={() => setError("")}
              />
            )}
            {current && current.links.length > 1 && <nav className="workspace-subnav" aria-label={`${current.label}功能`}>
              {current.links.map(([path, label]) => <NavLink key={path} to={withCourse(`${root}/${path}`)}>{label}</NavLink>)}
            </nav>}
            <LiveRoutes teacher={teacher} />
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

function Workspace({ teacher = false }: { teacher?: boolean }) {
  const { session } = useSession();
  return (
    <EditingProvider key={session?.user.id}>
      <LearningProvider>
        <Shell teacher={teacher} />
      </LearningProvider>
    </EditingProvider>
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
                <Workspace />
              </RequireSession>
            }
          />
          <Route
            path="/teacher/*"
            element={
              <RequireSession role="teacher">
                <Workspace teacher />
              </RequireSession>
            }
          />
          <Route path="*" element={<Navigate replace to="/login" />} />
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
