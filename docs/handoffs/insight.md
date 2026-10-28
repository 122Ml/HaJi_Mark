# 给葛炫毅的AI工具

只主责学情与干预纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md、docs/evidence.md和backend/internal/insight/README.md。

本周IN-01：学生查看已发布反馈的证据列表和知识点表现；教师查看本课程学生并点回原始作答。先表格/列表，别先做复杂雷达图或风险预测。无记录显示证据不足；结果附题数、时间、规则版本和released_revision_id。

可改：web/src/features/insight、backend/internal/insight、backend/db/queries/insight.sql；00005事件/干预迁移先和李然确认。后续再接规则推荐、教师下发任务、学生执行和复查，E4另做可复算统计。

你不是唯一开发者，不跨模块直接改成绩或原文，不重写依赖。允许用明确fixture开发证据界面，验收必须从真实发布修订读取；测试无数据、旧修订去重和越权。另由成员本人汇总课堂正式模块清单，不让AI编造M1—M4/M7名称或真实教师意见。
