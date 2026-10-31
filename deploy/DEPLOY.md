# 发布 UI 重构版本到 hajistudy.online

目标：154.201.71.22（root，OpenResty 反代 127.0.0.1:18080，2GB）。只替换 api / worker / web 镜像；PostgreSQL、Redis、卷、OpenResty 配置、证书都不改动。不在服务器上编译。

## 1. 本地构建与验证（不需要服务器）

```powershell
# 仓库根，工作区已提交
pwsh -File deploy/deploy.ps1 -Action build
```

脚本做的事：从 HEAD 的干净 worktree 构建 `hajimark-backend:<tag>`、`hajimark-web:<tag>`（带 `org.opencontainers.image.revision=<commit>` 标签），然后 `docker save` 并 gzip，写出 `.local/deployment/<release-id>/`：

| 文件 | 用途 |
| --- | --- |
| `images.tar.gz` | 两个镜像 |
| `release.json` | 源提交、镜像 ID、归档 SHA256、上一个 release |
| `compose.production.yaml` 等 | 与 `deploy/` 相同的生产 Compose 与运维脚本 |
| `env.template` | `shared/.env` 中需要的变量；升级时只改两行镜像 tag，保留原数据库密码 |
| `switch-release.sh` | 服务器上校验镜像 ID/revision，改写 `.env` 中的镜像 tag，切换 `current` 链接，逐服务 `up --no-deps --wait`，检查健康 |
| `update-release.sh` | 校验 SHA256 → 记录旧 `current` → `backup.sh` → `docker load` → `switch-release.sh` |
| `rollback.sh` | 切回 `.previous-current`（默认为 release.json 中的 previous_release）；只切镜像，不恢复数据库 |

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

凭据缺失时脚本输出 `DEPLOY_PENDING`，直接退出，服务器不会有任何改动。如果远端 release 目录里已经有镜像归档，脚本拒绝覆盖。上传使用 SFTP 直传，约 70MB，不经过 R2；需要 R2 中转时沿用 `scripts/stage-release.py`。

手动等价步骤（在服务器上执行）：

```sh
cd /opt/hajimark/releases/<release-id>
chmod 700 *.sh
bash update-release.sh          # 备份 → load → 切换 → 健康检查，输出 SWITCHED <release-id>
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

```powershell
pwsh -File deploy/deploy.ps1 -Action rollback -ReleaseId <release-id>
# 或服务器上：bash /opt/hajimark/releases/<release-id>/rollback.sh
```

回滚只切换应用镜像，不恢复数据库，回滚后新增的作答会保留。本次没有新迁移（仍为 00008），旧镜像可以直接使用当前数据库。
