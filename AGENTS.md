# HaJi Mark 开工入口

先读 README.md、docs/architecture.md、docs/team.md、docs/backlog.md，再读自己模块的 README。

- 当前为本地 Sprint 0 与参考平台前端复刻；26 个页面路由及浏览器本地闭环已实现，真实业务后端尚未接入。入口见 docs/research/frontend-rebuild.md。历史教师端 E6 设计见 references，当前范围包含基础师生闭环和 E6/E4。
- web/src/replica 是本轮师生界面；localStorage 只作显式演示，服务端接入不得据此放松身份/班级授权。参考站密码、生产 bundle、历史聊天与签名媒体地址不提交。模板工作流沿用现有 React/Vite，不迁到 Next.js。
- 保留 Go/Gin、React/TypeScript/Ant Design、PostgreSQL、pgx/sqlc、Goose、Redis/Asynq、Docker Compose。一个应用按业务模块组织，不拆微服务。
- 每人负责一个业务纵切面的页面、接口、数据保存与自测。共享基础、依赖、全局路由、迁移编号由李然协调；不得覆盖其他成员代码。
- 课程资料、rubric、原始作答、AI 原稿、人工确认、独立评测参照分别记录。标准起草不读取待评答案；正式成绩只来自教师确认。引用可定位不等于语义正确。
- 草稿不对学生公开；业务端点上线前必须实现服务端身份、班级归属与行级授权。前端学生/教师导航不是权限控制。
- 未作答、零分、资料不足、模型失败分别处理。画像/E4 只用有效的已确认记录，保留证据 ID 与算法版本。
- 新增迁移不修改已执行迁移；SQL 查询交给 sqlc 生成，生成文件不手改。模块间只通过明确契约调用，不跨模块直接更新表。
- 真实模型调用须有本轮明确授权、密钥和预算；默认不调用，不把固定样例、历史探查或 AI 自评分当教师真值。
- 验证优先 Docker；没有 Docker daemon 时可做静态构建和定向测试，但必须说明尚未运行容器。本项目启动/停止脚本只作用于 hajimark Compose 项目，不删除卷。
- 本地提交可以进行；未经用户明确要求不推送、不创建远端 PR、不自动 fetch/pull。当前 origin 推送地址被本地配置阻断，恢复方法见 docs/development.md。
- 文档、代码和实际状态不一致时同步修订当前文档；references 的历史材料与三个原流程图保留，不把旧范围当本次排除基础模块的理由。
