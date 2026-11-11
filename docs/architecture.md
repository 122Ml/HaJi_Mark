# 架构与实现边界

2026-10-28 · 本地整个平台完善。当前实现以本页和 [接口契约](contracts.md) 为准；旧立项范围与历史复刻证据保留在 references 和 research。

2026-11-11本地已接入独立题库、AI出题／分析／标准草稿、逐点依据和作业固定版本；[题库方案](research/question-bank-rubric-plan.md)保留设计与实施范围对照。公网仍为旧版，以下历史实现未迁移或重写既有成绩。

题库HTTP在`learning/question_bank.go`，生成与规则验证在`rag/question_bank.go`，页面在`live/question-bank.tsx`。`question_bank`保存稳定身份和停用状态，`bank_question_versions`保存不可变内容版本及题目/参考解答的独立确认状态；`rubric_versions`以互斥归属兼容旧作业题与新题库版本。`questions`仍是作业实例，固定题目版本和标准ID。题库父行锁串行化新增版本、确认与停用，作业事务再次核对选用组合及发布条件。

来源／知识的现有索引通过课程、状态、用途和来源许可核对后形成所选依据快照，最多8条、8000字；客户端不能传正文冒充依据。AI任务只接收教师要求、题干、参考解答和选中依据，输出先作草稿，题目、参考解答、标准分别确认。评分只按已绑定标准及快照，不临时检索新增扣分点；新标准不影响旧任务。学生仅从发布作业取得题干和选项，不能读题库、参考解答或内部标准。代码题按文本评阅，不执行代码。

## 主流程与调用链

教师发布课程、审核资料、发布作业/测验 → 学生阅读/笔记/作答 → 原文提交 → 客观题规则结果或教师评分草稿 → 教师确认并发布 → 学生反馈与知识点表现 → 规则学习路径或教师补学补练任务 → 新学习/新提交 → 教师复查。

```mermaid
flowchart LR
  Web[web/src/live 师生页面] --> Session[shared/session 与 identity]
  Session --> API[learning 已授权业务接口]
  API --> SQL[sqlc/store]
  SQL --> DB[(PostgreSQL)]
  API --> Evidence[已发布结果与学习记录]
  Evidence --> Path[规则路径 / 教师干预]
  Path --> Web
```

`App.tsx` 装配角色路由、顶栏与分组侧栏；`app/navigation.ts` 管理导航分组，`app/Login.tsx` 提供活动登录页，`app/theme.ts` 与 `styles.css` 管理设计变量，`shared/ui.tsx` 提供页头与加载/空/错误状态组件。重复概览/课程地址通过 `live/routes.tsx` 重定向到角色规范入口，具体映射和截图见 [设计指南](../design.md)。

`LearningProvider` 读取本人课程，URL 的 `course` 优先于浏览器记忆；对象深链、侧栏和跨模块返回保留课程。不存在或无权限的课程明确报错。Query 缓存来自 API，写入后只取消并刷新当前课程的关联查询。`editing.tsx` 将未保存编辑按账号和对象暂存在 sessionStorage，供失败或离页后恢复；正式草稿、提交、评分和状态仍以服务端为准。身份切换清空查询缓存，401 回到会话检查。页面异常边界允许重新加载。

## 模块位置

| 位置 | 当前职责 |
| --- | --- |
| backend/internal/identity | bcrypt、8小时数据库会话、角色/课程/本人权限、CSRF与登录频率限制 |
| backend/internal/learning | 课程/目录/资料/成员，作业/提交/评分，学情/路径/干预，互动和账号、教研/行业记录 |
| backend/internal/store；backend/db | sqlc类型查询，Goose迁移00001—00010；原文和修订的唯一事实源 |
| web/src/live | course/curriculum/graph/notes、assessment、insight/path、communication、account、assistant |
| web/src/shared | API、会话与错误恢复；原课程示例保留但不作为活动主入口 |
| backend/internal/course | 兼容公开的已发布课程摘要；不包含学生数据 |
| backend/internal/assessment、grading、insight；web/src/features | 原责任入口与文档，实际共享实现定位到 learning/live；没有重复业务服务 |
| web/src/replica | 历史26页复刻源码、旧登录页和课程目录模板；原演示与全量旧样式不再挂到活动路由 |

本轮为跨模块完整实现，集中在 learning 以避免同时造四套身份/状态处理；后续按真实协作需求渐进拆分，不凭目录名称宣称模块已实现。原纵向负责人见 [team](team.md)，不代记贡献。

## 运行与数据

Compose 运行 Nginx Web、Gin API、PostgreSQL/pgvector、Redis、worker；migrate 一次性执行，API就绪后Web启动。仅Web绑定 `127.0.0.1:18080`，数据库/API/Redis无宿主端口。Nginx通过Docker DNS更新API地址，保留Host端口供同源校验；API有读写/空闲超时。普通教学写入仍同步事务提交；启用本地RAG配置后，数据库processing_jobs持久记录配合Asynq执行耗时任务。

| 对象 | 实际状态与版本 |
| --- | --- |
| Course / Resource | draft→published；资源审核发布，修订新增 v+1 并链到旧ID，旧资料仍可查 |
| Curriculum | chapter/section/point＋parent_id，知识点依赖有向无环；空课程可原子导入参考目录 |
| Assignment / Question | draft可编辑并递增版本；published→closed；发布后题目/标准冻结 |
| AnswerDraft / Submission | 私人草稿可更新；每题正式提交新attempt，原文/哈希/作业版本不可覆盖，截止或关闭后拒绝新提交 |
| RubricVersion | 单题标准draft→confirmed；criteria为JSONB评分点列表，确认版本不原地修改；旧评分继续绑定原标准 |
| GradingRevision | draft→confirmed→released；每次改分新增修订，仅最新可确认/发布；客观规则直接产生released |
| Evidence | 每学生/题目选择最新有发布结果的attempt，再取其最新released修订；新未评分attempt不会抹去旧正式结果 |
| StudyPath | 按无证据或表现低于60%的知识点及其前置依赖生成，保存顺序/理由/规则版本，不把规则称为模型预测 |
| Intervention | draft→assigned→submitted→reviewed；关联资源须有下发后completed，关联作业须逐题有下发后新提交 |

提交与评分使用 request_id 去重；并发提交/评分通过行锁串行分配版本。其他状态转换使用预期旧状态条件。学生看不到评分草稿、内部标准答案和他人原文/笔记/路径。所有业务对象重新核对课程归属；角色路由不是权限边界。

CO-01/AS-01已按[贡献映射](../references/contributions/README.md)适配到learning/live。资料来源同时支持source_note说明和source_url链接，新增资料至少具备一项；locator必填。00008保留历史原文并增加学习对象版本，正式提交与submission.submitted事件同事务落库，已有提交回填对应历史事件；重试不多写事件。/activity用于本人或教师授权学生时间线；/assignments/:id/roster按选课名单返回已交/部分/未交，与评分独立。

公网运行使用[独立生产Compose](../deploy/README.md)，OpenResty终止HTTPS→回环Web→API，数据库与Redis只在私网。PUBLIC_ORIGIN绑定公网HTTPS来源，Secure cookie；本地Compose仍沿用本地HTTP配置。AI保持关闭。

## 评据与未完成范围

教师评分同屏查看冻结题目标准、学生原文、资料版本/段落/来源；已发布结果保留submission/revision/resource ID。资料由教师录入并审核，平台不证明内容的学术正确性。知识点表现为得分/满分汇总并展示证据，不等于真实能力；无记录显示证据不足。

2026-11-11用户已授权本地RAG和真实模型联调，具体边界见下节；默认配置和公网仍关闭模型。原文引用按字符串定位并高亮首次匹配，保留中文、emoji和换行；尚无带位置编号的多处同文消歧。知识点图谱为依赖卡片，教研和行业功能为人工记录CRUD，没有招聘采集/自动能力推断；视频处理未实现。班级表现与证据下钻已经可用，E4错因分类与独立教学效果评测仍是后续研究任务。

公网域名采用OpenResty/Let's Encrypt TLS，邮件/找回密码和多机构管理仍未配置，未做大规模并发/安全审计。当前按课堂试用验收，不声称与参考平台所有高级菜单或视觉完全等价。备份与隔离恢复见 [development](development.md)，历史三图保留在 references/diagrams。


## 2026-11-05 工作台交互（仅本地）

- `live/grading.tsx`：教师队列／原文／评分三栏，当前评分默认可见；修改复制当前版本，历史进抽屉。队列按学生与状态筛选、服务端分页、跨页上一份/下一份。切换有未保存编辑时提示，学生只读已发布结果。
- `live/assessment.tsx`、`notes.tsx`：逐题自动保存（900ms）和笔记自动保存（1200ms），保留保存状态、失败重试、当前会话恢复；旧保存响应不能将后续编辑标成已保存。正式提交单独确认并显示attempt回执，历史折叠。
- `live/course.tsx`：教师课程分为内容与目录、作业与标准、学生与进度、课程设置；目录树筛选，资料编辑/修订使用抽屉。资料深链定位具体版本。
- `live/insight.tsx`、`interventions.tsx`：班级/个人/证据分区；从具体反馈携带学生、作答与知识点进入任务创建。任务说明保留可读的关联作答编号，界面将其呈现为原文链接；它是上下文线索，不参与权限或评分计算。完成条件及新证据由后端查询，浏览器禁用按钮只是提示，最终转换仍由事务验证。
- `learning/workspace.go`、`db/queries/workspace.sql`：作业个人进度、提交队列的分页查询，以及干预下发后的学习/提交证据。沿既有课程和对象授权，学生无法查看他人任务、未下发任务或教师队列。无新迁移，未启用Redis评分任务或模型。

```mermaid
flowchart LR
  C[课程上下文与对象URL] --> A[作业与提交列表]
  A --> Q[教师批阅队列]
  Q --> R[原文 / 当前标准 / 评分编辑]
  R --> H[保存修订 → 确认 → 发布]
  H --> S[学生正式反馈]
  H --> E[班级 / 个人评分证据]
  E --> I[指定学生的补学补练任务]
  I --> L[具体资料与逐题作答]
  L --> N[下发后新学习 / 新提交]
  N --> T[完成条件核对 → 教师复查]
  S --> L
```

本次先完成本地Docker验收；随后按用户明确要求发布到公网hajistudy.online，release为hajimark-workspace-f40872a-20261105。部署与数据保全证据见验证记录。

## 资料与知识库

学习资料保存完整学习内容；知识库保存带条件、用途与出处的精炼条目。共享来源和检索能力，不共用发布状态。旧文本/外链资料继续有效；链接只保存地址，不等于已抓取网页全文。

```mermaid
flowchart TB
  File[教师：课程文件＋来源＋提炼许可] --> Source[原件：哈希 / 来源版本 / 文件卷]
  Source --> Parse[异步解析：正文 / 表格 / 中文OCR / 位置]
  Parse --> Review[教师：核对异常 / 校正原文 → 新修订]
  Parse --> Ready[可靠原文片段]
  Review --> Ready
  Ready --> Publish[教师：选择章节或全文发布]
  Publish --> Material[学习资料：正文 / 来源 / 阅读与笔记]
  Ready --> Index[分块 → Embedding与关键词索引]
  Ready --> Extract[按需AI：提炼 / 分类 / 条件 / 关联建议]
  Extract --> Draft[知识候选：逐字出处 / 关联知识点 / 相关条目]
  Draft --> Human[教师：编辑 / 比较 / 确认]
  Human --> KB[确认知识：学习用途 / 评分用途 / 可见性]
  KB --> Index
  Index --> Access[课程＋发布＋用途权限过滤 / RRF融合]
  Access --> Search[检索与带引用问答]
  Access --> Rubric[题目 → AI独立起草标准]
  Rubric --> Confirm[教师编辑确认标准 / 冻结依据]
  Answer[不可变学生作答] --> Grade[AI逐点评阅草稿 / 原文核对]
  Confirm --> Grade
  Grade --> Release[教师修改 / 确认 / 发布]
  Release --> Student[学生反馈 / 学情与后续补学]
  Material --> Student
  KB --> Student
```

`learning/materials.go`复用课程/角色/CSRF，`internal/rag`负责模型、检索与任务，`tools/parser/parse.py`仅做文件解析，`live/knowledge.tsx`提供资料核对、知识审核、检索、模型草稿界面。标准起草只接收题目和评分用途依据；评阅接收冻结题目、作答哈希、确认标准和当时依据，禁止检索追加扣分项。AI输出不自动改写教师编辑，不直接生成正式成绩。

```mermaid
flowchart LR
  Browser[React师生页面] --> API[Gin：会话 / 课程 / CSRF]
  API --> PG[(PostgreSQL：版本 / 权限 / 任务 / 预算)]
  API --> Volume[(资料原件持久化卷)]
  API --> Queue[(Redis / Asynq)]
  Queue --> Worker[Go worker：单任务执行 / 取消 / 恢复]
  Worker --> Parser[Python：原生格式解析 / RapidOCR CPU]
  Parser --> Volume
  Worker --> PG
  PG --> Recovery[15秒扫描待执行 / 过期租约]
  Recovery --> Queue
  Worker --> Provider[服务端模型profile → 百炼或兼容接口]
  API --> Provider
  Provider --> Vector[(pgvector：独立模型与维度空间)]
  PG --> FTS[gse / simple全文检索 / GIN]
  Vector --> RRF[RRF 60：两路各20 → 最多6段]
  FTS --> RRF
  RRF --> API
```

向量从精确余弦检索起步，尚无HNSW或reranker。分块目标约800字、上限1200 Unicode字符；单次上下文最多4000字符。空间指纹包括profile、实际地址、模型、维度与分块版本；完整建索引成功才切换活动空间。供应商别名不当作不可变模型版本。兼容协议适配验证条数、index重排、维度、有限值和非零向量；专有协议需另写适配器。

原件保存SHA256；解析修订和资料发布绑定不可变片段。扫描/OCR与图表提示标为待核，核对前不能发布、提炼或索引。定位为PDF页、DOCX内容块/表格、PPTX幻灯片/对象及文本段落；未实现PDF精确框选坐标、Office版式还原、公式/复杂图表/手写语义、网页抓取和视频。部分发布不允许整件下载。已公开的旧原文片段仍可供历史引用；归档来源或撤回提炼许可会立即限制派生知识未来检索，历史评分不覆盖。

模型任务由数据库保存输入/输出和状态，队列可恢复补投；失败显式创建新任务重试，不把超时视为免费。调用前全局事务预留50元预算，成功按配置保守费率与Token结算，未知调用保留预留额。供应商真实账单、其他应用调用及价格变化不由本地预算控制。模型密钥只由API/worker环境变量读取，浏览器只得到脱敏profile。

2026-11-11自检补强：原文修订、知识状态变更与索引请求同事务保存；解析失败保留旧可用修订。解析/提炼/索引提交时锁定任务核对running及attempt，取消后不写最终结果或激活空间。Asynq以15秒Unique锁限制重复投递，数据库claim负责执行去重，恢复扫描也为15秒；不以长时间保留的固定TaskID阻断补投。该机制不是供应商调用的严格exactly-once保证。

知识确认携edit_version，拒绝确认未审核的新编辑；完整原件发布拒绝重复片段ID并锁定来源校验全体片段。AI草稿页按对象从持久任务恢复，教师可查看标准和评分所用的冻结依据；问答正文R标记与逐字引用列表交叉核对。引用存在和机械校验通过仍不证明语义正确。
