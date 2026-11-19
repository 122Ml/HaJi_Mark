# 成员 A：徐铂尧 — 课程底座、资料解析与知识库 RAG

> 本文档既是你的**分工边界说明**，也是发给各自 AI 工具排查和修复 Bug 的**自查清单**。本轮整体平台功能由协作基线提供，后续由你亲自自查、修错并完成纵向答辩演示。

## 1. 你的纵向职责与上下游交接

你负责教学闭环的第一棒——**「教：课程内容与知识底座」**：
- **纵向主线**：创建/命名/发布课程、学生入课与事务建号 → 章节/小节/知识点三级目录与知识依赖 DAG → 上传原件（PDF/DOCX/PPTX/MD/HTML/CSV/公开网页快照）→ Worker 异步解析/OCR/视觉核对与人工修订 → 选段或全文发布学习资料 → AI 提炼知识候选、多专题比较与五种人工决策/确认入库 → pgvector + 中文全文 RRF 混合检索 → 学生阅读、完成记录、个人笔记与带引用问答。
- **交付给下家（张俊超 · 题库/作业）的真实对象**：已发布课程 `course_id`、知识点 `point_id`、已发布学习资料及其原文片段、已确认知识条目与出处引用。

## 2. 负责页面路由与代码边界

- **前端页面路由**：
  - 教师端：`/teacher/courses`、`/teacher/curriculum`、`/teacher/materials`、`/teacher/knowledge`、`/teacher/retrieval`
  - 学生端：`/student/course-content`、`/student/knowledge`、`/student/retrieval`
- **前端源码（`web/src/live/`）**：
  - `course-management.tsx`、`curriculum.tsx`、`curriculum-template.ts`、`graph.tsx`
  - `materials.tsx`、`material-assets.tsx`、`material-assist.tsx`
  - `content-topics.tsx`、`knowledge.tsx`、`knowledge-review.tsx`、`knowledge.css`
  - `retrieval.tsx`、`retrieval-history.tsx`、`course.tsx`、`notes.tsx`、`citations.tsx`
- **后端 Go 与 SQL**：
  - `backend/internal/learning/`：`course.go`、`curriculum.go`、`materials.go`、`assets.go`、`asset_crop.go`、`source_url.go`、`topics.go`、`knowledge_decisions.go`、`notes.go`、`scoped_search.go`、`assist.go`，以及 `path.go` 中**仅知识图谱 `/graph` 与 `/edges` 部分**
  - `backend/internal/rag/`：`retrieval.go`、`vision.go`、`web.go`、`workflows.go`
  - `backend/db/queries/`：`rag.sql`、`workflows.sql`（资料与知识段）、`course.sql`、`learning.sql`（课程/目录/资料/笔记段）
  - 对应 Agent 专家域：`materials`（原件导入审批、解析等待、资料发布、知识与检索工具）
- **责任入口**：[backend/internal/course/README.md](../../backend/internal/course/README.md)

## 3. 禁止越界与共享文件协调

- **不要改动**：独立题库/评分标准/作业提交（张俊超）、批阅工作台/整组重评/Agent 持久运行时/身份认证/公共样式（李然）、学情看板/学习路径/共性诊断/干预/互动/教研记录（葛炫毅）。
- **共享文件约束**：
  - `backend/internal/learning/path.go`：你只修改 `/graph`、`/edges` 与 `deleteEdge`，不动学生的学习路径 `/path`。
  - `backend/internal/learning/http.go`、`web/src/live/routes.tsx`、`web/src/live/types.ts`、`backend/config/models.json`、`web/src/styles/*`、`backend/internal/store/*`（`sqlc` 生成物）由 **李然** 协调修改。
  - 若需要新数据库迁移：**`00001—00019` 已使用，必须从 `00020` 起先向李然预约编号**，严禁修改已执行迁移。

## 4. 逐项自查挑错清单

按下面 8 条逐一在真实浏览器操作，记下报错、交互卡点或边界漏洞：

1. **课程管理与发布（`/teacher/courses`）**：
   - 新建课程与课程重命名是否严格拦截空值、空字符及超过 `200` 字节标题，未修改时保存按钮是否禁用；
   - 新建草稿（`draft`）课程在「发布课程」前，用学生账号登录是否确定不可见；点击「发布课程」后学生立即可见，重复发布正确返回 `409`。
2. **成员加入与新建学生账号（`/teacher/courses` → 课程成员）**：
   - 邀请不存在用户名是否提示 `404`、已加入用户是否提示 `409`；超过 `8` 名成员后搜索框是否出现并按姓名/用户名筛选；
   - 折叠面板「新建学生账号并加入本课程」验证用户名正则（3–64 位，禁空格）与密码 `12–72` 字节限制，新建后能否直接登录进课；点击成员姓名是否正确跳至 `/teacher/dashboard?student=<id>`。
3. **课程目录树（`/teacher/curriculum` 左侧）**：
   - 空课程一键「导入参考目录」（7 章骨架）是否正常展开，非空课程再次导入是否按 `409` 拦截；
   - 手动新增节点验证三级限制：`chapter` 不能挂父节点、`section` 只能挂 `chapter`、`point` 不能再挂子节点，以及新增子节点后父级是否自动展开。
4. **知识依赖图谱（`/teacher/curriculum` 右侧）**：
   - 添加先修边时是否只允许选择 `point` 知识点，且下拉选项是否已预先屏蔽自环、已有边及成环候选；
   - 构建链式与分叉边后，Kahn 拓扑分层是否清晰；关键词搜索节点是否自动保留其直接先修与直接后继；删除先修边确认弹窗与重排是否正常。
5. **原件导入、解析、视觉核对与修订发布（`/teacher/materials`）**：
   - 上传本地文件及公开网页/直链快照导入，检查 Worker 异步解析状态流转、公式/图表按需视觉核对（非手写）与教师修订保存；
   - 选中原件片段或全文发布为学习资料，确认未发布的草稿原件/资料对学生不可见，旧版历史可查。
6. **知识库提炼、多专题比较与 RAG 混合检索（`/teacher/knowledge`、`/teacher/retrieval`）**：
   - 原件未授权提炼（`allow_derived=false`）时能否正确阻断提炼；AI 提炼结果是否正确挂载 `evidence_fragment_ids` 对应原文；
   - 验证知识库五种人工决策（不采纳/合并/条件并存/替换/暂缓）与权限隔离（学生只检索到已发布资料和允许学习的公开确认知识），问答带引用追溯。
7. **学生端阅读与笔记（`/student/course-content`）**：
   - 打开/标记完成记录是否正确持久化与去重，刷新页面笔记与收藏是否保留，跨课程/跨账号访问是否被拒绝。
8. **Agent 资料导入协同（`/teacher/assistant`）**：
   - 尝试上传文本附件让助理导入原件：缺来源说明时是否触发问题卡追问，执行导入前是否弹出审批卡并等待解析终态完成。

## 5. 给 AI 工具改 Bug 时的操作规范

- 开工前把 [AGENTS.md](../../AGENTS.md)、[四人分工总表](../team.md)、[接口契约](../contracts.md) 和本文档交给你的 AI 工具，每次只排查和修改清单中的 1 个具体问题。
- 从最新 `codex/integration` 拉个人小分支（如 `member/xuboyao/fix-xxx`）修改，遵守 [协作提交指南](../../CONTRIBUTING.md)，不复制整仓库副本。
- 提交 PR 前自测：**前端**跑 `npm run typecheck && npm run build`，**后端**跑相关包测试（如 `learning`/`rag` 集成测试），并附上复现步骤、修改范围与界面截图。

## 6. 最终汇报 4 要点与可用素材

- **汇报主线（约 3 分钟）**：① 承接与痛点：如何从无结构讲义变成可追溯的知识图谱与向量库；② 纵向数据流：课程/目录/图谱 → 原件解析修订 → 知识提炼与检索落库 → 交付下游的已确认依据；③ 工程约束：图谱 DFS 防环、AI 提炼由服务端回填真实片段与许可核对、师生检索隔离；④ 现场演示：正常发布资料与检索问答 + 拦截成环或越权检索未发布内容。
- **可直接放进 PPT 的现成素材**：
  - [学习资料业务流程图](../diagrams/current/01_学习资料_业务流程.png)
  - [知识库业务流程图](../diagrams/current/02_知识库_业务流程.png)
  - 对应脚本验证流程见 [自动演示说明](../auto-demo.md)（流程 1–3）
