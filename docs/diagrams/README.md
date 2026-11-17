# 全景业务与实现架构

**当前总图：[PNG](current/00_全景架构_实现状态.png)／[可编辑SVG](current/00_全景架构_实现状态.svg)／[交互查看](current/index.html)。** 2026-11-17，对照本地应用代码`560de5e`更新。保留原19个业务节点、42条关系及模块边界，加入6个对话助理节点与5条关系，共25个节点、47条关系；底部同步展开运行架构。

对话助理已合入同一全景，包含协调者、四领域专家、问题与审批、权限门禁和真实业务Gateway。单独展开图仍可查看：[助理架构PNG](agent/architecture.png)／[SVG](agent/architecture.svg)；范围见[助理说明](../agent-harness.md)和[实际验收](../research/agent-acceptance-2026-11-17.md)。单图生成入口为generate-agent.py与render-agent.cjs。

课程图册 F01–F19 见[详细设计图册](atlas/README.md)：19 类、27 张图，展开业务分支、六类生命周期、41 张表／103 条外键和四条关键调用时序，逐图列出当前实现证据与未完成边界。[直接打开图册](atlas/index.html)。

实现状态按[架构](../architecture.md)、[三模块验收记录](../research/three-module-acceptance-2026-11-12.md)、助理验收和直接调用链标注。**完全实现限于图中列明能力，具体验证范围以验收记录为准，不表示全部扩展样例通过、独立教师验收或公网部署。**

[打开全部图表](current/index.html)。支持切换五张图、缩放、业务及助理模块筛选、节点上下游高亮、SVG与PNG下载。

| 图表 | PNG | 可编辑SVG |
| --- | --- | --- |
| 总架构：原业务关系网＋对话助理＋共享运行架构 | [全景架构](current/00_全景架构_实现状态.png) | [SVG](current/00_全景架构_实现状态.svg) |
| 学习资料：原件、解析、核对、发布与直接索引 | [学习资料流程](current/01_学习资料_业务流程.png) | [SVG](current/01_学习资料_业务流程.svg) |
| 知识库：提炼、确认、用途、检索与生命周期 | [知识库流程](current/02_知识库_业务流程.png) | [SVG](current/02_知识库_业务流程.svg) |
| 题目与评分标准：独立题库、三项确认、固定版本评阅 | [题目与标准流程](current/03_题目与评分标准_业务流程.png) | [SVG](current/03_题目与评分标准_业务流程.svg) |
| 内容变更与整组重评：影响、冻结、逐份确认与统一发布 | [变更与重评](current/04_内容变更与整组重评.png) | [SVG](current/04_内容变更与整组重评.svg) |

## 三模块的数据交接

1. **学习资料**：教师导入原件与来源 → 正文、表格、中文印刷OCR及位置解析 → 异常片段由教师核对校正 → 可靠原文。原文分别供学习资料发布、直接索引和按需知识提炼；三条支路不互相等待。学生阅读完整教学内容，保留笔记、收藏与完成记录。
2. **知识库**：许可允许的可靠原文 → AI提出精炼条目、分类、条件与关联候选 → 教师编辑确认 → 按学习用途、评分用途及学生可见性独立使用。确认知识与原文共用权限RAG；修订、归档或撤回许可不会覆盖历史评分快照。
3. **题目与评分标准**：所选资料／知识依据＋考查要求 → AI提出题目、参考解答、标准草稿，或教师直接录入 → 三者分别审定 → 作业固定确认题目和匹配标准 → 学生作答 → 按固定依据评阅、核对、教师确认发布。题库独立于作业，制定标准不读取待评学生答案。

**共享关系**：RAG使用pgvector精确余弦＋中文FTS＋RRF，供带引用问答及出题、标准选依据。正式评阅只使用当时绑定的标准与依据快照，不临时检索追加扣分点。学习结果、正式反馈和新提交继续进入全平台的学情、规则路径、教师补学补练与复查闭环。

## 状态与依据

图的底色表示AI／教师／数据职责；绿色为完全实现、琥珀色为部分实现、灰色为未实现。节点内逐项圆点保留具体能力状态；同一节点有未完成事项时标为部分实现。实线为已接通关系，虚线为待接通关系。

| 范围 | 主要代码与核对入口 |
| --- | --- |
| 资料、知识、检索和模型任务 | [materials.go](../../backend/internal/learning/materials.go)、[RAG](../../backend/internal/rag)、[解析工具](../../backend/tools/parser/parse.py)、[页面](../../web/src/live/knowledge.tsx) |
| 独立题库、标准和固定绑定 | [题库HTTP](../../backend/internal/learning/question_bank.go)、[生成任务](../../backend/internal/rag/question_bank.go)、[题库页面](../../web/src/live/question-bank.tsx)、[题库方案与实施边界](../research/question-bank-rubric-plan.md) |
| 规则路径与学生收藏 | [path.go](../../backend/internal/learning/path.go)、[路径页面](../../web/src/live/path.tsx)、[笔记与收藏](../../backend/internal/learning/notes.go) |
| 对话助理、权限门禁和授权执行 | [Agent服务](../../backend/internal/agent/service.go)、[工具目录](../../backend/internal/agent/catalog.go)、[助理页面](../../web/src/live/assistant.tsx)、[实现与验收](../research/agent-acceptance-2026-11-17.md) |
| 原全景结构 | [原模块标注SVG快照](base-network.svg)；来自课程目录20261108的原总图，不修改历史三个SVG |

本轮补入公开URL快照、按需视觉与教师确认、多专题与标签、知识双侧比较和五类人工决定、跨页整卷拆题、题库筛选和采纳审计、站内内容影响与整组重评。普通新版保留旧版，明确撤回才限制未来使用。重评一次管理已关闭作业的一道题，不是跨作业自动改分。

总图底部展开当前运行关系：React／Nginx → Gin API；同步问答、查询向量和Agent推理由API调用模型，耗时任务经Redis／Asynq交Go worker执行。共享PostgreSQL／pgvector保存业务版本、持久任务、预算、会话与审批；文件卷保存原件、快照、私有附件和CSV。模型推理当前非流式，前端接收业务事件SSE；未知调用保守结算，生成中断后显式重试。Agent使用已有业务路由及权限，不开放任意数据库写入。

特别保留的未实现项包括：精炼知识接入个性推荐、E4 AI共性错因诊断、自动补练生成、教师批量导入作答、独立检索问答页的会话历史和典型作答匿名沉淀。对话助理已保存自己的问答历史；整卷采纳、学生正式提交及部分课程维护仍使用现有页面，尚未全站工具化，长会话历史分页和供应商token流未实现。auto-review是确定性风险门禁，正式确认与发布始终逐操作审批。

## 生成与检查

在仓库根目录执行：

```powershell
python -B docs/diagrams/generate.py
node docs/diagrams/render-check.cjs
python -B scripts/check_docs.py
```

生成脚本需要Pillow与微软雅黑字体；渲染脚本需要可用的Playwright和Microsoft Edge。`current`保存SVG、PNG、HTML及结构／浏览器检查结果；脚本串行渲染，不访问业务服务或模型，不改变生产数据。

本轮检查覆盖五图文本边界、细图连线不穿无关节点、原19个节点与42条关系及原路径保留，另通过12项查看器检查，包括助理模块筛选、关键能力状态、五图切换、高亮、边界开关、缩放、文件链接、键盘和窄屏入口。总图PNG已目视核对；本轮仅更新图表与说明，业务和真实模型验证沿用实际验收记录。
