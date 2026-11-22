import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "./Login";
import { preloadWorkspace } from "./route-preload";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { RequireSession, SessionProvider } from "../shared/session";
import { LoadingState } from "../shared/ui";

const LazyWorkspace = lazy(preloadWorkspace);

export function App() {

  const workspaceFallback = (
    <div className="page-container">
      <LoadingState label="正在加载工作台…" />
    </div>
  );

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
                <Suspense fallback={workspaceFallback}>
                  <LazyWorkspace />
                </Suspense>
              </RequireSession>
            }
          />
          <Route
            path="/teacher/*"
            element={
              <RequireSession role="teacher">
                <Suspense fallback={workspaceFallback}>
                  <LazyWorkspace teacher />
                </Suspense>
              </RequireSession>
            }
          />
          <Route path="*" element={<Navigate replace to="/login" />} />
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
