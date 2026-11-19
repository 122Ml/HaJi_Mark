# 成员 D：葛炫毅 — 学情证据画像、路径推荐、共性诊断与干预复查

> 本文档既是你的**分工边界说明**，也是发给各自 AI 工具排查和修复 Bug 的**自查清单**。你在最终汇报中兼任开场总述，把全组「教 → 考 → 评 → 改」的闭环讲圆。

## 1. 你的纵向职责与上下游交接

你负责教学闭环的第四棒——**「改：证据画像、路径、共性诊断与干预复查」**：
- **承接上游（李然 · 评阅/重评 & 徐铂尧 · 课程/图谱）**：消费已发布的正式评分修订 `released_revision_id`、逐知识点得分证据、课程学习记录与知识点依赖图谱。
- **纵向主线**：教师端班级/个人学情看板下钻 & 学生端个人首页表现 → 基于依赖图谱的规则学习路径 + AI 排序与学习偏好持久化 → 同题同标准失分作答**共性问题诊断** → 教师确认诊断标签并下发补学/补练干预任务 → 学生执行补学 → 教师核对任务下发时间点之后产生的新学习/提交证据并复查结案（`reviewed`）→ 课程互动（公告/提问/回复）与教研/行业记录管理。
- **交付回流闭环**：将班级共性薄弱点与补练结果回流给课程资料与题库环节，驱动下一轮教学迭代。

## 2. 负责页面路由与代码边界

- **前端页面路由**：
  - 教师端：`/teacher/dashboard`、`/teacher/insight`、`/teacher/intervention/*`、`/teacher/interaction`、`/teacher/research`、`/teacher/industry-intelligence`
  - 学生端：`/student/home`、`/student/learning`、`/student/intervention/*`、`/student/interaction`
- **前端源码（`web/src/live/`）**：
  - `insight.tsx`、`path.tsx`、`learning-gaps.tsx`、`interventions.tsx`、`intelligence.tsx`、`activity.tsx`、`communication.tsx`、`records.tsx`
- **后端 Go 与 SQL**：
  - `backend/internal/learning/`：`activity.go`、`intelligence.go`，`path.go` 中**仅学生学习路径 `/path` 部分**，以及 `feedback.go` 中**`overview`、`evidence`、`interventions`、`interactions`、`research`、`industry` 部分**
  - `backend/internal/rag/intelligence.go`
  - `backend/db/queries/`：`intelligence.sql`、`learning.sql`（学情/路径/干预/互动/教研段）
  - 对应 Agent 专家域：`learning`（班级学情、正式证据、学习路径、诊断/推荐任务、补学干预下发与复核、互动）
- **责任入口**：[backend/internal/insight/README.md](../../backend/internal/insight/README.md)

## 3. 禁止越界与共享文件协调

- **不要改动**：课程管理/目录/图谱建边/资料解析/知识库（徐铂尧）、题库/标准/作业/学生作答提交（张俊超）、评分修改发布/重评/Agent 底座/身份公共配置（李然）。
- **严谨表述约束**：**不得修改成绩表或作答原文**；不得把规则计算结果包装成概率预测，也不得凭模型摘要或单次前后分差直接宣称“证明学习能力提升”。
- **共享文件约束**：
  - `backend/internal/learning/path.go`：你只修改 `/path` 学习路径逻辑，不动知识图谱 `/graph` 与 `/edges`（徐铂尧负责）。
  - `backend/internal/learning/feedback.go`：你只维护 `overview`、`evidence`、`interventions`、`interactions`、`research`、`industry` 处理器，不动 `grade` / `gradeState` / 导出核心逻辑（李然负责）。
  - `backend/internal/learning/http.go`、`web/src/live/routes.tsx`、`web/src/live/types.ts`、`backend/config/models.json`、`web/src/styles/*`、`backend/internal/store/*` 由 **李然** 协调修改；新数据库迁移须从 **`00020`** 起预约。

## 4. 逐项自查挑错清单

按下面 7 条逐一在真实浏览器操作，记下统计口径异常、数据脱节或边界漏洞：

1. **教师班级学情与个人下钻（`/teacher/dashboard`、`/teacher/insight`）**：
   - 验证全班作业提交覆盖率、平均/分布统计与成员页点姓名带参跳转 `/teacher/dashboard?student=<id>`；
   - 无提交或无已发布评分数据时，页面是否明确展示“证据不足”，而不是把未交或未评伪造成 0 分。
2. **学生首页与证据溯源（`/student/home`）**：
   - 检查学生查看个人正式评分证据与学习/提交时间线是否只含本人数据与**已发布**成绩（教师未发布草稿不可见），跨学生读取他人 `evidence`/`activity` 是否返回 `403`。
3. **规则学习路径与 AI 排序（`/student/learning`）**：
   - 先在不调用 AI 时生成规则学习路径，确认**纯规则兜底链路正常可用**；
   - 再开启 AI 排序并保存学习偏好（如前置巩固/当前薄弱优先级），刷新确认偏好历史持久化留存，顺序严格尊重知识依赖关系。
4. **共性问题诊断（`/teacher/insight` / `/teacher/intervention/*`）**：
   - 针对同题同标准存在失分的正式提交触发共性诊断任务，检查服务端是否按 `evidence_ids` 准确还原**不可变作答原句**；
   - 确认同一诊断项下**同一学生不被重复计数**，作答空白或证据不足的条目显式归入“未归类”；教师编辑并确认诊断标签后才作为正式依据。
5. **补学/补练干预全闭环（`/teacher/intervention/*`、`/student/intervention/*`）**：
   - 教师关联推荐资料或补练创建任务 → 下发（`assigned`）→ 学生登录看到任务并去打开/完成对应资料或提交作答 → 回到教师端点击核对；
   - 核验复查接口（`interventionEvidence`）是否严格检索**任务下发时间点之后**产生的新学习/提交记录，再允许教师确认结案（`reviewed`）。
6. **课程互动与教研/行业记录（`/teacher/interaction`、`/student/interaction`、`/teacher/research`、`/teacher/industry-intelligence`）**：
   - 验证教师发布公告、学生提问与教师回复完整持久化；验证教研记录及行业能力关联记录的增删改查刷新后均保留在 PostgreSQL。
7. **Agent 学习支持与推荐协同（`/teacher/assistant`、`/student/assistant`）**：
   - 分别以教师/学生身份通过助理触发诊断草稿创建、读取诊断历史或生成规则路径，确认工作台抽屉编辑诊断标签保存后能正确恢复原对话运行。

## 5. 给 AI 工具改 Bug 时的操作规范

- 开工前把 [AGENTS.md](../../AGENTS.md)、[四人分工总表](../team.md)、[接口契约](../contracts.md)、[评据来源](../evidence.md) 和本文档交给你的 AI 工具，每次只处理清单中的 1 个具体问题。
- 从最新 `codex/integration` 拉个人小分支（如 `member/gexuanyi/fix-xxx`）修改，遵守 [协作提交指南](../../CONTRIBUTING.md)，提交前运行 `npm run typecheck && npm run build` 与相关 Go 测试并附复现截图。

## 6. 最终汇报 4 要点与可用素材

- **汇报主线（开场总述 1 分钟 + 本段 3 分钟）**：① 开场定调平台不是对话套壳而是“人机协同证据闭环”；② 承接与痛点：如何从分散成绩单变成有原句依据的共性诊断与闭环补学；③ 纵向数据流与防呆：规则路径兜底 + AI 排序、诊断按 `evidence_ids` 还原原句并按人去重、干预核对下发后新增证据；④ 现场演示：下发补学任务 → 学生完成学习 → 教师端核对到新证据后复查结案 + 无正式证据时显示“证据不足”。
- **可直接放进 PPT 的现成素材**：
  - [全景架构与实现状态图](../diagrams/current/00_全景架构_实现状态.png)
  - [交互流程与时序图目录](../diagrams/interactions/README.md)
  - 对应脚本验证流程见 [自动演示说明](../auto-demo.md)（流程 8、9、12）
