# assessment 责任导航（成员 B：张俊超）

当前活动业务集中在 `backend/internal/learning`、`backend/internal/rag` 与 `web/src/live`，本目录保留为纵切面责任入口，不另外注册重复 HTTP 服务。

- **后端代码**：`learning/`（`question_bank.go`、`paper.go`、`rubrics.go`、`assessment.go`、`drafts.go`、`submission_import.go`、`submission_text.go`）与 `rag/question_bank.go`，SQL 位于 `backend/db/queries/`（`question_bank.sql`、`rubrics.sql`、`completion.sql`、`learning.sql` 对应段）。
- **前端代码**：`web/src/live/`（`question-bank.tsx`、`rubrics.tsx`、`submission-import.tsx` 与 `assessment.tsx` 的作业/测验/提交部分，不含 `GradePage`）。
- **迁移与边界**：出题与评分标准严格禁止读取学生作答；迁移 `00001—00020` 已使用，新增迁移从 `00021` 起向李然预约；完整边界与自查清单见 [docs/team.md](../../../docs/team.md)、[docs/handoffs/assessment.md](../../../docs/handoffs/assessment.md) 与 [docs/contracts.md](../../../docs/contracts.md)。
