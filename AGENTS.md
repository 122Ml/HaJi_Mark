# HaJi Mark 开工入口

先读 README.md、docs/architecture.md、docs/team.md、docs/backlog.md，再读自己模块的 README。

- 当前为本地Sprint 0、26页前端复刻与S1真实身份/课程授权接入。登录/退出、会话、本人课程及授权示例已实现；学习、提交、评分、画像等业务仍为浏览器演示。入口见docs/architecture.md与docs/research/frontend-rebuild.md。历史教师端E6设计见references，当前范围包含基础师生闭环和E6/E4。
- web/src/replica 是本轮师生界面；localStorage 只作显式演示，服务端接入不得据此放松身份/班级授权。参考站密码、生产 bundle、历史聊天与签名媒体地址不提交。模板工作流沿用现有 React/Vite，不迁到 Next.js。
- 保留 Go/Gin、React/TypeScript/Ant Design、PostgreSQL、pgx/sqlc、Goose、Redis/Asynq、Docker Compose。一个应用按业务模块组织，不拆微服务。
- 每人负责一个业务纵切面的页面、接口、数据保存与自测。共享基础、依赖、全局路由、迁移编号由李然协调；不得覆盖其他成员代码。
- 课程资料、rubric、原始作答、AI 原稿、人工确认、独立评测参照分别记录。标准起草不读取待评答案；正式成绩只来自教师确认。引用可定位不等于语义正确。
- 草稿不对学生公开；业务端点上线前必须实现服务端身份、班级归属与行级授权。前端学生/教师导航不是权限控制。
- 未作答、零分、资料不足、模型失败分别处理。画像/E4 只用有效的已确认记录，保留证据 ID 与算法版本。
- 新增迁移不修改已执行迁移；SQL 查询交给 sqlc 生成，生成文件不手改。模块间只通过明确契约调用，不跨模块直接更新表。
- identity中间件与web/src/shared/session.tsx、api.ts是S1公共入口。先RequireSession再RequireRole/RequireCourse；业务对象必须从存储对象取得course/student归属，不能只检查请求body课程。所有认证写操作再RequireCSRF；access-check只作无副作用示例。后续成员按各自业务补行级检查。
- 真实模型调用须有本轮明确授权、密钥和预算；默认不调用，不把固定样例、历史探查或 AI 自评分当教师真值。
- 验证优先 Docker；没有 Docker daemon 时可做静态构建和定向测试，但必须说明尚未运行容器。本项目启动/停止脚本只作用于 hajimark Compose 项目，不删除卷。
- 本地提交可以进行；初始化成果已同步，当前S1任务用户明确要求仅本地开发、不上传GitHub。保持codex/s1-liran，不fetch/push或发远端PR；后续同步按届时明确授权执行。手动同步与push.default约定见docs/development.md。
- 文档、代码和实际状态不一致时同步修订当前文档；references 的历史材料与三个原流程图保留，不把旧范围当本次排除基础模块的理由。
