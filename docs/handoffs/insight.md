# 给葛炫毅的AI工具

只主责学情与干预纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md、docs/evidence.md和backend/internal/insight/README.md。

先从docs/backlog.md选择当前一周的一项小任务，不一次实现六周。S1-I1/I2/I3依次是需求缺口、教师已提交/未提交名单、学生真实学习/提交记录；S1不等待评分才开工。S2在李然发布评分后接证据画像；S3做规则路径与任务复查。无记录显示证据不足；表现结果附题数、时间、规则版本和released_revision_id。

复用web/src/replica/student的HomePage/TwinPage/learning和任务包组件、teacher-analytics/dashboard.tsx及teacher-workflows/interventions.tsx；后端改backend/internal/insight、backend/db/queries/insight.sql。support.tsx中的课程提问与徐铂尧协调。00006为未执行的画像/干预迁移预约，先和李然核对backlog；不要为S1进度查询先建一整套事件/outbox平台。E4排S5做可复算统计。

你不是唯一开发者，不跨模块直接改成绩或原文，不重写依赖。允许用明确fixture开发证据界面，验收必须从真实发布修订读取；测试无数据、旧修订去重和越权。另由成员本人汇总课堂正式模块清单，不让AI编造M1—M4/M7名称或真实教师意见。
