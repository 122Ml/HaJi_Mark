# insight 责任导航（成员 D：葛炫毅）

当前活动业务集中在 `backend/internal/learning`、`backend/internal/rag` 与 `web/src/live`，本目录保留为纵切面责任入口，不另外注册重复 HTTP 服务。

- **后端代码**：`learning/`（`activity.go`、`intelligence.go`、`path.go` 学习路径段、`feedback.go` 的 `overview`/`evidence`/`interventions`/`interactions`/`research`/`industry` 段）与 `rag/intelligence.go`，SQL 位于 `backend/db/queries/`（`intelligence.sql` 与 `learning.sql` 对应段）。
- **前端代码**：`web/src/live/`（`insight.tsx`、`path.tsx`、`learning-gaps.tsx`、`interventions.tsx`、`intelligence.tsx`、`activity.tsx`、`communication.tsx`、`records.tsx`）。
- **迁移与边界**：不得修改成绩或学生原文；迁移 `00001—00017` 已使用，新增迁移从 `00018` 起向李然预约；完整边界与自查清单见 [docs/team.md](../../../docs/team.md)、[docs/handoffs/insight.md](../../../docs/handoffs/insight.md) 与 [docs/contracts.md](../../../docs/contracts.md)。
