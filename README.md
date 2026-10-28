# HaJi Mark · 智能学习平台

第6组智能软件工程课程项目：学生完整学习流程＋教师监控与干预流程，重点深化 E6 有据主观题评阅与 E4 班级共性难点分析。

## 项目初始化状态

2026-10-28，Sprint 0＋前端复刻＋S1身份接入。远端开工基线在 [codex/integration](https://github.com/122Ml/HaJi_Mark/tree/codex/integration)，成员从该分支创建任务分支；`main` 保留稳定基线。当前S1工作仅保存在本地`codex/s1-liran`，按用户本轮要求不上传GitHub，不启用后台同步。

| 已建立 | 尚待迭代实现 |
| --- | --- |
| Go/Gin API、健康检查、sqlc课程查询、Goose迁移；密码哈希、数据库会话、身份/角色/课程/本人授权与CSRF | 课程编辑发布、学习记录、答疑及业务对象行级授权 |
| React师生端26页面；真实登录/退出、本人课程与授权示例；本地作业／批改／任务／互动／测验演示 | 真实提交、人工评分、画像与推荐的服务端持久化 |
| API/Worker 同镜像、PostgreSQL/Redis、Compose、本地示例种子 | Asynq 业务处理器、真实模型接入、独立评测与效果验证 |
| 分工、六周72项小任务、接口/证据契约、CI 定义和开工提示 | 成员真实贡献、课堂验收与真实业务后端接入 |

前端已按指定的 ai-website-cloner-template 工作流复刻参考平台，见 [页面映射、截图对照与差异](docs/research/frontend-rebuild.md)。登录现接真实服务端，角色由数据库确定；使用下方生成的S1账号，不连接参考站。页首“我的真实课程”读取数据库并演示归属/CSRF检查；下方作业、评分、画像等仍保存于当前浏览器，明确标记构造演示。右下角可重置演示数据；切换身份须退出后用对应账号登录。

## 开始运行

安装并启动 Docker Desktop（Linux containers），在仓库根执行：

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
pwsh -File scripts/seed-s1.ps1
docker compose --profile demo run --rm seed
pwsh -File scripts/smoke.ps1 -ExpectDemo
```

浏览器打开 http://127.0.0.1:18080 。登录账号见本地`.local/s1-accounts.json`（已忽略，勿提交）：s1-teacher、s1-teacher-other、s1-student-a/b，密码随机生成。重复seed复用账号，保留已有数据。学生只见选课的发布课程，教师可见本人草稿；公开摘要不含草稿。停止使用 `docker compose down`，不加 `-v`，保留数据。首次构建需要下载镜像和依赖。

验证结果及当前环境限制见 [本轮验证](docs/verification.md)。详细命令、锁定工具版本及手动同步约定见 [开发说明](docs/development.md)。不要使用参考站账号作为本项目默认账号。

## 四人从哪里开始

| 成员 | 纵向工作包 | 第一项任务 |
| --- | --- | --- |
| 徐铂尧 | 课程、资料、学习与基础答疑 | CO-01：发布一份资料，学生可读并留下访问记录 |
| 张俊超 | 测验作业、原始提交与客观判分 | AS-01：发布一道题，学生提交并刷新查看 |
| 葛炫毅 | 画像推荐、教师监控、干预与 E4 | IN-01：查一名学生的已确认作答证据与表现 |
| 李然 | E6 有据评阅＋身份/工程基础与集成 | PL-01 授权基础；GR-01 人工评分到正式反馈 |

每人都负责页面、接口、保存和自测；角色与路径边界详见 [职责分工](docs/team.md)，可以直接复制 [成员开工提示](docs/handoffs/README.md) 给各自的 AI 工具。当前没有给成员创建重复项目目录或替他们发起远端任务。

## 必要阅读

简明项目说明见 [当前立项摘要](docs/proposal.md)；每周可复制 [汇报模板](docs/weekly-report-template.md)，AI使用与人工核实边界见 [协作记录](docs/ai-collaboration.md)。

1. [需求范围与课程追溯](docs/requirements.md)、[24条用户故事](docs/stories.md)：覆盖学生/教师主线，哪些是教师要求、哪些是本组建议。
2. [架构与边界](docs/architecture.md)、[接口与数据约定](docs/contracts.md)。
3. [评据来源与质量验证](docs/evidence.md)：rubric、材料、学生原文和人工参照分别怎样进入系统。
4. [每周目标与可领取任务](docs/backlog.md)：DoR、DoD、阻塞和演示脚本。
5. [开源与材料来源](docs/sources.md)：课程源文件、旧稿和参考平台观察。
6. [协作指南](CONTRIBUTING.md)：成员分支 → PR → 李然审核 → 检查通过 → 集成；远端每次执行结果以 PR 和 Actions 记录为准。

历史提交包与三个原图在 [references](references/README.md) 中保留来源与哈希；它们记录旧教师端 E6 范围，新实现以当前 docs 为准。
