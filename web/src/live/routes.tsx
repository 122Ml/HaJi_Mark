import { StudyPath } from "./path";
import { Route, Routes, useLocation, Navigate } from "react-router-dom";
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
export function LiveRoutes({ teacher }: { teacher: boolean }) {
  const { course } = useLearning();
  const location = useLocation();
  if (!course && !location.pathname.endsWith("/profile"))
    return teacher ? (
      <CourseWorkspace />
    ) : (
      <p>尚未加入课程，请联系教师添加账号后刷新。</p>
    );
  return (
    <Routes key={`${course?.id}:${location.pathname}`}>
      <Route path="profile" element={<ProfilePage />} />
      <Route path="research" element={<RecordsPage />} />
      <Route path="industry-intelligence" element={<RecordsPage industry />} />
      <Route path="teacher-twin/drilldown" element={<OverviewPage />} />
      <Route path="home" element={<OverviewPage />} />
      <Route path="dashboard" element={<OverviewPage />} />
      <Route path="course-content" element={<CourseWorkspace />} />
      <Route path="course-twin" element={<CourseWorkspace />} />
      <Route path="homework" element={<AssignmentList />} />
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
      <Route path="student-twin" element={<OverviewPage />} />
      <Route path="learning" element={<StudyPath />} />
      <Route
        path="courses"
        element={
          <Navigate
            replace
            to={teacher ? "/teacher/course-twin" : "/student/course-content"}
          />
        }
      />
      <Route
        path="assignments"
        element={
          <Navigate
            replace
            to={teacher ? "/teacher/homework" : "/student/homework"}
          />
        }
      />
      <Route path="insight" element={<OverviewPage />} />
      <Route path="grading" element={<AssignmentList />} />
      <Route
        path="*"
        element={
          <div className="card-panel">
            <h1>页面不存在</h1>
            <p>请从上方导航选择功能。</p>
          </div>
        }
      />
    </Routes>
  );
}
