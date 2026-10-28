import { Route, Routes } from "react-router-dom";
import {
  HomeworkEdit,
  HomeworkGrade,
  HomeworkList,
  HomeworkSubmissions,
  QuizList,
} from "./assessment";
import {
  TeacherIntervention,
  TeacherInterventionDetail,
} from "./interventions";
import { TeacherInteraction, TeacherResearch } from "./communication";

export function TeacherWorkflowRoutes() {
  return (
    <Routes>
      <Route path="homework" element={<HomeworkList />} />
      <Route path="homework/new" element={<HomeworkEdit key="new" />} />
      <Route path="homework/:assignmentId/edit" element={<HomeworkEdit />} />
      <Route
        path="homework/:assignmentId/submissions"
        element={<HomeworkSubmissions />}
      />
      <Route
        path="homework/submissions/:submissionId/grade"
        element={<HomeworkGrade />}
      />
      <Route path="intervention" element={<TeacherIntervention />} />
      <Route
        path="intervention/:packageId"
        element={<TeacherInterventionDetail />}
      />
      <Route path="interaction" element={<TeacherInteraction />} />
      <Route path="research" element={<TeacherResearch />} />
      <Route path="quiz" element={<QuizList />} />
    </Routes>
  );
}
