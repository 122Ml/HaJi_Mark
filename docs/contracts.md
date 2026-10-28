# 接口、数据与状态契约

v0.3 · 2026-10-28，当前真实平台。以下为已注册接口；后半节结构化rubric/E6为研究目标，不能据此调用旧规划路径。

## 共识与身份

前缀 `/api/v1`，JSON成功 `{data: ...}`，错误 `{error:{code,message}}`。400格式、401登录失效、403身份/课程/本人/CSRF拒绝、404对象不存在或条件更新无结果、409版本/状态冲突、422业务条件不足、429频率或容量限制、503数据库/模型不可用。服务端从cookie取得角色，不采信body中的teacher_id/student_id身份声明。

`POST /sessions` 接username/password返回user/csrf_token；`GET /me`恢复会话；`DELETE /sessions/current`退出204；`GET /me/courses`返回本人课程。公开 `GET /courses`只返回发布课程元数据。live/ready分别检查进程、数据库和Redis。原 `/student|teacher/courses/:courseID/context` 与 access-check授权示例保留，不写业务。

HttpOnly、SameSiteStrict、Path=/api/v1、8小时cookie，DB仅存token哈希；CSRF token在前端内存。所有认证写请求使用 `X-CSRF-Token` 并检查Origin。登录按用户名限制每分钟30次、最多10000个活跃窗口，限流在进程内；不是分布式公网防护。姓名/改密走 `PUT /learning/profile|password`；改密12—72字节，需原密码，成功撤销该账号所有会话。

## 教学业务（已实现）

除 `POST /learning/courses` 外，下表相对路径均位于 `/learning/courses/:courseID`。读写先校验课程归属；学生只读已发布课程，教师仅本人课程。T=教师、S=学生、TS=双方。

| 方法/相对路径 | 权限 | 输入/结果 |
| --- | --- | --- |
| GET 空路径；PUT 空路径 | TS读/T写 | 课程/目录；title重命名 |
| POST /publish | T | 发布课程 |
| POST /curriculum | T | chapters[{title,sections[{title,points:string[]}]}]；仅空课程、原子导入、上限1000节点 |
| POST /points；GET /graph；POST /edges | T写/TS读 | title/kind/parent_id/position；nodes/edges；from_id/to_id，拒绝成环 |
| GET /members；POST /members；POST /students | T | 成员；用username选课；username/display_name/password创建学生并选课，重复账号409 |
| GET /resources；POST /resources | TS读/T写 | title/content/source_url/locator/knowledge_point_id；学生过滤草稿 |
| POST /resources/:id/publish；POST /resources/:id/revisions | T | 教师审核；修订新增ID及version+1，旧文保留，只允许一条后继链 |
| GET /events；POST /resources/:id/events | TS本人读/S写 | 本人记录；verb=opened/completed、request_id |
| GET /notes；PUT /resources/:id/note | S本人 | note/favorite，私人保存，不进入班级问答 |
| GET /assignments；POST /assignments；PUT /assignments/:id | TS读/T写 | title/type(subjective/code/quiz)/description/due_at/questions；草稿编辑递增version |
| GET /assignments/:id；POST /assignments/:id/state | TS读/T写 | assignment/questions；state=published/closed；学生不读rubric/correct_answer |
| GET/PUT /assignments/:id/questions/:questionID/draft | S本人 | answer_text；可变草稿与正式原文分开 |
| GET/POST /assignments/:id/submissions | TS各自范围读/S写 | question_id/answer_text/request_id；attempt、hash、assignment_version，原文不可覆盖 |
| GET /submissions/:id | T/提交者 | submission/question/revisions；学生仅released修订 |
| POST /submissions/:id/revisions；POST /revisions/:id/state | T | score/feedback/request_id；draft→confirmed→released，只允许最新修订 |
| GET /evidence；GET /overview | TS各自范围/T | 去重正式结果；班级学习事件/作业提交/待执行任务 |
| GET/POST /path | S本人 | 保存的路径/items；按正式表现与前置依赖生成新路径 |
| GET/POST /interventions；POST /interventions/:id/state | TS按范围/T创建 | student_id/title/description/可选resource_id/assignment_id；draft→assigned→submitted→reviewed |
| GET/POST /interactions | TS | kind/title/content/parent_id；学生question/reply，教师另有announcement/discussion；同课程回复 |
| GET/POST/PUT/DELETE /research[/:id]；/industry[/:id] | T | 教研title/content；行业title/source_url/skills；按课程管理记录 |
| GET/POST /assist | TS | configured；topic请求。AI_ENABLED=false时503 model_not_configured，不返回假答案 |

`questions` 每项包含prompt/max_score/rubric/knowledge_point_id/resource_id，quiz另含options/correct_answer。资料引用只能绑定当前课程已审核发布记录。发布后题目/标准禁止原地更新。当前每个正式submission对应一道题，多题作业逐题提交；教师提交覆盖按不同question_id计数，partial与未提交分开。分值为整数，不隐式四舍五入。

提交/学习事件/评分草稿的request_id对同一actor唯一；同号同输入返回原记录，改输入409。提交在作业行锁内分配attempt，评分在提交行锁内分配revision。确认/发布/干预使用预期旧状态更新，重复状态请求返回冲突/无结果，前端刷新后继续；没有声称所有POST均可重放。关联干预资料要有assigned_at之后completed；关联作业所有题都需assigned_at之后新提交；教师复查另填review_note。

正式证据每学生/题目只取最新有released结果的attempt及其最新released修订；新未评分attempt保留旧有效结果。画像与路径只聚合这些结果；知识点无评分显示证据不足，不写零分。路径规则版本 `released-performance-prerequisite-v1`，阈值60%，保留生成时的顺序、理由和规则版本，非AI输出。

## 持久化与实现限制

迁移00001底座、00002身份、00003学习/作业/评分/干预/互动、00004草稿与资料绑定/笔记、00005课程层级/依赖/路径、00006资料历史、00007干预关联。SQL在learning.sql等queries中，store由sqlc生成。

当前是整题人工标准文本与整数评分，没有criterion表、独立rubric确认版本、AI原稿/任务或逐点quote偏移校验；题目冻结使标准随assignment_version保持不变。资料修订以resource_id绑定不可变版本。列表当前未分页，适合本地小规模课程；批量导入/高并发/大文件尚未验收。AI适配器默认关闭，未测试真实提供商，不能据此宣称E6已完成。

## S1-L3交给S2的人工评分契约

本节保留早期结构化逐点评分目标，不是当前HTTP契约；上游提交和整题人工评分现已实现。下列JSON是文档样例，`<...>`为待上游返回的真实ID，不可拿它们调用接口或认定联调通过。逐点结构化端点尚未实现；当前整题整数评分走上表接口，本轮不调用模型。先固定10分整数制（4＋6分），有小数需求时另行确认最小分值单位，不隐式四舍五入。

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

历史身份阶段的.local/s1-handoff.json保留当时null字段，现由scripts/check-platform.py生成.local/platform-check.json登记真实course/assignment/submission/resource等ID。当前整题评分联调已完成，结构化逐点评阅仍需另行实现，不能把旧交接文件当实时进度。

后续扩展到本节结构化逐点评阅时，李然仍须逐项核对：①教师查同一submission原文，学生B/另一教师拒绝；②题目/作业版本、attempt、原文hash齐全，旧attempt不覆盖；③资料可按版本与片段定位且同课程；④将实际ID代入本节样例，确认逐点满分/证据可供S2使用；⑤记录assessment/course提交SHA和Compose重启后读取结果。当前没有成员待审PR，不编造人工审核记录或远端PR；本轮仅本地集成。

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
