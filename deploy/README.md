# hajistudy.online Docker部署

部署目标为154.201.71.22，Ubuntu22.04/2核2GB，既有1Panel/OpenResty。AI保持关闭。本目录的Compose只有固定镜像引用，没有服务器构建入口，不与本地开发Compose混用。

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

首次运行seed-s1生成随机、可重复执行且不重置的4个账号。其名称保留s1-teacher/s1-student-a等，用于课堂试用与交叉权限验收；教师可开通真实学生并创建自己的课程。自动验收只创建有明确标签的独立课程，保留测试记录，不用构造题当教师正式教学资料。初始凭据交付到本机忽略目录，不放网页或README，不沿用1Panel密码。

更新前运行backup.sh并保留旧镜像、旧Compose和.env快照；只对本项目逐服务更新，禁止down -v。迁移00008增加来源与事件字段，00009增加标准版本和评分分项；均保留原业务表、提交/评分和资料历史。更新应用前须执行一次性migrate，统一脚本已包含该步骤。失败时保留现场；需要应用回退时明确选择旧release并核对schema兼容，不恢复旧数据库覆盖新增作答。

## HTTPS与运维

证书使用Let's Encrypt HTTP-01，先加载只处理本域名的80端口challenge配置，签发后使用openresty-hajistudy.conf。先nginx -t再reload；HTTP301跳转HTTPS，SPA深路由由Web处理。签发时没有提供邮件，不能依赖证书邮件提醒。

systemd定时器hajimark-cert-renew每天两次运行renew-certificate.sh，续期后仅reload既有OpenResty；可用--dry-run验证ACME续期。ACME客户端固定镜像digest，不随latest漂移。hajimark-backup每天执行backup.sh，校验pg_restore可读后保留归档；课堂持续使用前还应规划异地备份，当前未自动将学生数据库上传第三方。

公网验证：使用显式--allow-remote和本次服务器初始化账号运行check-platform.py；浏览器脚本通过HAJI_BASE_URL/HAJI_ACCOUNTS指定公网目标与忽略凭据。验证登录、发布、学习、草稿、提交、原文/名单、评分、干预、刷新和跨人隔离；同时检查证书、HTTP跳转、Secure cookie、容器health/OOM/restart和仅Web回环端口。

AI未接入；结构化逐点rubric已在本地实现并验证，独立教师效果评测、负载/渗透测试仍属于后续工作。2026-11-04本周新增功能因SSH认证未通过，未更新公网；本地验收不证明当前公网具有该能力。

## UI 重构版本发布

2026-10-31 起，镜像构建、导出、校验、上传、切换和回滚统一由 `deploy/deploy.ps1` 完成，步骤见 [DEPLOY.md](DEPLOY.md)。没有凭据时只生成并在本地验证 release 产物，服务器不受影响。
