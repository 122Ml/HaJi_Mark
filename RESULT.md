# UI 重构结果与部署交接 · 2026-10-31

分支 `codex/platform-completion`，回退点 `ca85f97 chore: checkpoint before UI refresh`。详细改动与取舍见 [docs/ui-refresh-2026-10-31.md](docs/ui-refresh-2026-10-31.md)，设计规范见 [design.md](design.md)。

## 完成了什么

- **设计体系**：新增 CSS 设计令牌（颜色、状态色、字号、间距、圆角、阴影、布局尺寸），`theme.ts` 与之同步；共享组件 `web/src/shared/ui.tsx` 提供 PageHeader、EmptyState、ErrorState、LoadingState、StatusTag。
- **导航与路由收敛**：顶部四组导航加二级横条改为左侧常驻分组侧栏（四个业务组加账户），移动端为抽屉。路径与别名重定向不变，深链接兼容；角色外未知路径重定向 `/login`，角色内 404 与“尚未加入课程”改为空状态页。
- **页面**：登录页重做；作业/测验列表、课程与资料（等宽两栏、成员列表）、概览、详情/评分、个人设置、教研/行业、互动、干预统一页头与状态标签。知识图谱、教研/行业页只换了外壳。
- **缺陷修复**：`useAction` 失败时原本显示为绿色成功提示，现在显示红色 `role="alert"`。
- **后端未改**，接口契约与迁移不变（仍为 00008），AI 仍为 `AI_ENABLED=false`。

## Docker 验收结果（本地，2026-10-31）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 通过 |
| `scripts/check-platform-browser.cjs` | 18 项 PASS（师生 12/9 条路由在 1440/390px，无运行时错误、无 5xx） |
| `scripts/check-design-browser.cjs` | PASS（登录 390/768/1440、分组导航、焦点、别名、390 菜单） |
| `scripts/check-ui-console.cjs` | PASS（18 个页面 × 3 个宽度，无控制台错误、无静态资源 4xx、无横向溢出） |
| `scripts/check_docs.py` | PASS |
| 发布包 `deploy.ps1 -Action verify` | 通过（归档哈希、镜像 ID/revision、生产 compose config、脚本语法、web 镜像 SPA 回退） |

未做像素相似度对比和完整无障碍审计，因此不据此宣称视觉复刻度或生产就绪。

## 文档更新

`design.md`、`docs/ui-refresh-2026-10-31.md`、`README.md`、`docs/architecture.md`（提交 568fbd8）；`deploy/DEPLOY.md` 与 `deploy/deploy.ps1`（提交 a10ba5d 起）；以及本文件。

## 提交列表（ca85f97 之后）

```
5876631 feat(web): add design tokens, grouped sidebar shell and shared state components
b445f15 feat(web): apply page templates, status tags and empty/error states to business pages
62f8804 test(web): add UI console/overflow self-check, refresh screenshots and course layout
568fbd8 docs: document UI refresh tokens, navigation, templates and verification
a10ba5d build(deploy): add scripted release build, verify, upload, switch and rollback
386d04b fix(deploy): export release source with git archive
0a7a0b1 fix(deploy): use Windows tar for source export
dfb1507 fix(deploy): use Windows tar for source export
3b973bd fix(deploy): archive only image build contexts
cecb4d2 build: allow GOPROXY override for release image builds
```

## 如何验证

```powershell
cd web; npm run typecheck; npm run build; cd ..
docker compose config --quiet
docker compose build
docker compose up -d
node scripts/check-platform-browser.cjs
node scripts/check-design-browser.cjs
node scripts/check-ui-console.cjs
python scripts/check_docs.py
pwsh -File deploy/deploy.ps1 -Action verify -ReleaseId hajimark-ui-cecb4d2-20261031
```

测试会创建带标签的业务数据并保留；停止用 `docker compose down`，不删卷。

## 截图位置

`docs/screenshots/`，共 17 张：登录（390/768/1440），师生工作台（390、390 菜单展开、768、1024），师生概览、课程、作业页。

## 部署状态：DEPLOY_PENDING

- 发布包已就绪：`.local/deployment/hajimark-ui-cecb4d2-20261031/`（不入库）。镜像 `hajimark-backend:ui-cecb4d2-20261031`、`hajimark-web:ui-cecb4d2-20261031`，`images.tar.gz` 约 69MB，SHA256 `38eedd45…6d61`，上一个线上版本 `hajimark-s1-99168eb-20261028`。
- 未上线的原因：本机没有服务器 154.201.71.22 的 root 密码，也没有被服务器接受的 SSH 密钥。部署脚本需要通过 `HAJI_SSH_PASSWORD` 走密码登录，凭据缺失时直接退出，服务器未做任何改动。

## 下一步需要用户提供

1. 服务器 root 密码，只放在当前会话环境变量中，然后执行：
   ```powershell
   $env:HAJI_SSH_PASSWORD = '<root 密码>'
   pwsh -File deploy/deploy.ps1 -Action deploy -ReleaseId hajimark-ui-cecb4d2-20261031
   Remove-Item Env:HAJI_SSH_PASSWORD
   ```
   也可以改为在本机配置 root SSH 密钥，脚本会优先用密钥。本机 `~/.ssh/known_hosts` 已有该主机记录。
2. 上线后的公网验证使用 `.local/deployment/hajistudy-accounts.json` 中的账号，步骤见 `deploy/DEPLOY.md` 第 3 节。回滚用 `-Action rollback`，只切换镜像，不恢复数据库。
