# hajistudy.online Docker部署

2026-11-19：`v0.2.0`已发布，数据库00016、pgvector0.8.7、独立解析worker和资料卷已部署；GitHub已同步。公网模型未配置，无收费调用。[同步与验收记录](sync-2026-11-19.md)和[版本收据](releases/2026-11-19-v0.2.0.json)为本轮直接观测；下列旧日期状态保留为历史。

部署目标为154.201.71.22，Ubuntu22.04/2核2GB，既有1Panel/OpenResty。AI保持关闭。本目录的Compose只有固定镜像引用，没有服务器构建入口，不与本地开发Compose混用。

2026-11-11的资料/RAG开发仅在本地启用，本次未更新公网。迁移00010要求pgvector：今后发布包需同时携带基于原PostgreSQL 18.1构建的扩展镜像及`POSTGRES_IMAGE`，保留`/var/lib/postgresql`原卷。部署脚本已增加镜像打包/标签选择与迁移前数据库就绪检查，尚未执行新生产发布。现网旧release与旧Compose保留；本地OCR worker和密钥配置不自动进入生产。小内存服务器运行OCR的资源门槛须另验，不直接套用原96MiB worker限制。

## 运行结构

OpenResty的独立hajistudy.online站点终止TLS，反代127.0.0.1:18080→Web→API；PostgreSQL、Redis、API、worker均无公网映射。PUBLIC_ORIGIN固定https://hajistudy.online，登录cookie启用Secure/HttpOnly/SameSite；不信任客户端自带的X-Forwarded-Proto来决定登录来源。

生产目录：

- `/opt/hajimark/releases/<版本>/`：Compose、镜像清单、部署版本与运维脚本。
- `/opt/hajimark/current`：当前已启用release的符号链接。
- `/opt/hajimark/shared/.env`：数据库随机密码和当前镜像tag，仅root可读，不入库。
- `/opt/hajimark/shared/s1-accounts.json`：独立初始化与验收账号，随机密码，不复制本地课程数据。
- `/opt/hajimark/backups/`：PostgreSQL自定义格式备份与SHA256，不自动删除旧备份。
- `/opt/1panel/www/conf.d/hajistudy.online.conf`：本域名站点配置；不覆盖OpenResty全局配置。
- `/opt/1panel/www/letsencrypt/`：证书与ACME账户，私钥仅在服务器。

## 首次部署与升级

先在本地完成Go真实数据库回归、TypeScript/Vite构建、sqlc一致性、HTTP/浏览器与文档检查，提交后从干净源码构建不可变tag镜像。记录源SHA、镜像ID、导出包SHA256、迁移和Compose路径；镜像通过私有R2中转，在服务器校验后load，不在2GB服务器源码编译。

上传Compose和运维脚本到新的release目录，生成0600环境文件，执行：

```sh
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml config --no-interpolate -q
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml config -q
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml up -d --no-build
```

首次运行seed-s1生成随机、可重复执行且不重置的4个账号，用于课堂试用与交叉权限验收；教师可开通真实学生并创建自己的课程。2026-11-05按用户要求设置公网教师和学生登录凭据，保留原用户ID、课程及提交历史；最新凭据只在服务器shared目录与本机忽略目录保管。此后不对公网重跑固定用户名的seed-s1；验收脚本中的固定测试用户名须映射到现有账号。本地种子账号未变。自动验收只创建有明确标签的独立课程，保留测试记录，不用构造题当教师正式教学资料。凭据不放网页或README，不沿用1Panel密码。

更新前运行backup.sh并保留旧镜像、旧Compose和.env快照；只对本项目逐服务更新，禁止down -v。迁移00008增加来源与事件字段，00009增加标准版本和评分分项；均保留原业务表、提交/评分和资料历史。更新应用前须执行一次性migrate，统一脚本已包含该步骤。失败时保留现场；需要应用回退时明确选择旧release并核对schema兼容，不恢复旧数据库覆盖新增作答。

## HTTPS与运维

证书使用Let's Encrypt HTTP-01，先加载只处理本域名的80端口challenge配置，签发后使用openresty-hajistudy.conf。先nginx -t再reload；HTTP301跳转HTTPS，SPA深路由由Web处理。签发时没有提供邮件，不能依赖证书邮件提醒。

systemd定时器hajimark-cert-renew每天两次运行renew-certificate.sh，续期后仅reload既有OpenResty；可用--dry-run验证ACME续期。ACME客户端固定镜像digest，不随latest漂移。hajimark-backup每天执行backup.sh，校验pg_restore可读后保留归档；课堂持续使用前还应规划异地备份，当前未自动将学生数据库上传第三方。

公网验证：使用显式--allow-remote和本次服务器初始化账号运行check-platform.py；浏览器脚本通过HAJI_BASE_URL/HAJI_ACCOUNTS指定公网目标与忽略凭据。验证登录、发布、学习、草稿、提交、原文/名单、评分、干预、刷新和跨人隔离；同时检查证书、HTTP跳转、Secure cookie、容器health/OOM/restart和仅Web回环端口。

AI未接入；结构化逐点rubric已在本地和公网实现并验证，独立教师效果评测、负载/渗透测试仍属于后续工作。2026-11-05公网已升级至 `hajimark-platform-dcc1474-20261105`，源码为 `dcc1474dc608034477f2eae14d745e3aa6a875d6`，迁移00009保持完成。服务器资源与业务数据保留，发布前已执行备份。

## UI 重构版本发布

2026-10-31 起，镜像构建、导出、校验、上传、切换和回滚统一由 `deploy/deploy.ps1` 完成，步骤见 [DEPLOY.md](DEPLOY.md)。没有凭据时只生成并在本地验证 release 产物，服务器不受影响。


## 2026-11-05 工作台交互版本

按用户本次明确要求，公网更新到 `hajimark-workspace-f40872a-20261105`，应用源码 `f40872ad231735d56608158de108e9ddc72d58cc`。已发布三栏批阅、连续队列、引用定位、课程分区、学生自动保存与逐题回执、个人证据到补学补练的上下文。数据库仍为00009，无新迁移；AI保持关闭，公网账号沿用原配置。

发布前备份为 `/opt/hajimark/backups/hajimark-20261105T034235Z.dump`，已校验pg_restore可读。原12门课程、16份提交、15条评分修订、10份资料、3份标准版本、5条干预记录按ID及整行指纹复核一致。旧release `hajimark-platform-dcc1474-20261105`、镜像、环境快照和数据卷均保留。

发布包SHA256为 `3d78007a37d4dfffc03d6d8d9db252cfe809ce3d77c8be3be4ccdb095a8d4b47`。HTTPS确认加载`index-CKWNBOAf.js`，本地发布包/远端镜像的源码revision一致；健康与交互检查见[验证记录](../docs/verification.md)。


## 公网展示数据

2026-11-05按用户要求清理13门旧测试课程及4个辅助测试账号，公网当前使用一门完整演示课程。jiaoshi/xuesheng的ID与密码保留，显示名更新；演示学员为模拟内容。展示路线与直达链接见[演示说明](../docs/demo-walkthrough.md)，备份/清理和只读验收见[验证记录](../docs/verification.md)。旧验收脚本中的辅助账号和课程ID已失效；日常展示复查优先只读，不自动重跑写入式公网测试造回旧数据。

## 2026-11-12 静态设计图册

按用户要求将完整[交互图册](https://hajistudy.online/design-atlas/)发布到独立路由 `/design-atlas/`，可直达 [F02 概念 ER 图](https://hajistudy.online/design-atlas/#F02)。F02 将教师和学生拆为两个概念角色，并分别关联授课、选课、作答、人工复核、个人学习记录和干预任务；物理库继续使用统一 `users` 表。

本次只发布 `index.html`、27 个 SVG 与27 个 PNG，共55 个静态文件。没有发布结构快照、生成脚本或凭据。图中本地业务能力与模型链路不因图册可访问而成为公网应用功能；应用仍为 `hajimark-workspace-f40872a-20261105`，未执行迁移或应用升级。

- 图册源码：`31b8ad0286e147fc15bc9c60ebe754c53c1c8ae8`。
- 静态 release：`design-atlas-31b8ad0-20261112T042018Z`。
- 发布归档及记录：`/opt/hajimark/releases/design-atlas-31b8ad0-20261112T042018Z/` 下的 `atlas.tar.gz`、`release.json`；记录源 SHA、每文件 SHA256、静态目录和站点配置备份。
- 归档 SHA256：`35a3c7d8e7f3d89348487de9c4c5da0b5610989ae46da654df8190f8813adcde`。
- 静态文件：`/opt/1panel/www/hajimark-static/releases/design-atlas-31b8ad0-20261112T042018Z/`。
- 当前图册链接：`/opt/1panel/www/hajimark-static/design-atlas` → `releases/design-atlas-31b8ad0-20261112T042018Z`。
- 原站点配置备份：`/opt/hajimark/releases/design-atlas-31b8ad0-20261112T042018Z/hajistudy.online.before.conf`。

利用既有 `/opt/1panel/www` → OpenResty `/www` 挂载，仅在实际域名配置中新增静态 location；保留原代理、TLS、1m 请求体限制和35s 代理超时，不整份覆盖为仓库模板。`/design-atlas` 返回301补尾斜杠；`/design-atlas/` 使用静态 index，未知文件直接404，关闭目录列表。配置经过 `nginx -t` 后热加载，未重启容器。

发布后从公网逐一下载55 个文件，SHA256与发布包一致，HTML／SVG／PNG 的 Content-Type 正确；HTTP跳转、尾斜杠跳转正常，未知文件、`schema.json` 和 `figures.py` 均404。浏览器检查27 张图切换、分图、教师／学生节点及课程关系标签、下载链接、缩放、高亮、标签开关与桌面／窄屏入口通过。原 `/login` 和 `/api/v1/health/ready` 均200；六个原容器ID未变，均在运行、重启计数均为0，配置 healthcheck 的四个业务容器均 healthy。站点配置与备份的差异仅为新增图册路由。

后续更新应在提交并校验图册后建立新的不可变静态 release，核对55 文件哈希，再原子切换 `design-atlas` 链接；链接使用相对 `releases/<版本>`，确保容器内也能解析。更新前记录旧链接目标并保留旧目录，回退时切回已验证的旧静态 release；不切换业务 `/opt/hajimark/current`，不恢复数据库。

若需撤销首次路由，先备份当前配置，再恢复上述 `hajistudy.online.before.conf`，执行 `docker exec 1Panel-openresty-VndB nginx -t`，成功后执行 `docker exec 1Panel-openresty-VndB nginx -s reload`。若检查失败应恢复刚备份的当前配置。发布包、静态目录和备份均保留，不通过删除目录回滚。
