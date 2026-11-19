import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Avatar, Button, ConfigProvider, Drawer, Menu, Tag, Tooltip } from "antd";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Compass,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Moon,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  User,
  X,
} from "lucide-react";
import {
  studentNavigation,
  teacherNavigation,
  findGroup,
  type NavigationIcon,
} from "./navigation";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { Login } from "./Login";
import { CommandPalette } from "./CommandPalette";
import { comfortableToken, darkTheme, theme } from "./theme";
import { useThemeMode } from "./theme-mode";
import { SessionProvider, RequireSession, useSession } from "../shared/session";
import { useConfirm } from "../shared/confirm";
import { EditingProvider, useEditingControls, useUnsavedChanges } from "../live/editing";
import { LearningProvider, CourseSelector, useLearning } from "../live/context";
import { LiveRoutes } from "../live/routes";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import "../live/styles.css";
import "../live/workspace.css";

const desktopMedia = window.matchMedia("(min-width: 1024px)");
const subscribeDesktop = (listener: () => void) => {
  desktopMedia.addEventListener("change", listener);
  return () => desktopMedia.removeEventListener("change", listener);
};

function navIcon(icon: NavigationIcon) {
  switch (icon) {
    case "dashboard":
      return <LayoutDashboard size={15} aria-hidden="true" />;
    case "book":
      return <BookOpen size={15} aria-hidden="true" />;
    case "clipboard":
      return <ClipboardCheck size={15} aria-hidden="true" />;
    case "chart":
      return <BarChart3 size={15} aria-hidden="true" />;
    case "sliders":
      return <SlidersHorizontal size={15} aria-hidden="true" />;
    case "message":
      return <MessageSquare size={15} aria-hidden="true" />;
    case "sparkles":
      return <Sparkles size={15} aria-hidden="true" />;
    case "target":
      return <Compass size={15} aria-hidden="true" />;
    case "git-branch":
      return <GitBranch size={15} aria-hidden="true" />;
  }
}

function resolvePageTitle(root: string, pathname: string, group?: { links: [string, string][] }) {
  if (pathname.endsWith("/profile")) return "个人设置";
  if (pathname.endsWith("/homework/new")) return "新建作业";
  if (pathname.endsWith("/quiz/new")) return "新建测验";
  if (/\/homework\/[^/]+\/edit$/.test(pathname)) return "编辑作业";
  if (/\/homework\/[^/]+\/submissions$/.test(pathname)) return "提交列表";
  if (/\/homework\/submissions\/[^/]+\/grade$/.test(pathname)) return "批阅作答";
  if (/\/homework\/submissions\/[^/]+\/feedback$/.test(pathname)) return "作答反馈";
  if (/\/homework\/[^/]+$/.test(pathname)) return "作业详情";
  return (
    group?.links.find(
      ([path]) => pathname === `${root}/${path}` || pathname.startsWith(`${root}/${path}/`),
    )?.[1] || "工作台"
  );
}

function Shell({ teacher = false }: { teacher?: boolean }) {
  const { session, logout } = useSession();
  const { course } = useLearning();
  const { mode, toggleMode } = useThemeMode();
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => desktopMedia.matches);
  const dirty = useUnsavedChanges();
  const { clearAllDirty } = useEditingControls();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const { pathname, search } = useLocation();
  const activeCourseID = new URLSearchParams(search).get("course") || course?.id || "";
  const withCourse = (path: string) =>
    activeCourseID ? `${path}?course=${encodeURIComponent(activeCourseID)}` : path;
  const main = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const root = teacher ? "/teacher" : "/student";
  const home = `${root}/${teacher ? "dashboard" : "home"}`;
  const groups = teacher ? teacherNavigation : studentNavigation;
  const current = findGroup(groups, root, pathname);
  const roleLabel = teacher ? "教师工作台" : "学生工作台";
  const pageTitle = resolvePageTitle(root, pathname, current);

  useEffect(() => {
    setNavOpen(false);
    main.current?.focus({ preventScroll: true });
    if (navType !== "POP") {
      window.scrollTo(0, 0);
    }
    document.title = `${pageTitle} · HaJi Mark`;
  }, [pathname, pageTitle, navType]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loggingOutRef = useRef(false);

  async function handleLogout() {
    if (loggingOutRef.current || busy) return;
    loggingOutRef.current = true;
    try {
      if (
        dirty &&
        !(await confirm("还有未保存的内容，确认退出？", {
          content: "未保存编辑仅暂存在当前浏览器会话，退出后将被清理。",
          okText: "退出登录",
          cancelText: "继续编辑",
        }))
      )
        return;
      setBusy(true);
      setError("");
      try {
        await logout();
        clearAllDirty();
        navigate("/login", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "退出失败，请重试");
      } finally {
        setBusy(false);
      }
    } finally {
      loggingOutRef.current = false;
    }
  }

  const selectedKey = pathname.endsWith("/profile") ? "account" : current?.label || "";
  const desktopMenuItems = groups.map((group) => ({
    key: group.label,
    icon: navIcon(group.icon),
    label: (
      <Link to={withCourse(`${root}/${group.links[0][0]}`)} onClick={() => setNavOpen(false)}>
        {group.label}
      </Link>
    ),
  }));
  const mobileMenuItems = [
    ...desktopMenuItems,
    {
      key: "account",
      icon: <User size={15} aria-hidden="true" />,
      label: (
        <Link to={withCourse(`${root}/profile`)} onClick={() => setNavOpen(false)}>
          个人设置
        </Link>
      ),
    },
    { type: "divider" as const },
    {
      key: "logout",
      icon: <LogOut size={15} aria-hidden="true" />,
      label: "退出登录",
      disabled: busy,
      onClick: () => {
        setNavOpen(false);
        void handleLogout();
      },
    },
  ];

  return (
    <div className="layout-shell lab-shell">
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
            className="menu-toggle"
            icon={navOpen ? <X size={18} aria-hidden="true" /> : <MenuIcon size={18} aria-hidden="true" />}
          />
          <Link className="brand" to={withCourse(home)}>
            <span className="brand-mark" aria-hidden="true">
              H
            </span>
            HaJi Mark
          </Link>
          <span className="topbar-role">{roleLabel}</span>
          {!isDesktop && <CourseSelector />}
          <span className="topbar-spacer" />
          <div className="nav-user">
            <Button
              htmlType="button"
              size="small"
              className="lab-cmd-btn"
              onClick={() => setPaletteOpen(true)}
              aria-label="打开快捷命令栏"
            >
              ⌘K
            </Button>
            <Button
              htmlType="button"
              size="small"
              className="lab-icon-btn"
              icon={mode === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              aria-pressed={mode === "dark"}
              aria-label={mode === "dark" ? "浅色" : "深色"}
              onClick={toggleMode}
            />
            <NavLink
              className="account-link"
              to={withCourse(`${root}/profile`)}
              aria-label="个人设置"
            >
              <Avatar
                size={24}
                style={{ background: "var(--mint)", color: "var(--teal)" }}
              >
                {session?.user.display_name.slice(0, 1)}
              </Avatar>
              <span className="nav-user-name">
                {session?.user.display_name}
              </span>
            </NavLink>
            <Button
              size="small"
              icon={<LogOut size={13} aria-hidden="true" />}
              loading={busy}
              onClick={handleLogout}
            >
              退出登录
            </Button>
          </div>
        </div>
      </header>
      <Drawer
        placement="left"
        open={navOpen}
        onClose={() => setNavOpen(false)}
        width={256}
        title={roleLabel}
        className="mobile-nav-drawer"
      >
        <Menu mode="inline" selectedKeys={selectedKey ? [selectedKey] : []} items={mobileMenuItems} />
      </Drawer>
      <div className="shell-body">
        <aside className="lab-rail" aria-label="工作台侧栏">
          <div className="lab-rail-head">
            <Link className="brand" to={withCourse(home)}>
              <span className="brand-mark" aria-hidden="true">
                H
              </span>
              HaJi Mark
            </Link>
            <Tag className="ui-meta-tag" style={{ margin: 0 }}>
              {teacher ? "教师版" : "学生版"}
            </Tag>
          </div>
          {isDesktop && (
            <div className="lab-workspace">
              <CourseSelector />
            </div>
          )}
          <Button
            htmlType="button"
            className="lab-command"
            onClick={() => setPaletteOpen(true)}
            aria-label="搜索或执行命令"
          >
            <span className="lab-command-left">
              <Search size={13} aria-hidden="true" />
              <span className="lab-command-label">搜索或跳转页面…</span>
            </span>
            <kbd>⌘K</kbd>
          </Button>
          <span className="lab-rail-section">{roleLabel}</span>
          <nav
            id="workspace-nav"
            className="sidebar"
            aria-label={teacher ? "教师导航" : "学生导航"}
          >
            <Menu mode="inline" selectedKeys={selectedKey ? [selectedKey] : []} items={desktopMenuItems} />
          </nav>
          <div className="lab-account">
            <NavLink
              className="account-link"
              to={withCourse(`${root}/profile`)}
              aria-label="个人设置"
            >
              <span className="lab-avatar-wrap">
                <Avatar
                  size={28}
                  style={{ background: "var(--mint)", color: "var(--teal)" }}
                >
                  {session?.user.display_name.slice(0, 1)}
                </Avatar>
                <span className="lab-avatar-dot" aria-hidden="true" />
              </span>
              <span className="lab-account-meta">
                <strong>{session?.user.display_name}</strong>
                <small>{roleLabel}</small>
              </span>
            </NavLink>
            <div className="lab-account-actions">
              <Tooltip title={mode === "dark" ? "切换为浅色模式" : "切换为深色模式"}>
                <Button
                  htmlType="button"
                  size="small"
                  className="lab-icon-btn"
                  icon={mode === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
                  aria-pressed={mode === "dark"}
                  aria-label={mode === "dark" ? "浅色" : "深色"}
                  onClick={toggleMode}
                />
              </Tooltip>
              <Tooltip title="退出登录">
                <Button
                  htmlType="button"
                  size="small"
                  className="lab-icon-btn"
                  icon={<LogOut size={14} aria-hidden="true" />}
                  loading={busy}
                  aria-label="退出登录"
                  onClick={handleLogout}
                />
              </Tooltip>
            </div>
          </div>
        </aside>
        <div className="shell-content">
          <div
            className={`workspace-topbar${current && current.links.length > 1 ? "" : " is-single-page"}`}
          >
            {current && current.links.length > 1 ? (
              <nav className="workspace-subnav" aria-label={`${current.label}功能`}>
                {current.links.map(([path, label]) => (
                  <NavLink key={path} to={withCourse(`${root}/${path}`)}>
                    {label}
                  </NavLink>
                ))}
              </nav>
            ) : (
              <span className="workspace-topbar-crumb">
                <span>{roleLabel}</span>
                <span aria-hidden="true">/</span>
                <strong>{current ? current.label : pageTitle}</strong>
              </span>
            )}
            {course && (
              <div className="workspace-topbar-course" title={course.title}>
                <span className="workspace-topbar-course-dot" aria-hidden="true" />
                <span className="workspace-topbar-course-title">{course.title}</span>
              </div>
            )}
          </div>
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
            <ErrorBoundary key={pathname} resetKey={course?.id ?? ""}>
              <LiveRoutes teacher={teacher} />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        root={root}
        groups={groups}
        withCourse={withCourse}
      />
    </div>
  );
}

function Workspace({ teacher = false }: { teacher?: boolean }) {
  const { session } = useSession();
  const { mode } = useThemeMode();

  useLayoutEffect(() => {
    document.documentElement.dataset.density = teacher ? "compact" : "comfortable";
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [teacher]);

  const body = (
    <EditingProvider key={session?.user.id}>
      <LearningProvider>
        <Shell teacher={teacher} />
      </LearningProvider>
    </EditingProvider>
  );

  if (teacher) return body;

  const baseTheme = mode === "dark" ? darkTheme : theme;
  return (
    <ConfigProvider
      theme={{
        ...baseTheme,
        cssVar: { key: "haji-theme-comfortable" },
        token: { ...baseTheme.token, ...comfortableToken },
      }}
    >
      {body}
    </ConfigProvider>
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
