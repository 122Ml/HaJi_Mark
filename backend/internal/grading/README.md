# 有据评阅 · 李然

当前无业务任务处理器，不会发起模型调用。首次 GR-01 先人工填写、确认并发布分点评分，跑通基础学习闭环；随后接入 E6 草稿、Asynq job、确定性检查和同屏对照。

rubric 起草与评阅分开；起草不含待评答案。固定输入版本；保存原始模型输出；失败不写零分；确认与发布由服务端教师操作。契约与证据见 docs/contracts.md、docs/evidence.md。

S1-L3已准备rubric逐点字段、人工评分请求/返回、引用区间、确认/发布和学生反馈边界，详见docs/contracts.md的S1-L3节；不是已实现的评分API。S1-L1/L2提供identity.Current、RequireSession/RequireRole/RequireCourse/RequireCSRF，以及web/src/shared/api.ts和session.tsx的共用接入。

实际联调仍等assessment的S1-A2/A3不可变提交及course的资料版本查询。交接用scripts/check-s1.py生成的.local/s1-handoff.json：真实课程/知识点/学生ID可用，submission_id保持null。上游就绪后核对原文hash、attempt、题目/作业版本、资料来源/片段，再进入S2-L1；不把前端演示样例写成真实提交，不抢占00003/00004迁移。
