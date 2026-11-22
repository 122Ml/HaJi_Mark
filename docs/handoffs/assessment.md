# 成员 B：张俊超 — 独立题库、评分标准与作业测验作答

> 本文档既是你的**分工边界说明**，也是发给各自 AI 工具排查和修复 Bug 的**自查清单**。本轮整体平台功能由协作基线提供，后续由你亲自自查、修错并完成纵向答辩演示。

## 1. 你的纵向职责与上下游交接

你负责教学闭环的第二棒——**「考：出题制标与正式作答」**：
- **承接上游（徐铂尧 · 课程/知识）**：消费已发布课程 `course_id`、知识点 `point_id`、已发布学习资料原文片段与已确认知识条目作为出题依据。
- **纵向主线**：手工建题 / JSON 候选导入 / 整卷三题型拆分 / 基于选定资料知识 AI 起草题目、参考解答与逐点评分标准 → 题目、参考解答、评分标准**三项分别人工确认** → 创建作业/客观测验并**冻结题目版本、满分与标准版本** → 发布/关闭作业状态机 → 学生端自动保存草稿、逐题正式提交（不可变 + SHA256 + attempt 历史）及教师 CSV 作答批量导入 → 客观测验规则自动判分。
- **交付给下家（李然 · 评阅/重评）的真实对象**：绑定固定题目版本和评分标准版本的作业，以及不可变的学生正式提交 `submission_id` 与 `attempt` 原文。

## 2. 负责页面路由与代码边界

- **前端页面路由**：
  - 教师端：`/teacher/question-bank`、`/teacher/homework`、`/teacher/homework/new`、`/teacher/homework/:assignmentId/edit`、`/teacher/quiz`、`/teacher/quiz/new`、`/teacher/homework/:assignmentId/submissions`
  - 学生端：`/student/homework`、`/student/quiz`、`/student/homework/:assignmentId`
- **前端源码（`web/src/live/`）**：
  - `question-bank.tsx`、`rubrics.tsx`、`submission-import.tsx`
  - `assessment.tsx`（**仅限列表、编辑、详情与提交名单，不含 `GradePage`**）
- **后端 Go 与 SQL**：
  - `backend/internal/learning/`：`question_bank.go`、`paper.go`、`rubrics.go`、`assessment.go`、`drafts.go`、`submission_import.go`、`submission_text.go`
  - `backend/internal/rag/question_bank.go`
  - `backend/db/queries/`：`question_bank.sql`、`rubrics.sql`、`completion.sql`（整卷拆题/作答导入段）、`learning.sql`（作业/草稿/提交段）
  - 对应 Agent 专家域：`questions`（严格受 `learner_context` 隔离，禁止接触学生作答）及 `assessment` 中的作业创建、CSV 作答导入部分
- **责任入口**：[backend/internal/assessment/README.md](../../backend/internal/assessment/README.md)

## 3. 禁止越界与共享文件协调

- **不要改动**：课程目录/图谱/资料解析/知识库（徐铂尧）、批阅工作台/评分发布/重评/Agent 运行时/身份公共层（李然）、学情看板/路径/诊断/干预/互动/教研（葛炫毅）。
- **严格隔离铁律**：**出题与评分标准接口不得读取待评学生作答**；若遇到题库或标准界面泄露学生作答记录，直接视为高危 Bug。
- **共享文件约束**：
  - `web/src/live/assessment.tsx`：你只修改 `AssignmentList`、`AssignmentEditor`、`AssignmentDetail`、`SubmissionList` 相关代码，不得擅自改动同文件里的 `GradePage`（李然负责）。
  - `backend/internal/learning/http.go`、`web/src/live/routes.tsx`、`web/src/live/types.ts`、`backend/config/models.json`、`web/src/styles/*`、`backend/internal/store/*` 由 **李然** 协调修改。
  - 若需要新数据库迁移：**`00001—00020` 已使用，必须从 `00021` 起先向李然预约编号**，严禁修改已执行迁移。

## 4. 逐项自查挑错清单

按下面 9 条逐一在真实浏览器操作，记下报错、逻辑问题或边界异常：

1. **独立题库建题、筛选与历史版本（`/teacher/question-bank`）**：
   - 验证手工录入、JSON 候选逐题核对入库、关键词/确认状态筛选与服务端分页是否准确；
   - 停用或修改已有题目分值时，是否生成新版本或阻断旧版被新作业选用，且已发布的旧作业不受影响。
2. **整卷拆分与来源出处反查（`/teacher/question-bank`）**：
   - 测试三题型（客观/简答/论述等）整卷文本拆分流程、教师逐题校正采纳以及来源片段出处反查链接跳转是否正确。
3. **AI 起草题目、参考解答与评分标准**：
   - 基于选定已发布资料/知识起草三类草稿后，人工载入编辑并**故意切换筛选条件或修改正在编辑的文本**，核对过期生成条件不会悄悄覆盖当前手动编辑内容。
4. **题目 / 解答 / 评分标准三项确认与逐点校验**：
   - 逐点评分标准核对 `1—30` 点与整数分加和校验（分项合计不等于满分必须拦截）；
   - 测试“仅确认题目但未确认标准”时，创建作业是否明确拦截选用（必须三项分别确认）。
5. **作业与测验发布、关闭与版本冻结（`/teacher/homework`、`/teacher/quiz`）**：
   - 验证草稿作业对学生不可见；发布作业后，确认题干、满分和标准 ID 被冻结锁定；关闭作业后，确认学生端禁止新增提交。
6. **学生草稿恢复与正式提交不可变（`/student/homework/:assignmentId`）**：
   - 编辑长文本（含中文、换行与特殊字符）不点击提交直接刷新或切页，检查自动草稿恢复是否完整；
   - 连续提交或同请求重试检查幂等性、多次 `attempt` 独立保留（第二次提交不覆盖第一次原文与 SHA256），且跨学生查看他人提交返回 `403`。
7. **教师 CSV 批量作答导入（`/teacher/homework/:assignmentId/submissions`）**：
   - 测试合法 `.csv`（`512KiB` 以内）预览与教师确认导入；尝试对**已关闭或逾期作业**执行补录导入，确认必须明确拦截。
8. **客观测验规则自动判分（`/student/quiz`）**：
   - 学生提交客观测验后，核对自动判分得分与未作答字段处理（未作答保持未交状态，不把整份未交强行伪造为 0 分学习结论）。
9. **Agent `learner_context` 隔离拦截（`/teacher/assistant`）**：
   - 在同一个助理会话中先让 Agent 读取学生作答或学情，再要求它调用出题或起草评分标准工具，确认系统已持久打标 `learner_context` 并明确阻止混用。

## 5. 给 AI 工具改 Bug 时的操作规范

- 开工前把 [AGENTS.md](../../AGENTS.md)、[四人分工总表](../team.md)、[接口契约](../contracts.md) 和本文档交给你的 AI 工具，每次只定位和修复清单中的 1 个具体问题。
- 从最新 `codex/integration` 拉个人小分支（如 `member/zhangjunchao/fix-xxx`）修改，遵守 [协作提交指南](../../CONTRIBUTING.md)，不覆盖他人修改。
- 提交 PR 前自测：跑通 `npm run typecheck && npm run build`、相关 Go 测试（含 `question_bank_test.go`、`submission_import_test.go`），在 PR 中写清复现步骤、交给下游的真实 `submission_id` 验证截图。

## 6. 最终汇报 4 要点与可用素材

- **汇报主线（约 3 分钟）**：① 承接与痛点：如何从课程资料出好“可核验、不污染历史成绩”的题目；② 纵向数据流：题库版本/三项确认 → 作业冻结引用 → 学生草稿与不可变提交 → 交付下游的 `submission_id`；③ 工程约束：版本冻结机制、逐点加和校验、`learner_context` 防出题泄露学生作答；④ 现场演示：正常出题确认发布并作答提交 + 拦截未确认标准入作业或已关闭作业禁止补录。
- **可直接放进 PPT 的现成素材**：
  - [题目与评分标准业务流程图](../diagrams/current/03_题目与评分标准_业务流程.png)
  - 对应脚本验证流程见 [自动演示说明](../auto-demo.md)（流程 4–6）
