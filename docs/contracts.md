# 接口、数据与状态契约

2026-11-17，对话助理新增课程作用域下的12个HTTP入口，见[全量清单](api-inventory.md)与[助理协议](agent-harness.md)。消息使用客户端UUID幂等键，返回run_id；工具执行与审批异步推进。问题响应按字段／选项验证，审批绑定参数和业务快照，发送／回答／恢复／取消均重新校验身份；私有附件检查会话所有者。事件SSE按持久游标重放，是业务状态事件而非供应商token流。模型非流式assistant/tool协议不改变现有业务HTTP返回结构。

2026-11-12增量见本页末尾“三模块、内容影响与整组重评”。该节补充当前已注册接口；明确标为历史或未来的样例不作为现行接口。

v0.4 · 2026-11-04，当前真实平台。以下为已注册接口；后半节结构化rubric/E6为研究目标，不能据此调用旧规划路径。

## 共识与身份

前缀 `/api/v1`，JSON成功 `{data: ...}`，错误 `{error:{code,message}}`。400格式、401登录失效、403身份/课程/本人/CSRF拒绝、404对象不存在或条件更新无结果、409版本/状态冲突、422业务条件不足、429频率或容量限制、503数据库/模型不可用。服务端从cookie取得角色，不采信body中的teacher_id/student_id身份声明。

`POST /sessions` 接username/password返回user/csrf_token；`GET /me`恢复会话；`DELETE /sessions/current`退出204；`GET /me/courses`返回本人课程。公开 `GET /courses`只返回发布课程元数据。live/ready分别检查进程、数据库和Redis。原 `/student|teacher/courses/:courseID/context` 与 access-check授权示例保留，不写业务。

HttpOnly、SameSiteStrict、Path=/api/v1、8小时cookie，DB仅存token哈希；CSRF token在前端内存。所有认证写请求使用 `X-CSRF-Token` 并检查Origin。登录按用户名限制每分钟30次、最多10000个活跃窗口，限流在进程内；不是分布式公网防护。姓名/改密走 `PUT /learning/profile|password`；改密12—72字节，需原密码，成功撤销该账号所有会话。

## 独立题库（2026-11-11本地已实现）

下列路径相对`/learning/courses/:courseID`，全部仅课程教师可用，写请求须CSRF。题目引用的原文与知识仅按服务器重读的索引ID解析，不接受客户端正文充当依据。

| 方法/路径 | 输入与返回 |
| --- | --- |
| GET/POST `/question-bank` | GET为各条目最新版本与archived；POST为title/prompt/type/max_score/requirements/reference_answer/options/correct_answer/knowledge_point_id/evidence_ids，可选criteria与题目同事务存草稿 |
| GET `/question-bank/:bankID` | entry、完整versions、作业uses；只读，不改变历史 |
| POST `/question-bank/:bankID/versions` | 同建题输入；创建新内容版本，不原地修改确认内容 |
| POST `/question-bank/:bankID/archive` | archived布尔值，可停用或恢复；阻断新选用和待发布作业，不删除旧作业或成绩 |
| GET `/question-bank/versions/:versionID` | 授权读取确切版本，供作业深链返回题库 |
| POST `/question-bank/versions/:versionID/confirm` | 确认题目；重复确认409 |
| POST `/question-bank/versions/:versionID/reference/confirm` | 单独确认非空参考解答；不代替题目确认 |
| GET/POST `/question-bank/versions/:versionID/rubrics` | 标准历史／criteria、evidence_ids、可选ai_job_id；标准归属确切题目版本。确认沿用`POST /rubrics/:id/confirm`，要求题目及非空参考解答已确认 |
| POST `/question-bank/evidence` | query或source_id/knowledge_id范围；返回合法候选hits。范围读取首批最多100条；选定最多8条且合计8000字 |
| POST `/question-bank/jobs` | kind为question_generate/question_analyze/bank_rubric；profile_id、evidence_ids。出题另含requirements/max_score/count（1—3）；分析／标准必须question_id且从服务器读取版本，忽略外传题干或学生答案 |

题库标准评分点沿用id/title/max_score/rule，扩展requirement、partial_credit、acceptable_answers、error_conditions、evidence_ids；各正整数分值之和必须等于题目满分，逐点引用只能来自所选依据。模型输出必须含pending_teacher_review，缺字段、错引和分数不符的输出失败，不自动确认。

作业创建／草稿编辑的每题新增`bank_question_version_id`、`bound_rubric_id`。服务器用确认版本重读题干、满分、知识点及选项规则；主观题须匹配该题目版本的确认标准，客观题不传标准ID。写入及发布事务重新核对，不能通过传入新满分或题干篡改题库。新实例不接受独立新建标准，逐点评分与AI评分都只接受bound_rubric_id；旧实例仍按原question_id规则兼容。学生读作业或提交时清空内部规则、正确答案及题库绑定ID，题库本身不公开。

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
| GET /assignments/:id/roster | T | total/submitted/partial/not_submitted/rows；未提交原文为空、无评分字段 |
| GET /activity?student_id=... | T或本人 | 真实学习/提交事件、时间/对象版本/来源；学生不准查询他人；最近500条 |
| GET /submissions/:id | T/提交者 | submission/question/revisions；学生仅released修订 |
| POST /submissions/:id/revisions；POST /revisions/:id/state | T | score/feedback/request_id；draft→confirmed→released，只允许最新修订 |
| GET /evidence；GET /overview | TS各自范围/T | 去重正式结果；班级学习事件/作业提交/待执行任务 |
| GET/POST /path | S本人 | 保存的路径/items；按正式表现与前置依赖生成新路径 |
| GET/POST /interventions；POST /interventions/:id/state | TS按范围/T创建 | student_id/title/description/可选resource_id/assignment_id；draft→assigned→submitted→reviewed |
| GET/POST /interactions | TS | kind/title/content/parent_id；学生question/reply，教师另有announcement/discussion；同课程回复 |
| GET/POST/PUT/DELETE /research[/:id]；/industry[/:id] | T | 教研title/content；行业title/source_url/skills；按课程管理记录 |
| GET/POST /assist | TS | configured；topic/profile_id请求。未启用RAG或无可用模型时明确失败；回答/引用核查见下节 |

`questions` 每项包含prompt/max_score/rubric/knowledge_point_id/resource_id，quiz另含options/correct_answer。资料引用只能绑定当前课程已审核发布记录。发布后题目/标准禁止原地更新。当前每个正式submission对应一道题，多题作业逐题提交；教师提交覆盖按不同question_id计数，partial与未提交分开。分值为整数，不隐式四舍五入。

提交/学习事件/评分草稿的request_id对同一actor唯一；同号同输入返回原记录，改输入409。提交在作业行锁内分配attempt，评分在提交行锁内分配revision。确认/发布/干预使用预期旧状态更新，重复状态请求返回冲突/无结果，前端刷新后继续；没有声称所有POST均可重放。关联干预资料要有assigned_at之后completed；关联作业所有题都需assigned_at之后新提交；教师复查另填review_note。

正式证据每学生/题目只取最新有released结果的attempt及其最新released修订；新未评分attempt保留旧有效结果。画像与路径只聚合这些结果；知识点无评分显示证据不足，不写零分。路径规则版本 `released-performance-prerequisite-v1`，阈值60%，保留生成时的顺序、理由和规则版本，非AI输出。

## 持久化与实现限制

迁移00001底座、00002身份、00003学习/作业/评分/干预/互动、00004草稿与资料绑定/笔记、00005课程层级/依赖/路径、00006资料历史、00007干预关联。SQL在learning.sql等queries中，store由sqlc生成。

当前兼容整题人工标准、独立rubric确认版本与逐点评分；评分点和分项结果存JSONB，没有独立criterion表。可选quote必须是该提交原文的子串；没有code point区间高亮。原题目文本标准仍随assignment_version冻结，结构化标准另存版本并绑定到对应评分修订。资料修订以resource_id绑定不可变版本。作业/批阅队列支持服务端分页，资料和知识列表暂按课程完整加载，未做大规模负载验收。AI任务与本地真实联调按2026-11-11增量实现，不代表独立教学效果评测完成。

## 2026-11-11 资料、知识与模型任务

所有路径相对`/learning/courses/:courseID`。T=课程教师，TS=教师或已选课学生；所有写请求保留CSRF及课程归属校验。`RAG_ENABLED=true`仅在本地覆盖配置启用；不可用时返回503，不返回样例冒充模型。

| 方法/路径 | 权限 | 主要契约 |
| --- | --- | --- |
| GET /sources；GET /sources/:sourceID | T | 原件清单；当前解析修订/片段，`?fragment_id=`可回看引用所属历史修订 |
| POST /sources | T | multipart `files`、`source_note`、`allow_derived`；可选`supersedes_id`上传一件新版本；文档上限30MiB/10件，视频（mp4/mov/mkv/webm/m4v）单件上限512MiB（容器魔数校验、不可与文档混批），课程活跃原件总配额2GiB |
| GET /sources/:sourceID/download；GET /sources/:sourceID/stream | TS | download按`full_source=true`控制整件下载（attachment）；stream仅限视频MIME，支持HTTP Range（206）内联播放，学生对本课已发布资料关联的视频可读（含切分发布`full_source=false`） |
| PUT /sources/:sourceID/fragments | T | `revision/fragments`完整当前列表；检查旧版本和片段顺序，新建解析修订，OCR可校正为ready |
| POST /sources/:sourceID/publish | T | `title/fragment_ids/full_source/knowledge_point_id`；锁定来源后校验当前ready片段；片段ID不得重复，full_source须包含全部已核对片段；创建并发布学习资源 |
| POST /sources/:sourceID/archive；PUT /sources/:sourceID/derivation | T | 来源归档；`allow_derived`调整提炼许可，派生检索实时检查当前许可 |
| GET /knowledge | TS | 教师看本课程全部状态；学生仅公开、确认、用于学习且出处已发布/仍可用的知识 |
| POST /knowledge；PUT /knowledge/:knowledgeID | T | title/body/category/content_kind/conditions/evidence/knowledge_point_ids/related_ids及可见性、用途；草稿编辑携edit_version，确认条目只能另建supersedes_id版本 |
| POST /knowledge/:knowledgeID/state | T | `state/edit_version`；state=confirmed或archived，编辑版本过期409；确认重查逐字出处、当前来源和学生发布范围，状态转换与索引请求同事务 |
| GET /models | T | 脱敏profile、全局保守预算、当前课程最近50次调用；不含密钥或私有认证头 |
| POST /jobs | T | kind=parse/index/extract/rubric/grade及对应来源、片段、模型/题目/作答/确认标准ID；服务端重新读取冻结输入 |
| GET /jobs；GET /jobs/:jobID | T | 列表可按`kind/question_id/submission_id/rubric_id`组合过滤，先过滤再取最近60条；指定任务返回状态、进度、错误和输出草稿 |
| POST /jobs/:jobID/cancel；POST /jobs/:jobID/retry | T | 取消排队/运行任务；仅失败可重试，新增任务保留原失败记录 |
| POST /retrieval；GET /retrieval/status | TS | query/purpose；学生不能grading用途；返回hits/mode，未启用向量时明确关键词降级原因 |
| POST /assist | TS | topic/profile_id；返回text/sources/citations/status/mode；无依据返回insufficient_evidence；逐字核对quote，正文R编号与引用列表须对应，伪造或未对应引用拒绝展示 |

知识`content_kind`为concept/method/rule/example/misconception；evidence包含`source_id/fragment_id/quote`，quote逐字来自本课程ready原文。候选不自动创建课程知识点，不把相似条目强行合并。确认知识仍分`student_visible/use_for_learning/use_for_grading`。学生私有笔记、作答和未发布评分不进入共享检索索引。

任务状态为queued→running→succeeded/failed，queued/running可取消；知识候选、标准和评阅草稿带`pending_teacher_review`。标准任务不读取submission；评阅任务冻结answer/hash、question、confirmed criteria、rubric evidence_refs。评分点完整、范围、加和和逐字作答引用必须通过，非零分须有引用。此机械核对不证明给分语义正确。

模型内部协议：知识提炼返回所选`evidence_fragment_ids`，服务端从本次选定原文附上引用并验证许可；AI评阅总分由逐点分值服务端相加，模型另报总分仅保留为`model_reported_score`。失败输出保留原稿，不写入未通过校验的知识候选或正式评分。

原文校正、解析成功、知识确认/归档与对应索引请求同事务保存，由数据库恢复扫描补投。Redis短期不可用不丢任务；数据库claim失败返回错误，不冒充完成。解析/提炼/索引完成提交前锁定任务并核对attempt，已取消或旧尝试不能写入新修订、候选或激活向量空间。重新解析失败保留已有可用原文和错误说明；首次解析失败仍为failed。

教师载入AI标准/评分到原编辑器后仍可修改，保存时传`ai_job_id`；后端检查任务、课程、对象与冻结版本，标准附带原任务检索依据，评分关联原AI任务。页面按课程和具体题目/作答/标准从数据库找回最近任务，刷新不自动重新生成；未保存编辑的浏览器恢复同时保留该关联。标准、历史版本和评分编辑区可展开冻结依据。标准确认与评分确认/发布保持原接口，AI任务成功不发布成绩。学生只得到released反馈，不读模型输入、内部标准或任务列表。

## 2026-11-04 逐点评分（已实现）

以下路径均相对 `/learning/courses/:courseID`，限课程教师，写请求另校验CSRF。

| 接口 | 输入／结果 |
| --- | --- |
| GET /questions/:id/rubrics | 本题所有版本，criteria含id/title/max_score/rule，按version倒序 |
| POST /questions/:id/rubrics | criteria数组，1—30项；编号唯一、规则非空、正整数满分总和与题目一致；另建不可原地修改的草稿 |
| POST /rubrics/:id/confirm | 草稿→confirmed；确认后只能另建版本 |
| POST /submissions/:id/revisions | rubric_id、points[{criterion_id,score,feedback,quote}]、score、feedback、request_id；逐点完整且不越界，总分等于合计；quote可空，否则须逐字来自当前作答 |

标准输入不含学生答案，可在无提交时建立。评分绑定本题确认版本，系统补入point_scores的title/max_score，内部rule不随分项返回学生。已存在确认标准时不允许省略rubric_id绕过；历史整题记录仍保留。相同request_id及同内容返回同修订，内容变化409。

评分沿既有draft→confirmed→released；学生仅见released。GET submission的revisions及GET evidence增加rubric_id/point_scores；CSV增加标准ID、分项与总评。新标准不改变旧评分绑定，新评分草稿不抹去旧正式反馈；改分发布后统计只计当前有效结果。引用字符串存在只证明能定位，不代表给分语义正确。

## S1-L3交给S2的人工评分契约

本节保留早期结构化逐点评分目标，不是当前HTTP契约；上游提交和整题人工评分现已实现。下列JSON是文档样例，`<...>`为待上游返回的真实ID，不可拿它们调用接口或认定联调通过。该历史样例的/teacher路径和code point区间字段未实现；当前结构化评分走前述/learning路径与quote字符串，不调用模型。先固定10分整数制（4＋6分），有小数需求时另行确认最小分值单位，不隐式四舍五入。

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

目标事件约定：course产生resource.opened/completed；assessment产生submission.submitted/objective.graded；grading产生grade.released/grade.superseded；insight产生intervention.assigned/submitted/reviewed。当前实际learning_events保存opened/completed与submission.submitted，含resource_id或submission_id、object_version、actor/course/time。提交事件已与提交同事务落库；客观评分、评分修订与干预当前从业务表读取，还未另存全量事件/outbox，不把目标约定当已实现队列。消费者按事件ID去重；正式成绩按当前有效发布修订重算，不重复计分。

## 先实现的一条数据交接

CO-01 发布 course demo-boundary 与资料版本 → AS-01 学生提交“测试17、18、19、59、60、61，这六个年龄都合法” → GR-01 按已确认的构造标准人工给分并发布 → IN-01 展示“范围外合法性混淆”的本题证据及实际资料 → 教师安排新范围练习。原始题/自拟分数只是演示，不能称教师已验证正确。后续学生端只收到正式反馈，不提前收到完整答案。


## 工作台查询（2026-11-05）

共同前缀 `/api/v1/learning/courses/:courseID`；均需当前会话和课程授权。

| GET路径 | 参数与返回 | 边界 |
| --- | --- | --- |
| `/assignment-worklist` | `page`默认1，`size`默认20（1—100）；`kind/state/search/point/sort`（kind=homework含主观题和代码题，quiz为测验）；返回`rows,total`，每行含`question_count/submitted_count/draft_count/feedback_count` | 学生只见已发布或关闭作业；三个个人计数按当前账号、题目去重；教师的这些计数不代表全班覆盖 |
| `/assignments/:id/worklist` | `page/size/search/state`；状态`pending/draft/confirmed/released`按最新评分修订；返回`rows,total`，含学生姓名、题目、attempt和review_state | 仅课程教师；每次提交一行，按提交时间和ID稳定排序；分页不删除历史attempt |
| `/interventions/:id/evidence` | `assigned_at/learning_ready/practice_ready/learning/submissions`；学习记录含resource_id/occurred_at，提交含id/question_id/attempt/submitted_at | 教师或任务本人；学生不能看draft。仅列下发后的关联记录，补练要求作业的每题都有新提交。状态转换仍重新核对，不信任客户端readiness |

空的超范围页仍返回匹配总数。查询失败沿既有错误协议返回，不以空列表/0分伪装成功。上述列表用于工作台操作，不替代评分事实源、名单覆盖或正式结果去重契约。


## 三模块、内容影响与整组重评（2026-11-12）

以下前缀均为`/api/v1/learning/courses/:courseID`。除资产读取外均限本课程教师；所有写请求需会话与CSRF，实际actor由服务端取得。机械核对不代替教师语义审核。

| 方法与路径 | 关键输入／输出 |
| --- | --- |
| GET /topics；POST /topics；PUT /topics/:topicID | 标题、说明；更新还需active/edit_version。返回新版本；冲突409。停用不归档内容 |
| PUT /content-links | kind=source/knowledge/question、id、topic_ids、tags、knowledge_point_ids；所有关联须本课程，题目关联确切版本 |
| GET /question-bank/search | search/state/type/point_id/topic_id/page/page_size；page_size为1—100，返回items/total/page/page_size |
| POST /sources/url | url/title/source_note/allow_derived；返回解析任务，保存最终URL和快照；重复409，非法目标422 |
| GET /sources/:sourceID/assets | assets/revisions；保存原图、定位与原生数据，不把模型候选当原文 |
| POST /assets/:assetID/crop | x/y/width/height为0—1比例、kind、parse_revision；真实PNG裁剪保留父资产及坐标 |
| POST /assets/:assetID/revisions | body/structured/base_revision/model_job_id；确认转写并新增原文修订，CAS冲突409 |
| GET /assets/:assetID/file | 授权图像；学生仅可读已发布资料或可访问题目的确切资产，不因开放裁剪图开放整页 |
| GET /resources/:id/assets；GET /questions/:id/assets | 按学生可见资料／题目返回获准资产 |
| POST /jobs | 新增kind=source_suggest/knowledge_compare/vision/paper_split；教师选profile，服务端读取来源与版本，不接受注入学生答案或评分规则 |
| POST /sources/:sourceID/suggestions/adopt | job_id/topic_ids/tags/knowledge_point_ids/new_topics/outline/reason；核对来源版本及输入ID，采纳留审计，按job幂等 |
| POST /knowledge/:knowledgeID/decision | action=discard/merge/coexist/replace/defer，edit_version、compare_job_id、related_ids、reason；merge另含title/body/conditions |
| POST /sources/:sourceID/paper/adopt | job_id＋questions/excluded/review_status；全片段归题或注明排除，整组事务采纳为私有题库草稿，按job幂等 |
| GET /question-bank/versions/:versionID/provenance | 原生成／拆题任务、采纳决定及输入版本；不伪造手工题的AI来源 |
| GET /decisions?object_id= | 课程内处理记录、输入和输出快照 |
| GET /impact?source_id=或knowledge_id= | changes/items/decisions；实际引用遍历知识、题目、标准、作业与结果 |
| POST /impact/decisions | kind=source/knowledge、id、action=no_action/future_version/regrade、reason；新版保存其前版消费者的影响快照，不自动换绑或创建重评 |
| GET /regrades；POST /regrades | 创建含question_id/rubric_id/reason/preview；单选用correct_answer且不传rubric_id；preview只预览 |
| GET /regrades/:batchID | batch/items/rubric；每人一份最新正式提交、原文哈希及评分基线 |
| PUT /regrades/:batchID/items/:submissionID | score/feedback/points/confirmed/edit_version/ai_job_id；逐点加和、引用、统一标准和任务输入均核对 |
| POST /regrades/:batchID/items/:submissionID/ai | profile_id；只按冻结答案与本批统一标准生成草稿，不直接确认或发布 |
| POST /regrades/:batchID/state | state=released/canceled；active可结束，重复同状态幂等，结束后不可逆转 |

`source_suggest`只用有限代表性摘录提出建议，输入快照标注excerpt_only；不宣称理解完整大文档。整卷输入超过110KB明确失败，不静默截断。所有AI候选须pending_teacher_review；缺失、越界ID、非原文引用或截断回复失败并保留原回复。题卷answer_origin为missing/extracted/teacher；AI不能冒充teacher，extracted的参考解答和单选答案须逐字在原卷内。无原卷答案先留空。

新增表：knowledge_topics/topic_links/content_tags、material_assets/asset_revisions、content_decisions、bank_question_assets、regrade_batches/regrade_items；grading_revisions增加regrade_batch_id。原资产与确认修订、学习资料发布、知识确认、向量空间分别存储，不为专题复制原件或向量。知识合并保存多方出处与权限交集，替换由教师明确停用旧条目，普通新版不自动停旧。

重评批次为active→released/canceled。仅关闭作业；题干、题型、选项、满分必须不变，名单与标准固定。同题一个活动批次。发布事务复查作业关闭、冻结名单／哈希、评分基线及全部确认；任何一份冲突整组回滚。旧作业绑定、提交和评分不改写，新增正式修订；学生反馈、CSV与学情按同一正式修订去重。进入重评管理后普通评分不得以旧标准覆盖新结果。

实际验证与限制见[三模块验收](research/three-module-acceptance-2026-11-12.md)。

模型中断恢复：worker将超过15分钟的生成类running任务转failed，等待显式重试；失联reserved调用转unknown并按预留额保守计费。恢复与后到结算均按调用状态保护，不能重复结算。parse/index保留幂等恢复。

## 问答历史与作答导入（00014）

- `POST /assist`可带`request_id`。同课程/本人/同请求的成功记录返回原回答；改变问题或模型返回409，已有失败/待核对记录不隐式重发。`GET /assist/history?page=&size=`返回`rows,total`，`GET /assist/history/:id`读取原问题、状态与回答快照；教师也不能读取另一人的历史。
- `POST /assignments/:id/import/preview`接收`question_id,csv`，只核对返回`rows,valid,preview_hash,assignment_version`；列头固定`username,answer_text`，UTF-8，最多200行答案、512KiB。用户名必须为当前课程学生，拒绝重复、空白、NUL与超长答案。引号、空格、CRLF及多行原文保留。
- `POST /assignments/:id/import/confirm`另带`preview_hash,request_id`；重新核对任务与当前次数，过期预览409；异常行422且整批不写入。整批回执`batch,submissions`，重复请求复用。题型限主观/代码文本，任务已发布未截止；逾期／关闭作业禁止新增补录，无例外通道；已成功请求仍仅返回原回执。无自动建号、覆盖或评分。
- `GET /assignments/:id/imports`为教师审计；作答与队列增加`teacher_imported`，详情增加可空`import_origin`（批次/导入人/时间/源行）。事件actor为教师，verb为`submission.imported`；学生可看本人的导入事件，干预执行证据排除教师导入。
- `GET /agent/conversations?size=&offset=&search=`仍返回本人对话数组；详情带`has_more,next_cursor`，用`?before=`取更早50个时间线条目。当前页消息/运行带完整步骤/问题卡，外加活跃和最近更新10次运行；前端按ID合并，不能累加当作总数。运行私有checkpoint/session/reasoning不返回。

评分缺口以现有`/evidence`每人每题的最新有效正式结果为基础，按题/标准/评分点分组；只比较当前在课、该点有正式分值的记录，不把不同标准、未作答或无逐点反馈补成零分。规则路径使用现有`/knowledge`权限过滤，不输出不可见条目。

## 智能分析与工作台（00015）

- `POST /intelligence`接收`kind,request_id,profile_id`，诊断另需`question_id,rubric_id`。教师仅创建diagnosis，学生仅创建本人的recommendation；报告与任务同事务创建，请求号重放返回原记录，改变范围或模型返回409。异步失败/中断不自动重发模型，显式新建分析保留旧报告。
- `GET /intelligence?kind=`及`GET /intelligence/:reportID`仅本人可读。诊断固定同题同标准、已去重正式失分作答与实际分母，最多40份/100KB；模型不得提供人数，归类人数按引用作答ID去重。每份作答须有逐字证据或明确列为未归类。
- 诊断的模型内部输出选择`evidence_ids`，服务端将其解析为当前不可变作答原句；拒绝模型自写引用、未提供ID和同项重复计人。对外报告及教师编辑仍使用`evidence[{submission_id,quote}]`，核对规则不变。失败模型原稿保留。
- `PUT /intelligence/:reportID`保存草稿，`POST .../confirm`确认；均带`output,edit_version`，核对标签、原句、引用归属及乐观版本。确认与正式发布使用同一作业事务锁，并复查正式结果快照。正式证据变化时409，原报告保留。`/diagnosis-labels`由教师维护，新标签建议先明确建立再确认，不从失分或空白推断学生整体能力。
- 推荐候选来自既有规则路径中的可见已发布资料、已确认学习知识及有效来源；排除明确完成的资料。模型只能重排同一前置顺序组内的候选，不能创造内容或越过先修顺序。`PUT .../choice`接收`candidate_id,choice`（saved/later/dismissed），重查当前可用性；历史失效内容隐藏标题、禁用操作。阅读/偏好不表示掌握。
- `POST .../cancel`取消本人分析任务。诊断草稿不进入学生反馈，不修改正式成绩；教师可从现有干预页面安排补学补练，未实现自动新题生成或自动发布。
- 知识`origin=source`仍要求可靠来源逐字依据；`origin=teacher_example`限教师独立编写的example，无来源引用且禁止评分用途；来源类型创建后不可转换。AI工具不提供教师自编来源字段，不从真实作答沉淀示例。
- Agent新增七类固定工作台（原文、知识、题目标准、目录、CSV导入、整卷拆题、诊断），使用既有编辑器。即使full-access也须用户操作工作台；read-only禁止打开写工作台。返回请求忽略客户端保存声明，通过同会话Gateway重读对象，记录`changed,saved_snapshot,snapshot_hash`，再恢复原运行。已有正式审批仍校验原快照，不能借编辑器绕过出题/标准的数据隔离。
- Agent CSV工具可用`csv`或同对话`attachment_id`二选一；UTF-8/.csv/512KiB/原件哈希校验，实际导入仍走原预览与教师确认业务。学生草稿和正式提交工具只以本人身份执行，教师不可代学生正式提交。
- Agent推理默认兼容SSE（`stream_options.include_usage`），协调者公开文本按约700ms合并存入`stream_text,stream_turn`，业务events发送可恢复文本快照。推理内容与工具参数不公开；完整finish、DONE、工具ID/参数校验后才执行。`disable_streaming`可关闭供应商流式，同一次HTTP响应可回退JSON，不自动发第二次付费请求；中断及缺少usage按原预留保守结算。

## 2026-11-19 全量安全与闭环加固（00017–00019，仅本地）

- **迁移 `00017`–`00019`**：`00017` 补齐作业/题库及字段约束；`00018` 新增 `content_sections`（按知识点切分方案与批量发布）；`00019` 新增 `1024/1536` HNSW 部分索引、外键及状态局部索引、`interactions.evidence_refs`、`courses.status` 支持 `archived`、`model_calls` 支持 `completed` 状态及 JSONB/级联检查约束。`00020` 补充高频查询/覆盖/局部索引，新迁移编号从 `00021` 起分配。
- **新增／补齐接口（全量见 [api-inventory.md](api-inventory.md)，共 169 个 method + path）**：
  - `GET /learning/courses/:courseID/sources/:sourceID/stream`（TS）：仅允许已校验视频原件的 `inline` Range 流式播放；已选课学生可在来源对应资料已发布时播放。
  - `PUT /learning/courses/:courseID/sources/:sourceID/sections/:sectionID`（T）：人工编辑 `proposed`/`rejected` 状态内容切分段的标题、关联、时间码（`time_start_ms/time_end_ms` 须 `(0,0)` 或 `0<=start<end<=MaxInt32`）与理由，带 `edit_version` 冲突校验（`409`）。
  - 视频原件拒绝触发 `paper_split`（422）；`source_segment` 与 `sections/adopt` 自动从匹配视频片段提取起止毫秒（文档强制为 `0,0`），并在修订继承时保留时间码。
  - `POST /learning/courses/:courseID/state`（T）：`state=draft|published|archived`；切换课程发布／存档状态。
  - `DELETE /learning/courses/:courseID/members/:studentID`（T）：将指定学生移出当前课程。
  - `PUT /learning/courses/:courseID/points/:pointID`、`DELETE /learning/courses/:courseID/points/:pointID`（T）：编辑名称与说明、删除无业务引用节点；删除父节点前须无不可删除业务引用。
  - `PUT /learning/courses/:courseID/resources/:id`（T）：编辑草稿学习资料（已发布／已归档修订不可原地覆盖）。
  - `POST /learning/courses/:courseID/resources/:id/archive`（T）：显式归档学习资料；发布新版修订仍保留旧版可查。
  - `POST /learning/courses/:courseID/sources/:sourceID/sections/publish`（T）：将当前已接受切分方案批量发布为学习资料；片段发布支持 `parse_revision` 陈旧版本冲突检测（`409`）。
  - `DELETE /learning/courses/:courseID/topics/:topicID`（T）：仅允许删除未被引用的专题。
- **行为契约澄清与增量字段**：
  - `GET/POST /learning/courses/:courseID/path` 额外返回 `total_points`（当前课程 `kind=point` 总数），供前端展示待学覆盖率。
  - `GET/POST /learning/courses/:courseID/interactions` 支持可选 JSON 数组 `evidence_refs`，前端仅提交授权已发布资料引用，服务端校验证据格式与大小。
  - 客观测验默认仅允许作答 `1` 次；仅当存在已下发的该题补学任务（`HasAssignedQuizIntervention`）时允许补充作答，否则返回 `409`。
  - Agent SSE `text` 事件：当累计公开文本 `<= 2048` 字节发送 `{turn, text}` 全量快照；当 `> 2048` 字节且增量可追加时发送 `{turn, delta, offset}`（`offset` 为前序公开文本 UTF-8 字节长度），前端核对偏移匹配后追加或回退快照重读。

## 2026-11-25 段落内切点（`00021`）

- **迁移 `00021`**：`content_sections` 增加 `split_quotes text[]`（最多 1 条切点引文）、`start_char`/`end_char`（相对首/末片段的 rune 区间，`end_char=0` 表示到末片段末尾），并以约束保证单切点、非负区间与单片段 `end_char > start_char`（跨多片段时允许首末片段独立 rune 偏移）。
- **生成侧**（`internal/rag`）：`source_segment` 允许相邻两段共用一个片段——后一段 `fragment_ids` 首项必须等于前一段末项，且必须给出唯一逐字切点引文；未共用片段时 `split_quotes` 必须为空；单个片段最多拆分为两段（禁止三切及以上）；视频片段（带时间码）禁止片段内切分。
- **采纳与修订侧**（`internal/learning`）：`adoptSegments` 用原文解析切点，要求引文在首片段内唯一、不在开头，重算区间并校验连续、不重叠、覆盖全部片段；任一不满足整份拒绝，不写业务表。原件解析修订延续时，`carryForwardContentSections` 对新片段重算偏移；若任一切点引文失配，整体回退为整片段（`0..0`）并清空 `split_quotes`。
- **前端**：分段卡片显示「同页续段」标签（悬浮提示切点引文）并在摘要行展示切点偏移。
- **边界**：片段内切分只影响分段归属、前端展示与反查，不改变检索块（chunk）与向量索引。
