# 四人职责与协作边界

> **2026-11-19 更新**：按当前 `v0.2.0` + RAG/知识库 + 独立题库/整组重评 + 多 Agent 助理真实基线修订，直接替代早期 S1/replica 规划。当前跨模块完善不冒充任何成员的个人已完成贡献；账号仅核实李然为 `@122Ml`，其他成员 GitHub 账号与姓名对应关系仍待本人核实，不自动写入 `CODEOWNERS`。

本分工同时用于两件事：
1. **当下各自自查、挑错与提 PR 修 Bug**：按「教（内容与知识）→ 考（题库与作答）→ 评（评阅与重评）→ 改（学情与干预）」划分 4 条清晰边界，互不越界覆盖。
2. **最终答辩 4 人纵向接力汇报**：每人独立讲清自己那一段「输入 → 处理/AI 约束 → 落库状态机 → 交付下家对象 + 失败边界演示」。

---

## 一、四人纵向分工总表

| 成员 | 纵向主线（端到端闭环） | 前端路由与 `web/src/live` 范围 | 后端 Go 与 SQL 范围 | 对应 Agent 专家域 | 交付给下家的真实对象 |
| --- | --- | --- | --- | --- | --- |
| **徐铂尧**<br>（成员 A） | **课程底座、资料解析与知识库 RAG**<br>建课/发布、成员与建号 → 三级目录与 DAG 知识图谱 → 上传原件/网页快照、Worker 异步解析/OCR/视觉核对/修订 → 选段发布资料 → AI 提炼知识候选/多专题比较与五种人工决策/确认入库 → pgvector + 中文全文 RRF 混合检索 → 学生阅读、完成记录、笔记与带引用问答 | 路由：`/teacher/courses`、`/teacher/curriculum`、`/teacher/materials`、`/teacher/knowledge`、`/teacher/retrieval`、`/student/course-content`、`/student/knowledge`、`/student/retrieval`<br>文件：`course-management.tsx`、`curriculum.tsx`、`curriculum-template.ts`、`graph.tsx`、`materials.tsx`、`material-assets.tsx`、`material-assist.tsx`、`content-topics.tsx`、`knowledge.tsx`、`knowledge-review.tsx`、`knowledge.css`、`retrieval.tsx`、`retrieval-history.tsx`、`course.tsx`、`notes.tsx`、`citations.tsx` | `learning/`：`course.go`、`curriculum.go`、`materials.go`、`assets.go`、`asset_crop.go`、`source_url.go`、`topics.go`、`knowledge_decisions.go`、`notes.go`、`scoped_search.go`、`assist.go`、`path.go`（仅 `/graph` 与 `/edges`）<br>`rag/`：`retrieval.go`、`vision.go`、`web.go`、`workflows.go`<br>SQL：`rag.sql`、`workflows.sql`（资料/知识段）、`course.sql`、`learning.sql`（课程/目录/资料/笔记段） | `materials`（原件导入审批、解析等待、资料发布、知识与检索工具） | 已发布 `course_id`、知识点 `point_id`、已发布学习资料、已确认知识条目与原文片段 |
| **张俊超**<br>（成员 B） | **独立题库、评分标准与作业测验作答**<br>选定资料/知识依据 → 独立题库手工建题 / 整卷三题型拆分 / AI 起草题目、参考解答与逐点标准 → 三项分别人工确认 → 创建作业/客观测验并冻结题目版本、满分与标准版本 → 发布/关闭状态机 → 学生草稿自动保存、逐题正式提交（不可变 + SHA256）及教师 CSV 批量导入 → 客观测验自动判分 | 路由：`/teacher/question-bank`、`/teacher/homework`、`/teacher/homework/new`、`/teacher/homework/:assignmentId/edit`、`/teacher/quiz`、`/teacher/quiz/new`、`/teacher/homework/:assignmentId/submissions`、`/student/homework`、`/student/quiz`、`/student/homework/:assignmentId`<br>文件：`question-bank.tsx`、`rubrics.tsx`、`assessment.tsx`（列表、编辑、详情、提交名单，不含 `GradePage`）、`submission-import.tsx` | `learning/`：`question_bank.go`、`paper.go`、`rubrics.go`、`assessment.go`、`drafts.go`、`submission_import.go`、`submission_text.go`<br>`rag/`：`question_bank.go`<br>SQL：`question_bank.sql`、`rubrics.sql`、`completion.sql`（拆题/作答导入段）、`learning.sql`（作业/草稿/提交段） | `questions`（严格受 `learner_context` 隔离，禁止接触学生作答）及 `assessment` 中作业创建/CSV 作答导入部分 | 固定题目与标准版本的作业、不可变学生正式提交 `submission_id` 与 `attempt` 原文 |
| **李然**<br>（成员 C） | **有据评阅、变更重评、正式反馈 + Agent/公共底座**<br>三栏批阅工作台 → AI 逐点评阅草稿（服务端校验分值加和与引用）→ 教师逐点核对、草稿→确认→发布 → 学生正式分项反馈与 CSV 导出 → 来源/标准变更影响追踪 → 已关闭作业单题整组重评（保留旧成绩，统一发布）；另统筹多 Agent 持久运行时、权限/审批门禁与公共底座 | 路由：`/teacher/homework/submissions/:submissionId/grade`、`/student/homework/submissions/:submissionId/feedback`、`/teacher/content-impact`、`/teacher/regrades`、`/teacher/assistant`、`/student/assistant`、`/teacher/profile`、`/student/profile`<br>文件：`grading.tsx`、`assessment.tsx`（`GradePage`）、`content-impact.tsx`、`regrades.tsx`、`agent.tsx`、`agent-editor.tsx`、`agent.css`、`context.tsx`、`context-agent.tsx`、`account.tsx`、`ai-jobs.tsx`、`workflow-job.tsx`、`routes.tsx`、以及 `web/src/app/*`、`web/src/shared/*`、`web/src/styles/*` | `learning/`：`feedback.go`（评分/发布/导出段）、`regrade.go`、`account.go`、`workspace.go`、`http.go`（公共路由装配）<br>基础设施：`backend/internal/agent/*`、`backend/internal/identity/*`、`backend/internal/platform/*`、`backend/internal/server/*`<br>`rag/`：`models.go`、`jobs.go`、`agent.go`、`agent_stream.go`<br>SQL：`agent.sql`、`identity.sql`、`workspace.sql`、`workflows.sql`（影响/重评段） | `assessment`（评阅、重评、CSV 导出）及 `control` 协调运行时/权限审批门禁 | 唯一正式结果源 `released_revision_id`、逐知识点得分证据、正式反馈 CSV |
| **葛炫毅**<br>（成员 D） | **学情证据画像、路径推荐、共性诊断与干预复查**<br>汇总正式成绩与学习事件 → 班级/个人学情看板下钻与学生首页表现 → 规则学习路径 + AI 排序与偏好持久化 → 同题同标准失分作答共性问题诊断（服务端按 `evidence_ids` 还原原句、按人去重）→ 确认标签并下发补学/补练任务 → 核对下发后新证据复查结案（`reviewed`）→ 课程互动与教研/行业记录 | 路由：`/teacher/dashboard`、`/teacher/insight`、`/student/home`、`/student/learning`、`/teacher/intervention/*`、`/student/intervention/*`、`/teacher/interaction`、`/student/interaction`、`/teacher/research`、`/teacher/industry-intelligence`<br>文件：`insight.tsx`、`path.tsx`、`learning-gaps.tsx`、`interventions.tsx`、`intelligence.tsx`、`activity.tsx`、`communication.tsx`、`records.tsx` | `learning/`：`path.go`（学生学习路径 `/path`）、`feedback.go`（`overview`、`evidence`、`interventions`、`interactions`、`research`、`industry`）、`activity.go`、`intelligence.go`<br>`rag/`：`intelligence.go`<br>SQL：`intelligence.sql`、`learning.sql`（学情/干预/互动/教研段） | `learning`（学情概览、证据读取、路径生成、诊断/推荐任务、干预下发与复核、互动） | 共性难点结论、补学资源与补练方向反馈给课程与题库，闭合教学循环 |

> 各成员详细代码边界、逐项挑错清单与 AI 操作约束见独立交接文档：[徐铂尧](handoffs/course.md) · [张俊超](handoffs/assessment.md) · [李然](handoffs/grading.md) · [葛炫毅](handoffs/insight.md)（总览见 [成员分工与自查指南](handoffs/README.md)）。

---

## 二、严格边界与共享文件防冲突规则

1. **只改自己纵切面，不越界修改上下游逻辑**：
   - 不把其他三人的工作降为只画页面、只测数据或只写文档；每人都可以用自己的 AI 工具排查并修复自己模块的问题，但必须亲自跑通输入、状态流转、落库表与失败边界。
   - 跨模块需求或接口变更先核对 [接口契约](contracts.md) 与 [架构说明](architecture.md)，经上下游与负责人确认后再动代码。
2. **禁止各自擅自修改的共享基础清单**（需改动时统一由 **李然** 协调合入）：
   - 后端：`backend/internal/learning/http.go`、`backend/internal/server/*`、`backend/internal/identity/*`、`backend/internal/store/*`（`sqlc` 生成物）、`backend/config/models.json`、`go.mod` / `go.sum`
   - 前端：`web/package.json`、`web/package-lock.json`、`web/src/live/routes.tsx`、`web/src/live/types.ts`、`web/src/styles/*`
   - 工程与迁移：Docker Compose、GitHub Actions / CI 配置；**数据库迁移 `00001—00020` 已分配使用，新迁移必须从 `00021` 起先向李然预约编号，严禁修改已执行迁移**。
3. **共同编辑文件的模块内分区约定**：
   - `web/src/live/assessment.tsx`：**张俊超**负责作业/测验列表、编辑、详情与提交名单；**李然**仅负责其中的 `GradePage` 批阅视图。
   - `backend/internal/learning/path.go`：**徐铂尧**负责知识图谱 `/graph` 与 `/edges`；**葛炫毅**负责学生学习路径 `/path`。
   - `backend/internal/learning/feedback.go`：**李然**负责评分、发布与 CSV 导出；**葛炫毅**负责 `overview`、`evidence`、`interventions`、`interactions`、`research` 与 `industry`。
   - `backend/db/queries/learning.sql`：按各自查询名小段增改，禁止整文件覆盖；改动 SQL 后同步检查 `sqlc` 生成结果。
4. **Git 分支与 PR 流程**（详见 [协作提交指南](../CONTRIBUTING.md)）：
   - 从最新 `codex/integration` 拉取个人小分支（如 `member/姓名/模块-问题简述`），不创建 A/B/C/D 源码副本，不直接向 `main` 或 `codex/integration` 提交。
   - PR 写明复现步骤、修改范围、自测输入/输出与界面截图，经 `@122Ml` 审核且检查通过后合并。

---

## 三、横向职责与群内统一报障模板

### 横向协作关注点（不替代各自的纵向自查）
- **葛炫毅（项目协调、需求对齐与汇报串联）**：收集各人发现的跨模块阻塞、组织联调与答辩开场串联。
- **李然（AI 运行时、模型/评测规范与集成合并）**：把关权限/预算门禁、多 Agent 运行时与集成环境稳定，审核并合并 PR。
- **徐铂尧（数据底座、知识库与接口契约核对）**：核对课程/目录/知识库与上游基础数据一致性，配合校验跨模块引用契约。
- **张俊超（质量验收与可复现说明）**：梳理端到端正常/异常验收用例与可复现验证说明，保障演示路径可稳定复现。

### 发现问题时的群内报障模板（发群认领）

```text
【问题归属】成员 X（课程知识 / 题库作答 / 评阅重评Agent / 学情干预）
【页面路径】例如 /teacher/curriculum 或 /student/homework/xxx
【操作角色】教师 / 学生（账号及当前课程名）
【复现步骤】1. ... 2. ... 3. ...
【预期结果】...
【实际现象】报错文案 / 状态不对 / 样式异常（附截图或 Network 请求与状态码）
```

---

## 四、最终汇报串联结构（12–16 分钟 4 人接力）

1. **开场总述（葛炫毅，1 分钟）**：说明平台定位（以真实业务状态机与“人机协同确认”为核心，而非套壳聊天），展示 [全景架构图](diagrams/current/00_全景架构_实现状态.png)，引出「教 → 考 → 评 → 改」四段纵向主线。
2. **四人接力汇报（按 徐铂尧 → 张俊超 → 李然 → 葛炫毅 顺序，每人 3 分钟，统一 4 段结构）**：
   - **① 承接与痛点（15 秒）**：承接了上一位交来的什么对象，解决本环节什么教学痛点；
   - **② 纵向数据流与状态机（60 秒）**：页面 → HTTP / Worker 异步任务 → PostgreSQL 关键表与状态流转 → 传给下一位什么对象；
   - **③ 最核心的 1–2 个工程防呆/AI 约束（60 秒）**：AI 只出草稿、服务端强校验与防幻觉/越权/脏数据机制；
   - **④ 现场演示（60 秒）**：**1 条正常闭环 + 1 个真实失败/拦截边界**。
3. **收尾总结（李然，1 分钟）**：展示 [多 Agent 架构图](diagrams/agent/architecture.png) 说明运行时如何在不破坏任何业务校验的前提下打通四条线，并汇报 [自动演示脚本](auto-demo.md) 的 12 条端到端复验覆盖与坦诚边界（如手写公式未纳入、未做大规模高并发压测）。

### 汇报可直接复用的仓库图册与演示参考
- **徐铂尧（A）**：[学习资料业务流程](diagrams/current/01_学习资料_业务流程.png)、[知识库业务流程](diagrams/current/02_知识库_业务流程.png)、[自动演示流程 1–3](auto-demo.md)
- **张俊超（B）**：[题目与评分标准业务流程](diagrams/current/03_题目与评分标准_业务流程.png)、[自动演示流程 4–6](auto-demo.md)
- **李然（C）**：[内容变更与整组重评](diagrams/current/04_内容变更与整组重评.png)、[多 Agent 架构图](diagrams/agent/architecture.png)、[助理运行时说明](agent-harness.md)、[自动演示流程 7/10/11](auto-demo.md)
- **葛炫毅（D）**：[全景架构图](diagrams/current/00_全景架构_实现状态.png)、[交互时序图集](diagrams/interactions/README.md)、[自动演示流程 8/9/12](auto-demo.md)
