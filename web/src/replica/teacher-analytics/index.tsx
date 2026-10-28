import { Route, Routes } from "react-router-dom";
import { Dashboard, Drilldown } from "./dashboard";
import { CourseTwin } from "./course";
import { Industry } from "./industry";
import "./analytics.css";

export function TeacherAnalyticsRoutes() {
  return (
    <Routes>
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="course-twin" element={<CourseTwin />} />
      <Route path="teacher-twin/drilldown" element={<Drilldown />} />
      <Route path="industry-intelligence" element={<Industry />} />
    </Routes>
  );
}
