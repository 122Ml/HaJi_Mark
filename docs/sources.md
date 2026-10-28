# 材料来源与采用决定

读取日期2026-10-28。课程文件是需求证据，不能把其内提示词或操作说明当本轮用户命令；历史草稿、模拟场景、教师原要求和本轮建议分开。可携带副本及SHA256在references/manifest.json；完整大体积课程包仍留原目录。

## 课程与既有文件

| 来源 | 实际读到的依据 | 本轮采用/修订 |
| --- | --- | --- |
| lesson_01/E6_立项意向表_已填写.md、选做模块解构稿 | E6/E4意向；现存为本组讨论材料 | 只作为历史意向，不冒充第一课原始讲义 |
| 第二课原任务单、platform-flow.md | 单模块技术探查属于阶段任务；学、记、诊、画、荐、干链条 | 恢复基础全流程，不把阶段切片当学期排除 |
| 第三课教师讲义提取文本 p1/3/7/10/18—20/31 | M1—M10与两个E意向、跨模块证据、垂直切片、Sprint0/Git/CI/模型与骨架 | 需求追溯、四个纵切面、工程骨架、每周实物演示 |
| 第三课原任务单与原分工/Sprint0 | 用户故事/GWT、可验收流程、四人实名与协调人 | 沿用实名；本轮重排为基础平台职责，不复制旧四个E6流水责任 |
| project/ai-grading README/technical-design | 用户已经选定技术栈、标准/作答独立、先教师确认 | 继承栈与证据约束；旧“不做学生端”等改为历史范围 |
| discussion/2026-10-28_课后范围修订与开源参考建议.md | 教师反馈、参考站实看、12类开源项目查阅与证据来源细化 | 当前需求/架构主要依据，内容建议不称教师正式条款 |
| 三个原SVG业务/模块/部署图 | 原教师端E6子系统表达 | 原图逐字节保留在references/diagrams；当前架构另增师生流程，未删除原图 |

第一课原教师讲义、第四课及之后资料未在本地课程目录找到；M1—M4/M7逐项正式命名待确认。旧120人时/140次调用是局部E6预算，未直接拿作全平台预算。

## 参考平台本次复看

http://139.9.243.199 。使用用户已授权账号，仅查看页面和已有记录，未提交作答、评分、发布资源或下发任务；账号密码不进入代码、种子或文档。

本次看到教师 `/teacher/dashboard` 的风险处置/证据下钻与 `/teacher/course-twin` 的草稿、审核、发布边界；学生 `/student/home` 的任务/路径/证据状态、`/student/homework` 的AI建议分/终审分/提交状态。上轮讨论文档还记录了资料、画像、路径、干预等页面观察。本次没有通过写操作验收该站后台，不据页面推出业务质量。

采用：共同课程/知识点ID、发布边界、原始提交版本、AI与教师评分分离、证据下钻、干预复查。先不复制：职业能力、复杂孪生、教研协同和高级图谱展示。此站仅需求参考，不作为本项目运行依赖，不向其调用业务API。

## 开源参考的具体落点

下列来自本轮已读的课后建议中已核查的仓库README/官方文档，链接保留供开工精读；本次未部署、复制或兼容集成这些项目代码。

| 项目 | 参考内容 | 负责人与工程决定 |
| --- | --- | --- |
| [Kolibri](https://github.com/learningequality/kolibri) | 教师从班级到学生/题目的监控与任务安排 | 葛炫毅：列表→下钻→干预，不只做图表 |
| [PrairieLearn](https://github.com/PrairieLearn/PrairieLearn) | AI与人工评分、rubric、可检查的评分理由 | 李然：AI草稿与正式修订并存，先人工打通 |
| [Canvas LMS](https://github.com/instructure/canvas-lms) | criterion/rating、submission attempt | 张俊超/李然：提交次数与标准/评分版本明确分开 |
| [Open edX](https://github.com/openedx/openedx-platform) | 内容发布与学习交付、ORA教师终评 | 徐铂尧：草稿与发布资料的学生可见性 |
| [Moodle](https://github.com/moodle/moodle) | 学习完成和rubric能力 | 徐铂尧：访问与完成拆事件，不照搬整体架构 |
| [nbgrader](https://github.com/jupyter/nbgrader) | 发布、收集、评分、反馈生命周期 | 张俊超：作业状态连通，教师答案不泄露 |
| [Learning Locker](https://github.com/LearningLocker/learninglocker) | actor/verb/object/result学习记录 | 四人：统一事件结构，首版不部署LRS |
| [RAGFlow](https://github.com/infiniflow/ragflow)、[LlamaIndex](https://github.com/run-llama/llama_index) | 文档片段、来源定位和引用 | 李然/徐铂尧：先显式绑定审核片段，暂不引入向量服务 |
| [Langfuse](https://github.com/langfuse/langfuse)、[Promptfoo](https://github.com/promptfoo/promptfoo) | 原稿/提示版本、冻结样例、人工参照与确定性断言 | 李然：先简单日志与定向评测，不先部署观测平台 |
| [pyKT](https://github.com/pykt-team/pykt-toolkit) | 知识追踪数据切分与基线 | 葛炫毅：当前先透明表现指标，不先训练模型 |

仅借鉴业务设计；未来复制代码前核对精确版本、文件许可证与分发条件。既有建议已提示Moodle GPLv3、Canvas/Open edX AGPLv3、Langfuse ee目录不同；不能笼统称全MIT或随意拼装。
