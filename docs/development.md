# 本地开发与验证

## Git 手动同步约定

本仓库继承 GitHub 历史，初始化任务分支 `codex/bootstrap` 从 `origin/codex/integration@53909b0` 建立。2026-10-28用户已授权同步整个初始化成果，解除原本地push URL阻断，经任务分支→PR→检查→codex/integration合入；main保留稳定基线。保留 `push.default=nothing`，推送必须显式指定任务分支，不配置后台同步。

当前S1任务另在本地`codex/s1-liran`实现，用户本轮要求“不必同步到GitHub”；本轮不fetch、不push、不建立远端PR。以下远端流程仅为以后获授权同步时的协作说明。

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
pwsh -File scripts/seed-s1.ps1
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

Windows使用npm.cmd避免PowerShell执行策略问题。web开发服务器可用于界面开发，运行验收以Compose为准。登录现使用真实会话和课程授权；学习/作业/评分等业务仍仅存本机浏览器，不加入真实学生数据。前端页路由与复验见 [复刻记录](research/frontend-rebuild.md)。

运行`npm.cmd run dev`前先按上方步骤启动Compose与生成S1账号。Vite将`/api`代理到本机`http://127.0.0.1:18080`的网关，保留浏览器Host供同源校验；API的8080没有映射到宿主机，不应直接代理该端口。使用本地默认WEB_PORT=18080；若手动调整该端口，同时更新vite.config.ts中的代理目标。

## S1本地账号、身份与成员接入

启动迁移后执行`pwsh -File scripts/seed-s1.ps1`，生成四个账号与随机密码，保存在被Git忽略的`.local/s1-accounts.json`；终端不打印密码。教师T/U分别为`s1-teacher`/`s1-teacher-other`，学生A/B为`s1-student-a`/`s1-student-b`。两名学生选同一门发布课程；另有不归属课程、教师草稿、两个知识点。旧demo账号不具备登录密码。重复seed复用本地文件和数据库，不覆盖已有身份；丢失文件时不要删除数据卷或强行重置密码，由李然核对后处理。

DB仅存bcrypt哈希与会话token的SHA256摘要。会话8小时，HttpOnly、SameSiteStrict、Path=/api/v1；本机HTTP下`SESSION_COOKIE_SECURE=false`，不要在普通HTTP启用后误判登录异常。将来HTTPS代理需补可信来源配置，当前Compose没有TLS。登录角色选择只保留页面样式，服务端忽略请求role；前端身份不得读sessionStorage或localStorage。退出使DB中原token失效。依赖异常503，禁止回退到任意密码登录。

三人接业务时复用：

```go
// identityHandler由装配层创建并传入模块，和现有identity/context.go一致。
group := api.Group("/teacher/courses/:courseID",
    identityHandler.RequireSession(), identity.RequireRole("teacher"),
    identityHandler.RequireCourse("courseID"))
// 写路由还须增加identityHandler.RequireCSRF()；actor := identity.Current(c)。
```

`RequireCourse`校验教师拥有课程，学生已选且已发布。已有`context`与`access-check`可直接对照；后者返回`persisted:false`，不冒充课程保存。针对`/submissions/:id`等对象，必须先从DB加载对象取得真实course_id和student_id，再校验角色/课程/本人；不能只验证body中可伪造的course_id。教师读取学生原文需额外验证学生属于该课程，`RequireSelf`不提供教师绕过。授权检查及业务写入的一致性由各模块事务保证。

前端用`useSession()`取`session.user`及`session.csrf_token`，`requestJSON('/路径',{method:'POST',body:JSON.stringify(payload)},session.csrf_token)`自动加credentials、JSON和X-CSRF-Token。成功204按无响应体处理；APIError包含status/code/message。401调用refresh并重新登录，403显示无权限，503保留错误/重试；不得把失败当本地保存成功。当前RequireSession守护路由，Query缓存在登录/退出清空，焦点恢复时重查身份；后端每次请求仍校验会话。不要向日志输出密码、Cookie或CSRF。

容器验收（全部在仓库根，不启动额外本地API）：

```powershell
docker compose --profile test build backend-test
docker compose --profile test run --rm backend-test
python scripts/check-s1.py --save-session
docker compose restart api
python scripts/check-s1.py --resume-session
```

backend-test设置TEST_DATABASE_URL，创建独立`auth_test_*`schema，执行迁移和权限回归后只删除自己的schema，不清空业务表。普通`go test`未设置该变量时会跳过DB集成用例，不能称数据库验收通过。CI已增加隔离PostgreSQL服务，但本轮未上传或执行远端CI。

浏览器检查使用本机Playwright与独立无痕上下文，读本地账号文件，不写参考站、不影响用户当前会话。`node scripts/check-s1-browser.cjs`验证登录/退出、角色伪造拒绝、真实课程/CSRF，以及原26路由×双尺寸和演示闭环；需运行环境可解析`playwright`且已安装Edge。桌面附带运行时可在PowerShell为**当前进程**设置`NODE_PATH`为工具返回的node_modules路径，再使用附带Node运行，无需改项目依赖。演示闭环通过不计真实作业/评分完成。

`check-s1.py`保存`.local/s1-handoff.json`供下游取真实course/student/knowledge_point ID；当前`actual_submission_id`与`actual_rubric_version`为null。评分契约见[contracts](contracts.md#s1-l3交给s2的人工评分契约)，真实提交/资料联调须等S1-A2/A3和C1/C2。

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
