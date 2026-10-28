# AI辅助主观题批改系统

第6组智能软件工程课程项目。当前为立项与设计阶段，仅建立文档入口；尚无可运行的后端、前端或Docker镜像。

## 已确定的首版

教师端；一个任务一道题、多份文本作答，支持多个任务。题目与评分标准、学生作答在同一任务中独立维护；教师可先准备任意一侧。评分标准支持手填和AI辅助拟定，拟定标准的请求只使用题目、参考答案与教师要求，不读取待批改作答。

教师选择确认后的标准与答案发起批改；系统按份生成评分、原文依据和反馈，检查字段、分值与引用。教师可随时查看已返回结果、逐份修改或确认，统一导出已确认项。失败项可重试，已有结果保留所用标准与原始AI输出。

## 技术栈

| 层 | 选型 | 职责 |
| --- | --- | --- |
| 前端 | React、TypeScript、Vite、Ant Design、React Router、TanStack Query | 任务工作区、表格、标准编辑、进度查询和逐份复核 |
| 后端 | Go、Gin | 三块业务能力的HTTP接口 |
| PostgreSQL访问 | sqlc、pgx；Goose迁移 | 显式SQL、事务、业务记录与表结构演进 |
| PostgreSQL | 主业务数据库 | 题目、标准、作答、作业、AI原稿、人工修订和确认 |
| Redis、Asynq | 队列与短期状态 | 按ID投递作业、受控并发与重试；不作为最终成绩事实源 |
| 模型接入 | Go net/http薄封装；本次探查采用DeepSeek deepseek-flash | 标准生成和答案评阅分别组织请求；集成时锁定配置 |
| 部署 | Docker Compose、Nginx | web、api、worker、postgres、redis五个常驻服务；文件持久化卷 |

Go/Gin、sqlc/pgx、React/TypeScript/Ant Design、PostgreSQL/Redis和Docker经用户明确选择；其余组件为随方案采用的配套选型。具体依赖版本在实现时选择受支持版本并锁定，不使用latest作为交付基线。

API与Worker共用后端代码和镜像、使用不同启动命令。API负责交互，Worker处理耗时模型调用。队列可能重复投递，数据库必须保证同一作业重复执行不会覆盖教师确认结果；Go不会消除模型端时延或供应商限流。

## 文档入口与下一步

- [第三课立项摘要](docs/proposal.md)：proposal-v1，≤3页PDF另在课程提交包中。
- [架构与技术设计](docs/technical-design.md)：三模块、Docker部署与数据边界。
- 课程交付目录：`F:/vibe-coding/school/2026.9 智能软件工程/lesson_03/第6组_第三课_完整提交包_proposal-v1`。
- 当前只有文档。已用独立Python脚本完成一次DeepSeek API探查：HTTP 200，4.562秒，797 tokens，A3得7分，字段与引用检查通过。原始请求响应位于课程包evidence/lesson03/api-probe；尚未接入Go服务。
- 后续按讲义第31页推进Go集成、Git协作、CI、数据模型和W4最小原型；本README不代表部署成功。

本轮主实现E6；E4重点难点发现列入学期后续候选。M1—M10的课程对照与待核实责任见课程提交包，首版范围不取消学期要求。
