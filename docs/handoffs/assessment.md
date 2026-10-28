# 给张俊超的AI工具

只主责测验作业纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md和backend/internal/assessment/README.md。

本周AS-01：教师发布一道文本题→学生保存/提交→教师查提交列表→学生刷新查提交状态。每份正式提交有独立attempt与原文；重试同request_id不重复入库；不把未作答设0分。为李然交submission_id/题目版本，不自己实现AI评分。

可改：web/src/features/assessment、backend/internal/assessment、backend/db/queries/assessment.sql和已协调00003迁移。登录授权复用公共中间件，未接身份前不开放写接口。依赖/全局装配与李然商量。你不是唯一开发者，不重写其他模块和锁文件。

逐段实现界面、API、保存与自测，不只交页面。检查中文换行原文、第二次提交不覆盖、跨人读取403、刷新留存。PR描述写复现步骤和交给下游的真实ID；测试fixture须标记且合并前连真实数据。
