# HaJi Mark 开工入口

先读 README.md、docs/architecture.md、docs/team.md、docs/backlog.md，再沿工作区导航读取实际模块。

- 当前为真实师生平台完善阶段。活动入口是 web/src/live 与 backend/internal/learning；identity 提供数据库会话和权限，store 由 sqlc 生成。web/src/replica 保留历史复刻源码和目录模板，未作为活动业务路由，不能把 localStorage 演示当数据库事实。
- 保留 Go/Gin、React/TypeScript、PostgreSQL、pgx/sqlc、Goose、Redis/Asynq、Docker Compose；一个应用内组织业务，不拆微服务。worker 目前没有业务任务处理器。
- 用户本轮授权跨原分工完善整个前后端；旧周计划和模块责任不阻止本轮改动。不冒充成员贡献、独立人工审核或教师验收。后续多人仍按纵向流程分支协作，共享入口先协调。
- 当前分支 codex/platform-completion；用户已授权将CO-01/AS-01适配合并并部署到154.201.71.22，以hajistudy.online提供服务。此授权不包含GitHub同步；不fetch/push、不开远端PR、不发GitHub消息。原始交付及适配映射见references/contributions，部署入口见deploy/README.md。
- 用户明确要求先完成平台，AI 保持未配置。AI_ENABLED 默认 false；本轮不接真实模型、不填密钥、不用固定样例伪装AI响应。后续真实调用需另有明确授权、密钥与预算。
- RequireSession→RequireRole/RequireCourse；所有认证写请求再 RequireCSRF。对象 ID 要从数据库读取课程/学生归属，不只检查请求 body。学生不能读别人提交、笔记、路径、评分草稿，教师只能访问本人课程。
- 题目/标准发布后冻结，原始作答保存 attempt、assignment_version、原文 SHA256。评分新增修订，教师确认后单独发布；客观题使用教师答案规则判分。知识点表现只用已发布、去重结果，不把无证据当零分或能力概率。
- 资料修订新增版本并保留旧文，题目绑定确切 resource_id；干预关联学习/练习时验证下发之后的新证据。状态转换和相关写入在数据库事务中完成。
- 新增迁移不得修改已执行迁移；当前 00001—00009 已分配，后续从 00010 开始。先修改 db/queries，再用 sqlc 生成 store，不手改生成物。
- 人工逐点评分入口为 learning/rubrics.go、feedback.go 和 live/rubrics.tsx、grading.tsx；确认标准版本绑定题目，评分修订绑定当时标准。规则私有、逐点评语可随正式结果发布；模型和评分队列仍未接入。
- 验证优先 Docker；构建串行、分步输出。当前入口为 check-platform.py、check-platform-browser.cjs、check-workspace-browser.cjs、backend-test、backup.py 与 check_docs.py。测试保留有标签的业务数据，不清空表、不删除卷、不影响其他 Compose 项目。
- .env/.local/账号/备份不提交。历史 references 副本和三个原 SVG 保留。代码、文档、工作区 navigation 与实际状态随本轮结构同步维护。
- 不宣称生产就绪、90%视觉复刻或AI效果，除非有对应当前版本的证据；历史截图与旧SSIM不证明当前真实平台视觉。

- 2026-11-05本轮仅本地交互改进验收，不更新公网。URL course为课程上下文；editing.tsx提供账号/对象隔离的未保存编辑恢复，不能冒充服务端保存。workspace.go/workspace.sql承载分页队列与干预完成证据；学生草稿、评分草稿与未下发任务继续私有。
