# 成员 C：李然 — 有据评阅、变更重评、正式反馈与 Agent/公共底座

> 本文档既是你的**纵向业务范围与公共统筹边界**，也是本轮最终收口自查与联调核验清单。除负责评阅与重评纵切面外，你负责统筹多 Agent 运行时、公共接口装配、数据库迁移编号审批与四人 PR 集成。

## 1. 你的纵向职责与上下游交接

你负责教学闭环的第三棒——**「评：有据评阅、变更追溯与唯一正式反馈」**，并维护全组共享基础设施：
- **承接上游（张俊超 · 题库/作答）**：消费作业冻结的题目与评分标准版本、学生不可变正式提交 `submission_id` 与原文。
- **纵向主线**：三栏批阅工作台（队列/原文/评分）→ AI 逐点评阅草稿（仅生成逐点得分与引用，总分由服务端重算校验）→ 教师逐点核对、草稿→确认→发布状态机 → 学生查看正式分项反馈与导出正式 CSV → 资料/标准变更影响追踪（`content-impact`）→ 已关闭作业单题整组重评批次（逐份确认后统一发布，保留旧版成绩历史）。
- **公共统筹范围**：多 Agent 持久运行时与权限/审批门禁、OpenAI 兼容模型 Profiles 与共享 50 元预算账本、身份/CSRF/课程鉴权中间件、前后端公共布局与主题样式、Docker Compose/CI 与迁移协调。
- **交付给下家（葛炫毅 · 学情/干预）的真实对象**：唯一正式结果源 `released_revision_id`、逐知识点得分证据、正式反馈 CSV。

## 2. 负责页面路由与代码边界

- **前端页面路由**：
  - 教师端：`/teacher/homework/submissions/:submissionId/grade`、`/teacher/content-impact`、`/teacher/regrades`、`/teacher/assistant`、`/teacher/profile`
  - 学生端：`/student/homework/submissions/:submissionId/feedback`、`/student/assistant`、`/student/profile`
- **前端源码**：
  - `web/src/live/`：`grading.tsx`、`assessment.tsx`（**仅限 `GradePage` 部分**）、`content-impact.tsx`、`regrades.tsx`、`agent.tsx`、`agent-editor.tsx`、`agent.css`、`context.tsx`、`context-agent.tsx`、`account.tsx`、`ai-jobs.tsx`、`workflow-job.tsx`、`routes.tsx`
  - 公共框架：`web/src/app/*`、`web/src/shared/*`、`web/src/styles/*`
- **后端 Go 与 SQL**：
  - `backend/internal/learning/`：`feedback.go`（评分/发布/导出部分）、`regrade.go`、`account.go`、`workspace.go`、`http.go`（公共路由装配）
  - 公共包与运行时：`backend/internal/agent/*`、`backend/internal/identity/*`、`backend/internal/platform/*`、`backend/internal/server/*`
  - `backend/internal/rag/`：`models.go`、`jobs.go`、`agent.go`、`agent_stream.go`
  - `backend/db/queries/`：`agent.sql`、`identity.sql`、`workspace.sql`、`workflows.sql`（影响分析与整组重评段）
  - 对应 Agent 专家域：`assessment`（评阅、重评、CSV 导出）及 `control` 协调运行时/门禁
- **责任入口**：[backend/internal/grading/README.md](../../backend/internal/grading/README.md)

## 3. 公共底座协调职责与边界

- **统筹而不包办**：其他三人的纵向 Bug 由各自主责排查并在各自小分支修；遇到共用路由、跨表迁移、`sqlc` 重生、模型 Profile 或容器环境故障时由你介入协调。
- **共享改动把关**：
  - 维护 `backend/internal/learning/http.go`、`web/src/live/routes.tsx`、`web/src/live/types.ts`、`backend/config/models.json`、`go.mod`/`go.sum`、`web/package.json`、`backend/internal/store/*` 与 Compose/CI；
  - 分配新增迁移号（**`00001—00020` 已使用，后续从 `00021` 起统一登记编号**），禁止修改已执行迁移；
  - 执行成员 PR 审核与 `codex/integration` → `main` 集成合并。

## 4. 逐项自查挑错清单

按下面 8 条逐一在真实浏览器与后端测试中核查：

1. **三栏批阅工作台（`/teacher/homework/submissions/:submissionId/grade`）**：
   - 验证队列连续翻份、复制当前评分（若支持）、原文引用定位高亮与历史修订抽屉是否联动正常，切换不同学生提交不会残留上一位分数草稿。
2. **AI 逐点评阅草稿防算错机制**：
   - 触发 AI 逐点评阅草稿，核对后端是否独立加和逐点得分、校验引用完整性，模型自报总分仅作 `model_reported_score` 追溯而不篡改正式总分；模型不可用或欠费时手工评分仍完全可用。
3. **评分草稿 → 确认 → 正式发布状态机**：
   - 仅保存草稿或仅确认未发布时，学生端是否确定不可见；点击正式发布后生成正式修订版本，后续修订仍需重新确认发布。
4. **学生正式反馈与 CSV 导出（`/student/.../feedback`）**：
   - 学生查看正式反馈是否与学情统计、CSV 导出读取同一正式版本；CSV 中若包含 `=`, `+`, `-`, `@` 等开头字符必须正确转义防公式注入；学生不得读取其他同学反馈或教师草稿。
5. **内容变更影响清单（`/teacher/content-impact`）**：
   - 当资料片段或知识条目/评分标准修订或停用后，核对影响清单是否准确列出下游关联的知识、题目、作业与已发布正式成绩。
6. **已关闭作业单题整组重评（`/teacher/regrades`）**：
   - 为已关闭作业的一道题创建重评批次，验证有效提交被冻结、AI/人工逐份复核确认后整组统一发布，且**历史旧版成绩记录仍完整保留可查**（并验证单个批次不可跨多个作业）。
7. **多 Agent 持久运行时与安全门禁（`/teacher/assistant`、`/student/assistant`）**：
   - 检查 DeepSeek / 百炼模型选择（仅会话空闲可改）、三种权限模式（学生禁用 `full-access`；`read-only` 禁止打开写工作台）、问题卡与审批卡参数/快照比对（对象变化时拒绝旧审批）；
   - 验证七类复用业务编辑器抽屉保存后服务端重读回执、`changed=false` 不宣称完成、草稿恢复按账号/课程/对话隔离，以及共享 50 元预算正确预留与结算。
8. **身份权限、UI 与自适应一致性**：
   - 验证登录/退出、CSRF 校验、跨课程 `403` 拦截、`1440×900` 与 `390×844` 桌面/移动端及浅色/深色主题无遮挡或对比度缺陷。

## 5. 协作集成与验证规范

- 每次合入集成前确保跑通：`npm run typecheck && npm run build`、`node scripts/check-frontend-ui.cjs`、`python scripts/check_docs.py`、`git diff --check`，以及 Docker 内的 `rag`/`learning`/`agent` 包 `go test -count=1` 与 `go vet`。
- 本地启动带 AI 与 RAG 的环境统一使用 `docker compose -f compose.yaml -f compose.rag.yaml up -d`，密钥仅保留在 `.local/model-secrets.env`。

## 6. 最终汇报 4 要点与可用素材

- **汇报主线（约 3 分钟评阅主线 + 1 分钟全局收尾）**：① 承接与痛点：解决“AI 批改乱给总分、改题改标准后历史成绩对不上”的问题；② 纵向数据流：提交原文 → 逐点草稿校验 → 确认发布唯一正式结果源 → 内容影响追踪与整组重评 → 交付 `released_revision_id`；③ 工程约束：逐点分值服务端重算、CSV 唯一正式源、重评保留旧结果，以及收尾的多 Agent 持久检查点与门禁架构；④ 现场演示：正常逐点评阅发布/整组重评 + 拦截旧审批快照失效或越权导出。
- **可直接放进 PPT 的现成素材**：
  - [内容变更与整组重评流程图](../diagrams/current/04_内容变更与整组重评.png)
  - [多 Agent 协调与门禁架构图](../diagrams/agent/architecture.png)
  - 运行边界见 [对话助理与执行运行时说明](../agent-harness.md)、对应脚本验证见 [自动演示说明](../auto-demo.md)（流程 7、10、11）
