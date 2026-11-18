# HaJi Mark 开工入口

先读 README.md、docs/architecture.md、docs/team.md、docs/backlog.md，再沿工作区导航读取实际模块。

- 当前为真实师生平台完善阶段。活动入口是 web/src/live 与 backend/internal/learning；identity 提供数据库会话和权限，store 由 sqlc 生成。web/src/replica 保留历史复刻源码和目录模板，未作为活动业务路由，不能把 localStorage 演示当数据库事实。
- 保留 Go/Gin、React/TypeScript、PostgreSQL/pgvector、pgx/sqlc、Goose、Redis/Asynq、Docker Compose；一个应用内组织业务，不拆微服务。RAG worker 处理解析、索引、知识提炼、标准和评分草稿；Python 只是本地解析工具。
- 用户本轮授权跨原分工完善整个前后端；旧周计划和模块责任不阻止本轮改动。不冒充成员贡献、独立人工审核或教师验收。后续多人仍按纵向流程分支协作，共享入口先协调。
- 当前分支 codex/platform-completion；用户已授权将CO-01/AS-01适配合并并部署到154.201.71.22，以hajistudy.online提供服务。2026-11-19用户进一步明确授权将最新项目主体及各图同步服务器，并上传GitHub；沿当前分支非强制推送，不自动合并main或发送消息。原始交付及适配映射见references/contributions，部署入口见deploy/README.md。
- 历史平台阶段 AI 保持未配置。2026-11-11 用户已明确授权本地实现资料/知识库 RAG、提供百炼北京按量凭据并批准累计50元真实联调预算；仅本地启用，生产配置仍关闭。密钥保存在忽略的.local/model-secrets.env，不输出、不提交，不用固定样例伪装AI响应。
- RequireSession→RequireRole/RequireCourse；所有认证写请求再 RequireCSRF。对象 ID 要从数据库读取课程/学生归属，不只检查请求 body。学生不能读别人提交、笔记、路径、评分草稿，教师只能访问本人课程。
- 题目/标准发布后冻结，原始作答保存 attempt、assignment_version、原文 SHA256。评分新增修订，教师确认后单独发布；客观题使用教师答案规则判分。知识点表现只用已发布、去重结果，不把无证据当零分或能力概率。
- 资料修订新增版本并保留旧文，题目绑定确切 resource_id；干预关联学习/练习时验证下发之后的新证据。状态转换和相关写入在数据库事务中完成。
- 新增迁移不得修改已执行迁移；当前 00001—00016 已分配，后续从 00017 开始。先修改 db/queries，再用 sqlc 生成 store，不手改生成物。
- 独立题库入口是learning/question_bank.go、rag/question_bank.go和live/question-bank.tsx。题目/参考解答分别确认，题库标准归属确切题目版本；questions保留为作业实例，bank_question_version_id/bound_rubric_id固定组合，评分不能改绑。旧作业仍走原question_id归属，不重写历史。
- 逐点评分入口为 learning/rubrics.go、feedback.go 和 live/rubrics.tsx、grading.tsx；AI草稿任务在internal/rag，确认标准绑定题目，评分绑定当时标准及依据。规则私有，机械核对不代替教师语义复核。
- 资料/知识HTTP入口为learning/materials.go，页面为live/knowledge.tsx。原件、解析修订、学习资料发布、知识确认和索引空间分开；索引不能扩大权限，部分发布不允许下载完整原件。来源归档/撤回提炼许可须阻断派生知识未来检索，历史评分快照保留。
- 默认Compose运行人工平台，compose.rag.yaml仅本地显式启用RAG并加载忽略的密钥文件。生成模型与Embedding分开profile，空间绑定模型/维度/配置；不把所有提供商固定1024维。累计50元数据库预留预算，未知调用不当作免费自动重试。
- 验证优先 Docker；构建串行、分步输出。当前入口为 check-platform.py、check-platform-browser.cjs、check-workspace-browser.cjs、backend-test、backup.py 与 check_docs.py。测试保留有标签的业务数据，不清空表、不删除卷、不影响其他 Compose 项目。
- .env/.local/账号/备份不提交。历史 references 副本和三个原 SVG 保留。代码、文档、工作区 navigation 与实际状态随本轮结构同步维护。
- 不宣称生产就绪、90%视觉复刻或AI效果，除非有对应当前版本的证据；历史截图与旧SSIM不证明当前真实平台视觉。

- 2026-11-05交互改进先完成本地验收，随后用户明确要求发布公网；现网release为hajimark-workspace-f40872a-20261105（应用f40872a），AI仍关闭。URL course为课程上下文；editing.tsx提供账号/对象隔离的未保存编辑恢复，不能冒充服务端保存。workspace.go/workspace.sql承载分页队列与干预完成证据；学生草稿、评分草稿与未下发任务继续私有。

- 2026-11-05用户要求整理公网demo：旧13门测试课与4个辅助测试账号已清理；现为一门软件工程演示课程，保留jiaoshi/xuesheng及7个demo-student账号。docs/demo-walkthrough.md为当前展示入口，私密账号/备份/对象ID在忽略目录。复查优先只读，不将旧种子或写入式公网回归自动重跑到干净demo中；模拟成绩不代表真实教学效果。

- 2026-11-12本地三模块增量：topics/assets/source_url/knowledge_decisions/paper/workflow_jobs/regrade 分别承载专题、图像证据、网页快照、知识决定、整卷采纳、影响和整组重评；rag/workflows.go与vision.go只生成可核对候选。首轮视觉失败与显式重试均保留，不冒充独立教师验收。实际范围见docs/research/three-module-acceptance-2026-11-12.md。
- regrade_batches冻结关闭作业的一道题、每人最新正式提交、哈希、评分基线和统一规则；regrade_items逐份确认，事务整组发布。原绑定和旧结果不改写；进入重评管理后普通评分不能覆盖，后续更正仍另建批次。

- 中断模型调用：15分钟后孤儿reserved按预留额转unknown一次结算；生成类running转failed等待显式重试，parse/index保持幂等恢复。勿清零预算、自动重发未知生成或把unknown当未调用。

- 2026-11-12前端分区：courses管理课程/成员，curriculum维护目录/依赖，materials分原件与学习内容，knowledge独立，question-bank承接题目/标准/整卷拆题；旧course-twin按对象重定向。课程选择在顶栏，切课保持模块并清理对象参数；不展示联调账目/调试JSON。导航回归入口check-navigation-browser.cjs；人工演示账号与S1自动化数据分开，均只在忽略的.local保存。

- 2026-11-17本地对话助理入口是internal/agent、rag/agent.go和live/agent.tsx。协调者单层顺序委派四领域专家，工具只经identity.Gateway重走已授权业务路由，不开放SQL/shell/任意HTTP；浏览器写请求仍须CSRF。auto-review是确定性风险门禁，full-access不绕过正式确认／发布审批。作答／学情工具永久标记会话learner_context，随后禁止本会话出题与标准工具。运行和审批持久化到00013七张表；未知写操作不重放，未知模型调用不自动收费重试。自动等待业务任务真实终态，queued不能冒充完成。详见docs/agent-harness.md；验收入口check-agent.py、check-agent-browser.cjs和agent/service_test.go，真实模型共享原50元预算。

- 2026-11-17收口入口：learning/submission_import.go（单题CSV预览/确认/审计）、assist_turns及live/retrieval-history.tsx（本人问答历史）、completion.sql和agent/http.go（长历史游标分页）、live/learning-gaps.tsx（正式评分点缺口）及path.tsx（授权精炼知识关联）。导入追加不可变attempt，actor为教师，不能计为干预后的学生执行。新增00014；验收check-completion-browser.cjs，待定业务规则见docs/research/partial-completion-2026-11-17.md。

- 2026-11-17方案B：learning/intelligence.go与rag/intelligence.go承载规则候选AI排序、同题同标准的正式失分作答诊断；输入快照、任务、报告及偏好持久化。引用逐字核对、提议标签先维护再确认、正式证据变化禁止确认旧诊断。教师自编示例使用origin=teacher_example，无学生作答转换、无评分用途。agent-editor.tsx复用七类既有编辑器，返回回执由服务端重读，浏览器草稿不等于保存；学生上下文隔离仍适用。rag/agent_stream.go兼容SSE，完整校验后才执行工具，profile可禁流且不自动收费重试。迁移00015，验收check-intelligence-browser.cjs；自动生成并发布新补练仍未纳入。

- 2026-11-19工作区协同：context-agent.tsx在八类对象内复用助理，agent/context.go经Gateway校验引用并预先标记学生上下文；location-state.ts承接URL筛选。scoped_search.go只检索授权的已发布学习文本，不展开私有原件；手工发布与索引排队同事务。00016保存干预的正式诊断／作答来源，feedback.go验证当前证据。验收入口scripts/check-frontend-integration.cjs仅连接隔离18082；构造模型验证链路，不证明AI效果。逐项状态见docs/research/frontend-integration-2026-11-19.md。
