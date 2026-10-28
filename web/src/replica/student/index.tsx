import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage";
import { TwinPage } from "./TwinPage";
import { CoursePage } from "./course";
import { LearningPage } from "./learning";
import { HomeworkPage, HomeworkDetail, QuizPage } from "./assessment";
import {
  InterventionPage,
  InterventionDetail,
  InteractionPage,
  ProfilePage,
} from "./support";
export function StudentRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate replace to="home" />} />
      <Route path="home" element={<HomePage />} />
      <Route path="course-content" element={<CoursePage />} />
      <Route path="learning" element={<LearningPage />} />
      <Route path="student-twin" element={<TwinPage />} />
      <Route path="homework" element={<HomeworkPage />} />
      <Route path="homework/:assignmentId" element={<HomeworkDetail />} />
      <Route path="intervention" element={<InterventionPage />} />
      <Route path="intervention/:packageId" element={<InterventionDetail />} />
      <Route path="interaction" element={<InteractionPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="quiz" element={<QuizPage />} />
      <Route path="*" element={<Navigate replace to="home" />} />
    </Routes>
  );
}
