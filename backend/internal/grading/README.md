# grading 责任导航（成员 C：李然）

当前活动业务集中在 `backend/internal/learning`、`backend/internal/agent`、`backend/internal/rag`、`backend/internal/identity` 与 `web/src/live`，本目录保留为纵切面与公共底座责任入口，不另外注册重复 HTTP 服务。

- **后端代码**：`learning/`（`feedback.go` 评分/发布/导出段、`regrade.go`、`account.go`、`workspace.go`、`http.go` 公共路由）及 `agent/*`、`identity/*`、`platform/*`、`server/*`、`rag/`（`models.go`、`jobs.go`、`agent.go`、`agent_stream.go`）；SQL 位于 `backend/db/queries/`（`agent.sql`、`identity.sql`、`workspace.sql`、`workflows.sql` 重评影响段）。
- **前端代码**：`web/src/live/`（`grading.tsx`、`assessment.tsx` 的 `GradePage`、`content-impact.tsx`、`regrades.tsx`、`agent.tsx`、`agent-editor.tsx`、`context*.tsx`、`account.tsx`、`ai-jobs.tsx`、`workflow-job.tsx`、`routes.tsx`）及 `web/src/{app,shared,styles}/*`。
- **迁移与边界**：迁移 `00001—00020` 已使用，后续从 `00021` 起统一预约编号；完整边界与自查清单见 [docs/team.md](../../../docs/team.md)、[docs/handoffs/grading.md](../../../docs/handoffs/grading.md) 与 [docs/contracts.md](../../../docs/contracts.md)。
