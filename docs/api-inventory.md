# 当前 API 全量清单

盘点日期：2026-11-26；注册入口内容 SHA256：`ceb0bff8d205028d21f18fd84f18bdf2aeba93e814a6796df1d10bbc61db0caa`。

共 **171 个 method + path**，方法统计：`{"GET": 70, "POST": 73, "DELETE": 7, "PUT": 20, "PATCH": 1}`。

依据 server.New 实际调用的注册入口展开角色循环；这是源码入口清单，不是线上调用量、生产启用证明或安全审计结论。

所有路径已展开 `/api/v1` 前缀。认证写请求使用CSRF；登录是独立公开入口。
learning课程路由还会核对课程授权；表中角色只概括路由层，业务处理器继续校验对象归属、发布状态、版本和所有权。
materials.go 中原件／知识／后台任务入口经过 h.rag 非空门禁；retrieval/status 可独立读取、已发布资料的 resource_id 文内检索不依赖模型。全课程智能检索与其他AI入口仍检查配置；路由注册不表示模型已配置。
Agent审批和业务状态转换分别执行；审批通过后仍走原业务路由。模型推理采用兼容SSE，events转发持久文本快照与业务事件；工具参数在完整流校验后执行。profile可禁用流式，同一次响应可兼容JSON，不自动重发收费请求。
写入后部分路径会附带排队索引；“同步业务处理”描述主响应，不表示完全没有后台副作用。

## server/router.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/health/live` | 进程存活探针 | 公开 | HTTP JSON；同步读取 | — | [inline:89](../backend/internal/server/router.go) |
| GET | `/api/v1/health/ready` | 数据库与Redis就绪探针 | 公开 | HTTP JSON；同步读取 | — | [inline:92](../backend/internal/server/router.go) |

## course/http.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/courses` | 公开已发布课程元数据 | 公开 | HTTP JSON；同步读取 | — | [inline:15](../backend/internal/course/http.go) |

## identity/session.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| POST | `/api/v1/sessions` | 登录并创建数据库会话 | 公开登录入口 | HTTP JSON；同步业务处理 | — | [login:213](../backend/internal/identity/session.go) |
| GET | `/api/v1/me` | 读取本人身份及CSRF令牌 | 本人会话 | HTTP JSON；同步读取 | — | [inline:216](../backend/internal/identity/session.go) |
| GET | `/api/v1/me/courses` | 列出本人可访问课程 | 本人会话 | HTTP JSON；同步读取 | — | [myCourses:220](../backend/internal/identity/session.go) |
| DELETE | `/api/v1/sessions/current` | 注销当前会话 | 本人会话 | HTTP JSON；同步业务处理 | 是 | [logout:221](../backend/internal/identity/session.go) |

## identity/context.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/student/courses/:courseID/context` | 角色路由下读取课程上下文 | student；课程归属 | HTTP JSON；同步读取 | — | [courseContext:14](../backend/internal/identity/context.go) |
| GET | `/api/v1/teacher/courses/:courseID/context` | 角色路由下读取课程上下文 | teacher；课程归属 | HTTP JSON；同步读取 | — | [courseContext:14](../backend/internal/identity/context.go) |
| POST | `/api/v1/student/courses/:courseID/access-check` | 权限检查示例；不执行业务写入 | student；课程归属 | HTTP JSON；同步业务处理 | 是 | [RequireCSRF:15](../backend/internal/identity/context.go) |
| POST | `/api/v1/teacher/courses/:courseID/access-check` | 权限检查示例；不执行业务写入 | teacher；课程归属 | HTTP JSON；同步业务处理 | 是 | [RequireCSRF:15](../backend/internal/identity/context.go) |
| GET | `/api/v1/student/users/:studentID/context` | 读取本人用户上下文；路由使用RequireSelf | 本人 | HTTP JSON；同步读取 | — | [inline:20](../backend/internal/identity/context.go) |

## learning/http.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| POST | `/api/v1/learning/courses` | 创建课程草稿 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createCourse:45](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/profile` | 修改本人资料 | 已登录；对象级权限按业务过滤 | HTTP JSON；同步业务处理 | 是 | [profile:46](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/password` | 修改本人密码 | 已登录；对象级权限按业务过滤 | HTTP JSON；同步业务处理 | 是 | [password:47](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID` | 读取当前课程及成员上下文 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [context:49](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/publish` | 发布课程 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [publishCourse:54](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/state` | 转换课程状态（草稿/发布/归档） | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [courseState:55](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID` | 修改课程名称 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [renameCourse:56](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/curriculum` | 导入课程目录 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [importCurriculum:57](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/points` | 创建目录节点/知识点 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createPoint:58](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/points/batch` | 事务性批量创建课程目录与知识点前置依赖 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createPointsBatch:59](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/points/:pointID` | 修改目录节点/知识点名称与说明 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [updatePoint:60](../backend/internal/learning/http.go) |
| DELETE | `/api/v1/learning/courses/:courseID/points/:pointID` | 删除无业务引用的目录节点/知识点 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [deletePoint:61](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/graph` | 读取目录与知识点依赖图 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [graph:62](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/edges` | 维护知识点依赖 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [edge:63](../backend/internal/learning/http.go) |
| DELETE | `/api/v1/learning/courses/:courseID/edges` | 删除知识点前置依赖关系 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [deleteEdge:64](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/path` | 读取本人学习路径 | 学生；本人/本课程 | HTTP JSON；同步读取 | — | [path:65](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/path` | 按已发布证据与前置关系生成规则学习路径（非模型调用） | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [planPath:66](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/members` | 查询选课成员 | 教师；本课程 | HTTP JSON；同步读取 | — | [members:67](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/members` | 添加选课关系 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [enroll:68](../backend/internal/learning/http.go) |
| DELETE | `/api/v1/learning/courses/:courseID/members/:studentID` | 将指定学生移出当前课程 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [removeMember:69](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/students` | 创建学生并加入课程 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createStudent:70](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/resources` | 读取可见学习资料 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [resources:71](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/resources` | 创建学习资料/新增资料修订 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createResource:72](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/resources/:id` | 修改草稿学习资料内容与定位 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [updateDraftResource:73](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/revisions` | 创建学习资料/新增资料修订 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createResource:74](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/publish` | 发布学习资料版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [publishResource:75](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/archive` | 归档学习资料版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [archiveResource:76](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/events` | 记录本人的资料学习事件 | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [event:77](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/events` | 读取可授权学习事件 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [events:78](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/activity` | 读取学习活动时间线 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [activity:79](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/notes` | 读取本人笔记 | 学生；本人/本课程 | HTTP JSON；同步读取 | — | [notes:80](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/resources/:id/note` | 保存本人资料笔记 | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [note:81](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments` | 读取可见作业 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assignments:82](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignment-worklist` | 读取作业工作清单 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assignmentWorklist:83](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/worklist` | 分页查询教师批阅队列 | 教师；本课程 | HTTP JSON；同步读取 | — | [submissionWorklist:84](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/interventions/:id/evidence` | 读取补学补练任务的完成证据 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [interventionEvidence:85](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/assignments` | 创建/修改未发布作业 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createAssignment:86](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/assignments/:id` | 创建/修改未发布作业 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createAssignment:87](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id` | 读取授权作业详情 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assignment:88](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/state` | 发布/关闭等作业状态转换 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [assignmentState:89](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/submissions` | 读取授权范围内的作答 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [submissions:90](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/roster` | 查询作业提交名单及未交情况 | 教师；本课程 | HTTP JSON；同步读取 | — | [roster:91](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/submissions` | 提交本人答案；客观题可按教师答案规则判分 | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [submit:92](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/imports` | 查询本作业教师导入审计 | 教师；本课程 | HTTP JSON；同步读取 | — | [submissionImports:93](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/import/:operation` | 预览核对或原子确认导入文本作答；保留来源与新attempt | 教师；本课程 | HTTP JSON；CSV预览哈希 → 显式确认 → 幂等整批事务 | 是 | [importSubmissions:94](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/questions/:questionID/draft` | 读取本人逐题草稿 | 学生；本人/本课程 | HTTP JSON；同步读取 | — | [draft:95](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/assignments/:id/questions/:questionID/draft` | 保存本人逐题草稿 | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [saveDraft:96](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/submissions/:id` | 读取授权作答详情与可见评阅结果 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [submission:97](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/questions/:id/rubrics` | 读取作业题目的评分标准版本 | 教师；本课程 | HTTP JSON；同步读取 | — | [rubrics:98](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/questions/:id/rubrics` | 保存作业题目标准草稿/采纳AI草稿 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createRubric:99](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/rubrics/:id/confirm` | 确认评分标准版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [confirmRubric:100](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/submissions/:id/revisions` | 保存评分修订/采纳AI评分草稿 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [grade:101](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/revisions/:id/state` | 确认或发布评分修订 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [gradeState:102](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/interventions` | 读取授权补学补练任务 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [interventions:103](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/interventions` | 创建补学补练任务草稿 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createIntervention:104](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/interventions/:id/state` | 按角色下发、提交完成、复核任务 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步业务处理 | 是 | [interventionState:105](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/interactions` | 读取课程答疑互动 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [interactions:106](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/interactions` | 按角色提交问题/回复 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步业务处理 | 是 | [createInteraction:107](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/overview` | 查询班级学情汇总 | 教师；本课程 | HTTP JSON；同步读取 | — | [overview:108](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/evidence` | 读取授权评分表现及证据 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [evidence:109](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assist` | 查询助教是否配置 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assistStatus:110](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/assist` | 幂等课程RAG问答；核对引用并保存本人历史 | 师生；本课程；按对象/可见性过滤 | HTTP同步；RAG＋非流式Chat；返回JSON | 是 | [assist:111](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assist/history` | 分页读取本人课程问答历史 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assistHistory:112](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/assist/history/:id` | 读取本人问答、引用快照及生成状态 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [assistTurn:113](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/research` | 读取教研记录 | 教师；本课程 | HTTP JSON；同步读取 | — | [research:114](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/research` | 新增/修改人工教研记录 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createResearch:115](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/research/:id` | 新增/修改人工教研记录 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createResearch:116](../backend/internal/learning/http.go) |
| DELETE | `/api/v1/learning/courses/:courseID/research/:id` | 删除教研记录 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [deleteResearch:117](../backend/internal/learning/http.go) |
| GET | `/api/v1/learning/courses/:courseID/industry` | 读取行业案例 | 教师；本课程 | HTTP JSON；同步读取 | — | [industry:118](../backend/internal/learning/http.go) |
| POST | `/api/v1/learning/courses/:courseID/industry` | 新增/修改人工行业案例 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createIndustry:119](../backend/internal/learning/http.go) |
| PUT | `/api/v1/learning/courses/:courseID/industry/:id` | 新增/修改人工行业案例 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createIndustry:120](../backend/internal/learning/http.go) |
| DELETE | `/api/v1/learning/courses/:courseID/industry/:id` | 删除行业案例 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [deleteIndustry:121](../backend/internal/learning/http.go) |

## learning/materials.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/models` | 查询模型profile及预算/调用台账（没有配置修改接口） | 教师；本课程 | HTTP JSON；同步读取 | — | [models:58](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/sources` | 查询原件列表 | 教师；本课程 | HTTP JSON；同步读取 | — | [sources:59](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID` | 读取原件及解析片段/指定历史片段版本 | 教师；本课程 | HTTP JSON；同步读取 | — | [sourceDetail:60](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources` | 上传原件并建立解析任务 | 教师；本课程 | multipart上传 → PG任务 → Asynq解析 | 是 | [uploadSources:61](../backend/internal/learning/materials.go) |
| PUT | `/api/v1/learning/courses/:courseID/sources/:sourceID/fragments` | 人工校正原文并创建解析修订 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [correctFragments:62](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/publish` | 选择原文片段发布为学习资料 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [publishFragments:63](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/archive` | 归档来源并限制未来使用 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [archiveSource:64](../backend/internal/learning/materials.go) |
| PUT | `/api/v1/learning/courses/:courseID/sources/:sourceID/derivation` | 设置或撤回知识提炼许可 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [sourceDerivation:65](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/download` | 下载原件；按资料发布范围/角色校验 | 师生；本课程；按对象/可见性过滤 | HTTP文件响应 | — | [downloadSource:66](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/stream` | 按视频类型与发布权限流式播放原件视频 | 师生；本课程；按对象/可见性过滤 | HTTP文件响应 | — | [streamSource:67](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/knowledge` | 读取权限允许的知识条目 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [knowledge:68](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/knowledge` | 新增/修改知识草稿或新版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveKnowledge:69](../backend/internal/learning/materials.go) |
| PUT | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID` | 新增/修改知识草稿或新版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveKnowledge:70](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID/state` | 知识确认等状态转换 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [knowledgeState:71](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/jobs` | 提交解析/索引/提炼/标准/评分/视觉等后台任务 | 教师；本课程 | HTTP JSON返回任务ID → Asynq → 前端轮询 | 是 | [createRAGJob:72](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/jobs` | 查询处理任务 | 教师；本课程 | HTTP JSON；后台状态读取/轮询 | — | [jobs:73](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/jobs/:jobID` | 读取任务状态与候选结果 | 教师；本课程 | HTTP JSON；后台状态读取/轮询 | — | [job:74](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/jobs/:jobID/cancel` | 请求取消后台任务 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [cancelJob:75](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/jobs/:jobID/retry` | 显式新建失败任务重试 | 教师；本课程 | HTTP JSON返回任务ID → Asynq → 前端轮询 | 是 | [retryJob:76](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/sections` | 查询原件当前解析版本的内容切分方案 | 教师；本课程 | HTTP JSON；同步读取 | — | [sections:77](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/sections/adopt` | 采纳 AI 生成的资料内容切分方案 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [adoptSegments:78](../backend/internal/learning/materials.go) |
| PUT | `/api/v1/learning/courses/:courseID/sources/:sourceID/sections/:sectionID` | 编辑待确认或已驳回的内容切分方案及时间码 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [updateSection:79](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/sections/state` | 批量接受或驳回资料内容切分方案 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [sectionsState:80](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/sections/publish` | 按已接受的内容切分方案批量发布学习资料 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [sectionsPublish:81](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/knowledge-points/:pointID/clips` | 按知识点查询未归档原件最新解析版本中已接受的内容及时间切片 | 教师；本课程 | HTTP JSON；同步读取 | — | [pointClips:82](../backend/internal/learning/materials.go) |
| POST | `/api/v1/learning/courses/:courseID/retrieval` | 按学习/评分/比较用途检索；可调用查询Embedding | 师生；本课程；按对象/可见性过滤 | HTTP同步；关键词/向量检索；可能调用Embedding | 是 | [retrieval:83](../backend/internal/learning/materials.go) |
| GET | `/api/v1/learning/courses/:courseID/retrieval/status` | 查询检索配置/索引状态 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [retrievalStatus:84](../backend/internal/learning/materials.go) |

## learning/question_bank.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/question-bank` | 查询独立题库 | 教师；本课程 | HTTP JSON；同步读取 | — | [questionBank:21](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank` | 创建题目或新题目版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveBankQuestion:22](../backend/internal/learning/question_bank.go) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/:bankID` | 读取题目与版本详情 | 教师；本课程 | HTTP JSON；同步读取 | — | [bankDetail:23](../backend/internal/learning/question_bank.go) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID` | 读取指定题库版本 | 教师；本课程 | HTTP JSON；同步读取 | — | [inline:24](../backend/internal/learning/question_bank.go) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/provenance` | 读取题目版本来源与证据 | 教师；本课程 | HTTP JSON；同步读取 | — | [bankProvenance:29](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/:bankID/versions` | 创建题目或新题目版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveBankQuestion:30](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/:bankID/archive` | 停用题库题目 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [archiveBank:31](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/confirm` | 确认题目版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [confirmBankQuestion:32](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/reference/confirm` | 单独确认参考解答 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [confirmBankReference:33](../backend/internal/learning/question_bank.go) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/rubrics` | 读取题目版本的标准 | 教师；本课程 | HTTP JSON；同步读取 | — | [bankRubrics:34](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/rubrics` | 保存题库标准草稿/采纳AI候选 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createBankRubric:35](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/jobs` | 提交出题/题目分析/题库标准草稿任务 | 教师；本课程 | HTTP JSON返回任务ID → Asynq → 前端轮询 | 是 | [createBankJob:36](../backend/internal/learning/question_bank.go) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/evidence` | 检索题目可用的评分依据 | 教师；本课程 | HTTP同步；关键词/向量检索；可能调用Embedding | 是 | [bankEvidence:37](../backend/internal/learning/question_bank.go) |

## learning/topics.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/topics` | 读取专题库 | 教师；本课程 | HTTP JSON；同步读取 | — | [topics:19](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/topics` | 新增/修改专题库 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveTopic:20](../backend/internal/learning/topics.go) |
| PUT | `/api/v1/learning/courses/:courseID/topics/:topicID` | 新增/修改专题库 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveTopic:21](../backend/internal/learning/topics.go) |
| DELETE | `/api/v1/learning/courses/:courseID/topics/:topicID` | 永久删除未被引用的专题 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [deleteTopic:22](../backend/internal/learning/topics.go) |
| PUT | `/api/v1/learning/courses/:courseID/content-links` | 维护专题、标签及知识点关联 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [contentLinks:23](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/decisions` | 读取知识加工决定 | 教师；本课程 | HTTP JSON；同步读取 | — | [decisions:24](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/search` | 搜索题库 | 教师；本课程 | HTTP JSON；同步读取 | — | [searchBank:25](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/url` | 抓取公开单页或直链文档后排队解析 | 教师；本课程 | HTTP JSON → 同步公开网页抓取 → 异步解析 | 是 | [importURL:26](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/assets` | 读取来源图片/公式/图表资产 | 教师；本课程 | HTTP JSON；同步读取 | — | [sourceAssets:27](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/assets/:assetID/revisions` | 保存人工识别校正或确认版本 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveAssetRevision:28](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/assets/:assetID/crop` | 裁剪所选图像资产 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [cropAsset:29](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID/decision` | 采纳/合并/条件并存/替换等知识决定 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [knowledgeDecision:30](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/suggestions/adopt` | 采纳目录/专题/关联建议 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [adoptSuggestions:31](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/paper/adopt` | 采纳经教师校正的整卷拆题结果 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [adoptPaper:32](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/impact` | 查询来源或知识变更影响 | 教师；本课程 | HTTP JSON；同步读取 | — | [impact:33](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/impact/decisions` | 保存影响处理决定 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [impactDecision:34](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/regrades` | 读取整组重评批次 | 教师；本课程 | HTTP JSON；同步读取 | — | [regrades:35](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/regrades` | 创建冻结作答与新版标准的重评批次 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [createRegrade:36](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/regrades/:batchID` | 读取重评批次详情 | 教师；本课程 | HTTP JSON；同步读取 | — | [regradeDetail:37](../backend/internal/learning/topics.go) |
| PUT | `/api/v1/learning/courses/:courseID/regrades/:batchID/items/:submissionID` | 保存/确认一份重评结果 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [saveRegradeItem:38](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/regrades/:batchID/state` | 整组发布等重评状态转换 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [regradeState:39](../backend/internal/learning/topics.go) |
| POST | `/api/v1/learning/courses/:courseID/regrades/:batchID/items/:submissionID/ai` | 按冻结的重评输入排队生成评分草稿 | 教师；本课程 | HTTP JSON返回任务ID → Asynq → 前端轮询 | 是 | [regradeAI:40](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/assets/:assetID/file` | 读取授权图像资产文件 | 师生；本课程；按对象/可见性过滤 | HTTP文件响应 | — | [assetFile:41](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/resources/:id/assets` | 读取学习资料关联资产 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [resourceAssets:42](../backend/internal/learning/topics.go) |
| GET | `/api/v1/learning/courses/:courseID/questions/:id/assets` | 读取作业题目关联资产 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [questionAssets:43](../backend/internal/learning/topics.go) |

## learning/intelligence.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/intelligence` | 读取本人的诊断或推荐历史 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [intelligenceList:28](../backend/internal/learning/intelligence.go) |
| POST | `/api/v1/learning/courses/:courseID/intelligence` | 冻结正式作答/规则候选并排队分析，按请求号幂等 | 师生；本课程；按对象/可见性过滤 | HTTP JSON → 冻结输入/报告/任务同事务 → Asynq模型分析 → 校验落库 → 轮询 | 是 | [intelligenceCreate:29](../backend/internal/learning/intelligence.go) |
| GET | `/api/v1/learning/courses/:courseID/intelligence/:reportID` | 读取本人报告，重查正式证据与推荐可见性 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步读取 | — | [intelligenceRead:30](../backend/internal/learning/intelligence.go) |
| PUT | `/api/v1/learning/courses/:courseID/intelligence/:reportID` | 保存或确认诊断；校验原句、标签、编辑版本和正式证据 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [diagnosisEdit:31](../backend/internal/learning/intelligence.go) |
| POST | `/api/v1/learning/courses/:courseID/intelligence/:reportID/confirm` | 保存或确认诊断；校验原句、标签、编辑版本和正式证据 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [diagnosisEdit:32](../backend/internal/learning/intelligence.go) |
| PUT | `/api/v1/learning/courses/:courseID/intelligence/:reportID/choice` | 保存本人推荐偏好；重新核验内容可用性 | 学生；本人/本课程 | HTTP JSON；同步业务处理 | 是 | [recommendationChoice:33](../backend/internal/learning/intelligence.go) |
| POST | `/api/v1/learning/courses/:courseID/intelligence/:reportID/cancel` | 取消本人的分析任务 | 师生；本课程；按对象/可见性过滤 | HTTP JSON；同步业务处理 | 是 | [intelligenceCancel:34](../backend/internal/learning/intelligence.go) |
| GET | `/api/v1/learning/courses/:courseID/diagnosis-labels` | 读取课程问题标签 | 教师；本课程 | HTTP JSON；同步读取 | — | [diagnosisLabels:35](../backend/internal/learning/intelligence.go) |
| POST | `/api/v1/learning/courses/:courseID/diagnosis-labels` | 教师维护问题标签及启停 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [diagnosisLabelSave:36](../backend/internal/learning/intelligence.go) |
| PUT | `/api/v1/learning/courses/:courseID/diagnosis-labels/:labelID` | 教师维护问题标签及启停 | 教师；本课程 | HTTP JSON；同步业务处理 | 是 | [diagnosisLabelSave:37](../backend/internal/learning/intelligence.go) |

## agent/http.go

| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |
|---|---|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/agent/status` | 读取可用模型、工具及运行上限 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | — | [status:29](../backend/internal/agent/http.go) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations` | 列出本人课程对话 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | — | [conversations:30](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations` | 新建对话 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | 是 | [createConversation:31](../backend/internal/agent/http.go) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID` | 读取消息、运行、步骤及问题卡 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | — | [conversation:32](../backend/internal/agent/http.go) |
| PATCH | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID` | 切换模型与权限模式（空闲时） | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | 是 | [options:33](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/messages` | 幂等提交消息并创建持久运行 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON返回run_id → PostgreSQL检查点 → 多Agent工具循环 | 是 | [send:34](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/attachments` | 上传会话私有附件 | 师生；本人对话；本课程；写入仍按业务身份授权 | multipart上传；私有文件卷＋数据库元数据 | 是 | [upload:35](../backend/internal/agent/http.go) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/attachments/:attachmentID/file` | 授权下载附件／反馈CSV | 师生；本人对话；本课程；写入仍按业务身份授权 | 授权HTTP文件响应 | — | [download:36](../backend/internal/agent/http.go) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/events` | 按游标重放运行事件并保持SSE连接 | 师生；本人对话；本课程；写入仍按业务身份授权 | 持久事件SSE；业务状态＋协调者文本快照；游标重放、心跳与重连 | — | [stream:37](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/runs/:runID/cancel` | 请求停止运行，保留已完成业务 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | 是 | [cancel:38](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/runs/:runID/resume` | 显式恢复可恢复检查点 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON；持久对话及权限门禁 | 是 | [resume:39](../backend/internal/agent/http.go) |
| POST | `/api/v1/learning/courses/:courseID/agent/requests/:requestID/respond` | 提交问题答案或批准／拒绝具体操作 | 师生；本人对话；本课程；写入仍按业务身份授权 | HTTP JSON → 参数／业务快照核验 → 恢复原运行 | 是 | [respond:40](../backend/internal/agent/http.go) |
