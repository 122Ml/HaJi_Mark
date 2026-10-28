# 接口、数据与状态契约

v0.2 · S1 李然交接。只有标“已实现”的接口当前可调用；其余是下次纵切面的输入输出约定。标识采用服务端生成的字符串 UUID；demo- 前缀仅构造种子使用。时间 RFC3339 UTC，界面按本地时区展示；成绩用整数 point 或明确的定点精度，不用浮点比较决定通过。

## HTTP 共识

前缀 `/api/v1`，JSON。成功 `{data: ...}`；错误 `{error:{code,message}}`。400格式/字段、401未登录、403不属于本人/课程、404对象不存在、409状态或版本冲突、422依据/业务条件不足、503依赖不可用。已实现身份由 HttpOnly 会话 cookie 提供；服务端从会话确定 actor，不采信请求中的角色/学生ID。

列表后续统一 limit/cursor（默认20、最大100）。当前仅有限构造课程摘要，扩展真实多课程前补列表分页。提交、评分确认和干预下发写接口带客户端 request_id，唯一约束 actor_id/request_id，重复请求返回原结果。后端校验对象的课程归属，不接受仅靠外键存在的跨课程引用。

## 当前可调用

| 方法/路径 | 返回 | 说明 |
| --- | --- | --- |
| GET /health/live | `{status:"ok"}` | 已实现；不说明依赖可用 |
| GET /health/ready | `{database:true,redis:true}` | 已实现；依赖失效返回503，不回显连接字符串 |
| GET /courses | `{data:[{id,title,version,knowledge_point_count}]}` | 已实现；仅公开已发布元数据，不包含成员/答案/草稿 |
| POST /sessions | `{username,password}` → `{data:{user,csrf_token}}` | 已实现；JSON、同源、bcrypt验证；角色从DB读取，成功旋转会话 |
| GET /me | `{data:{user:{id,username,display_name,role},csrf_token}}` | 已实现；会话过期/撤销401，数据库不可用503 |
| DELETE /sessions/current | 204，无响应体 | 已实现；会话＋CSRF；销毁DB会话并清cookie |
| GET /me/courses | `{data:[{id,title,status,version,knowledge_point_count}]}` | 已实现；教师仅本人课程，学生仅已选且发布课程 |
| GET /student/courses/:courseID/context；GET /teacher/courses/:courseID/context | `{data:{id,title,status,version}}` | 已实现；依次校验会话、角色、课程归属 |
| POST /student/courses/:courseID/access-check；POST /teacher/courses/:courseID/access-check | `{data:{course_id,actor_id,authorized:true,persisted:false,purpose:"authorization_example"}}` | 已实现；增加CSRF校验的复用示例，不写业务数据 |
| GET /student/users/:studentID/context | `{data:{id,username,display_name,role}}` | 已实现；仅本人；教师无通用绕过权限 |

会话 cookie 为 `haji_session`：HttpOnly、SameSite=Strict、Path=/api/v1、8小时，DB只存SHA256 token摘要；`SESSION_COOKIE_SECURE=false`仅本机HTTP使用。CSRF token只放前端内存，由登录或/me返回；所有已认证写请求带`X-CSRF-Token`，校验同源与会话绑定。重新登录旋转旧会话，退出/过期返回401。数据库故障不得降级到浏览器演示登录。JSON登录禁止跨源Origin（缺少Content-Type返回415）。尚未提供注册、找回密码或生产防暴力破解设施。

## 按责任实现的业务端点（全部待实现）

| 所属 | 端点 | 核心输入 → 输出 |
| --- | --- | --- |
| course | POST /teacher/courses；POST /teacher/courses/:id/publish | 标题、章节、知识点、resource_version → 课程发布版本 |
| course | GET /student/courses/:id/resources；POST /student/resources/:id/events | 授权课程 → 已发布片段；opened/completed＋request_id → 事件ID |
| course | POST /student/courses/:id/questions | 问题、knowledge_point_id → answer/draft/insufficient_sources 与 source_refs |
| assessment | POST /teacher/courses/:id/assignments；POST /teacher/assignments/:id/publish | 题目版本/知识点/截止时间 → 作业ID及发布状态 |
| assessment | PUT /student/assignments/:id/draft；POST /student/assignments/:id/submissions | answer_text、assignment_version、request_id → submission_id/attempt，原文独立保存 |
| assessment | GET /teacher/assignments/:id/submissions | 本课程 → 提交列表/未提交名单；两类分开 |
| grading | POST /teacher/questions/:id/rubrics；POST /teacher/rubrics/:id/confirm | 总分、评分点、资料出处 → 确认标准版本 |
| grading | POST /teacher/submissions/:id/revisions | rubric_version、逐点分/证据/反馈 → needs_review 修订；先人工实现 |
| grading | POST /teacher/revisions/:id/confirm；POST /teacher/revisions/:id/release | revision_version、request_id → confirmed/released；并发修改返回409 |
| grading | GET /student/submissions/:id/feedback | 本人 → 当前 released 修订；不返回原始模型调用和教师隐藏备注 |
| grading | POST /teacher/grading/jobs；GET /teacher/grading/jobs/:id | submission_id、rubric_version → job_id/执行状态；输入快照不可变 |
| insight | GET /student/profile；GET /teacher/courses/:id/overview | 有效确认记录 → 样本数/表现/来源ID；无数据显式 insufficient_evidence |
| insight | GET /student/path；POST /teacher/interventions | 目标知识点、resource_version、followup_assignment_id → 教师草稿 |
| insight | POST /teacher/interventions/:id/assign；POST /student/interventions/:id/submit；POST /teacher/interventions/:id/review | 证据ID、版本、request_id → assigned/submitted/reviewed |
| insight | GET /teacher/courses/:id/difficulties | 去重后的已发布评分 → 知识点/错因统计、分母、证据列表、规则版本 |

## 核心对象与写权限

| 对象 | 必备字段/约束 | 唯一写入方 |
| --- | --- | --- |
| Course/KnowledgePoint/ResourceVersion | course_id、owner、发布版本；片段有 text/page/locator/审核者 | course；身份/选课由公共基础 |
| Assignment/QuestionVersion | course_id、knowledge_point_ids、题型、满分、题目快照；教师答案另表 | assessment |
| Submission | student_id、course_id、assignment_version、attempt、原始文本、source(platform/csv)、submitted_at | assessment；提交后不可更新原文 |
| LearningEvent | event_id、actor、verb、object/version、course_id、occurred_at、producer、request_id | 各业务通过同事务事件接口；共享表由公共基础维护 |
| RubricVersion/Criterion | question_version、confirmed_by、point_max、条件/部分分/反例、knowledge_point_id、source_refs | grading |
| GradeJob/Attempt | 固定输入快照/hash、模型/提示版本、原稿、时延/token、失败类别 | grading worker；无模型权限写确认状态 |
| GradingRevision | submission_id、rubric_version、points、evidence、feedback、state、reviewer、supersedes_id | grading；每次修订新增 |
| Profile/Path/Intervention | evidence_revision_ids、knowledge_point_id、rule_version、样本数/分母；干预有资源/练习/复查条件 | insight；不能跨模块改原成绩 |

当前迁移00001建 users/courses/enrollments/knowledge_points，00002补账号密码哈希与sessions；以上其他对象按第一张卡落地，不声明已存在数据库表。

## S1-L3：交给S2的人工评分契约

下列JSON是文档样例，`<...>`为待上游返回的真实ID，不可拿它们调用接口或认定联调通过。评分端点尚未实现；本轮不调用模型。先固定10分整数制（4＋6分），有小数需求时另行确认最小分值单位，不隐式四舍五入。

**上游交接必须齐全**：assessment交付`submission_id/student_id/course_id/assignment_id/assignment_version/question_id/question_version/attempt/answer_text/answer_sha256/submitted_at/source`，并提供按ID读取不可变快照的内部查询。哈希为原文UTF-8的SHA256小写hex；不先trim、不改换行。第一轮一道文本题，每个submission绑定唯一question版本；以后多题须增加answer_id，不能复用整份作业的引用区间。course交付知识点所属课程、已审核资料`resource_id/resource_version/fragment_id/text/source_uri/locator/reviewed_by/published_at`及历史版本查询。

**rubric创建请求**（未来POST /teacher/questions/:id/rubrics）：

```json
{
  "question_version": 1,
  "point_max": 10,
  "request_id": "<client-uuid>",
  "criteria": [
    {"criterion_id":"C1","point_max":4,"knowledge_point_id":"<kp-1>","condition":"列出边界及相邻值","partial_credit":[{"condition":"仅列出部分边界值","points":2}],"accepted_expressions":["17、18、19、59、60、61"],"counterexamples":["只测范围中间值"],"source_refs":[{"resource_id":"<resource>","resource_version":1,"fragment_id":"p1","locator":"第1段"}]},
    {"criterion_id":"C2","point_max":6,"knowledge_point_id":"<kp-1>","condition":"区分合法范围18到60与范围外非法值","partial_credit":[{"condition":"仅正确说明一个范围外值非法","points":3}],"accepted_expressions":["17与61非法，其余合法"],"counterexamples":["六个值都合法"],"source_refs":[{"resource_id":"<resource>","resource_version":1,"fragment_id":"p2","locator":"第2段"}]}
  ]
}
```

服务端生成`rubric_id/rubric_version`和`state:draft`；确认请求带`rubric_version/request_id`，确认人来自会话。确认前检查题目版本/满分匹配、评分点ID唯一、逐点满分之和=10、部分分在范围内、知识点与资料同课程、来源版本可查且已审核。失败返回422，不能靠传一个`confirmed_by`绕过。确认后不可原地改标准，须新版本。标准起草不读取待评答案；此构造题/标准尚未取得教师独立认可。

**人工评分请求**（未来POST /teacher/submissions/:id/revisions）：

```json
{
  "rubric_id":"<rubric>","rubric_version":1,"request_id":"<client-uuid>",
  "points":[
    {"criterion_id":"C1","points":4,"feedback":"已列出边界及相邻值","answer_refs":[{"submission_id":"<submission>","attempt":1,"start":2,"end":19,"quote":"17、18、19、59、60、61"}]},
    {"criterion_id":"C2","points":0,"feedback":"17与61应判为非法","answer_refs":[{"submission_id":"<submission>","attempt":1,"start":20,"end":28,"quote":"这六个年龄都合法"}]}
  ],
  "feedback":"边界值选取完整，需要区分范围外非法值。"
}
```

对应原文为`测试17、18、19、59、60、61，这六个年龄都合法`。`start/end`统一Unicode code point、左闭右开；须逐字等于原文切片，不能跨submission/attempt引用。资料引用由rubric带入并冻结。未出现的要点用`missing:true`及完整作答覆盖说明，不伪造quote。教师ID、student_id、course_id、总分和state从服务端事实取得，不允许请求伪造。

**评分草稿返回**：

```json
{"data":{"revision_id":"<revision>","revision_version":1,"submission_id":"<submission>","attempt":1,"rubric_id":"<rubric>","rubric_version":1,"state":"needs_review","total_points":4,"point_max":10,"checks":{"criterion_coverage":true,"score_range":true,"answer_quotes":true,"source_versions":true},"released_at":null}}
```

响应points/evidence同时回显服务端保存结果（结构同请求），另附原始作答hash与冻结版本用于教师核对。上述机械检查全通过也不代表语义正确。确认/发布分两个POST，均带`revision_version/request_id`；版本过期或非法跃迁409，检查失败422。只允许`needs_review→confirmed→released`。同actor/request_id＋相同负载重试返回原结果，换负载409。修改新增修订，以`supersedes_id`指旧修订，原文/标准/旧记录保留；只在新结果发布时替换有效结果，不在草稿阶段抹掉旧成绩。

**学生反馈返回**：仅本人、授权课程的有效released结果，含`submission_id/attempt/released_revision_id/revision_version/released_at/total_points/point_max/points[{criterion_id,points,point_max,feedback,answer_refs}]/feedback`。未发布返回422 `feedback_not_released`，无权访问403；不返回参考答案、rubric内部反例、教师私有备注、AI原稿或他人作答。insight只读有效released_revision_id及逐点知识点得分；缺记录明确证据不足，不补0分。

### 实际联调门槛与当前阻塞

已就绪：真实会话actor、授权课程/知识点ID、统一请求与CSRF示例。`scripts/check-s1.py`写本地`.local/s1-handoff.json`，只登记真实存在的ID；尚无提交时`actual_submission_id:null`，不生成假提交。S1-A2/A3及C1/C2未落地，真实submission/资料版本联调未完成，S1-L3保持部分完成。

上游到位后李然须逐项核对：①教师查同一submission原文，学生B/另一教师拒绝；②题目/作业版本、attempt、原文hash齐全，旧attempt不覆盖；③资料可按版本与片段定位且同课程；④将实际ID代入本节样例，确认逐点满分/证据可供S2使用；⑤记录assessment/course提交SHA和Compose重启后读取结果。当前没有成员待审PR，不编造人工审核记录或远端PR；本轮仅本地集成。

## 事件例子与消费者

```json
{
  "event_id": "server-generated-id",
  "actor_id": "demo-student",
  "course_id": "demo-boundary",
  "verb": "submission.submitted",
  "object": {"type": "submission", "id": "submission-id", "version": 1},
  "occurred_at": "2026-10-28T00:00:00Z",
  "producer": "assessment",
  "request_id": "client-generated-id"
}
```

course 产生 resource.opened/completed；assessment 产生 submission.submitted/objective.graded；grading 产生 grade.released/grade.superseded；insight 产生 intervention.assigned/submitted/reviewed。事件与业务同事务提交，不通过浏览器分别调两次接口。消费者用 event_id 去重；成绩替代按 submission 的当前有效发布修订重算，不能一份学生答案计数两次。队列只传 ID，数据库持久事实不放 Redis。

## 先实现的一条数据交接

CO-01 发布 course demo-boundary 与资料版本 → AS-01 学生提交“测试17、18、19、59、60、61，这六个年龄都合法” → GR-01 按已确认的构造标准人工给分并发布 → IN-01 展示“范围外合法性混淆”的本题证据及实际资料 → 教师安排新范围练习。原始题/自拟分数只是演示，不能称教师已验证正确。后续学生端只收到正式反馈，不提前收到完整答案。
