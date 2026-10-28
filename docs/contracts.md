# 接口、数据与状态契约

v0.1 开工约定。只有标“已实现”的接口当前可调用；其余是下次纵切面的输入输出约定。标识采用服务端生成的字符串 UUID；demo- 前缀仅构造种子使用。时间 RFC3339 UTC，界面按本地时区展示；成绩用整数 point 或明确的定点精度，不用浮点比较决定通过。

## HTTP 共识

前缀 `/api/v1`，JSON。成功 `{data: ...}`；错误 `{error:{code,message}}`。400格式/字段、401未登录、403不属于本人/课程、404对象不存在、409状态或版本冲突、422依据/业务条件不足、503依赖不可用。待实现的身份由 HttpOnly 会话 cookie 提供；服务端从会话确定 actor，不采信请求中的角色/学生ID。

列表后续统一 limit/cursor（默认20、最大100）。当前仅有限构造课程摘要，扩展真实多课程前补列表分页。提交、评分确认和干预下发写接口带客户端 request_id，唯一约束 actor_id/request_id，重复请求返回原结果。后端校验对象的课程归属，不接受仅靠外键存在的跨课程引用。

## 当前可调用

| 方法/路径 | 返回 | 说明 |
| --- | --- | --- |
| GET /health/live | `{status:"ok"}` | 已实现；不说明依赖可用 |
| GET /health/ready | `{database:true,redis:true}` | 已实现；依赖失效返回503，不回显连接字符串 |
| GET /courses | `{data:[{id,title,version,knowledge_point_count}]}` | 已实现；仅公开已发布元数据，不包含成员/答案/草稿 |

## 按责任实现的业务端点（全部待实现）

| 所属 | 端点 | 核心输入 → 输出 |
| --- | --- | --- |
| 公共 | POST /sessions；GET /me；DELETE /sessions/current | 凭据 → 服务端会话和角色；退出销毁会话 |
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

当前迁移只建 users/courses/enrollments/knowledge_points；以上后续对象按第一张卡落地，不声明已存在数据库表。

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
