import { StudyPath } from "./path";
import { Link, Route, Routes, useLocation, Navigate } from "react-router-dom";
import { CourseWorkspace } from "./course";
import {
  AssignmentList,
  AssignmentEditor,
  AssignmentDetail,
  SubmissionList,
  GradePage,
} from "./assessment";
import { OverviewPage, InterventionPage } from "./insight";
import { InteractionPage } from "./communication";
import { useLearning } from "./context";
import { ProfilePage, RecordsPage } from "./account";
import { EmptyState } from "../shared/ui";
import { MaterialsPage, KnowledgePage, RetrievalPage } from "./knowledge";
export function LiveRoutes({ teacher }: { teacher: boolean }) {
  const { course } = useLearning();
  const location = useLocation();
  const root = teacher ? "/teacher" : "/student";
  const overviewRedirect = <Navigate replace to={`${root}/${teacher ? "dashboard" : "home"}${location.search}`} />;
  const courseRedirect = <Navigate replace to={`${root}/${teacher ? "course-twin" : "course-content"}${location.search}`} />;
  if (!course && !location.pathname.endsWith("/profile"))
    return teacher ? (
      <CourseWorkspace />
    ) : (
      <section className="card-panel">
        <EmptyState heading title="尚未加入课程">请联系课程教师将你的账号加入课程，然后刷新页面。</EmptyState>
      </section>
    );
  return (
    <Routes key={`${course?.id}:${location.pathname}`}>
      <Route path="profile" element={<ProfilePage />} />
      {teacher && <Route path="research" element={<RecordsPage />} />}
      {teacher && <Route path="industry-intelligence" element={<RecordsPage industry />} />}
      <Route path="teacher-twin/drilldown" element={overviewRedirect} />
      <Route path="home" element={teacher ? overviewRedirect : <OverviewPage />} />
      <Route path="dashboard" element={teacher ? <OverviewPage /> : overviewRedirect} />
      <Route path="course-content" element={teacher ? courseRedirect : <CourseWorkspace />} />
      <Route path="course-twin" element={teacher ? <CourseWorkspace /> : courseRedirect} />
      <Route path="homework" element={<AssignmentList />} />
      {teacher && <Route path="materials" element={<MaterialsPage />} />}
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
            path="homework/:assignmentId/submissions"
            element={<SubmissionList />}
          />
          <Route
            path="homework/submissions/:submissionId/grade"
            element={<GradePage />}
          />
        </>
      )}
      <Route path="homework/:assignmentId" element={<AssignmentDetail />} />
      <Route
        path="homework/submissions/:submissionId/feedback"
        element={<GradePage />}
      />
      <Route path="intervention/*" element={<InterventionPage />} />
      <Route path="interaction" element={<InteractionPage />} />
      <Route path="student-twin" element={overviewRedirect} />
      {!teacher && <Route path="learning" element={<StudyPath />} />}
      <Route
        path="courses"
        element={
          <Navigate
            replace
            to={`${root}/${teacher ? "course-twin" : "course-content"}${location.search}`}
          />
        }
      />
      <Route
        path="assignments"
        element={
          <Navigate
            replace
            to={`${root}/homework${location.search}`}
          />
        }
      />
      <Route path="insight" element={overviewRedirect} />
      <Route path="grading" element={<Navigate replace to={`/${teacher ? "teacher" : "student"}/homework${location.search}`} />} />
      <Route
        path="*"
        element={
          <section className="card-panel">
            <EmptyState heading title="页面不存在" action={<Link className="ghost-btn" to={`${root}/${teacher ? "dashboard" : "home"}`}>返回概览</Link>}>
              该地址没有对应的功能，请从左侧导航选择。
            </EmptyState>
          </section>
        }
      />
    </Routes>
  );
}
