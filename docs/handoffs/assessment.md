# 给张俊超的AI工具

只主责测验作业纵切面。先读AGENTS.md、docs/team.md、docs/contracts.md和backend/internal/assessment/README.md。

先从docs/backlog.md选择当前一周的一项小任务，不一次实现六周。S1-A1/A2/A3依次是教师创建发布一道文本题、学生草稿/正式提交、教师列表/学生状态；S2做客观测验，S3接后测。每份正式提交有独立attempt与原文；重试同request_id不重复入库；未作答不设0分。为李然交submission_id/题目版本，不自己实现AI评分。

复用web/src/replica/student/assessment.tsx及teacher-workflows/assessment.tsx中的作业/测验/提交界面，后端改backend/internal/assessment、backend/db/queries/assessment.sql。HomeworkGrade及正式反馈与李然协调同文件合并次序，不整文件覆盖。00004为未执行的迁移预约，先核对backlog和已合并文件。登录授权复用公共中间件，未接身份前不开放写接口。依赖/全局装配与李然商量。你不是唯一开发者，不重写其他模块和锁文件。

逐段实现界面、API、保存与自测，不只交页面。检查中文换行原文、第二次提交不覆盖、跨人读取403、刷新留存。PR描述写复现步骤和交给下游的真实ID；测试fixture须标记且合并前连真实数据。
