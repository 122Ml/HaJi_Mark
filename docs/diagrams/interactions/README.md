# 全平台交互图册

[交互查看](index.html) · [总览PNG](I00.png) · [总览SVG](I00.svg) · [业务与实现架构](../current/index.html)

按2026-11-17本地工作树整理。四条泳道分别为教师、平台、AI／对话助理和学生；连线表示操作或数据交接，不要求按图中行次逐项执行。资料发布、直接索引、知识提炼独立触发，题目与标准审定不读取学生作答。

| 图 | 交互范围 | PNG | SVG |
| --- | --- | --- | --- |
| I00 | 跨模块总览与学习闭环 | [PNG](I00.png) | [SVG](I00.svg) |
| I01 | 登录、顶栏选课、课程成员、目录、编辑恢复与个人设置 | [PNG](I01.png) | [SVG](I01.svg) |
| I02 | 原件导入、解析核对、视觉、发布与学生阅读 | [PNG](I02.png) | [SVG](I02.svg) |
| I03 | 专题知识、重复冲突决定、用途、检索与问答历史 | [PNG](I03.png) | [SVG](I03.svg) |
| I04 | 手工／JSON／AI出题、整卷拆题、解答与标准分别审定 | [PNG](I04.png) | [SVG](I04.svg) |
| I05 | 作业、测验、草稿、正式提交、CSV导入、评阅与发布 | [PNG](I05.png) | [SVG](I05.svg) |
| I06 | 正式证据、诊断确认、路径排序、干预执行与复查 | [PNG](I06.png) | [SVG](I06.svg) |
| I07 | 内容版本、未来使用限制、影响核对与整组重评 | [PNG](I07.png) | [SVG](I07.svg) |
| I08 | 私有对话、工具门禁、输入审批、七类编辑器与运行恢复 | [PNG](I08.png) | [SVG](I08.svg) |
| I09 | 公告、提问、讨论、回复、人工教研与行业能力维护 | [PNG](I09.png) | [SVG](I09.svg) |

灰色虚线框表示“自动生成并发布新补练”尚未实现；当前由教师选择已有练习。其余节点描述当前已接通的交互范围，不代表本轮重新执行所有业务验收或更新公网。

查看器支持点选上下游、侧栏关系跳转、跨图入口、键盘Enter／Escape、地址片段恢复、缩放及PNG／SVG下载。图片可直接用于汇报；原业务架构图与历史图册保留。

## 生成与检查

仓库根目录执行：

```powershell
python -X utf8 -B docs/diagrams/interactions/generate.py
node docs/diagrams/interactions/render-check.cjs
python -B scripts/check_docs.py
```

需要Pillow、微软雅黑字体、Playwright和Microsoft Edge。串行渲染，只读取本地文件，不调用业务API或模型。

[manifest.json](manifest.json)记录各图节点、连线、直接源码、28个角色页面入口及其对应分图。生成时核对导航覆盖、源码存在、正交连线、节点不重叠、连线不穿无关节点；[browser-check.json](browser-check.json)记录文字边界、导出文件及查看器交互检查。导航覆盖仅表示页面有对应交互视图，不等同于逐控件测试覆盖率。
