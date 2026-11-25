import { lazy, Suspense } from "react";
import { Route, Routes, useLocation, Navigate } from "react-router-dom";
import { Link, useLearning } from "./context";
import { EmptyState, LoadingState } from "../shared/ui";
import { PageHeader } from "../shared/PageHeader";

const StudyPath = lazy(() => import("./path").then((m) => ({ default: m.StudyPath })));
const CourseWorkspace = lazy(() => import("./course").then((m) => ({ default: m.CourseWorkspace })));
const AssignmentList = lazy(() => import("./assignment-list").then((m) => ({ default: m.AssignmentList })));
const AssignmentEditor = lazy(() => import("./assessment").then((m) => ({ default: m.AssignmentEditor })));
const AssignmentDetail = lazy(() => import("./assessment").then((m) => ({ default: m.AssignmentDetail })));
const SubmissionList = lazy(() => import("./assessment").then((m) => ({ default: m.SubmissionList })));
const GradePage = lazy(() => import("./assessment").then((m) => ({ default: m.GradePage })));
const OverviewPage = lazy(() => import("./insight").then((m) => ({ default: m.OverviewPage })));
const InterventionPage = lazy(() => import("./insight").then((m) => ({ default: m.InterventionPage })));
const InteractionPage = lazy(() => import("./communication").then((m) => ({ default: m.InteractionPage })));
const ProfilePage = lazy(() => import("./account").then((m) => ({ default: m.ProfilePage })));
const RecordsPage = lazy(() => import("./records").then((m) => ({ default: m.RecordsPage })));
const MaterialsPage = lazy(() => import("./materials").then((m) => ({ default: m.MaterialsPage })));
const KnowledgePage = lazy(() => import("./knowledge").then((m) => ({ default: m.KnowledgePage })));
const RetrievalPage = lazy(() => import("./retrieval").then((m) => ({ default: m.RetrievalPage })));
const QuestionBankPage = lazy(() => import("./question-bank").then((m) => ({ default: m.QuestionBankPage })));
const RegradesPage = lazy(() => import("./regrades").then((m) => ({ default: m.RegradesPage })));
const ContentImpactPage = lazy(() => import("./content-impact").then((m) => ({ default: m.ContentImpactPage })));
const CourseManagement = lazy(() => import("./course-management").then((m) => ({ default: m.CourseManagement })));
const CurriculumPage = lazy(() => import("./curriculum").then((m) => ({ default: m.CurriculumPage })));
const AgentPage = lazy(() => import("./agent").then((m) => ({ default: m.AgentPage })));

export function LiveRoutes({ teacher }: { teacher: boolean }) {
  const { course } = useLearning();
  const location = useLocation();
  const root = teacher ? "/teacher" : "/student";
  const overviewRedirect = (
    <Navigate
      replace
      to={`${root}/${teacher ? "dashboard" : "home"}${location.search}`}
    />
  );
  const params = new URLSearchParams(location.search);
  const legacyTab = params.get("tab");
  const legacyTarget = params.has("resource")
    ? "materials"
    : legacyTab === "members" || legacyTab === "settings"
      ? "courses"
      : legacyTab === "work"
        ? "homework"
        : "curriculum";
  if (params.has("resource")) params.set("tab", "published");
  const courseRedirect = (
    <Navigate
      replace
      to={`${root}/${teacher ? legacyTarget : "course-content"}?${params}`}
    />
  );
  if (
    params.has("course") &&
    !course &&
    !location.pathname.endsWith("/profile") &&
    !location.pathname.endsWith("/courses")
  )
    return (
      <section className="card-panel">
        <EmptyState
          heading
          title="无法访问该课程"
          action={
            teacher ? (
              <Link className="ghost-btn" to="/teacher/courses">
                课程管理
              </Link>
            ) : undefined
          }
        >
          请从顶部选择有权限的课程。
        </EmptyState>
      </section>
    );
  if (
    !course &&
    !location.pathname.endsWith("/profile") &&
    !location.pathname.endsWith("/courses")
  )
    return teacher ? (
      <Navigate replace to="/teacher/courses" />
    ) : (
      <section className="card-panel">
        <EmptyState heading title="尚未加入课程">
          请联系课程教师将你的账号加入课程，然后刷新页面。
        </EmptyState>
      </section>
    );
  return (
    <Suspense fallback={<LoadingState label="正在加载页面…" />}>
      <Routes key={course?.id || "global"}>
        <Route path="profile" element={<ProfilePage />} />
        <Route path="assistant" element={<AgentPage />} />
        {teacher && <Route path="courses" element={<CourseManagement />} />}
        {teacher && <Route path="curriculum" element={<CurriculumPage />} />}
        {teacher && <Route path="research" element={<RecordsPage />} />}
        {teacher && (
          <Route
            path="industry-intelligence"
            element={<RecordsPage industry />}
          />
        )}
        <Route path="teacher-twin/drilldown" element={overviewRedirect} />
        <Route
          path="home"
          element={teacher ? overviewRedirect : <OverviewPage />}
        />
        <Route
          path="dashboard"
          element={teacher ? <OverviewPage /> : overviewRedirect}
        />
        <Route
          path="course-content"
          element={teacher ? courseRedirect : <CourseWorkspace />}
        />
        <Route path="course-twin" element={courseRedirect} />
        <Route path="homework" element={<AssignmentList />} />
        {teacher && <Route path="materials" element={<MaterialsPage />} />}
        {teacher && <Route path="question-bank" element={<QuestionBankPage />} />}
        {teacher && <Route path="regrades" element={<RegradesPage />} />}
        {teacher && (
          <Route path="content-impact" element={<ContentImpactPage />} />
        )}
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="retrieval" element={<RetrievalPage />} />
        <Route path="quiz" element={<AssignmentList quiz />} />
        {teacher && (
          <>
            <Route path="homework/new" element={<AssignmentEditor />} />
            <Route
              path="homework/:assignmentId/edit"
              element={<AssignmentEditor />}
            />
            <Route path="quiz/new" element={<AssignmentEditor quiz />} />
            <Route
              path="quiz/:assignmentId/edit"
              element={<AssignmentEditor quiz />}
            />
            <Route
              path="homework/:assignmentId/submissions"
              element={<SubmissionList />}
            />
            <Route
              path="quiz/:assignmentId/submissions"
              element={<SubmissionList />}
            />
            <Route
              path="homework/submissions/:submissionId/grade"
              element={<GradePage />}
            />
          </>
        )}
        <Route path="homework/:assignmentId" element={<AssignmentDetail />} />
        <Route path="quiz/:assignmentId" element={<AssignmentDetail />} />
        <Route
          path="homework/submissions/:submissionId/feedback"
          element={<GradePage />}
        />
        <Route path="intervention/*" element={<InterventionPage />} />
        <Route path="interaction" element={<InteractionPage />} />
        <Route path="student-twin" element={overviewRedirect} />
        {!teacher && <Route path="learning" element={<StudyPath />} />}
        {!teacher && <Route path="courses" element={courseRedirect} />}
        <Route
          path="assignments"
          element={<Navigate replace to={`${root}/homework${location.search}`} />}
        />
        <Route path="insight" element={teacher ? <OverviewPage analysis /> : overviewRedirect} />
        <Route
          path="grading"
          element={
            <Navigate
              replace
              to={`/${teacher ? "teacher" : "student"}/homework${location.search}`}
            />
          }
        />
        <Route
          path="*"
          element={
            <div className="live-page">
              <PageHeader title="页面不存在" />
              <section className="card-panel">
                <EmptyState
                  heading
                  title="页面不存在"
                  action={
                    <Link
                      className="ghost-btn"
                      to={`${root}/${teacher ? "dashboard" : "home"}`}
                    >
                      返回概览
                    </Link>
                  }
                >
                  该地址没有对应的功能，请从左侧导航选择。
                </EmptyState>
              </section>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
