# 本地开发与验证

## Git 手动同步约定

本仓库继承 GitHub 历史，初始化任务分支 `codex/bootstrap` 从 `origin/codex/integration@53909b0` 建立。2026-10-28用户已授权同步整个初始化成果，解除原本地push URL阻断，经任务分支→PR→检查→codex/integration合入；main保留稳定基线。保留 `push.default=nothing`，推送必须显式指定任务分支，不配置后台同步。

成员先fetch最新codex/integration，再创建各自任务分支；工作树干净时用 `git merge --ff-only origin/codex/integration` 更新本地集成分支。提交前排除 `.env`、密钥、node_modules、dist、.local研究下载、日志和本地验证缓存。已追踪源码、锁文件、迁移、Compose、课程历史来源、必要文档及截图对照正常提交。不得强推或绕过检查；仅在现有管理员审核例外适用时处理本人PR，必需状态检查仍须通过。

## 锁定基线

Go 1.26.1、Node 22.22.0；Gin 1.11.0、pgx 5.7.6、Asynq 0.25.1；Goose 3.26.0、sqlc 1.30.0；PostgreSQL 18.1（挂载/var/lib/postgresql）、Redis 7.4.10。数据库镜像复用本机已有的明确版本，避免首次验证重复下载。React/Ant Design/Vite等精确版本在package.json及锁文件。Docker使用明确版本标签，不使用latest；未宣称这些是2026年最新版本。

依赖属于最小工程支持：Gin路由、pgx/sqlc数据、Goose迁移、Asynq队列、React Router路由、Query服务端缓存、Ant Design表单/表格。不开向量库/Agent编排框架。升级依赖由李然集中处理，三人不要分别让AI重写锁文件。

## 常用命令

仓库根：

```powershell
Copy-Item .env.example .env   # 仅第一次，不覆盖现有本地配置
docker compose config --quiet
docker compose build
docker compose up -d
docker compose --profile demo run --rm seed
pwsh -File scripts/smoke.ps1 -ExpectDemo
docker compose logs --tail=60 api worker
docker compose down         # 不删除卷
```

api/worker 五个常驻服务共享内部网络，另有迁移/种子的一次性服务。只有web本机18080端口公开。默认密码仅本机Compose构造数据使用，不是平台登录凭据；密码包含URL特殊字符时DATABASE_URL需要正确编码，此骨架默认示例使用简单本地值。尚无生产部署配置。

后端目录（Docker build会产生API/worker，避免直接运行本地服务）：

```powershell
go mod download
go test ./...
go vet ./...
go build ./cmd/api ./cmd/worker
docker run --rm -v "${PWD}:/src" -w /src sqlc/sqlc:1.30.0 generate
git diff --exit-code -- internal/store
```

`internal/store`只由sqlc生成；先改db/queries与迁移，再运行generate。Goose迁移会在Compose启动前完成；不要把schema创建塞进API启动代码。每个数据库卷首次或升级均执行尚未应用迁移，种子用ON CONFLICT保留已有数据。

前端目录：

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
```

Windows使用npm.cmd避免PowerShell执行策略问题。web开发服务器可用于界面开发，运行验收以Compose为准。当前登录页只切换演示角色，业务交互仅存本机浏览器；真实会话与授权尚未实现，不加入真实学生数据。前端页路由与复验见 [复刻记录](research/frontend-rebuild.md)。

## 本地检查与CI

```powershell
python scripts/check_docs.py
git diff --check
python -B F:/vibe-coding/scripts/workspace.py check --repo F:/vibe-coding/school/HaJi_Mark
```

CI沿用必需检查名 `collaboration-check`，覆盖Go测试/vet/构建、前端类型/构建、sqlc生成一致性、Compose配置和文档来源检查。所有步骤必须通过该job才成功；每次以PR或集成分支对应SHA的远端执行为准，本地成功不替代远端执行记录。

冒烟验证覆盖静态入口/深路由、live、ready、已发布构造课程/草稿过滤；它只说明工程骨架链路。业务验收与AI效果按backlog和evidence另做。Docker没启动时报告未验证，不以静态页面截图代替数据库运行结果。

## 验证资源预算

按preflight模板保留以下任务成本/I/O记录。时间来自本轮日志，内存仅为预算/限制，未测RSS峰值，不把预算称为实测。

| 任务 | 时间/类别 | 内存预算与外部资源 | 读 → 写 |
| --- | --- | --- | --- |
| 前端本地build | 本轮Vite约9秒，Light | NODE_OPTIONS限512MB；含依赖暂预留1GB | web/src、锁文件 → web/dist（忽略） |
| Go检查与编译 | 首次分钟级，缓存后秒级；按Moderate预留 | GOMAXPROCS=2、GOMEMLIMIT=768MiB，含编译子进程预留2GB | Go/SQL生成物、go.sum → Go缓存 |
| Docker后端build | 首次约4—5分钟，按Moderate预留 | 镜像下载、Go/Goose编译；不与其他构建并行 | backend → 本地镜像/构建缓存 |
| Compose与冒烟 | 秒至分钟级，Light | 本项目小型PG/Redis，无模型/GPU | 迁移/种子 → hajimark专属数据卷 |
| 文档/哈希/元数据检查 | 秒级，Light | 无网络 | 当前文档、原件哈希、清单 → 标准输出 |

共享写入：sqlc写internal/store，npm写package-lock/dist，Compose迁移/seed写数据库；运行生成/迁移时不要同时手改这些目标。批量任务按总内存重估；未知任务先探测，再安排。受资源压力影响时只继续小检查，暂缓新构建。

应用构建串行，暂按Docker构建＋依赖下载峰值≤4GB、5—15分钟估算；前端构建通常<1GB，Go首次编译依赖可能更久。构建前检查可用内存与Docker状态；未知任务先小步探测，失败后查日志再重跑，不重复叠加完整构建。当前Windows约40GB内存、初查空闲约22GB，实际结果见verification。不做GPU任务、无长驻后台计算。
