export const preloadWorkspace = () => import("./Workspace");

const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
  dashboard: () => import("../live/insight"),
  home: () => import("../live/insight"),
  insight: () =>
    Promise.all([
      import("../live/insight"),
      import("../live/insight-students"),
      import("../live/learning-gaps"),
    ]),
  materials: () => import("../live/materials"),
  "course-content": () => import("../live/course"),
  homework: () => import("../live/assignment-list"),
  quiz: () => import("../live/assignment-list"),
  courses: () => import("../live/course-management"),
  curriculum: () => import("../live/curriculum"),
  research: () => import("../live/records"),
  "industry-intelligence": () => import("../live/records"),
  "question-bank": () => import("../live/question-bank"),
  regrades: () => import("../live/regrades"),
  "content-impact": () => import("../live/content-impact"),
  knowledge: () => import("../live/knowledge"),
  retrieval: () => import("../live/retrieval"),
  intervention: () => import("../live/insight"),
  interaction: () => import("../live/communication"),
  assistant: () => import("../live/agent"),
  learning: () => import("../live/path"),
  profile: () => import("../live/account"),
};

const prefetchedRoutes = new Set<string>();

export function prefetchRoute(key: string) {
  if (prefetchedRoutes.has(key)) return;
  const loader = ROUTE_PREFETCH[key];
  if (!loader) return;
  prefetchedRoutes.add(key);
  void loader().catch(() => {
    prefetchedRoutes.delete(key);
  });
}

export function preloadPathRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return;
  const segment = parts[1];
  if ((segment === "homework" || segment === "quiz") && parts.length > 2) {
    if (!prefetchedRoutes.has("assessment-detail")) {
      prefetchedRoutes.add("assessment-detail");
      void import("../live/assessment").catch(() => {
        prefetchedRoutes.delete("assessment-detail");
      });
    }
    return;
  }
  prefetchRoute(segment);
}
