# HaJi Mark · 智能学习平台

第6组智能软件工程课程项目。学生完成学习、作业测验、反馈与补学；教师维护课程、查看证据、评分和干预复查。当前按用户要求完善整个平台，AI 保持未配置。

## 当前可用

2026-10-28，分支 `codex/platform-completion`。用户已授权合并成员CO-01/AS-01并部署[课堂平台](https://hajistudy.online)，未授权新的GitHub同步。原交付与适配采用见[贡献记录](references/contributions/README.md)，生产配置与运维见[部署说明](deploy/README.md)。此前26页前端复刻保留源码和历史对照，当前入口为真实服务端业务。

| 学生端 | 教师端 |
| --- | --- |
| 课程目录与资料阅读、完成记录、个人笔记与收藏 | 创建/命名/发布课程，学生账号开通与选课管理 |
| 作答草稿、逐题提交、历史 attempt 和正式反馈 | 章节/小节/知识点，依赖图与资料审核/修订历史 |
| 客观测验规则判分、知识点表现、规则学习路径 | 作业与测验创建、草稿编辑、发布/关闭、提交覆盖与批改 |
| 课程提问/回复、接收公告、执行补学补练任务 | 评分草稿→确认→发布、历史修订与依据对照 |
| 姓名与密码修改 | 班级/个人证据、结果导出、任务下发/复查、互动、教研/行业记录管理 |

业务事实保存在 PostgreSQL，刷新或重启不会回到浏览器构造数据。没有模型时明确显示未配置，人工答疑、评分和规则路径可继续使用。图谱为依赖卡片；资料为文本与链接；教研和行业功能为人工维护记录。模型评阅、自动行业采集与完整参考站视觉等价尚未完成，详见 [实现边界](docs/architecture.md)。公网课堂试用采用独立部署配置，未做大规模负载验收。

## 2026-11-04 本周增量

教师可在题目页独立建立并确认逐点评分标准版本（1—30点，整数分、满分加和检查）；评分页选确认版本、逐点填写得分/评语及可选原文引用。后端重新核对分项、加和和引用，保存修订后仍须教师确认、发布。学生仅看已发布分项反馈，学情与CSV导出使用正式结果并携带标准ID。旧整题评分记录保留。

迁移00009增量增加rubric_versions及评分绑定字段；标准更改另建版本，旧评分不变。标准管理与作答独立，不通过学生答案生成标准。模型起草/评阅和评分队列均未接入，AI仍关闭。运行证据与课堂材料见[本周交付](docs/weekly-2026-11-04.md)。2026-11-05，最新平台版本已发布到[hajistudy.online](https://hajistudy.online)，保留原课程、提交与评分历史；公网教师和学生登录凭据已按用户要求设置。

## 前端设计

2026-10-31 前端重构采用 Lattice 参考图的深青、薄荷渐变与白色圆角卡片，工作台改为顶栏＋按角色分组的侧栏（移动端抽屉）。设计变量、页面模板、路由兼容与可复现截图见 [design.md](design.md)，改动与取舍见 [UI 重构记录](docs/ui-refresh-2026-10-31.md)。本地设计验收与生产部署分别记录。

## 开始运行

安装并启动 Docker Desktop（Linux containers），在仓库根执行：

```powershell
# 仅首次且没有 .env 时复制，避免覆盖本地配置
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose config --quiet
docker compose build
docker compose up -d
pwsh -File scripts/seed-s1.ps1
pwsh -File scripts/smoke.ps1
```

打开 [本地平台](http://127.0.0.1:18080)。账号密码在被忽略的 `.local/s1-accounts.json`：教师 `s1-teacher`、另一教师 `s1-teacher-other`、学生 `s1-student-a/b`，密码随机生成。重复种子不重置账号和业务数据。教师可新建课程、加入已有学生或开通学生账号、录入/审核资料和题目后发布。参考课程目录可在空课程导入，目录不附带假成绩或未经审核的资料。

停止执行 `docker compose down`，保留卷。AI 默认 `AI_ENABLED=false`，无需配置密钥。默认 Compose 只绑定本机，不直接用于公网。

## 验证与备份

```powershell
python scripts/check-platform.py          # 创建有明确标签的测试课程，保留记录
python scripts/check-platform.py --resume # 用上次ID复查持久化
python scripts/backup.py --verify-restore # 本地备份＋独立临时数据库恢复演练
python scripts/check_docs.py
```

真实数据库 Go 测试、浏览器双会话验收与恢复命令见 [开发说明](docs/development.md)，实际运行记录见 [验证记录](docs/verification.md)。测试凭据、备份和日志均留在被忽略的 `.local`，勿上传。

## 协作与课程材料

组内继续按纵向流程维护，当前跨模块完善不冒充任何成员的个人贡献。共享业务入口是 `backend/internal/learning` 与 `web/src/live`，原模块目录保留为责任导航。每周计划见 [backlog](docs/backlog.md)，职责与协作见 [team](docs/team.md)、[开工提示](docs/handoffs/README.md) 和 [CONTRIBUTING](CONTRIBUTING.md)。后续同步仍采用成员分支→PR→审核→检查→集成，不自动推送。

必要入口：[需求与课程追溯](docs/requirements.md)、[架构](docs/architecture.md)、[接口契约](docs/contracts.md)、[评据来源](docs/evidence.md)、[24条用户故事](docs/stories.md)、[来源](docs/sources.md)。[立项摘要](docs/proposal.md)、[汇报模板](docs/weekly-report-template.md)、[AI协作记录](docs/ai-collaboration.md) 保留课程讨论背景。

历史提交包与三个原流程图在 [references](references/README.md) 保留，旧图不作为当前功能已完成的证明。
