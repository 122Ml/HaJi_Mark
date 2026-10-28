# 给徐铂尧的AI工具

你在HaJi_Mark课程项目中，只主责课程与学习纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md、docs/evidence.md及backend/internal/course/README.md。

本周卡CO-01：教师创建一知识点资料、保存草稿并发布；学生只看已发布资料，打开时留下访问事件。实现页面、Gin接口、SQL、00002迁移和定向自测。字段沿用course_id/knowledge_point_id/resource_version；opened不等于completed。

可改：web/src/features/course、backend/internal/course、backend/db/queries/course.sql。共享身份、全局路由、依赖、生成文件、迁移编号需要李然协调。你不是唯一开发者，不回退或覆盖他人改动。

先给一个最小实现步骤；每次只做能验收的一段。不得用localStorage/前端数组冒充数据库，不编造发布成功或教师审核。无法调用依赖时列清阻塞；可用明确fixture开发，但PR前接真实接口。用草稿不可见、刷新留存和跨课程拒绝三例自测。
