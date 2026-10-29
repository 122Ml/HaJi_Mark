# 工程与前端验证记录

以下旧S1/前端记录按发生阶段保留。当前状态以本页最新收口/部署记录为准；旧“尚无提交/评分、仅localStorage”的结论不再适用于当前代码。历史测试结果不自动移用到新版本。

## 2026-10-29 按钮与阴影细节复核

按用户反馈将登录及业务主按钮统一为纯青绿色，移除渐变/内高光，Ant Design按钮由主题管理，不再用全局背景覆盖其状态。统一8px按钮圆角，减轻按钮、卡片和悬停阴影；登录流程图卡片圆角统一16px。主视觉和插图区保留渐变，界面精简文案不变。

Docker类型/构建通过，最终镜像 `sha256:f195ce141f48674305c8410f3d0cdd248b5834aaee3c38309b810df2b8a00ec0`。设计浏览器检查通过，包括真实登录/退出、双角色导航、焦点/别名、390/768/1024/1440px布局；另读取登录按钮正常/悬停/按下的computed style，background-image均为none且圆角8px。已人工查看最终登录截图并更新六张示例。此次仅样式调整，未重复运行上一轮已通过的全业务写入回归；未更新公网。

## 2026-10-29 第二轮样式自检与界面文案精简

用户要求重新对照七张WebP并移除README式说明。已逐张查看完整参考图及按钮/卡片局部；第一版并非完全复刻，胶囊按钮、整片浅绿画布、通用圆角标题横幅和入口说明均有偏差。本轮改为白色画布、8px青绿渐变按钮、16px轻阴影卡片、标题下方的渐变插图区；登录主视觉渐变到白色。分类标签仍使用小胶囊。

移除课程/作业/互动/教研/干预/学习路径页头的静态功能介绍、快捷入口说明和英文编号、登录页重复宣传区及页脚口号；教师概览标题缩短为“教学概览”。保留实际作业说明、反馈、资料来源、错误与必要操作限制；规划规则放入“查看规划依据”。无业务请求、状态机或权限变更。

- 最终Docker TypeScript/Vite构建通过；镜像 `sha256:d97b5407bb6a5d6b2e4200d6fcea0f7d1a53d6832e342e85ff188a04d1f41a2f`。主JS 648.77kB，保留Vite拆包提示。
- 完整Edge/Playwright平台回归通过：12教师＋9学生入口×1440/390px；课程、作答、评分、干预、互动、路径、导出、改密、跨标签切换与目录导入通过，无pageerror或意外API 5xx。
- 设计检查重新执行，覆盖390/768/1024/1440px、四组导航、焦点、旧地址、截图；增加入口无说明段落及已删除静态文案的断言。
- 六张页面示例从最终镜像更新。视觉依据及剩余差异写入 [design.md](../design.md) 的“第二轮对照结论”。

结论：完成样式偏差修正与文案精简，**仍不宣称七张营销页逐像素完全复刻**。中文字体、品牌、图片/插画、内容布局和真实业务导航不同，无SSIM或像素一致证明。仅本地验证，未更新公网。接手前已有的查询修复与参考图仍保留原状。

## 2026-10-29 Lattice 风格前端与导航收束（本地）

接续本地 Claude Code “Casual greeting” 会话 `1c0e3870-8b69-47dc-b744-bc0ab35043cc`。接手时只有未接入的 `app/theme.ts` 设计文件；已有 `live/context.tsx` 查询竞态修复与 `check-platform-query-race.cjs` 保留原样，未纳入本次设计提交。下列运行结果来自包含该既有修复的实际工作树，不代表设计提交单独提供了竞态修复。

实现活动登录页、四组主导航与二级功能入口、账户操作、工作台快捷卡片、全局青绿主题及业务表单/表格/目录样式。重复概览与课程地址归一，保留规范对象深链接和查询参数。旧 replica 登录页与 CSS 保留为历史文件，活动页面已解除旧全量样式依赖。设计变量、路由表、页面模板与六张截图见 [design.md](../design.md)。

| 验证 | 实际结果与范围 |
| --- | --- |
| Docker 前端构建 | TypeScript 与 Vite 通过；最终 CSS 16.82kB（gzip 4.20kB），JS 651.99kB（gzip 207.80kB）；保留大于500kB的拆包建议，未隐藏警告 |
| Compose 本地运行 | PostgreSQL、Redis、API healthy；web在127.0.0.1:18080；使用既有卷与后端镜像，未执行数据清理 |
| check-platform-browser.cjs | 完整师生课程/作答/评分/干预/测验/路径/互动/资源修订、CSV、账号、改密、跨标签隔离通过；12教师＋9学生入口在1440/390px通过，无页面异常或意外服务端错误 |
| check-design-browser.cjs | 最终镜像通过；登录390/768/1440px，工作台390/768/1024/1440px；四组导航、SPA焦点、概览/课程/评分别名与查询参数、退出通过 |
| 既有 check-platform-query-race.cjs | 教研与行业记录首次读取落后于写入的两条回归通过；原有脚本与修复未改动 |
| 文档/来源/元数据 | check_docs.py检查design.md及截图链接；Compose配置、Git空白和工作区catalog检查，结果见本轮命令输出 |

完整业务回归后仅补齐剩余角色别名与手机标题均衡换行，并在最终镜像上重新运行针对性设计检查。浏览器早期发现Ant Design自动将“登录”插入空格，关闭autoInsertSpace后完整流程通过。

最终本地Web镜像ID：`sha256:58245335c38773a49d145fd0eb562fe792ce1d81c3ca4c116a689097448fc491`。截图由该镜像生成，输出位于`.local/design`，六张交付示例复制到`docs/design-examples`。测试数据为有标签的构造课程，保留在本地数据库。构建约10—15秒；运行时Web约10MiB、API约6MiB、PostgreSQL约38MiB，仅为一次采样，不是峰值。

本轮未推送GitHub、未部署公网、未调用真实AI；未声称像素相似度、全量无障碍认证或生产级负载通过。生产部署记录保留原日期和版本。

## 2026-10-28 CO-01/AS-01适配合并与S1收口

用户授权在当前codex/platform-completion合并两份交付、补全S1全部12项并部署hajistudy.online。两包基于旧快照，采用当前learning/live适配合并，原补丁/ZIP哈希和采用映射保留[贡献记录](../references/contributions/README.md)。不复刻旧X-Actor-Id认证、不覆盖当前路由、迁移或业务数据。

新增source_note、服务端提交名单与真实时间线，提交事件与原文同事务；迁移00008对已有提交回填事件，对已有学习记录补对象版本。学习记录去重完成数，重复发布409；新增PUBLIC_ORIGIN适配HTTPS且不接受伪造代理协议头。浏览器复验发现草稿初载可覆盖快速输入，已在原草稿加载完成前隐藏编辑表单并通过复验。

公网首次浏览器复验进一步发现：保存多题后立即重新进入编辑页，旧Query缓存可先被当作初值，后到的新查询因初始化锁被忽略，导致页面仍显示一题但数据库已有两题。修复为等待本次挂载请求完成后初始化一次，继续保持后台刷新不覆盖用户输入；用既有“保存两题→立即重开”真实场景回归，不以增加测试等待掩盖问题。

| 本轮本地检查 | 实际结果 |
| --- | --- |
| Docker Go构建/全包测试/vet，真实PostgreSQL | 通过；CO01/AS01回归覆盖发布不回退、来源必填、同请求换内容/跨作业409、名单、事件唯一性和未发布课程隔离 |
| TypeScript与Docker Vite构建 | 通过；沿现有师生页面接来源/名单/时间线 |
| 真实HTTP完整平台检查 | 通过；含评分前一交一未交名单、原文/哈希与s1_handoff、评分/规则/干预、权限、关闭/截止和AI未配置 |
| Edge/Playwright真实双会话 | 通过；新增评分前师生时间线与来源核查；12教师+9学生路由×1440/390px；无pageerror/意外服务端错误 |
| API/PostgreSQL重启后resume | 通过；旧提交、评分、干预仍保留 |
| 迁移前备份与独立恢复 | 通过；归档及恢复证据留.local/backups，未清业务数据 |
| sqlc1.30.0重生成 | 字节一致 |
| docs/来源哈希/原图/Compose/Git空白/工作区check | 通过；贡献补丁另有SHA256校验；工作区通过只说明元数据 |

服务器已签发hajistudy.online证书并配置本域名OpenResty；应用镜像冻结、远端启动和公网业务验收结果在部署完成后补记，不能以证书成功当业务上线成功。没有GitHub同步、真实AI或成员独立验收签字。

## 2026-10-28 整个平台完善（本地）

基于7b4f0a7，在codex/platform-completion完成跨原分工的基础教学平台。用户明确要求AI保持未配置，未做真实模型调用；没有fetch/push、远端PR或成员消息。实际实现见architecture/contracts，原始材料与三个历史SVG保持不变。

- 课程、目录、知识点依赖、资料审核/修订、学习记录/笔记、作答草稿/原文、多题作业草稿编辑、人工评分修订、客观规则结果、证据画像/路径、干预/复查、互动、账号与教研/行业记录接PostgreSQL。
- 当前活动前端web/src/live，原replica为历史参考。历史SSIM不代表当前真实平台视觉；没有宣称90%—95%复刻或生产就绪。
- 迁移00003—00007已落地；00001/00002不变。曾将00004已有来源字段误放重复迁移，迁移报重复列后纠正：恢复原00004定义并移除尚未成功应用的重复迁移，再以00005—00007各自承载新内容。未删除Goose历史、未重建业务库或卷。
- 联调发现API重建后Nginx仍缓存旧IP，改为Docker DNS解析；发现课程首次加载卸载表单导致输入重置，改为上层等待课程；作答/笔记/编辑表单只首次初始化，后台刷新保留未保存输入。扩展浏览器复验发现SPA切换路径会残留表单、跨标签账号切换会残留私人数据，已改为按路径重建页面、按actor清理Query缓存并重建课程Provider。删除正在编辑的教研/行业记录也会清空编辑器。客观测验浏览器验收发现嵌套label造成首个选项名称合并，改为独立radiogroup和逐项标签。

| 已实际运行 | 结果与边界 |
| --- | --- |
| Docker API/Web构建、TypeScript/Vite | 通过；本次最新主JS约407KB，未修改依赖锁文件 |
| 实际PostgreSQL Go test/vet | 通过；identity和learning独立schema应用全部迁移，含四个并发同号提交只生成一个attempt、草稿隐私、最新修订确认发布、跨课程/本人/CSRF拒绝 |
| check-platform.py | 通过：课程改名/目录原子导入、草稿过滤、资料历史、学习幂等/笔记、题目冻结/版本/来源、Unicode/hash/attempt、评分边界与发布、证据去重、测验答案隐私/规则结果、干预下发后新学习及多题补练全部提交才可完成、互动、教研/行业CRUD、账号开通/改密撤销、AI未配置 |
| check-s1.py | 通过：登录、角色/课程/学生隔离、CSRF/Origin、退出撤销；与新增课程并存，不覆盖旧交接记录 |
| 双独立Edge会话 | 主观题与教师正式反馈、学习笔记/草稿跨刷新、未保存作答刷新不丢、多题草稿编辑、资料修订依据追溯、干预复查、客观测验创建/作答/规则反馈、规则路径保存、跨标签页账号切换清理私人表单全部通过；当前主要21页面×1440/390px无pageerror和横向溢出 |
| API重建与数据库重启 | Web保持运行时force-recreate api，网关恢复就绪且原文/评分/干预可读；再重启postgres并等待健康、重启api，--resume复查仍通过 |
| 本地备份与隔离恢复 | backup.py --verify-restore通过；pg_dump归档可读并实际恢复到唯一临时库，提交与评分查询通过后仅删除临时库；备份与摘要保留.local/backups |
| 数据库与测试隔离 | Goose版本7，auth_test/learning_test残留schema为0，业务数据保留 |
| sqlc1.30.0重生成 | 逐字节一致，生成文件未手改 |
| 文档与Compose/治理 | check_docs检查23份当前文档、12份历史副本与四个原模块入口通过；Compose配置、冒烟、Git空白与工作区check/audit通过（后者仅元数据检查） |

测试创建有明确“自动验收/浏览器验收”标签的独立课程和学生记录并保留；浏览器还验证了CSV正式结果导出、教师开通学生、姓名/密码修改、参考目录116节点导入和移动无横向溢出，用于重启复查。凭据仅在忽略的.local/s1-accounts.json；真实业务ID在.local/platform-check.json；当前截图在.local/platform-teacher.png和platform-student.png。不会清空他人数据或把测试内容当教师提供资料。公开参考站只读观察，未写教学业务。有限密钥模式扫描未发现命中，.env/.local未纳入Git；不宣称扫描可证明没有任何敏感信息。构建串行，Go限制2核/768MiB；本轮Windows空闲内存约13GiB，未测进程峰值。

当前可本地试用人工/规则闭环。AI按要求关闭；没有结构化逐点rubric/引用核查、AI评阅或独立教师效果评测；行业是人工记录而非自动招聘采集，图谱是依赖卡片，资料是文本/链接。未做公网TLS、多机构、负载/渗透验收，也没有成员独立人工复验或教师验收签字。


## 2026-10-28 S1再次自检

按用户“自检一遍”要求，基于`24e4c28`逐项核对S1-L1/L2/L3、代码、数据库、契约和开发入口。结论：L1/L2实现与本地自动化复验通过，L3契约已就绪但真实提交/资料联调未完成；不能确认李然S1三项全部完成，也不能把前端演示当真实业务验收。成员人工交叉复验未代填。

本次发现并修复开发入口遗漏：vite.config.ts将/api指向宿主8080，但Compose只开放18080。复现时Compose的/health/live为200、临时Vite入口15173为500，Vite日志显示ECONNREFUSED 127.0.0.1:8080。改为代理本机18080网关并保留Host，避免破坏Origin校验；用`python scripts/check-s1.py --base http://127.0.0.1:15173`验证登录、授权、CSRF、课程查询和退出通过。开发说明补启动前提，临时Vite服务验证后停止。course入口中旧“没有登录”说明已校正为由公共identity提供。

| 本轮实际复验 | 结果 |
| --- | --- |
| Docker backend-test：全包Go测试与vet，实际PostgreSQL环境 | 通过；独立schema清理后残留0，未改业务表 |
| Compose HTTP：错误登录、角色/学生/课程隔离、CSRF、退出撤销 | 通过；有效写检查仍明确persisted=false |
| API重启留存及既有冒烟 | 保存会话→restart api→就绪冒烟→恢复身份通过；测试cookie清除 |
| Docker Web的TypeScript/Vite构建 | 通过；更新的开发代理配置纳入构建检查 |
| 独立Edge/Playwright | 真实身份验证及26路由×1440/390px通过；无横向溢出、无pageerror，原四条演示流程通过 |
| sqlc/Docker配置/文档历史/Git空白 | 重生成与跟踪代码一致；Compose配置通过；23份当前文档、12份历史副本与三个原图保留；空白检查通过 |
| 凭据与工作区 | 4个S1账号密码列均为bcrypt；.env/.local未追踪，账号/交接文件被忽略；工作区check通过 |

阻塞证据：backend/internal/assessment只有README；迁移仅00001/00002；public schema没有submission/resource相关表；本地交接中的actual_submission_id与actual_rubric_version仍为null。缺S1-A2/A3的不可变原始提交及C1/C2的可定位资料版本。李然需在上游到位后核对实际submission_id、attempt、题目/作业版本、原文hash、资料片段和课程归属并记录上游SHA。目前不应实现一份替身提交来填完成率，亦不提前实现S2评分。交接脚本的blocked_by已更正为这两个S1依赖，避免把S2 rubric持久化误写成S1完成门槛。

本轮Windows可用内存约14.3GiB；构建串行，无模型/参考站业务调用和GitHub同步。已有Compose数据卷和其他项目未操作。

## 2026-10-28 S1李然本地身份与契约交付

实现提交`5b2fdbd5dd3b7b1b17c6d6a42d47ec2a20e9bf31`，本地分支`codex/s1-liran`，基于`ad0b91f`。用户本轮要求仅本地开发，未fetch/push、未建远端PR、未运行远端CI；以下为本地实际执行结果。未代填成员人工审核、工时或教师验收。

| 检查 | 实际结果 |
| --- | --- |
| Docker后端构建 | API/worker/seed-s1/Goose镜像构建通过。第一次依赖下载长时间无输出后停止本任务构建，改为go mod download -x；第二次下载约358秒、应用编译45秒、Goose约46秒后成功，构建串行；未改全局代理 |
| 迁移与种子 | 00001保留，00002执行成功，DB版本2；seed-s1连续两次成功，4账号仍为同一ID/凭据，密码列均为bcrypt；无明文密码入库或终端输出 |
| Docker Go测试/vet | `docker compose --profile test build backend-test`及`run --rm backend-test`通过；TEST_DATABASE_URL实际指向PostgreSQL，独立schema跑迁移/会话/归属回归，结束后auth_test_*残留0。普通未带DB环境的本机定向测试也通过，但未用它替代集成结果 |
| 会话与权限 | `python scripts/check-s1.py --save-session`通过：错误/未知凭据401、外源登录403；学生A/B隔离、跨课程/教师角色/草稿访问拒绝；教师不能查另一教师课程；缺失/伪造/另一会话CSRF及外源写入403；有效CSRF返回授权示例且persisted=false |
| 撤销、旋转、过期 | HTTP退出后复用旧cookie401；Go集成覆盖重新登录旋转旧token、过期401、另一会话保持有效、Secure配置及DB仅存token哈希；无凭据/会话泄露到响应 |
| API重启 | 保存会话后`docker compose restart api`，冒烟就绪后`check-s1.py --resume-session`仍识别学生A；验证后退出并删除本次测试cookie文件，保留数据卷 |
| 前端/Docker Web | TypeScript检查、Docker内tsc/Vite构建通过；Nginx保留Host端口，实际浏览器JSON登录和CSRF写检查通过 |
| 浏览器真实身份 | 本机Playwright运行`check-s1-browser.cjs`通过：匿名跳登录、错误密码拒绝、故意选择相反角色仍按DB跳工作台、刷新恢复、课程读取/CSRF、学生改教师URL拒绝、退出后/me为401 |
| 原前端回归 | 26路由×1440/390px共52次，无页面横向溢出、无pageerror；作业草稿隔离→发布→提交→终审→反馈、干预全流程、公告、测验均通过。这些业务仍为localStorage演示，不计真实S1提交/评分完成 |
| 验证工具修正 | Playwright MCP调用超时300秒，改用桌面附带Node/Playwright＋独立Edge无痕上下文。首次回归脚本仅等待h1，因既有部分页面用h2/h3超时；改为等待业务标题并排除新课程卡后全部通过，无需修改业务页面 |
| 生成代码/资料 | Docker sqlc1.30.0重生成前后哈希一致；check_docs通过23份当前文档链接、12份不可变副本及模块入口，三个原SVG未修改 |
| 工程治理 | Compose配置、Git空白检查及工作区check/audit通过。导航首次检查提示seed入口不在identity模块目录，已归入runtime后复验通过；只说明元数据纳管，不表示生产可发布 |

S1-L1/L2实现及本地自动化验证完成，成员交叉复验仍待执行。S1-L3已交付[评分契约](contracts.md#s1-l3交给s2的人工评分契约)与[evidence](evidence.md)，包括rubric、原文hash/版本、逐点请求/返回、code point引用、确认发布和反馈过滤边界。尚无assessment正式提交服务及course资料版本服务，真实submission_id联调未完成；GR-01/S1全链路不能记为已完成。

真实构造课程ID为`89bc8c28-80fa-4571-acca-53e62c5c450a`，其余实际ID见本地`.local/s1-handoff.json`，`actual_submission_id/actual_rubric_version`保持null。密码仅见被忽略的`.local/s1-accounts.json`，重复seed不重置。上游提交到位后按contracts清单再核对实际submission/资源、记录上游SHA及重启结果。

本轮开始前Windows可用内存约14.8GiB，应用构建串行，Go GOMAXPROCS=2/GOMEMLIMIT=768MiB；未测峰值。未调用模型、不写参考站、不操作其他Compose项目、不删除卷。预览保留运行在`http://127.0.0.1:18080/login`，可按README停止本项目并保留数据。下方记录为各历史阶段事实，以本节作为当前S1状态。

## 2026-10-28 GitHub初始化同步

用户已授权将必要成果上传。初始化内容通过 [PR #2](https://github.com/122Ml/HaJi_Mark/pull/2) 从codex/bootstrap进入codex/integration；main保留e4c096e稳定基线，不直接推送受保护分支，不修改审核与必需检查规则。

- 上传前检查146份跟踪文件及3个未发布成果提交：约3.82MiB，常见密钥格式、签名资源链接、运行缓存路径和超大文件未发现命中；这是有限规则检查，不声称可证明所有敏感内容不存在。研究下载、凭据封装、.env、node_modules、dist和日志均保持忽略。
- 提交2002f37的 [GitHub Actions](https://github.com/122Ml/HaJi_Mark/actions/runs/40653380851) 已实际通过collaboration-check：审核归属/合并方向、Git空白、Go测试/vet/构建、sqlc重生成一致性、前端安装/构建、文档及Compose检查。
- 当前容器冒烟再次通过：live/ready、课程发布过滤和SPA深路由。没有新增模型调用或参考站业务写入。
- 同步时若新增提交，必须等最新SHA的PR检查通过才合入；集成分支push后的最终运行结果以 [Actions](https://github.com/122Ml/HaJi_Mark/actions) 为准。下方初始化/前端阶段的“未上传”记录保留为当时事实。
- 本地已解除原push URL阻断，保留push.default=nothing，不配置后台同步。源码、文档、截图对照和历史副本正常纳入Git；只清理由本次工作创建且已合并的临时分支，未合并成员分支不清理。

## 2026-10-28 前端复刻增补

沿用指定 ai-website-cloner-template 的观察／实现／比较流程，具体范围和差异见 [复刻记录](research/frontend-rebuild.md)。本轮只修改前端、验证脚本及文档，Go 业务没有新增实装。

| 检查 | 实际结果 |
| --- | --- |
| TypeScript / Vite / Docker Web | 本机和 Docker 构建通过；按页面模块懒加载，最大块约456KB，无大块警告 |
| 容器运行与既有 API 冒烟 | `docker compose up -d`、`scripts/smoke.ps1 -ExpectDemo`通过；既有数据卷保留，只启动hajimark项目 |
| Playwright 路由回归 | 26 路由×1440/390px，共52次访问，无页面横向溢出、无pageerror |
| 作业闭环 | 新建草稿不对学生可见；发布后提交，教师确认88分和评语，学生可刷新查看 |
| 干预闭环 | 草稿→推送→接受→作答→教师复查通过 |
| 互动／测验 | 教师公告在学生详情可读；教师发布示例测验后学生作答得到100/100 |
| 视觉对照 | 20主页面，首屏平均SSIM0.9809，共有高度平均0.9645；原始尺寸、高度差异及逐页结果保留JSON，不能当真实业务完成率 |
| 宽屏／移动补查 | 登录、学生首页、教师看板在1920/390px均无页面溢出；移动导航保留可滚动入口 |
| 文档与历史 | 23份当前文档链接、12份历史副本哈希与三个原图保留；工作区check/audit均通过，只说明元数据纳管 |

浏览器检查脚本 [frontend-browser-check.js](../scripts/frontend-browser-check.js) 使用独立测试标签，结束后还原本地演示存储。无远站业务写入、模型请求或GitHub推送。本地页面数据未接入后端认证和数据库，不作为真实教学系统验收。

## 初始化阶段记录

日期2026-10-28，Windows / Go1.26.1 / Node22.22.0 / Docker Engine29.7.2。业务功能和AI评测未开始，历史Python探查不算当前Go接入验收。

| 检查 | 实际结果 |
| --- | --- |
| `go test ./...`、`go vet ./...`、`go build ./cmd/api ./cmd/worker` | 通过；定向测试覆盖依赖失效不误报就绪、课程不可用503、未实装评分路由404 |
| `npm run build` | TypeScript与Vite构建通过；产物约799KB JS，有大chunk提示，后续按页面增长再拆分 |
| npm依赖审计 | 首次发现React Router/Vite漏洞，精确升级到7.18.5/7.3.7后安装审计为0已知漏洞；不等于永久无漏洞 |
| sqlc1.30.0重生成 | 输出逐字节一致；已提交生成代码，不手工伪造 |
| `docker compose config --quiet` | 通过；只绑定本机web端口 |
| 后端Docker镜像与Goose迁移 | 构建通过，迁移00001执行成功，数据库版本1 |
| 容器内live/ready/课程接口 | ready返回database/redis均true；seed前课程为空；seed后仅demo-boundary可见 |
| 构造种子幂等与发布边界 | 第二次seed各表新增0；数据库同时有published/draft，API不返回draft |
| API和数据库重启留存 | 重启后仍返回同一构造课程与知识点计数 |
| `check_docs.py`与Git暂存对象校验 | 22份当前文档链接、12份来源副本哈希、四个业务入口通过；历史字节保留，包含三个原SVG |
| 工作区`check`与`audit` | 通过；73个仓库目录/元数据检查无问题，只说明纳管信息，不说明生产验收 |
| 前端Docker镜像/完整冒烟 | 构建通过；`scripts/smoke.ps1 -ExpectDemo`通过：静态入口、深路由、live/ready及课程发布过滤 |
| 浏览器师生入口/窄屏 | 页面加载真实API课程示例；1440/375px无横向溢出；学生→教师→有据评阅导航正常；控制台无错误 |

本地分支codex/bootstrap；main与origin/main保持e4c096e，集成基线origin/codex/integration保持53909b0。本轮没有推送、远端PR、新模型请求或对参考站的业务写入。origin的本地push URL为disabled://local-only。

现有范围：工程骨架与公开发布课程摘要可运行。登录授权、真实课程编辑/提交/评分、画像干预、模型任务处理与独立评测仍按backlog建设；构造种子不是实际教师审核内容。新增CI定义仅本地保存，尚未在GitHub运行。当前平台不能作为真实教学系统部署。

初次前端容器安装长时间无日志，停止本任务的构建客户端后加入npm下载日志、30秒请求超时与一次重试；重新执行安装43秒、Vite约5秒完成，审计0已知漏洞。保留首次下载缓存，没有修改全局代理或其他项目配置。Docker启动时发现本机已有其他项目自动启动的容器，未操作它们。

验收后将hajimark本项目容器停止（Compose down，不删卷），避免长期占资源；本地数据库构造示例保留，之后按README启动即可查看。未删除镜像、缓存或历史文件。
