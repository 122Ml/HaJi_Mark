# 四人职责与协作边界

根据已存在的实名分工修订；这是本轮建议的责任安排，不冒充成员已完成贡献。账号只核实李然为 `@122Ml`；其他 GitHub 账号与姓名对应关系待本人确认，不自动添加 CODEOWNERS。

## 纵向分工

| 主责 | 独立负责的用户流程 | 前端／后端／SQL 文件范围 | 每周必须交付 |
| --- | --- | --- | --- |
| 徐铂尧 | 教师维护课程/知识点/资料并发布 → 学生学习、提问 → 留学习证据 | `web/src/features/course`、`backend/internal/course`、`backend/db/queries/course.sql`，本模块新迁移 | 一个可操作场景、正常/异常自测、接口字段及来源 |
| 张俊超 | 教师发布作业测验 → 学生保存/提交 → 教师查看提交 → 学生查状态 | `web/src/features/assessment`、`backend/internal/assessment`、`backend/db/queries/assessment.sql`，本模块新迁移 | 一道题完整走通、提交不可变和归属检查、对应事件 |
| 葛炫毅 | 证据画像/规则推荐 → 教师看班级和个人 → 下发干预 → 学生执行及复查 | `web/src/features/insight`、`backend/internal/insight`、`backend/db/queries/insight.sql`，本模块新迁移 | 一条有证据可下钻的结论及一个可执行后续动作；后续负责 E4 |
| 李然 | 评分依据 → 人工评分/AI草稿 → 检查 → 教师确认发布 → 学生正式反馈 | `web/src/features/grading`、`backend/internal/grading`、`backend/db/queries/grading.sql`；另维护公共基础 | E6 纵切面；身份权限、模型/队列、共享封装、CI/Compose、合并及复杂问题支援 |

不要把其他三人的工作降为只画页面、只测数据或只写文档。每人可以调用自己的 AI 工具完成本模块，但必须亲自说明输入、状态、失败处理、保存在哪里和怎样验证。AI 生成多少行代码不计为验收。

## 降低同时开发冲突

当前用户授权跨原分工完善整个平台，实际共享业务在 `web/src/live` 和 `backend/internal/learning`，原 features/各业务README保留入口，不作为已有功能缺失的证明。下一轮仍按课程学习、作业测验、评分、学情干预的纵向流程分工：修改各自live页面和learning对应处理器/queries时先拆小PR，共享路由、权限与生成文件由李然协调。不将本轮工具实现代记为其他成员的个人贡献。

- 活动前端：徐铂尧course/curriculum/graph/notes，张俊超assessment的题目/提交，李然assessment的评分及公共基础，葛炫毅insight/path；communication/account跨模块变动先协调。
- `backend/internal/learning` 的http.go注册公共路由；course/curriculum/notes、assessment/drafts、feedback、path等文件按职责领取，SQL集中learning.sql时按查询名小段修改，不整文件覆盖。
- `go.mod/go.sum`、锁文件、store生成物、全局路由、Compose、CI和迁移编号由李然协调。
- 一张卡一个小分支/PR，不使用A/B/C/D源码副本人工覆盖。
- 00001—00008已分配使用，后续从00009预约；旧周表编号只是历史计划，不得重复或修改已执行迁移。
- 跨模块调用先依据 contracts；需要新字段先在卡片中列变更，再由上下游确认。别人未合并时可用明确标记的测试 fixture，合并前必须替换为真实数据。

## 项目角色

横向职责仍保留课程的四类：葛炫毅“项目与需求”、李然“AI与评测”、徐铂尧“数据与接口”、张俊超“质量与交付”。横向角色负责约定与交叉检查，不代替自己的纵向实现；复杂CI/容器故障由李然处理，张俊超维护验收场景和可复现说明。

产品范围/最终技术取舍与合并：李然。首轮 Scrum Master 沿用葛炫毅，负责收集阻塞、安排周内联调和汇报，不替其他人完成开发。后续可每周轮值；责任调整必须写进 team 与卡片。

建议投入按每人每周 6—8 小时重新核实，约4—6小时小任务＋2小时联调/修错/汇报。每人最多一张主卡进行中；任务超过2小时先再拆，阻塞超过半天就说明缺失依赖。原S1身份、S2人工评分的排期已被本轮整体实现推进；后续成员重点是真实复验、改进与本人能解释的纵向交付。具体任务ID、交接物与验收见 [每周任务](backlog.md)。

## 自测与交叉检查

徐铂尧把已发布 course_id/resource_version 交张俊超；张俊超把 submission_id/attempt 交李然；李然把 released_revision_id/知识点评分交葛炫毅；葛炫毅把补学资源与新练习返回前两人。下游各核对一次输入，李然最终审核 PR。人工审核记录不能由 AI 自动伪造。

每周每人演示自己的一条垂直行为并说明失败用例；葛炫毅维护证据路径，李然负责集成环境和公共问题。未过验收卡保持未完成，不能用截图数量代替真实数据保存。
