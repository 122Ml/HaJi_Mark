import { lazy, Suspense, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Login } from "../replica/Login";
import { Modal, Button } from "../replica/ui";

const StudentRoutes = lazy(() =>
  import("../replica/student").then((m) => ({ default: m.StudentRoutes })),
);
const TeacherWorkflowRoutes = lazy(() =>
  import("../replica/teacher-workflows").then((m) => ({
    default: m.TeacherWorkflowRoutes,
  })),
);
const TeacherAnalyticsRoutes = lazy(() =>
  import("../replica/teacher-analytics").then((m) => ({
    default: m.TeacherAnalyticsRoutes,
  })),
);
const CoursePage = lazy(() =>
  import("../features/course").then((m) => ({ default: m.CoursePage })),
);

const studentLinks = [
  ["home", "今日学习"],
  ["course-content", "学习中心"],
  ["learning", "个性化路径"],
  ["student-twin", "学生画像"],
  ["homework", "作业测验"],
  ["intervention", "老师任务"],
  ["interaction", "互动答疑"],
  ["profile", "设置"],
];
const teacherLinks = [
  ["dashboard", "教师看板"],
  ["interaction", "教学互动中心"],
  ["research", "教研协同中心"],
  ["course-twin", "课程底座"],
  ["industry-intelligence", "行业能力"],
  ["homework", "作业中心"],
  ["intervention", "AI干预任务包"],
  ["quiz", "测验中心"],
];

function Shell({ teacher = false }: { teacher?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const root = teacher ? "/teacher" : "/student";
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="layout-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <Link className="brand" to={root + (teacher ? "/dashboard" : "/home")}>
          AI-Education
        </Link>
        <nav
          className="nav-links"
          aria-label={teacher ? "教师导航" : "学生导航"}
        >
          {(teacher ? teacherLinks : studentLinks).map(([url, label]) => (
            <NavLink
              end
              className={({ isActive }) =>
                isActive ? "router-link-active" : ""
              }
              key={url}
              to={root + "/" + url}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-user">
          {!teacher && (
            <select
              className="locale-select"
              aria-label="语言"
              defaultValue="zh"
            >
              <option value="zh">简体中文</option>
            </select>
          )}
          {teacher ? (
            <span className="nav-user-name">teacher</span>
          ) : (
            <Link
              className="nav-user-name nav-profile-link"
              to="/student/profile"
            >
              曾懿涵
            </Link>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              sessionStorage.removeItem("haji-demo:role");
              navigate("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </header>
      <main className="page-container" id="main-content">
        <Suspense fallback={<p className="replica-empty">正在加载页面…</p>}>
          {teacher ? <TeacherPages /> : <StudentRoutes />}
        </Suspense>
      </main>
      <button
        className="demo-badge"
        onClick={() => setHelp(true)}
        title="查看本地演示说明"
      >
        本地演示
      </button>
      {help && (
        <Modal title="本地前端演示" onClose={() => setHelp(false)}>
          <p>
            此版本复刻参考平台的学生端与教师端界面。作业、批改、任务与公告保存在当前浏览器；切换角色后可以接续演示。
          </p>
          <p>
            登录仅切换演示身份，图表为样例数据，AI
            按钮生成固定演示草稿。未接入真实身份认证、模型服务或参考站业务接口。
          </p>
          <div className="replica-actions">
            <Button
              onClick={() => {
                setHelp(false);
                navigate("/student/home");
              }}
            >
              学生端
            </Button>
            <Button
              onClick={() => {
                setHelp(false);
                navigate("/teacher/dashboard");
              }}
            >
              教师端
            </Button>
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    "清除本浏览器的演示作业、批改、任务和设置，恢复初始样例？",
                  )
                ) {
                  Object.keys(localStorage)
                    .filter((k) => k.startsWith("haji-demo:"))
                    .forEach((k) => localStorage.removeItem(k));
                  location.reload();
                }
              }}
            >
              重置演示数据
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function TeacherPages() {
  const { pathname } = useLocation();
  return /\/teacher\/(dashboard|course-twin|industry-intelligence|teacher-twin)/.test(
    pathname,
  ) ? (
    <TeacherAnalyticsRoutes />
  ) : (
    <TeacherWorkflowRoutes />
  );
}
export function App() {
  return (
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
        path="/student/courses"
        element={<Navigate replace to="/student/course-content" />}
      />
      <Route
        path="/teacher/courses"
        element={<Navigate replace to="/teacher/course-twin" />}
      />
      <Route
        path="/student/assignments"
        element={<Navigate replace to="/student/homework" />}
      />
      <Route
        path="/teacher/assignments"
        element={<Navigate replace to="/teacher/homework" />}
      />
      <Route
        path="/student/insight"
        element={<Navigate replace to="/student/student-twin" />}
      />
      <Route
        path="/teacher/insight"
        element={<Navigate replace to="/teacher/dashboard" />}
      />
      <Route
        path="/teacher/grading"
        element={<Navigate replace to="/teacher/homework" />}
      />
      <Route path="/student/*" element={<Shell />} />
      <Route path="/teacher/*" element={<Shell teacher />} />
      <Route
        path="/development/catalog"
        element={
          <main className="page-container">
            <Suspense fallback={<p>正在读取课程…</p>}>
              <CoursePage />
            </Suspense>
          </main>
        }
      />
      <Route
        path="*"
        element={
          <div className="page-container">
            <h1>页面不存在</h1>
            <Link to="/login">返回入口</Link>
          </div>
        }
      />
    </Routes>
  );
}
