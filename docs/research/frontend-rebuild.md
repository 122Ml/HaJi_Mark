# 示例平台前端复刻与验收

2026-10-28。参考站：[AI-Education](http://139.9.243.199)。本地预览：[Docker Web](http://127.0.0.1:18080)。本次只修改本地项目，不推送 GitHub，不写入参考站。

## 使用指定模板的方式

采用 [JCodesMore/ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template) 的 canonical `clone-website` 工作流：路由映射、真实页面观察、提取样式与资产、可编辑组件实现、同尺寸截图对照、交互回归。所读版本为 `ee3f5a2f31fd549b9593fa4f7cf6d2955ee593bb`；其工作流明确要求沿用现有应用约定。因此保留 React/Vite/TypeScript、Go 与 Compose，没有另起 Next.js 应用。

模板 MIT 声明见 [template-license.txt](ai-education/template-license.txt)。参考站样式、背景图与示例内容的来源单独记在 [assets.json](ai-education/assets.json)，不能把模板 MIT 误当成参考站资产的许可证。生产 JavaScript bundle、登录凭据、会话和原始页面抓取均未纳入交付。最终页面是 React JSX、数据文件、CSS 与可编辑 SVG，没有 iframe、整页截图或原生产 bundle 充当实现。

## 覆盖与代码入口

参考站中的学生端、教师端路径保持一致；管理员端没有本轮提供的账号和需求，不在本次范围。下列是 26 个页面路由模式；ID 不同属于同一页面模板。

| 入口 | 路径 | 主要状态 |
| --- | --- | --- |
| 登录 | `/login` | 学生／教师选择、空字段提示、本地身份演示 |
| 学生首页 | `/student/home` | 优先任务、计划、知识图谱点选、画像、学习定位 |
| 学习中心 | `/student/course-content` | 完整观测目录、知识点选择、资源分类、笔记、收藏、助教演示 |
| 个性化路径 | `/student/learning` | 4 个正式节点、4 个补充项、目标、排序、版本、开始／完成 |
| 学生画像 | `/student/student-twin` | 雷达、趋势、风险、薄弱点、证据说明 |
| 作业测验 | `/student/homework` | 筛选、状态页签、作业卡、提交记录 |
| 作业详情 | `/student/homework/:assignmentId` | 查看、草稿／提交、结果、历史 |
| 老师任务 | `/student/intervention` | 任务包列表 |
| 任务详情 | `/student/intervention/:packageId` | 接受、作答、提交、教师复查回显 |
| 班级互动 | `/student/interaction` | 公告详情、讨论详情、提问 |
| 个人设置 | `/student/profile` | 资料保存、密码变更的本地演示提示 |
| 在线测验 | `/student/quiz` | 无主题错误态、主题样例题、教师已发布测验、结果／总结 |
| 教师看板 | `/teacher/dashboard` | 班级概览、学生画像、课程热度、教师孪生、课程资源五页签 |
| 课程底座 | `/teacher/course-twin` | 发布检查、课程树、图谱、资源审核、节点测验、运行评估、能力映射 |
| 行业能力 | `/teacher/industry-intelligence` | 参数、筛选、热力图与统计、职位详情、能力候选导入 |
| 六维钻取 | `/teacher/teacher-twin/drilldown` | 维度／时间筛选、指标与原始证据 |
| 教师作业 | `/teacher/homework` | 新建、查看、编辑、发布、关闭、批改 |
| 创建作业 | `/teacher/homework/new` | 类型、题目、评分点、知识点覆盖、草稿／发布 |
| 编辑作业 | `/teacher/homework/:assignmentId/edit` | 保存修改、多题编辑 |
| 提交列表 | `/teacher/homework/:assignmentId/submissions` | 学生原始提交与评分状态 |
| 批改详情 | `/teacher/homework/submissions/:submissionId/grade` | 原始作答、AI 历史建议、教师终审、确认发布 |
| 教师干预 | `/teacher/intervention` | 识别、草稿编辑、确认推送、进度与证据时间线 |
| 干预详情 | `/teacher/intervention/:packageId` | 查看学生作答、填写复查意见、确认复查 |
| 教学互动 | `/teacher/interaction` | 公告／讨论新增编辑删除、问答 |
| 教研协同 | `/teacher/research` | 教研记录新增编辑删除 |
| 测验中心 | `/teacher/quiz` | 手动创建、固定示例草稿、编辑／发布／关闭 |

共享导航与路由见 [App.tsx](../../web/src/app/App.tsx)；交互组件和持久化见 [ui.tsx](../../web/src/replica/ui.tsx)；三块实现为 [student](../../web/src/replica/student)、[teacher-workflows](../../web/src/replica/teacher-workflows)、[teacher-analytics](../../web/src/replica/teacher-analytics)。原课程只读 API 页面保留在 `/development/catalog`；旧路由有跳转兼容。

## 如何理解 90–95% 目标

页面覆盖、视觉相似和真实业务完成度分开核查，不把一个像素指标当成整个系统的完成度。

- 页面：26/26 个本轮学生／教师／登录路由模式可渲染；1440×1000、390×844 共 52 次路由访问，无横向页面溢出或 JavaScript 运行异常。
- 交互：作业“草稿隐藏→发布→学生提交→教师确认→学生反馈”、干预“草稿→推送→接受→作答→复查”、公告同步、教师发布测验→学生作答→结果，均通过浏览器断言。
- 视觉：20 个主页面已保存同尺寸参考／本地对照，首屏平均 SSIM 为 **0.9809**，共有高度平均为 **0.9645**。具体数值见 [metrics.json](ai-education/comparisons/metrics.json)。SSIM 是灰度结构相似度，背景占比、文本抗锯齿和不同内容都会影响分数；它不验证答案正确性、后台能力或所有弹窗的像素精度。
- 全页比较只计算两图共有高度，并单列高度一致率；较长一方多出的部分不计入 SSIM。课程底座、行业页等长页仍需人工结合高度与对照阅读，不能用首屏高分掩盖下方差异。

对照图左为参考站，右为本地。代表页面：[学生首页](ai-education/comparisons/student-home.webp)、[学习路径](ai-education/comparisons/student-learning.webp)、[作业中心](ai-education/comparisons/teacher-homework.webp)、[课程底座](ai-education/comparisons/teacher-course-twin.webp)、[行业能力](ai-education/comparisons/teacher-industry-intelligence.webp)。移动对照见 [学生首页](ai-education/comparisons/student-home-mobile.webp)；本地增加了可横向滚动的窄屏导航行，参考站该宽度隐藏主导航，因此内容起点会下移约38px，这是可访问性与像素一致性的明确取舍。

## 实际边界与剩余差异

1. 这是可交互的前端复刻。登录只切换本地演示身份，业务数据保存在当前浏览器 `haji-demo:*`；不是服务端认证、授权或多用户同步。右下角“本地演示”提供说明、角色切换与重置。
2. 真正的 Go 后端仍只实现健康检查和公开课程摘要。前端的创建、发布、批改和任务数据未接入 PostgreSQL。正式接入时按原接口／证据契约替换本地存储，不把 demo fixture 当教学事实。
3. AI 按钮使用固定演示草稿或说明，不请求外部模型。画像、雷达、趋势、行业职位与热力图为样例；图表为 SVG 重绘，力导图的动态布局、滚轮缩放和部分悬停细节与原站不同。
4. 远站签名视频未复制到本地，视频区域保留布局与控件并说明未离线保存。外站资料通过公开链接打开；不保证第三方媒体长期可播，也没有复制旧助教聊天记录。
5. 学生画像仅有观察到的薄弱点样例，未复制全部 169 条；新课程目前复用示例结构。课程底座长页、行业统计图和部分详情／弹窗仍有布局、内容与原站的细节差异。
6. 高级图谱、教研、行业页是本轮新增的前端演示范围，不自动改变基础闭环、E6/E4 的后端开发优先级。

## 复验

```powershell
docker compose build web
docker compose up -d
pwsh -File scripts/smoke.ps1 -ExpectDemo
python scripts/check_docs.py
```

`scripts/frontend-browser-check.js` 是 Playwright MCP `browser_run_code_unsafe` 的 `filename` 入口；使用本机 18080，在单独标签中检查 26 路由×2尺寸及四条闭环，运行后还原演示存储并关闭测试标签。此文件不请求参考站、不读写账号。

原始研究截图留在忽略目录 `.local/source-inspection/pages`。需要复算时，先确认同一宽度、滚动位置和状态，等待 React 懒加载内容、字体与页面稳定后截图；不要捕获“正在加载页面”占位。可选研究依赖为 Pillow/numpy/opencv-python；它们不是 Web 运行依赖。

```powershell
python scripts/compare_frontend.py .local/source-inspection/pages docs/research/ai-education/comparisons
```

生产构建已按学生、教师流程、教师分析和开发 API 页面拆包；最大输出块低于 500KB。参考 CSS 保留较完整的样式以便对照，后续在视觉基线稳定后再按业务组件收敛。
