# 工程与前端验证记录

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
