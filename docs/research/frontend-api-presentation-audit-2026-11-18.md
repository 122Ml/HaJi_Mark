# 前后端业务承接清单（155个注册入口）

日期：2026-11-18。关联[完整业务链调研](frontend-business-chain-audit-2026-11-18.md)。

2026-11-19：以下保留审计时的入口职责与缺口描述；后续修复、同页承接和逐项验收以[协同修正记录](frontend-integration-2026-11-19.md)为准。重新生成的当前注册事实源为[API清单](../api-inventory.md)。

本表穷举当前注册入口，并标记其应由哪个活动界面承接。它是源码级职责映射，不是155个接口均已动态调用、每项都有独立按钮或每个写入都已验收。F编号对应主报告发现；基础设施和身份示例无需强塞业务导航。

| 业务族 | 注册入口数 |
|---|---:|
| 基础设施 | 2 |
| 公开课程元数据 | 1 |
| 课程与身份 | 10 |
| 身份上下文与示例门禁 | 5 |
| 目录与路径 | 6 |
| 成员 | 3 |
| 学习资料 | 6 |
| 笔记与活动 | 3 |
| 作业与测验 | 11 |
| 批阅与正式反馈 | 7 |
| 干预 | 4 |
| 作答导入 | 2 |
| 课程互动 | 2 |
| 学情 | 2 |
| 检索与问答 | 6 |
| 教研与行业 | 8 |
| 模型与任务 | 6 |
| 资料导入与原文 | 9 |
| 知识 | 5 |
| 题库 | 14 |
| 专题、审计与建议 | 7 |
| 图文资产 | 6 |
| 内容影响与重评 | 8 |
| 智能分析与推荐 | 10 |
| Agent运行时 | 12 |
| 合计 | 155 |

## 基础设施

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/health/live` | 运维健康检查，无需业务按钮 | 有意无业务页入口 | [inline:26](../../backend/internal/server/router.go#L26) |
| GET | `/api/v1/health/ready` | 运维健康检查，无需业务按钮 | 有意无业务页入口 | [inline:29](../../backend/internal/server/router.go#L29) |

## 公开课程元数据

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/courses` | 公开数据入口 | 不作为学生选课／教务闭环已完成的证明 | [inline:15](../../backend/internal/course/http.go#L15) |

## 课程与身份

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| POST | `/api/v1/sessions` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [login:92](../../backend/internal/identity/session.go#L92) |
| GET | `/api/v1/me` | 登录会话读取 | 基础会话接口 | [inline:95](../../backend/internal/identity/session.go#L95) |
| GET | `/api/v1/me/courses` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [myCourses:99](../../backend/internal/identity/session.go#L99) |
| DELETE | `/api/v1/sessions/current` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [logout:100](../../backend/internal/identity/session.go#L100) |
| POST | `/api/v1/learning/courses` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [createCourse:30](../../backend/internal/learning/http.go#L30) |
| PUT | `/api/v1/learning/profile` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [profile:31](../../backend/internal/learning/http.go#L31) |
| PUT | `/api/v1/learning/password` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [password:32](../../backend/internal/learning/http.go#L32) |
| GET | `/api/v1/learning/courses/:courseID` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [context:34](../../backend/internal/learning/http.go#L34) |
| POST | `/api/v1/learning/courses/:courseID/publish` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [publishCourse:39](../../backend/internal/learning/http.go#L39) |
| PUT | `/api/v1/learning/courses/:courseID` | 课程管理、顶部课程切换、登录和个人设置 | 已有界面；基础对象管理，不等于后续教学链闭环 | [renameCourse:40](../../backend/internal/learning/http.go#L40) |

## 身份上下文与示例门禁

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/student/courses/:courseID/context` | SessionCourses诊断组件及权限示例 | 不应因未放入主业务导航认定功能漏做；本轮非完整安全审计 | [courseContext:14](../../backend/internal/identity/context.go#L14) |
| GET | `/api/v1/teacher/courses/:courseID/context` | SessionCourses诊断组件及权限示例 | 不应因未放入主业务导航认定功能漏做；本轮非完整安全审计 | [courseContext:14](../../backend/internal/identity/context.go#L14) |
| POST | `/api/v1/student/courses/:courseID/access-check` | SessionCourses诊断组件及权限示例 | 不应因未放入主业务导航认定功能漏做；本轮非完整安全审计 | [RequireCSRF:15](../../backend/internal/identity/context.go#L15) |
| POST | `/api/v1/teacher/courses/:courseID/access-check` | SessionCourses诊断组件及权限示例 | 不应因未放入主业务导航认定功能漏做；本轮非完整安全审计 | [RequireCSRF:15](../../backend/internal/identity/context.go#L15) |
| GET | `/api/v1/student/users/:studentID/context` | SessionCourses诊断组件及权限示例 | 不应因未放入主业务导航认定功能漏做；本轮非完整安全审计 | [inline:20](../../backend/internal/identity/context.go#L20) |

## 目录与路径

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| POST | `/api/v1/learning/courses/:courseID/curriculum` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [importCurriculum:41](../../backend/internal/learning/http.go#L41) |
| POST | `/api/v1/learning/courses/:courseID/points` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [createPoint:42](../../backend/internal/learning/http.go#L42) |
| GET | `/api/v1/learning/courses/:courseID/graph` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [graph:43](../../backend/internal/learning/http.go#L43) |
| POST | `/api/v1/learning/courses/:courseID/edges` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [edge:44](../../backend/internal/learning/http.go#L44) |
| GET | `/api/v1/learning/courses/:courseID/path` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [path:45](../../backend/internal/learning/http.go#L45) |
| POST | `/api/v1/learning/courses/:courseID/path` | 课程目录；学生学习路径 | 规则路径与目录已有界面；AI推荐另见智能分析 | [planPath:46](../../backend/internal/learning/http.go#L46) |

## 成员

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/members` | 课程管理／成员 | 已有成员管理；可进入学生看板 | [members:47](../../backend/internal/learning/http.go#L47) |
| POST | `/api/v1/learning/courses/:courseID/members` | 课程管理／成员 | 已有成员管理；可进入学生看板 | [enroll:48](../../backend/internal/learning/http.go#L48) |
| POST | `/api/v1/learning/courses/:courseID/students` | 课程管理／成员 | 已有成员管理；可进入学生看板 | [createStudent:49](../../backend/internal/learning/http.go#L49) |

## 学习资料

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/resources` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [resources:50](../../backend/internal/learning/http.go#L50) |
| POST | `/api/v1/learning/courses/:courseID/resources` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [createResource:51](../../backend/internal/learning/http.go#L51) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/revisions` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [createResource:52](../../backend/internal/learning/http.go#L52) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/publish` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [publishResource:53](../../backend/internal/learning/http.go#L53) |
| POST | `/api/v1/learning/courses/:courseID/resources/:id/events` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [event:54](../../backend/internal/learning/http.go#L54) |
| GET | `/api/v1/learning/courses/:courseID/events` | 学习资料／学习内容；学生课程学习 | F05/F06/F12：阶段反馈、手工资料索引和问答上下文 | [events:55](../../backend/internal/learning/http.go#L55) |

## 笔记与活动

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/activity` | 学习资料内笔记；概览时间线 | 已有内嵌入口；按本人或授权范围读取 | [activity:56](../../backend/internal/learning/http.go#L56) |
| GET | `/api/v1/learning/courses/:courseID/notes` | 学习资料内笔记；概览时间线 | 已有内嵌入口；按本人或授权范围读取 | [notes:57](../../backend/internal/learning/http.go#L57) |
| PUT | `/api/v1/learning/courses/:courseID/resources/:id/note` | 学习资料内笔记；概览时间线 | 已有内嵌入口；按本人或授权范围读取 | [note:58](../../backend/internal/learning/http.go#L58) |

## 作业与测验

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/assignments` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [assignments:59](../../backend/internal/learning/http.go#L59) |
| GET | `/api/v1/learning/courses/:courseID/assignment-worklist` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [assignmentWorklist:60](../../backend/internal/learning/http.go#L60) |
| POST | `/api/v1/learning/courses/:courseID/assignments` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [createAssignment:63](../../backend/internal/learning/http.go#L63) |
| PUT | `/api/v1/learning/courses/:courseID/assignments/:id` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [createAssignment:64](../../backend/internal/learning/http.go#L64) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [assignment:65](../../backend/internal/learning/http.go#L65) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/state` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [assignmentState:66](../../backend/internal/learning/http.go#L66) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/submissions` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [submissions:67](../../backend/internal/learning/http.go#L67) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/roster` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [roster:68](../../backend/internal/learning/http.go#L68) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/submissions` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [submit:69](../../backend/internal/learning/http.go#L69) |
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/questions/:questionID/draft` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [draft:72](../../backend/internal/learning/http.go#L72) |
| PUT | `/api/v1/learning/courses/:courseID/assignments/:id/questions/:questionID/draft` | 作业中心、测验、作业编辑与详情 | F11：选题异常缺少原位修复；已有版本固定及草稿机制 | [saveDraft:73](../../backend/internal/learning/http.go#L73) |

## 批阅与正式反馈

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/worklist` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [submissionWorklist:61](../../backend/internal/learning/http.go#L61) |
| GET | `/api/v1/learning/courses/:courseID/submissions/:id` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [submission:74](../../backend/internal/learning/http.go#L74) |
| GET | `/api/v1/learning/courses/:courseID/questions/:id/rubrics` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [rubrics:75](../../backend/internal/learning/http.go#L75) |
| POST | `/api/v1/learning/courses/:courseID/questions/:id/rubrics` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [createRubric:76](../../backend/internal/learning/http.go#L76) |
| POST | `/api/v1/learning/courses/:courseID/rubrics/:id/confirm` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [confirmRubric:77](../../backend/internal/learning/http.go#L77) |
| POST | `/api/v1/learning/courses/:courseID/submissions/:id/revisions` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [grade:78](../../backend/internal/learning/http.go#L78) |
| POST | `/api/v1/learning/courses/:courseID/revisions/:id/state` | 三栏批阅、标准编辑、学生反馈 | 较完整局部工作台；缺少上下文助理入口见F01 | [gradeState:79](../../backend/internal/learning/http.go#L79) |

## 干预

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/interventions/:id/evidence` | 干预任务／老师任务 | 已有证据核对和带task返回；诊断上游交接缺口见F09 | [interventionEvidence:62](../../backend/internal/learning/http.go#L62) |
| GET | `/api/v1/learning/courses/:courseID/interventions` | 干预任务／老师任务 | 已有证据核对和带task返回；诊断上游交接缺口见F09 | [interventions:80](../../backend/internal/learning/http.go#L80) |
| POST | `/api/v1/learning/courses/:courseID/interventions` | 干预任务／老师任务 | 已有证据核对和带task返回；诊断上游交接缺口见F09 | [createIntervention:81](../../backend/internal/learning/http.go#L81) |
| POST | `/api/v1/learning/courses/:courseID/interventions/:id/state` | 干预任务／老师任务 | 已有证据核对和带task返回；诊断上游交接缺口见F09 | [interventionState:82](../../backend/internal/learning/http.go#L82) |

## 作答导入

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/assignments/:id/imports` | 批阅队列内导入；Agent导入编辑器 | 已有预览、确认和导入历史；本轮仅查看已有结果 | [submissionImports:70](../../backend/internal/learning/http.go#L70) |
| POST | `/api/v1/learning/courses/:courseID/assignments/:id/import/:operation` | 批阅队列内导入；Agent导入编辑器 | 已有预览、确认和导入历史；本轮仅查看已有结果 | [importSubmissions:71](../../backend/internal/learning/http.go#L71) |

## 课程互动

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/interactions` | 课程互动 | F15：回复在页首编辑、上下文承接弱 | [interactions:83](../../backend/internal/learning/http.go#L83) |
| POST | `/api/v1/learning/courses/:courseID/interactions` | 课程互动 | F15：回复在页首编辑、上下文承接弱 | [createInteraction:84](../../backend/internal/learning/http.go#L84) |

## 学情

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/overview` | 教学看板／学生概览 | F08：看板标签职责错误；正式证据链已存在 | [overview:85](../../backend/internal/learning/http.go#L85) |
| GET | `/api/v1/learning/courses/:courseID/evidence` | 教学看板／学生概览 | F08：看板标签职责错误；正式证据链已存在 | [evidence:86](../../backend/internal/learning/http.go#L86) |

## 检索与问答

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/assist` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [assistStatus:87](../../backend/internal/learning/http.go#L87) |
| POST | `/api/v1/learning/courses/:courseID/assist` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [assist:88](../../backend/internal/learning/http.go#L88) |
| GET | `/api/v1/learning/courses/:courseID/assist/history` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [assistHistory:89](../../backend/internal/learning/http.go#L89) |
| GET | `/api/v1/learning/courses/:courseID/assist/history/:id` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [assistTurn:90](../../backend/internal/learning/http.go#L90) |
| POST | `/api/v1/learning/courses/:courseID/retrieval` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [retrieval:64](../../backend/internal/learning/materials.go#L64) |
| GET | `/api/v1/learning/courses/:courseID/retrieval/status` | 检索与问答及回答历史 | GET assist只在未挂载旧组件消费；retrieval/status无活动前端消费；F12/F16 | [retrievalStatus:65](../../backend/internal/learning/materials.go#L65) |

## 教研与行业

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/research` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [research:91](../../backend/internal/learning/http.go#L91) |
| POST | `/api/v1/learning/courses/:courseID/research` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [createResearch:92](../../backend/internal/learning/http.go#L92) |
| PUT | `/api/v1/learning/courses/:courseID/research/:id` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [createResearch:93](../../backend/internal/learning/http.go#L93) |
| DELETE | `/api/v1/learning/courses/:courseID/research/:id` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [deleteResearch:94](../../backend/internal/learning/http.go#L94) |
| GET | `/api/v1/learning/courses/:courseID/industry` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [industry:95](../../backend/internal/learning/http.go#L95) |
| POST | `/api/v1/learning/courses/:courseID/industry` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [createIndustry:96](../../backend/internal/learning/http.go#L96) |
| PUT | `/api/v1/learning/courses/:courseID/industry/:id` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [createIndustry:97](../../backend/internal/learning/http.go#L97) |
| DELETE | `/api/v1/learning/courses/:courseID/industry/:id` | 教研记录、行业能力 | 人工记录CRUD；未证明自动情报采集或教学映射闭环 | [deleteIndustry:98](../../backend/internal/learning/http.go#L98) |

## 模型与任务

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/models` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [models:46](../../backend/internal/learning/materials.go#L46) |
| POST | `/api/v1/learning/courses/:courseID/jobs` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [createRAGJob:59](../../backend/internal/learning/materials.go#L59) |
| GET | `/api/v1/learning/courses/:courseID/jobs` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [jobs:60](../../backend/internal/learning/materials.go#L60) |
| GET | `/api/v1/learning/courses/:courseID/jobs/:jobID` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [job:61](../../backend/internal/learning/materials.go#L61) |
| POST | `/api/v1/learning/courses/:courseID/jobs/:jobID/cancel` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [cancelJob:62](../../backend/internal/learning/materials.go#L62) |
| POST | `/api/v1/learning/courses/:courseID/jobs/:jobID/retry` | 模型选择、AI草稿及课程任务折叠面板 | F04/F05：任务入口已有，结果定位和阶段反馈缺口 | [retryJob:63](../../backend/internal/learning/materials.go#L63) |

## 资料导入与原文

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/sources` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [sources:47](../../backend/internal/learning/materials.go#L47) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [sourceDetail:48](../../backend/internal/learning/materials.go#L48) |
| POST | `/api/v1/learning/courses/:courseID/sources` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [uploadSources:49](../../backend/internal/learning/materials.go#L49) |
| PUT | `/api/v1/learning/courses/:courseID/sources/:sourceID/fragments` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [correctFragments:50](../../backend/internal/learning/materials.go#L50) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/publish` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [publishFragments:51](../../backend/internal/learning/materials.go#L51) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/archive` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [archiveSource:52](../../backend/internal/learning/materials.go#L52) |
| PUT | `/api/v1/learning/courses/:courseID/sources/:sourceID/derivation` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [sourceDerivation:53](../../backend/internal/learning/materials.go#L53) |
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/download` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [downloadSource:54](../../backend/internal/learning/materials.go#L54) |
| POST | `/api/v1/learning/courses/:courseID/sources/url` | 学习资料／原件工作台 | F03/F05/F07/F14：导入回执、发布交接、绑定和批次失败 | [importURL:25](../../backend/internal/learning/topics.go#L25) |

## 知识

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/knowledge` | 知识库及版本／冲突处理编辑器 | F07/F13：源资料到候选和恢复上下文不连贯 | [knowledge:55](../../backend/internal/learning/materials.go#L55) |
| POST | `/api/v1/learning/courses/:courseID/knowledge` | 知识库及版本／冲突处理编辑器 | F07/F13：源资料到候选和恢复上下文不连贯 | [saveKnowledge:56](../../backend/internal/learning/materials.go#L56) |
| PUT | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID` | 知识库及版本／冲突处理编辑器 | F07/F13：源资料到候选和恢复上下文不连贯 | [saveKnowledge:57](../../backend/internal/learning/materials.go#L57) |
| POST | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID/state` | 知识库及版本／冲突处理编辑器 | F07/F13：源资料到候选和恢复上下文不连贯 | [knowledgeState:58](../../backend/internal/learning/materials.go#L58) |
| POST | `/api/v1/learning/courses/:courseID/knowledge/:knowledgeID/decision` | 知识库及版本／冲突处理编辑器 | F07/F13：源资料到候选和恢复上下文不连贯 | [knowledgeDecision:29](../../backend/internal/learning/topics.go#L29) |

## 题库

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/question-bank` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [questionBank:18](../../backend/internal/learning/question_bank.go#L18) |
| POST | `/api/v1/learning/courses/:courseID/question-bank` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [saveBankQuestion:19](../../backend/internal/learning/question_bank.go#L19) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/:bankID` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [bankDetail:20](../../backend/internal/learning/question_bank.go#L20) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID` | 题库确切版本深链读取 | 版本定位已有；不等于任意Agent返回编号可直接打开 | [inline:21](../../backend/internal/learning/question_bank.go#L21) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/provenance` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [bankProvenance:26](../../backend/internal/learning/question_bank.go#L26) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/:bankID/versions` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [saveBankQuestion:27](../../backend/internal/learning/question_bank.go#L27) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/:bankID/archive` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [archiveBank:28](../../backend/internal/learning/question_bank.go#L28) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/confirm` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [confirmBankQuestion:29](../../backend/internal/learning/question_bank.go#L29) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/reference/confirm` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [confirmBankReference:30](../../backend/internal/learning/question_bank.go#L30) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/rubrics` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [bankRubrics:31](../../backend/internal/learning/question_bank.go#L31) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/versions/:versionID/rubrics` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [createBankRubric:32](../../backend/internal/learning/question_bank.go#L32) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/jobs` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [createBankJob:33](../../backend/internal/learning/question_bank.go#L33) |
| POST | `/api/v1/learning/courses/:courseID/question-bank/evidence` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [bankEvidence:34](../../backend/internal/learning/question_bank.go#L34) |
| GET | `/api/v1/learning/courses/:courseID/question-bank/search` | 题库详情、参考解答、标准、选题抽屉 | 详情与确认已有；原位交接及恢复见F11/F13 | [searchBank:24](../../backend/internal/learning/topics.go#L24) |

## 专题、审计与建议

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/topics` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [topics:19](../../backend/internal/learning/topics.go#L19) |
| POST | `/api/v1/learning/courses/:courseID/topics` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [saveTopic:20](../../backend/internal/learning/topics.go#L20) |
| PUT | `/api/v1/learning/courses/:courseID/topics/:topicID` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [saveTopic:21](../../backend/internal/learning/topics.go#L21) |
| PUT | `/api/v1/learning/courses/:courseID/content-links` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [contentLinks:22](../../backend/internal/learning/topics.go#L22) |
| GET | `/api/v1/learning/courses/:courseID/decisions` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [decisions:23](../../backend/internal/learning/topics.go#L23) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/suggestions/adopt` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [adoptSuggestions:30](../../backend/internal/learning/topics.go#L30) |
| POST | `/api/v1/learning/courses/:courseID/sources/:sourceID/paper/adopt` | 专题标签、处理记录、目录建议与整卷拆题 | 已有局部界面；原件到题库仍需跨页交接 | [adoptPaper:31](../../backend/internal/learning/topics.go#L31) |

## 图文资产

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/sources/:sourceID/assets` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [sourceAssets:26](../../backend/internal/learning/topics.go#L26) |
| POST | `/api/v1/learning/courses/:courseID/assets/:assetID/revisions` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [saveAssetRevision:27](../../backend/internal/learning/topics.go#L27) |
| POST | `/api/v1/learning/courses/:courseID/assets/:assetID/crop` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [cropAsset:28](../../backend/internal/learning/topics.go#L28) |
| GET | `/api/v1/learning/courses/:courseID/assets/:assetID/file` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [assetFile:40](../../backend/internal/learning/topics.go#L40) |
| GET | `/api/v1/learning/courses/:courseID/resources/:id/assets` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [resourceAssets:41](../../backend/internal/learning/topics.go#L41) |
| GET | `/api/v1/learning/courses/:courseID/questions/:id/assets` | 原件公式图像核对；学习资料／题目图像 | 已有资产界面；本轮未重做PDF/OCR/裁图写入验证 | [questionAssets:42](../../backend/internal/learning/topics.go#L42) |

## 内容影响与重评

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/impact` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [impact:32](../../backend/internal/learning/topics.go#L32) |
| POST | `/api/v1/learning/courses/:courseID/impact/decisions` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [impactDecision:33](../../backend/internal/learning/topics.go#L33) |
| GET | `/api/v1/learning/courses/:courseID/regrades` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [regrades:34](../../backend/internal/learning/topics.go#L34) |
| POST | `/api/v1/learning/courses/:courseID/regrades` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [createRegrade:35](../../backend/internal/learning/topics.go#L35) |
| GET | `/api/v1/learning/courses/:courseID/regrades/:batchID` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [regradeDetail:36](../../backend/internal/learning/topics.go#L36) |
| PUT | `/api/v1/learning/courses/:courseID/regrades/:batchID/items/:submissionID` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [saveRegradeItem:37](../../backend/internal/learning/topics.go#L37) |
| POST | `/api/v1/learning/courses/:courseID/regrades/:batchID/state` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [regradeState:38](../../backend/internal/learning/topics.go#L38) |
| POST | `/api/v1/learning/courses/:courseID/regrades/:batchID/items/:submissionID/ai` | 内容变更；整组重评 | F10：影响对象到重评范围丢失；批次内冻结和发布已有 | [regradeAI:39](../../backend/internal/learning/topics.go#L39) |

## 智能分析与推荐

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/intelligence` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [intelligenceList:19](../../backend/internal/learning/intelligence.go#L19) |
| POST | `/api/v1/learning/courses/:courseID/intelligence` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [intelligenceCreate:20](../../backend/internal/learning/intelligence.go#L20) |
| GET | `/api/v1/learning/courses/:courseID/intelligence/:reportID` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [intelligenceRead:21](../../backend/internal/learning/intelligence.go#L21) |
| PUT | `/api/v1/learning/courses/:courseID/intelligence/:reportID` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [diagnosisEdit:22](../../backend/internal/learning/intelligence.go#L22) |
| POST | `/api/v1/learning/courses/:courseID/intelligence/:reportID/confirm` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [diagnosisEdit:23](../../backend/internal/learning/intelligence.go#L23) |
| PUT | `/api/v1/learning/courses/:courseID/intelligence/:reportID/choice` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [recommendationChoice:24](../../backend/internal/learning/intelligence.go#L24) |
| POST | `/api/v1/learning/courses/:courseID/intelligence/:reportID/cancel` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [intelligenceCancel:25](../../backend/internal/learning/intelligence.go#L25) |
| GET | `/api/v1/learning/courses/:courseID/diagnosis-labels` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [diagnosisLabels:26](../../backend/internal/learning/intelligence.go#L26) |
| POST | `/api/v1/learning/courses/:courseID/diagnosis-labels` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [diagnosisLabelSave:27](../../backend/internal/learning/intelligence.go#L27) |
| PUT | `/api/v1/learning/courses/:courseID/diagnosis-labels/:labelID` | 看板共性分析、诊断复核、路径AI排序 | F08/F09/F13：模块已落地，标签／行动／恢复存在缺口 | [diagnosisLabelSave:28](../../backend/internal/learning/intelligence.go#L28) |

## Agent运行时

| 方法 | 完整路径 | 前端承接 | 调研结论／限制 | 后端注册 |
|---|---|---|---|---|
| GET | `/api/v1/learning/courses/:courseID/agent/status` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [status:27](../../backend/internal/agent/http.go#L27) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [conversations:28](../../backend/internal/agent/http.go#L28) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [createConversation:29](../../backend/internal/agent/http.go#L29) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [conversation:30](../../backend/internal/agent/http.go#L30) |
| PATCH | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [options:31](../../backend/internal/agent/http.go#L31) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/messages` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [send:32](../../backend/internal/agent/http.go#L32) |
| POST | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/attachments` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [upload:33](../../backend/internal/agent/http.go#L33) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/attachments/:attachmentID/file` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [download:34](../../backend/internal/agent/http.go#L34) |
| GET | `/api/v1/learning/courses/:courseID/agent/conversations/:conversationID/events` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [stream:35](../../backend/internal/agent/http.go#L35) |
| POST | `/api/v1/learning/courses/:courseID/agent/runs/:runID/cancel` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [cancel:36](../../backend/internal/agent/http.go#L36) |
| POST | `/api/v1/learning/courses/:courseID/agent/runs/:runID/resume` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [resume:37](../../backend/internal/agent/http.go#L37) |
| POST | `/api/v1/learning/courses/:courseID/agent/requests/:requestID/respond` | 师生assistant；agent.tsx和七类AgentEditor | F01/F02：入口独立，普通业务页无上下文发起；回执缺少类型化业务定位 | [respond:38](../../backend/internal/agent/http.go#L38) |
