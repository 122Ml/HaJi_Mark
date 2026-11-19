# 发布 HaJi Mark 到 hajistudy.online

2026-11-19 已发布 `v0.2.0`，生产迁移到 00016。实际发布和核验见[同步记录](sync-2026-11-19.md)。

目标：154.201.71.22（root，OpenResty 反代 127.0.0.1:18080，2GB）。更新 api / worker / web 镜像前先执行镜像内的数据库迁移；保留 PostgreSQL、Redis、数据卷、OpenResty 配置和证书。不在服务器上编译。

`v0.2.0` 的上一版为 `hajimark-workspace-f40872a-20261105`，迁移 00009。升级前已备份，数据卷、旧 release 和公网账号均保留。

## 1. 本地构建与验证（不需要服务器）

```powershell
# 工作区干净，HEAD 对应版本标签，PreviousRelease 填服务器实测值
pwsh -File deploy/deploy.ps1 -Action build -ReleaseId <新版本目录名> -PreviousRelease <服务器当前版本目录名>
```

从精确 Git 标签导出源码，构建 PostgreSQL/pgvector、API、解析 worker 和 Web 四个镜像，并写入源码 revision。`docker save` 后压缩到 `.local/deployment/<release-id>/`。模型凭据由服务端单独配置。

| 文件 | 用途 |
| --- | --- |
| `images.tar.gz` | 数据库扩展基座、API、解析 worker 和 Web 四个镜像 |
| `release.json` | 源提交、镜像 ID、归档 SHA256、上一个 release |
| `compose.production.yaml` 等 | 与 `deploy/` 相同的生产 Compose 与运维脚本 |
| `env.template` | `shared/.env` 所需变量。保留原数据库密码和数据卷 |
| `switch-release.sh` | 核对镜像 ID 和 revision，执行迁移，校验旧数据指纹并启动服务。健康检查后更新 `current` |
| `update-release.sh` | 加锁、核对归档哈希、加载镜像、暂停写服务、完成最终备份并切换 |

发布清单分别记录本地镜像ID与归档manifest中的config ID，兼容Docker Desktop的OCI index和服务器经典镜像存储；服务器接受两种ID之一，并继续核对源码revision标签。

接着自动执行 `verify`：校验归档哈希，重新 load 并比对镜像 ID 与 revision，用发布 tag 运行 `compose config -q`，用 `bash -n` 检查服务器脚本（同时确认是 LF 换行），并在 127.0.0.1:18089 启动发布 web 镜像，确认 SPA 回退正常、样式包含本次改版。

单独复验：`pwsh -File deploy/deploy.ps1 -Action verify -ReleaseId <release-id>`

## 2. 上线（需要凭据，不会交互提示）

前提，二选一：

- `~/.ssh` 中有被服务器接受的 root 密钥（脚本先用 `ssh -o BatchMode=yes` 探测）；
- 或在当前进程设置 `$env:HAJI_SSH_PASSWORD`，脚本通过 paramiko 非交互登录，并强制校验 `~/.ssh/known_hosts`。

```powershell
$env:HAJI_SSH_PASSWORD = '<root 密码>'   # 只放在当前会话；不要写入文件
pwsh -File deploy/deploy.ps1 -Action deploy -ReleaseId <release-id>
Remove-Item Env:HAJI_SSH_PASSWORD
```

凭据缺失时脚本输出 `DEPLOY_PENDING`。已有镜像归档的远端目录保留。SFTP 直传后，服务器后台执行更新，查看 `deployment.log` 和 `deployment.exit` 确认结果。`v0.2.0` 的镜像归档约为 478 MB。

手动等价步骤（在服务器上执行）：

```sh
cd /opt/hajimark/releases/<release-id>
chmod 700 *.sh
nohup bash ./update-release.sh >deployment.log 2>&1 </dev/null &
```

## 3. 线上验证

```powershell
curl.exe -sI https://hajistudy.online/login            # 200，HTTP→HTTPS 301 不变
$env:HAJI_BASE_URL = 'https://hajistudy.online'
$env:HAJI_ACCOUNTS = '.local/deployment/hajistudy-accounts.json'
node scripts/check-platform-browser.cjs                # 公网回归（创建带标签数据并保留）
python scripts/check-platform.py --allow-remote ...    # 见 deploy/README.md
```

在服务器上确认：`docker compose ... ps` 全部 healthy，没有 OOM 或反复重启；只有 web 绑定在 127.0.0.1:18080。

## 4. 回滚

应用回退前先确认目标旧镜像与当前 schema 兼容，并保护升级后新增的写入。旧 release、镜像及最终备份保留。若需验证数据恢复，在独立数据库恢复备份。
