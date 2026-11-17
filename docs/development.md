# 本地开发与验证

## 对话助理（2026-11-17，本地）

先执行到迁移00014；既有00001—00013不修改，新迁移从00015开始。默认Compose仍可运行人工业务；`compose.rag.yaml`显式启用RAG和`AGENT_ENABLED=true`，沿用忽略的模型密钥文件与共享50元账本。助理由API进程的关闭上下文管理，不另起Agent服务。运行时、模型／工具协议和三种模式见[助理说明](agent-harness.md)。

```powershell
docker compose -f compose.yaml -f compose.rag.yaml build api
docker compose -f compose.yaml -f compose.rag.yaml build worker
docker compose -f compose.yaml -f compose.rag.yaml build web
docker compose -f compose.yaml -f compose.rag.yaml run --rm migrate
docker compose -f compose.yaml -f compose.rag.yaml up -d --no-build api worker web
```

构建串行执行；迁移前先用既有backup.py备份。教师`/teacher/assistant`、学生`/student/assistant`均依赖顶栏当前课程；人工业务页继续可用。生成工具省略profile_id时沿用会话所选模型，Embedding与视觉使用各自配置，不把生成profile强加给它们。

`python -X utf8 -u scripts/check-agent.py --phase import --real-model`开始新的有标签真实模型验收，再按content、questions、assignment、grading、student顺序执行。若需核验教师规则纠正路径，在questions之后执行rubric-correction，另存标准版本再创建新作业，不改写旧版本。`--retry-phase`明确归档停止的旧尝试后另发新任务；`--resume-run`明确恢复可安全续行的检查点，两者互斥，均可能计费，禁止自动循环重试。最后重启API／worker后执行`--phase verify`只读核对持久关系与权限。问题／审批由测试白名单处理，未知请求立即停下；自动化批准不是独立教师审核。

浏览器`node scripts/check-agent-browser.cjs --real-model`验证真实文件、问题卡、刷新、审批和后台解析。去掉该参数只检查配置与布局；不会将空对话截图伪装为模型闭环。Go Agent集成在backend-test的隔离schema运行、使用明确标注的模型协议fixture。报告、失败日志、截图、账号和备份仅保留在忽略的`.local`。已执行结果见[验收记录](research/agent-acceptance-2026-11-17.md)。

`node scripts/check-agent-polish.cjs`验证草稿切换／刷新、UTF-8上限、失败发送重试、账号与课程隔离、多轮消息顺序、折叠审批和真实下载；仅拦截消息POST制造503，避免意外模型调用。需要已有`.local/agent-acceptance.json`及S1账号，保留带标签的私有上传和两个空对话，报告写入`.local/agent-polish/`并归档上一次结果。人工验收顺序见[助理说明](agent-harness.md#本地人工验收)。

API清单：`python -B scripts/api-inventory.py`。架构图：`python -B docs/diagrams/generate-agent.py`、`node docs/diagrams/render-agent.cjs`；保留原全景与历史图册。源码／文档变更后运行`python -B scripts/check_docs.py`及工作区`check --repo`。

本轮新增`node scripts/check-completion-browser.cjs`，检查批量导入预览/确认、正式评分点名单与证据、独立问答历史、长会话分页及学习路径的精炼知识链接。只访问本机18080；真实提交与评分经API，长历史/知识可见性使用新课程内明确标记的构造数据，不调用模型或删除记录。结果见`.local/completion/report.json`与[收口记录](research/partial-completion-2026-11-17.md)。Docker无法连接默认Go代理时可在单次构建加`--build-arg GOPROXY=https://goproxy.cn,direct`；不修改生产配置。

## Git 手动同步约定

本仓库继承 GitHub 历史，初始化任务分支 `codex/bootstrap` 从 `origin/codex/integration@53909b0` 建立。2026-10-28用户已授权同步整个初始化成果，解除原本地push URL阻断，经任务分支→PR→检查→codex/integration合入；main保留稳定基线。保留 `push.default=nothing`，推送必须显式指定任务分支，不配置后台同步。

当前整个平台完善在本地`codex/platform-completion`实现，基于`7b4f0a7`；用户要求本地开发，本轮不fetch、不push、不建立远端PR。以下远端流程仅为以后获授权同步时的协作说明。

成员先fetch最新codex/integration，再创建各自任务分支；工作树干净时用 `git merge --ff-only origin/codex/integration` 更新本地集成分支。提交前排除 `.env`、密钥、node_modules、dist、.local研究下载、日志和本地验证缓存。已追踪源码、锁文件、迁移、Compose、课程历史来源、必要文档及截图对照正常提交。不得强推或绕过检查；仅在现有管理员审核例外适用时处理本人PR，必需状态检查仍须通过。

## 锁定基线

本次用户已授权hajistudy.online服务器部署，具体步骤与入口见[生产部署](../deploy/README.md)。生产使用独立Compose和随机数据库/账号凭据；本地HTTP开发命令保持不变。S1收口适配合并见[贡献来源](../references/contributions/README.md)。本次不包含GitHub同步。

Go 1.26.1、Node 22.22.0；Gin 1.11.0、pgx 5.7.6、Asynq 0.25.1；Goose 3.26.0、sqlc 1.30.0；PostgreSQL 18.1（挂载/var/lib/postgresql）、Redis 7.4.10。数据库镜像复用本机已有的明确版本，避免首次验证重复下载。React/Ant Design/Vite等精确版本在package.json及锁文件。Docker使用明确版本标签，不使用latest；未宣称这些是2026年最新版本。

依赖属于最小工程支持：Gin路由、pgx/sqlc数据、Goose迁移、Asynq队列、React Router路由、Query服务端缓存、Ant Design表单/表格。向量检索复用PostgreSQL/pgvector，不另开向量数据库或Agent编排框架。升级依赖由李然集中处理，三人不要分别让AI重写锁文件。

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
# 已提交版本检查生成一致性；开发中先保存生成结果摘要再比较
git diff --exit-code -- internal/store
```

`internal/store`只由sqlc生成；先改db/queries与迁移，再运行generate。Goose迁移会在Compose启动前完成；不要把schema创建塞进API启动代码。每个数据库卷首次或升级均执行尚未应用迁移，种子用ON CONFLICT保留已有数据。

前端目录：

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
```

Windows使用npm.cmd避免PowerShell执行策略问题。web开发服务器可用于界面开发，运行验收以Compose为准。活动页面web/src/live接真实会话、课程授权与PostgreSQL业务；旧replica浏览器演示不再挂到活动路由。使用真实学生资料前须核实课程许可和数据保管。前端页路由与复验见 [复刻记录](research/frontend-rebuild.md)。

运行`npm.cmd run dev`前先按上方步骤启动Compose与生成S1账号。Vite将`/api`代理到本机`http://127.0.0.1:18080`的网关，保留浏览器Host供同源校验；API的8080没有映射到宿主机，不应直接代理该端口。使用本地默认WEB_PORT=18080；若手动调整该端口，同时更新vite.config.ts中的代理目标。

## 当前平台回归、AI与备份

2026-11-04新增：`python scripts/check-rubrics.py`、`node scripts/check-rubrics-browser.cjs`（同下方NODE_PATH），先运行HTTP构造数据，再跑浏览器。`--resume`仅复查已有评分数据；端点与测试数据均为本地，不调用模型。迁移00009前须备份，重启复验分项与版本保留。

`node scripts/check-evidence-export.cjs` 使用已有正式评分课程，验证证据加载期间和读取失败时禁用导出，成功后CSV包含原提交ID。支持 `HAJI_BASE_URL`、`HAJI_ACCOUNTS`、`HAJI_CHECK_IDS` 和 `HAJI_TEACHER_USER` 指向明确授权的公网环境与账号；不新增课程或评分，只在独立浏览器上下文延迟／模拟失败响应。


以下命令从仓库根执行。先 `docker compose up -d`，首次运行 `pwsh -File scripts/seed-s1.ps1` 生成忽略的凭据。不要输出或提交密码。

```powershell
python scripts/check-s1.py
python scripts/check-platform.py
# 应用构建与测试构建串行，避免和他人的重构/迁移同时运行
docker compose --profile test build backend-test
docker compose --profile test run --rm backend-test
python scripts/check_docs.py
docker compose config --quiet
```

`backend-test` 在真实PostgreSQL的独立schema运行身份与学习集成测试，结束只删除该测试schema；包含并发重复提交、课程/本人/CSRF权限、评分草稿隔离和最新修订发布。CI现有 `go test ./...` 会运行这些测试；本轮没有执行远端CI。没有TEST_DATABASE_URL时数据库用例明确skip，不能记为集成通过。

浏览器回归使用本机Playwright和Edge，两个独立会话操作真实数据。桌面附带运行时示例：

```powershell
$taskNode = 'C:/Users/23396/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
$env:NODE_PATH = "$taskNode/node_modules"
& "$taskNode/bin/node.exe" scripts/check-platform-browser.cjs
& "$taskNode/bin/node.exe" scripts/check-design-browser.cjs
```

也可安装本机Playwright后用Node执行脚本，不需要增加业务依赖。脚本创建有标签的课程并保留，`.local/platform-teacher.png`、`platform-student.png`为本地检查截图。旧 `frontend-browser-check.js` 仅适用于历史replica，`check-s1-browser.cjs` 现转到当前平台回归，不再验证旧localStorage演示。

HTTP用例创建隔离测试课程并保存 `.local/platform-check.json` 的真实ID，供重启后验证。可以重启本项目 `api postgres` 后运行冒烟和 `python scripts/check-platform.py --resume`。不删除数据卷，不修改其他Compose项目。

```powershell
python scripts/backup.py --verify-restore
```

备份使用pg_dump自定义格式，写入 `.local/backups/*.dump` 和SHA256元信息。`--verify-restore` 实际恢复到唯一 `hajimark_restore_<uuid>` 临时数据库，查询提交／评分、来源／图像、专题／知识、题库版本、处理决定及重评批次／条目10类表后只删除该临时库；不覆盖现有业务库，不删旧备份。备份含账号、作答等私人数据，须在本地妥善保存。实际灾难恢复需先备份现存库，再由维护者选定恢复目标，不能把演练脚本当业务库覆盖命令。

默认Compose保持模型关闭，人工答疑、评分、客观规则和学习路径可单独运行。2026-11-11已获用户授权的本地真实RAG配置见下节；公网仍未启用，不沿用旧AI环境变量隐式开通新功能。

迁移已分配并在本地执行00001—00012，后续从00013新建。修改queries后用sqlc1.30.0生成；不改已执行迁移，不手改store，不删除Goose历史来绕过失败。Nginx使用Docker DNS解析API，API重建后应自动恢复代理。

## 资料与知识库的本地运行

密钥位于被忽略的`.local/model-secrets.env`：百炼使用`DASHSCOPE_API_KEY/DASHSCOPE_BASE_URL`，按需视觉使用`DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL`。北京兼容地址为`https://dashscope.aliyuncs.com/compatible-mode/v1`。不要在终端打印该文件，不提交、不发给浏览器。模型清单在`backend/config/models.json`；可增加多组OpenAI兼容profile，专有协议必须明确实现适配器。`key_env/base_url_env`引用服务端环境变量，`dimensions/send_dimensions/batch_size`按供应商实际能力设置。

```powershell
# 构建串行；首次需下载解析库和OCR权重，后续复用镜像层
docker compose -f compose.yaml -f compose.rag.yaml build postgres
docker compose -f compose.yaml -f compose.rag.yaml build api
docker compose -f compose.yaml -f compose.rag.yaml build worker
docker compose -f compose.yaml -f compose.rag.yaml build web
docker compose -f compose.yaml -f compose.rag.yaml up -d --no-build
python -u scripts/check-rag.py
# 修复后在同一验收课程继续，不重复已完成的付费阶段
python -u scripts/check-rag.py --continue-run
# 重启同一Compose栈后核对持久化
python scripts/check-rag.py --resume
# 浏览器验收；后续可用 --continue-run 复用已完成的付费阶段
node scripts/check-rag-browser.cjs
```

Go worker复用Asynq，单任务执行，Python解析进程限制页数、输出大小和图片尺度，OCR模型在镜像构建时初始化验证；运行不依赖GPU。仅本项目`materials-data`新卷保存原件，旧PostgreSQL卷保持原路径。默认基座也使用向量扩展镜像，以保证新迁移可执行；RAG模型调用仍须显式启用。停机使用同一组`-f`参数，不能删卷重建来掩盖数据问题。

若默认Go代理连接失败，对api与worker构建同时加`--build-arg GOPROXY=https://goproxy.cn,direct`；其余构建参数保持一致以复用缓存。浏览器脚本使用上文的NODE_PATH与Edge配置。HTTP和浏览器断点记录是本地构造场景的恢复入口，不作为公网运行脚本。

文件限制：30MiB/个、10个/批、200页PDF或PPTX，解包上限200MiB、提取上限200万字符，单图最多2400万像素。文本按UTF-8读取。OCR和视觉候选须教师核对后才能使用；印刷公式、原生图表及简单图像样例的实际覆盖见[验收记录](research/three-module-acceptance-2026-11-12.md)，复杂公式／图表和手写不据此视为已验。正文过长分段处理，不静默截断。

`model_budget/model_calls`是本轮联调的共享预留账。示例profile使用每Token微元保守费率（Embedding输入1，生成输入10/输出40），不冒充供应商账单。50元包含预检留账；未知/超时调用按预留额保守计入，不自动免费重试。默认profile为`text-embedding-v4`1024维和`qwen-plus`；变更Embedding配置后重建新空间，完成后才切换。

## 本地账号、身份与成员接入

启动迁移后执行`pwsh -File scripts/seed-s1.ps1`，生成四个账号与随机密码，保存在被Git忽略的`.local/s1-accounts.json`；终端不打印密码。教师T/U分别为`s1-teacher`/`s1-teacher-other`，学生A/B为`s1-student-a`/`s1-student-b`。两名学生选同一门发布课程；另有不归属课程、教师草稿、两个知识点。旧demo账号不具备登录密码。重复seed复用本地文件和数据库，不覆盖已有身份；丢失文件时不要删除数据卷或强行重置密码，由李然核对后处理。

DB仅存bcrypt哈希与会话token的SHA256摘要。会话8小时，HttpOnly、SameSiteStrict、Path=/api/v1；本机HTTP下`SESSION_COOKIE_SECURE=false`，不要在普通HTTP启用后误判登录异常。将来HTTPS代理需补可信来源配置，当前Compose没有TLS。登录页按实际账号确定身份，不再提供无效角色选择；前端身份不得读sessionStorage或localStorage。退出使DB中原token失效。依赖异常503，禁止回退到任意密码登录。

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

浏览器检查使用本机Playwright与独立无痕上下文，读本地账号文件，不写参考站、不影响用户当前会话。`node scripts/check-s1-browser.cjs` 是当前平台浏览器回归的兼容入口，实际执行check-platform-browser.cjs；测试21个主要页面的双尺寸与真实教师/学生操作，不再运行旧localStorage演示。Node/Playwright环境见上节。

历史.local/s1-handoff.json不再由check-s1.py更新，实际业务ID由check-platform.py写入.local/platform-check.json。结构化逐点目标见[contracts](contracts.md#s1-l3交给s2的人工评分契约)，不能把整题评分误写为完整rubric实现。

## 本地检查与CI

```powershell
python scripts/check_docs.py
git diff --check
python -B F:/vibe-coding/scripts/workspace.py check --repo F:/vibe-coding/school/HaJi_Mark
```

CI沿用必需检查名 `collaboration-check`，覆盖Go测试/vet/构建、前端类型/构建、sqlc生成一致性、Compose配置和文档来源检查。所有步骤必须通过该job才成功；每次以PR或集成分支对应SHA的远端执行为准，本地成功不替代远端执行记录。

冒烟验证覆盖静态入口/深路由、live、ready、已发布构造课程/草稿过滤；它只说明工程骨架链路。业务验收与AI效果按backlog和evidence另做。Docker没启动时报告未验证，不以静态页面截图代替数据库运行结果。

## 验证资源预算

题库本地验收：先串行构建RAG覆盖配置的api、worker、web，再`docker compose -f compose.yaml -f compose.rag.yaml up -d --no-build api worker web`执行增量迁移与启动。受网络影响时Go构建可显式传`--build-arg GOPROXY=https://goproxy.cn`，不改仓库的默认代理配置。

```powershell
python -B scripts/check-question-bank.py --real-ai
# 若真实评分已成功而最后核对中断，可仅续查反馈与来源边界，不再调用模型
python -B scripts/check-question-bank.py --continue-real
# 使用上文Node / NODE_PATH设置，--real-ai会真实生成候选并计入共享预算
node scripts/check-question-bank-browser.cjs --real-ai
docker compose -f compose.yaml -f compose.rag.yaml restart api worker web
python -B scripts/check-question-bank.py --resume
```

不加`--real-ai`仅做人工题库与固定版本验收。脚本只允许本机固定地址，读取忽略凭据，保留有标签课程与记录；确认操作是自动化测试账号行为，不是独立教师审核。结果保存在`.local/question-bank-check.json`、`.local/question-bank-browser.json`及桌面／移动截图。Go新增依据读取回归在隔离schema运行，避免将索引内部tsvector列误作JSON依据读取。

按preflight模板保留以下任务成本/I/O记录。时间来自本轮日志，内存仅为预算/限制，未测RSS峰值，不把预算称为实测。

| 任务 | 时间/类别 | 内存预算与外部资源 | 读 → 写 |
| --- | --- | --- | --- |
| 前端本地build | 本轮Vite约9秒，Light | NODE_OPTIONS限512MB；含依赖暂预留1GB | web/src、锁文件 → web/dist（忽略） |
| Go检查与编译 | 首次分钟级，缓存后秒级；按Moderate预留 | GOMAXPROCS=2、GOMEMLIMIT=768MiB，含编译子进程预留2GB | Go/SQL生成物、go.sum → Go缓存 |
| Docker后端build | 首次约4—5分钟，按Moderate预留 | 镜像下载、Go/Goose编译；不与其他构建并行 | backend → 本地镜像/构建缓存 |
| Docker前端build（2026-10-29） | 缓存构建约10—15秒，Light | Node堆限512MB，预算1GB；未测峰值 | web/src与锁文件 → hajimark-web:local与构建缓存 |
| 浏览器平台/设计检查 | 单次约1分钟/10秒，Light | Edge无痕上下文，预算1GB；串行执行 | 本机Docker与忽略凭据 → 有标签业务记录、.local截图；设计检查只写会话/截图 |
| Compose与冒烟 | 秒至分钟级，Light | 本项目小型PG/Redis，无模型/GPU | 迁移/种子 → hajimark专属数据卷 |
| 文档/哈希/元数据检查 | 秒级，Light | 无网络 | 当前文档、原件哈希、清单 → 标准输出 |
| RAG浏览器与真实接口验收 | 含OCR/模型等待，单次通常数分钟，按Moderate预留 | Edge预算1GB；worker空闲约160MiB，OCR峰值待量测；无GPU | 有标签本地课程/私密profile → 原件卷、任务、模型共享预算、.local证据 |
| Agent真实闭环与界面验收 | 各phase独立执行，单次秒至分钟；长任务按Moderate预留 | 运行推进最多2槽；浏览器与构建串行，无GPU | 本机API／Worker与忽略凭据 → 有标签业务、持久对话、共享50元账本及.local记录；verify不调用模型 |

共享写入：sqlc写internal/store，npm写package-lock/dist，Compose迁移/seed写数据库；运行生成/迁移时不要同时手改这些目标。批量任务按总内存重估；未知任务先探测，再安排。受资源压力影响时只继续小检查，暂缓新构建。

应用构建串行，暂按Docker构建＋依赖下载峰值≤4GB、5—15分钟估算；前端构建通常<1GB，Go首次编译依赖可能更久。构建前检查可用内存与Docker状态；未知任务先小步探测，失败后查日志再重跑，不重复叠加完整构建。当前Windows约40GB内存、初查空闲约22GB，实际结果见verification。不做GPU任务、无长驻后台计算。


## 工作台交互回归（2026-11-05，本地）

2026-11-12路由分区回归：`node scripts/check-navigation-browser.cjs` 使用本地Docker和忽略的S1凭据，创建带标签的课程，验证课程管理／目录／资料／题库的页面归属、同模块切课与旧对象清理、未保存编辑拦截、旧链接跳转、拆题来源深链及学生笔记持久化；检查1440/390px布局。报告与截图在 `.local/navigation/`，不调用模型、不访问公网。原平台、设计和工作台脚本已按新入口调整，断言仍检查真实服务端内容。

本地人工演示凭据与课程ID保存在忽略的 `.local/manual-demo-accounts.json`，与自动化S1账号分开。创建的演示课程采用自编资料，不伪装成AI生成或真实教学结果；后续验收继续用自动化账号，避免演示列表积累测试记录。

`node scripts/check-workspace-browser.cjs`读取忽略的本地种子凭据，只允许固定回环地址；创建有标签的两题作业和21次提交，保留数据。覆盖分页与权限、十份连续查看和20条分页边界、Unicode原文引用、评分复制/编辑恢复、慢保存竞态、失败恢复、逐题提交、发布隔离、具体反馈→任务→新证据→复查，以及12条路线的1440/390px布局。结果和截图保存在`.local/workspace-check.json`、`.local/workspace-*.png`。不是模型效果实验。

先串行`docker compose build api`、`docker compose build web`，再`docker compose up -d --no-build api web`。Node路径与NODE_PATH沿上文配置。旧平台/评分/设计/导出回归脚本已按新分区、抽屉、确认框和带课程URL维护；不能以旧DOM选择器失效代替业务失败诊断。

未保存编辑仅按账号+对象保存在当前浏览器会话。关闭浏览器会话可能失去尚未上传的编辑；页面明确区分“暂存”和“已保存到平台”。测试构造失败只在Playwright请求拦截中发生，不修改服务端生产开关。


## 三模块与整组重评验收（2026-11-12）

API、worker、web分别串行构建，使用同一组compose.rag覆盖启动。DeepSeek视觉按需调用，profile关闭thinking；原图经教师确认才进入可靠片段，KaTeX只渲染文本中的数学表达式。公开URL只抓指定页和相关图片；新导入解析成功会自动发起索引与目录／分类建议，故导入测试也可能产生模型费用。

```powershell
docker compose -f compose.yaml -f compose.rag.yaml build api
docker compose -f compose.yaml -f compose.rag.yaml build worker
docker compose -f compose.yaml -f compose.rag.yaml build web
docker compose -f compose.yaml -f compose.rag.yaml up -d --no-build api worker web
# 新验收环境才按顺序执行各phase，不要在现有课程重复core/regrade/paging
python -B scripts/check-material-workflows.py --phase core
python -B scripts/check-material-workflows.py --phase ai
python -B scripts/check-material-workflows.py --phase retrieval
python -B scripts/check-material-workflows.py --phase regrade
python -B scripts/check-material-workflows.py --phase paging
python -B scripts/check-material-workflows.py --phase edge
python -B scripts/check-material-workflows.py --phase edge-ai
node scripts/check-material-workflows-browser.cjs
docker compose -f compose.yaml -f compose.rag.yaml restart postgres redis api worker web
python -B scripts/check-material-workflows.py --phase resume
```

脚本仅连接本机18080、保留有标签课程、1000条构造题目和全部审计，不清表。core的`--continue-run`复用已有核心对象；ai和浏览器会追加确认修订，regrade会改构造课程正式成绩。edge/edge-ai复用已有任务；真实模型在数据库共享50元预算内记账。浏览器13组检查复用真实候选，503只在该浏览器请求中注入；不是独立教师审核。原始任务、JSON、截图与账号均留在忽略的.local，不能发布为教学数据。

worker每15秒检查恢复；执行超时11分钟、失联判定15分钟。中断的生成类任务标记失败，须显式重试；超过15分钟仍reserved的调用保守按全预留额转unknown，保留原调用记录，不自动重复扣账。解析／索引按已有幂等过程恢复；未知Embedding调用同样保守计费。全容器重启只验证持久化，不等同于所有任务kind的运行中故障注入。

本次实际覆盖、模型失败、预算和未验场景见[验收记录](research/three-module-acceptance-2026-11-12.md)。

仅复查已载入内容的布局时：`node scripts/check-material-workflows-browser.cjs --layout-only`，不确认新修订、不发模型请求，结果另存material-workflows-layout.json。
