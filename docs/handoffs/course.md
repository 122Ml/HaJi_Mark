# 给徐铂尧的AI工具

> 当前平台基线在本地codex/platform-completion，尚未同步GitHub。后续接续前先读README/architecture和实际learning/live入口；下方原开工步骤/迁移预约为历史计划，00003—00007已使用，不得照抄创建重复接口或覆盖表。本轮整体实现不自动计入任何成员贡献。


你在HaJi_Mark课程项目中，只主责课程与学习纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md、docs/evidence.md及backend/internal/course/README.md。

先从docs/backlog.md选择当前一周的一项小任务，不一次实现六周。S1-C1/C2/C3依次是教师保存资料草稿、发布并供学生查询、保存opened/completed记录。每项预计1—2小时；后续周沿同一课程学习纵切面推进，状态和验收回填原计划。

复用已有web/src/replica/student/course.tsx及teacher-analytics/course.tsx中的课程/资源界面，后端改backend/internal/course、backend/db/queries/course.sql；不重画已复刻页面。00003为未执行的课程迁移预约，先核对backlog和已合并文件；字段沿用course_id/knowledge_point_id/resource_version。共享身份、全局路由、依赖、生成文件由李然协调。你不是唯一开发者，不回退或覆盖他人改动。

先给一个最小实现步骤；每次只做能验收的一段。不得用localStorage/前端数组冒充数据库，不编造发布成功或教师审核。无法调用依赖时列清阻塞；可用明确fixture开发，但PR前接真实接口。用草稿不可见、刷新留存和跨课程拒绝三例自测。
