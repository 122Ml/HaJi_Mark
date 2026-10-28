# Sprint 0 验证记录

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
