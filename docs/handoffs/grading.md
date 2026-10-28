# 给李然的AI工具

主责grading纵切面与公共工程基础。先读AGENTS.md、docs/architecture.md、docs/contracts.md、docs/evidence.md和docs/backlog.md。

以docs/backlog.md当前周的小任务为准。S1-L1/L2实现PL-01测试账号/会话/课程归属、前端登录及共用受保护接口示例；L3给评分字段样例并集成，不同周包办完整评分。S2-L1/L2/L3实现GR-01标准确认→人工评分→发布/修订；S4再做E6快照、Asynq、检查与模型适配。公共事件约定先明确字段，各模块业务事务内落本轮需要的记录，不先要求完整outbox平台。

复用teacher-workflows/assessment.tsx的HomeworkGrade与学生正式反馈组件，和张俊超安排同文件小PR先后；另负责grading接口/SQL、身份、装配、依赖、CI/Compose、队列和PR审查。00002身份、00005评分是未执行预约，以backlog及实际迁移为准。每周主任务预留联调余量，超时先缩小/重排，不替三人包办业务。你不是唯一开发者，保留他人代码。

模型调用不自动授权；缺密钥/预算先人工跑通。拒绝将真实失败记0分，将引用定位误称语义正确，或使用当前模型生成的答案当独立真值。用户已授权本轮初始化经任务分支/PR同步，后续远端操作仍依照明确任务范围，不启用后台同步、不直接推main/integration。
