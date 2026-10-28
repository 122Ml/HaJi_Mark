# HaJi Mark · 智能学习平台

第6组智能软件工程课程项目：学生完整学习流程＋教师监控与干预流程，重点深化 E6 有据主观题评阅与 E4 班级共性难点分析。

## 本地开工状态

2026-10-28，Sprint 0＋示例平台前端复刻。基线为 GitHub `codex/integration` 的 `53909b0`，当前在本地 `codex/bootstrap` 开发；`main` 内容未修改。已禁用本地 origin 推送，不自动上传、同步或创建远端 PR。

| 已建立 | 尚待迭代实现 |
| --- | --- |
| Go/Gin API、存活/依赖就绪检查、sqlc 课程查询、Goose 初始迁移 | 登录/授权、课程编辑发布、学习记录、答疑 |
| React 师生端 26 个页面路由、本地作业／批改／任务／互动／测验演示、课程摘要查询 | 业务接入服务端：认证、持久化、授权、真实画像与推荐 |
| API/Worker 同镜像、PostgreSQL/Redis、Compose、本地示例种子 | Asynq 业务处理器、真实模型接入、独立评测与效果验证 |
| 分工、逐周 backlog、接口/证据契约、CI 定义和交接提示 | 成员真实贡献、课堂验收及远端 CI 执行 |

前端已按指定的 ai-website-cloner-template 工作流复刻参考平台，见 [页面映射、截图对照与差异](docs/research/frontend-rebuild.md)。本地预览从登录页进入，任意非空账号／密码可选择学生或教师角色；不会连接参考站账号。业务操作保存在当前浏览器，右下角“本地演示”可切换角色或重置。当前公共课程 API 仍只返回发布元数据；本地交互不等于真实后端已经实现。

## 开始运行

安装并启动 Docker Desktop（Linux containers），在仓库根执行：

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
docker compose --profile demo run --rm seed
pwsh -File scripts/smoke.ps1 -ExpectDemo
```

浏览器打开 http://127.0.0.1:18080 。未执行 seed 时课程列表应为空；seed 仅插入构造示例，draft 课程不可见。停止使用 `docker compose down`，不加 `-v`，保留数据。首次构建需要下载镜像和依赖。

验证结果及当前环境限制见 [本轮验证](docs/verification.md)。详细命令、锁定工具版本及推送阻断见 [开发说明](docs/development.md)。不要使用参考站账号作为本项目默认账号。

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
6. [协作指南](CONTRIBUTING.md)：成员分支 → PR → 李然审核 → 检查通过 → 集成；远端操作本轮未执行。

历史提交包与三个原图在 [references](references/README.md) 中保留来源与哈希；它们记录旧教师端 E6 范围，新实现以当前 docs 为准。
