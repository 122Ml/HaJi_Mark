import { ErrorBoundary } from "../shared/ErrorBoundary";
import { useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { Login } from "../replica/Login";
import { SessionProvider, RequireSession, useSession } from "../shared/session";
import { LearningProvider } from "../live/context";
import { LiveRoutes } from "../live/routes";
import "../live/styles.css";
const studentLinks = [
  ["home", "今日学习"],
  ["course-content", "学习中心"],
  ["learning", "个性化路径"],
  ["student-twin", "学生画像"],
  ["homework", "作业测验"],
  ["quiz", "在线测验"],
  ["intervention", "老师任务"],
  ["interaction", "互动答疑"],
  ["profile", "设置"],
];
const teacherLinks = [
  ["dashboard", "教师看板"],
  ["course-twin", "课程底座"],
  ["homework", "作业中心"],
  ["quiz", "测验中心"],
  ["intervention", "干预任务"],
  ["interaction", "教学互动"],
  ["research", "教研协同"],
  ["industry-intelligence", "行业能力"],
  ["profile", "设置"],
];
function Shell({ teacher = false }: { teacher?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const root = teacher ? "/teacher" : "/student";
  return (
    <div className="layout-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <Link
          className="brand"
          to={`${root}/${teacher ? "dashboard" : "home"}`}
        >
          HaJi Mark
        </Link>
        <nav
          className="nav-links"
          aria-label={teacher ? "教师导航" : "学生导航"}
        >
          {(teacher ? teacherLinks : studentLinks).map(([path, label]) => (
            <NavLink
              key={path}
              end
              to={`${root}/${path}`}
              className={({ isActive }) =>
                isActive ? "router-link-active" : ""
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-user">
          <span className="nav-user-name">{session?.user.display_name}</span>
          <button
            className="ghost-btn"
            onClick={async () => {
              try {
                await logout();
                navigate("/login", { replace: true });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            退出登录
          </button>
        </div>
      </header>
      <main id="main-content" className="page-container">
        {error && <p role="alert">{error}</p>}
        <LearningProvider>
          <LiveRoutes teacher={teacher} />
        </LearningProvider>
      </main>
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
