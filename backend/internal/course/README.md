# course 责任导航（成员 A：徐铂尧）

当前活动业务集中在 `backend/internal/learning`、`backend/internal/rag` 与 `web/src/live`，本目录保留为纵切面责任入口，不另外注册重复 HTTP 服务。

- **后端代码**：`learning/`（`course.go`、`curriculum.go`、`materials.go`、`assets.go`、`asset_crop.go`、`source_url.go`、`topics.go`、`knowledge_decisions.go`、`notes.go`、`scoped_search.go`、`assist.go`、`path.go` 图谱段）与 `rag/`（`retrieval.go`、`vision.go`、`web.go`、`workflows.go`），SQL 位于 `backend/db/queries/`（`course.sql`、`rag.sql`、`workflows.sql`、`learning.sql` 对应段）。
- **前端代码**：`web/src/live/`（`course-management.tsx`、`curriculum.tsx`、`curriculum-template.ts`、`graph.tsx`、`materials.tsx`、`material-assets.tsx`、`material-assist.tsx`、`content-topics.tsx`、`knowledge.tsx`、`knowledge-review.tsx`、`retrieval.tsx`、`retrieval-history.tsx`、`course.tsx`、`notes.tsx`、`citations.tsx`）。
- **迁移与边界**：迁移 `00001—00020` 已使用，新增迁移从 `00021` 起向李然预约；完整边界与自查清单见 [docs/team.md](../../../docs/team.md)、[docs/handoffs/course.md](../../../docs/handoffs/course.md) 与 [docs/contracts.md](../../../docs/contracts.md)。
