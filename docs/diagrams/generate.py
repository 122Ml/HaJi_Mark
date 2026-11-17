"""Generate the current local implementation diagrams; preserve the original network."""
from pathlib import Path
from copy import deepcopy
import json
import xml.etree.ElementTree as ET

from PIL import ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "current"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
FONT = "C:/Windows/Fonts/msyh.ttc"
AS_OF = "2026-11-17"
CODE_BASELINE = "560de5e"
FONTS = {}
COL = {"done": "#187653", "partial": "#A06413", "planned": "#78818A"}
STATUS = {"done": "完全实现", "partial": "部分实现", "planned": "未实现"}
ROLE = {
    "system": ("#FFFFFF", "#CFD5D5", "#242424", "#58616A", "系统"),
    "teacher": ("#303235", "#303235", "#FFFFFF", "#E1E5E8", "教师"),
    "ai": ("#FFF1E5", "#E3B89A", "#242424", "#62656A", "AI"),
    "data": ("#EAF1F5", "#AFC9DA", "#242424", "#526575", "数据"),
    "external": ("#F0F0EA", "#C8CBC5", "#242424", "#62656A", "衔接"),
}


def tag(name):
    return f"{{{NS}}}{name}"


def el(parent, name, **attrs):
    return ET.SubElement(parent, tag(name), {k.replace("_", "-"): str(v) for k, v in attrs.items()})


def width(text, size):
    if size not in FONTS:
        FONTS[size] = ImageFont.truetype(FONT, size)
    return FONTS[size].getlength(text)


def txt(parent, x, y, value, size=23, fill="#242424", **attrs):
    t = el(parent, "text", x=x, y=y, font_size=size, fill=fill, **attrs)
    t.text = value
    return t


def box(parent, x, y, w, h, fill, stroke="none", **attrs):
    return el(parent, "rect", x=x, y=y, width=w, height=h, fill=fill, stroke=stroke, **({"rx": 12} | attrs))


def badge(parent, x, y, status):
    box(parent, x, y, 128, 31, "#E3F0E9" if status == "done" else "#FFF0D8" if status == "partial" else "#EBEDF0", rx=7)
    txt(parent, x + 64, y + 23, STATUS[status], 20, COL[status], text_anchor="middle", font_weight=600)


def node_content(g, x, y, w, h, title, lines, role, status=None, compact=False):
    status = status or ("partial" if any(s != "done" for s, _ in lines) else "done")
    fill, stroke, fg, muted, actor = ROLE[role]
    g.set("data-status", status)
    box(g, x, y, w, h, fill, stroke, stroke_width=2)
    badge(g, x + w - 144, y - 14, status)
    tx = x + 24
    if role in ("ai", "teacher") and not compact:
        txt(g, tx, y + 29, actor, 17, "#F1BB90" if role == "teacher" else "#AE4D25", font_weight=600)
        title_y, body_y = y + 64, y + 99
    else:
        title_y, body_y = y + 44, y + 85
    txt(g, tx, title_y, title, 26, fg, font_weight=600)
    step = 32 if compact else 33
    for i, (state, line) in enumerate(lines):
        cy = body_y + i * step
        el(g, "circle", cx=x+30, cy=cy-7, r=4.5, fill=COL[state], **{"data-item-status": state})
        txt(g, x + 44, cy, line, 22, muted if state == "done" else "#C98C40" if role == "teacher" else COL[state])
        if width(line, 22) > w - 61:
            raise ValueError(f"Node text overflow: {title}: {line}")
        if cy + 5 > y + h - 9:
            raise ValueError(f"Node height overflow: {title}")


def legend(parent, y, detailed=False):
    for x, state in ((80, "done"), (275, "partial"), (490, "planned")):
        el(parent, "circle", cx=x+8, cy=y-7, r=6, fill=COL[state])
        txt(parent, x+26, y, STATUS[state], 23, COL[state])
    txt(parent, 720, y, "实线：已接通关系　虚线：待接通关系", 22, "#62656A")
    if detailed:
        txt(parent, 2320, y, "AI橙 / 教师深色 / 数据蓝", 22, "#62656A", text_anchor="end")


# Every original node and every original relationship remains in the panorama.
NETWORK = {
    "sources": ("课程资料导入", "system", [
        ("done", "PDF / DOCX / PPTX / 文本 / 表格"),
        ("done", "原件 / 来源 / 许可 / 哈希 / 版本"),
        ("done", "公开单页 / 图片快照 / 直链文档")]),
    "ingest": ("资料解析与原文核对", "system", [
        ("done", "正文 / 常规表格 / 中文印刷OCR / 定位"),
        ("done", "异常片段待核；教师校正 → 新修订"),
        ("done", "常规印刷公式图表 / 按需视觉 / 目录建议")]),
    "knowledge-review": ("知识候选与教师审核", "teacher", [
        ("done", "AI提炼 / 分类 / 条件 / 关联候选"),
        ("done", "教师编辑、确认；候选不生效"),
        ("done", "双侧证据；教师决定合并、并存与替换")]),
    "question": ("独立课程题库", "system", [
        ("done", "手工录题 / JSON候选 / 多版本"),
        ("done", "使用记录 / 停用恢复；独立于作答"),
        ("done", "三题型拆题 / 校正 / 分页 / 出处审计")]),
    "materials": ("学习资料：完整内容", "data", [
        ("done", "教师选段或全文发布；保留来源与定位"),
        ("done", "阅读 / 笔记 / 收藏 / 完成记录"),
        ("done", "可靠原文直接分块索引，无须AI提炼"),
        ("done", "选段发布不开放完整原件下载")]),
    "knowledge": ("知识库：精炼条目", "data", [
        ("done", "概念 / 规则 / 方法 / 示例 / 误区"),
        ("done", "多专题 / 标签 / 条件 / 出处 / 知识点"),
        ("done", "独立版本；学习 / 评分用途分别设置"),
        ("done", "学生可见性独立；普通新版不自动停旧"),
        ("done", "权限RAG → 问答 / 出题 / 标准依据")]),
    "authoring": ("AI出题、分析与标准草稿", "ai", [
        ("done", "选资料 / 知识依据 + 考查要求"),
        ("done", "题目 + 参考解答 + 标准；分别编辑"),
        ("done", "评分点 / 部分分 / 表达 / 错误条件"),
        ("done", "不读取待评答案；过期候选不覆盖")]),
    "rubric": ("分别确认与版本绑定", "teacher", [
        ("done", "题目 / 参考解答 / 匹配标准分别确认"),
        ("done", "同题统一满分；改满分另建匹配版本"),
        ("done", "作业固定题目、标准与依据快照"),
        ("done", "新版本不改旧作业与历史成绩")]),
    "learning": ("学生学习工作区", "system", [
        ("done", "完整资料 ↔ 精炼知识 ↔ 原文定位"),
        ("done", "阅读 / 笔记 / 收藏 / 学习完成"),
        ("done", "检索提问 / 正式反馈 / 执行补学"),
        ("done", "课程助理持久问答 / 引用 / 草稿恢复")]),
    "qa": ("RAG检索答疑", "ai", [
        ("done", "可见资料 + 学习用途确认知识"),
        ("done", "向量 + 关键词 → RRF融合"),
        ("done", "带引用回答 / 原文定位；不足可提问"),
        ("planned", "独立检索页历史（助理历史已实现）")]),
    "tasks": ("作业与测验", "system", [
        ("done", "选确认版本 / 发布 / 截止 / 关闭"),
        ("done", "课程 / 名单 / 题目与任务版本"),
        ("done", "未交 / 部分 / 已交；学生看不到规则")]),
    "answers": ("原始作答", "data", [
        ("done", "学生草稿自动保存 / 回执 / 提交历史"),
        ("done", "不可变原文 / attempt / 任务版本 / 哈希"),
        ("planned", "教师批量导入学生作答")]),
    "grading": ("有据智能评阅", "ai", [
        ("done", "原文 + 固定标准 + 当时依据快照"),
        ("done", "逐点得分 / 学生原句 / 依据来源"),
        ("done", "失败显式重试或人工；不追加扣分点"),
        ("done", "客观题固定规则；代码仅作文本评阅")]),
    "review": ("机械核对、教师复核与发布", "teacher", [
        ("done", "系统：字段 / 加和 / 引用 / 绑定检查"),
        ("done", "教师：原文、标准、依据同屏对照"),
        ("done", "修改 → 确认 → 发布；保留修订"),
        ("done", "关闭作业按题整组重评；全组统一发布")]),
    "intervention": ("教师干预与复查", "teacher", [
        ("done", "选学生 / 资料 / 补练 / 完成条件"),
        ("done", "下发 → 新学习 / 新提交 → 教师复查"),
        ("done", "只采纳下发后证据；可继续干预")]),
    "recommend": ("规则学习路径与补练", "system", [
        ("done", "低表现 / 无证据 + 前置知识 → 路径"),
        ("done", "教师指定资料与已确认练习"),
        ("planned", "知识驱动个性推荐 / 自动补练生成")]),
    "diagnose": ("学情证据与错因诊断", "system", [
        ("done", "正式结果去重 / 分母 / 班级个人表现"),
        ("done", "反馈 → 评分点 → 原文；缺证据单列"),
        ("planned", "E4：AI班级共性错因诊断")]),
    "results": ("正式结果与学习证据", "data", [
        ("done", "分项反馈 / 引用 / 标准与版本"),
        ("done", "学生本人可见 / 教师CSV导出"),
        ("done", "历次作答 / 学习 / 干预与复查")]),
    "maintenance": ("来源与知识生命周期", "system", [
        ("done", "普通新版不自动停旧；明确归档 / 撤回 / 替换才限制未来"),
        ("done", "影响清单 / 站内决定 / 整组重评；旧成绩与依据保留"),
        ("planned", "典型作答匿名化沉淀案例")]),
}


def agent_layer(main, root):
    """Add execution capabilities while retaining the original business network."""
    zone = el(root.find(f".//{tag('g')}[@class='module-zones']"), "g",
              **{"class": "module-region", "data-module": "agent"})
    box(zone, 80, 2540, 3440, 750, "#F0F4F1", "#9AAFA7", stroke_dasharray="10 7", stroke_width=2)
    group = el(main, "g", **{"class": "agent-architecture"})
    txt(group, 110, 2585, "对话助理与授权执行模块", 29, font_weight=600)
    badge(group, 565, 2560, "partial")
    txt(group, 3490, 2585, "复用上方业务对象与状态，不另建第二套业务数据", 22, "#526575", text_anchor="end")
    links = el(group, "g", **{"class": "agent-links"})
    for a, b, route, both in [
        ("agent-chat", "agent-coordinator", "M 860 2720 H 1000", False),
        ("agent-coordinator", "agent-specialists", "M 1640 2720 H 1780", False),
        ("agent-specialists", "agent-policy", "M 2635 2840 V 2865 H 550 V 2920", False),
        ("agent-chat", "agent-policy", "M 460 2820 V 2920", True),
        ("agent-policy", "agent-gateway", "M 960 3040 H 1080", False),
    ]:
        g = el(links, "g", **{"class": "edge", "data-from": a, "data-to": b, "data-status": "done"})
        attrs = {"marker-end": "url(#runtime-arrow)"}
        if both:
            attrs["marker-start"] = "url(#runtime-arrow)"
        el(g, "path", d=route, fill="none", stroke="#638092", stroke_width=2.5, **attrs)
    txt(group, 930, 2701, "目标", 21, "#526575", text_anchor="middle")
    txt(group, 1710, 2701, "顺序委派", 21, "#526575", text_anchor="middle")
    txt(group, 435, 2902, "问题 / 审批 ↔ 回答", 21, "#526575", text_anchor="end")
    txt(group, 1820, 2898, "类型化工具调用 → 身份 / 模式 / 快照核对", 21, "#526575", text_anchor="middle")
    txt(group, 1020, 3021, "准入", 21, "#526575", text_anchor="middle")
    cards = [
        ("agent-chat", 110, 2630, 750, 190, "师生对话与文件", "system", [
            ("done", "消息 / 附件 / 模型选择 / 业务事件SSE"),
            ("done", "文本 / 单选 / 多选问题卡；逐操作审批"),
            ("done", "持久历史 / 草稿恢复 / 私有下载与CSV")]),
        ("agent-coordinator", 1000, 2630, 640, 190, "协调Agent与持久运行时", "ai", [
            ("done", "完整目标 + 已验证补充回答"),
            ("done", "单层顺序委派 / 限额 / 后台等待"),
            ("done", "检查点 / 取消 / 显式恢复")]),
        ("agent-specialists", 1780, 2630, 1710, 210, "四领域专家 → 上方业务模块", "ai", [
            ("done", "资料与知识 → 学习资料 / 知识审核 / 专题库 / 来源生命周期"),
            ("done", "题目与标准 → 独立题库 / 参考解答 / 标准版本；不读待评作答"),
            ("done", "作业与评阅 → 作业 / 固定标准 / 评分 / 整组重评 / 正式结果导出"),
            ("done", "学习支持 → RAG答疑 / 笔记 / 正式证据 / 规则路径 / 补学任务")]),
        ("agent-policy", 110, 2920, 850, 240, "类型化工具与权限门禁", "teacher", [
            ("done", "read-only / auto-review / full-access"),
            ("done", "auto-review为确定性风险门禁"),
            ("done", "正式确认 / 发布始终逐操作批准"),
            ("done", "角色 / 课程 / 本人 / 参数快照重核")]),
        ("agent-gateway", 1080, 2920, 680, 240, "业务Gateway与真实回执", "system", [
            ("done", "重走原路由 → 已有领域数据"),
            ("done", "后台任务等到真实终态才报完成"),
            ("done", "未知写操作不重放；保留已完成业务"),
            ("done", "已读作答会话禁止出题与标准工具")]),
        ("agent-coverage", 1880, 2920, 1610, 240, "对话代办覆盖与扩展边界", "system", [
            ("done", "资料 / 知识 / 题目 / 标准 / 作业 / 评分 / 学习的已登记工具"),
            ("done", "整卷采纳、学生正式提交及部分课程维护继续使用既有页面"),
            ("planned", "全站所有动作工具化；长会话历史分页"),
            ("planned", "供应商token流（当前是非流式模型调用 + 业务事件SSE）")]),
    ]
    for name, x, y, w, h, title, role, lines in cards:
        g = el(group, "g", **{"class": "node", "data-node": name, "data-module": "agent",
                               "role": "button", "tabindex": "0", "aria-label": title})
        node_content(g, x, y, w, h, title, lines, role, compact=True)
    call = el(group, "g", **{"class": "runtime-connections"})
    el(call, "path", d="M 1440 3160 V 3430", fill="none", stroke="#638092", stroke_width=2.5,
       marker_start="url(#runtime-arrow)", marker_end="url(#runtime-arrow)")
    txt(group, 1470, 3320, "调用业务 / 返回真实结果", 21, "#526575")


def panorama():
    root = ET.parse(HERE / "base-network.svg").getroot()
    original = deepcopy(root)
    groups = [g for g in root.iter(tag("g")) if g.get("class") == "node"]
    assert {g.get("data-node") for g in groups} == set(NETWORK)
    for g in groups:
        r = g.find(tag("rect"))
        x, y, w, h = [float(r.get(k)) for k in ("x", "y", "width", "height")]
        title, role, lines = NETWORK[g.get("data-node")]
        for child in list(g):
            g.remove(child)
        g.set("aria-label", title)
        node_content(g, x, y, w, h, title, lines, role, compact=True)
    main = root.find(tag("g"))
    for t in root.iter(tag("text")):
        if t.text == "目标设计":
            t.text = f"本地实现 · {AS_OF} · {CODE_BASELINE}"
        elif t.text == "HaJi Mark · 全系统业务与智能数据关系图":
            t.text = "HaJi Mark · 全景业务与实现架构图"
        elif t.text == "学习推荐与补练生成":
            t.text = "规则学习路径与补练"
        elif t.text == "AI处理":
            t.text = "AI功能"
        elif t.text and t.text.startswith("课程 / 章节目录"):
            t.text = "课程 / 章节目录 / 知识点依赖 / 成员权限 / 公告答疑 / 人工教研与行业记录"
    for g in root.iter(tag("g")):
        if g.get("class") == "module-label" and g.get("data-module") == "shared":
            g.set("transform", "translate(1480 0)")
    # Place the status legend in existing whitespace; role colors remain unchanged.
    lg = el(main, "g", **{"class": "implementation-legend"})
    legend(lg, 198)
    txt(lg, 3520, 198, "实现状态对应所列能力；非模型质量或公网状态", 22, "#62656A", text_anchor="end")
    badge(lg, 1870, 120, "done")
    # Expand only the old shared-base area; all business geometry stays intact.
    root.set("height", "4050")
    root.set("viewBox", "0 0 3600 4050")
    main.find(tag("rect")).set("height", "4050")
    for child in list(main):
        if ((child.tag == tag("rect") and child.get("y") == "2540")
                or (child.tag == tag("text") and child.text
                    and (child.text == "共享运行底座" or child.text.startswith("PostgreSQL：业务")))):
            main.remove(child)
    runtime = el(main, "g", transform="translate(0 800)", **{"class": "runtime-architecture"})
    box(runtime, 80, 2540, 3440, 610, "#EAE9E3", rx=10)
    txt(runtime, 110, 2585, "共享运行架构 · Go单体 + 独立worker · Docker Compose", 29, font_weight=600)
    defs = root.find(tag("defs"))
    marker = el(defs, "marker", id="runtime-arrow", viewBox="0 0 10 10", refX=9, refY=5,
                markerWidth=7, markerHeight=7, orient="auto-start-reverse")
    el(marker, "path", d="M 0 1 L 9 5 L 0 9 Z", fill="#638092")
    connections = el(runtime, "g", **{"class": "runtime-connections"})
    for route, both in [
        ("M 710 2725 H 830", False),
        ("M 1230 2630 V 2610 H 3160 V 2630", False),
        ("M 1630 2725 H 1830", False),
        ("M 2630 2725 H 2830", False),
        ("M 1230 2820 V 2890", True),
        ("M 1930 2820 V 2860 H 1510 V 2890", True),
        ("M 2330 2820 V 2890", True),
        ("M 2630 2785 H 2740 V 2970 H 2830", True),
    ]:
        attrs = {"marker-end": "url(#runtime-arrow)"}
        if both:
            attrs["marker-start"] = "url(#runtime-arrow)"
        el(connections, "path", d=route, fill="none", stroke="#638092", stroke_width=2, **attrs)
    components = [
        ("web", 110, 2630, 600, 190, "浏览器 / Nginx Web", "system", [
            "React / TypeScript / Ant Design", "师生表单 / 课程助理 / 业务SSE", "同源请求；持久对话与编辑恢复"]),
        ("api", 830, 2630, 800, 190, "Go / Gin API", "system", [
            "会话 / 角色 / 课程 / CSRF", "同步事务 / 固定版本 / 整组发布", "sqlc / pgx；业务Gateway与教师状态"]),
        ("worker", 1830, 2630, 800, 190, "Go worker / Asynq", "system", [
            "本地Python解析 / 中文OCR / 图像裁剪", "索引 / 提炼 / 出题 / 标准 / 评阅", "PG持久任务 + Redis执行队列"]),
        ("models", 2830, 2630, 660, 190, "第三方模型 API", "ai", [
            "Embedding / 生成 / 视觉；推理非流式", "服务端profile / 模型 / 维度 / 凭据", "累计50元预算：事务预留 → 结算"]),
        ("postgres", 830, 2890, 800, 160, "PostgreSQL / pgvector", "data", [
            "业务 / 版本 / 任务 / 预算 / 对话与审批", "pgvector精确余弦 / 中文GIN索引"]),
        ("redis", 1830, 2890, 800, 160, "Redis / Asynq", "data", [
            "队列投递 / 领取 / 执行；AOF持久化", "失联任务状态由PG核对与恢复"]),
        ("files", 2830, 2890, 660, 160, "共享文件卷", "data", [
            "原件 / 网页快照 / 图像 / 私有附件 / CSV", "API与worker共享；授权下载，保留历史"]),
    ]
    for name, x, y, w, h, title, role, lines in components:
        component = el(runtime, "g", **{"class": "runtime-component", "data-component": name})
        fill, stroke, fg, muted, _ = ROLE[role]
        box(component, x, y, w, h, fill, stroke, stroke_width=2)
        txt(component, x+24, y+41, title, 26, fg, font_weight=600)
        for i, line in enumerate(lines):
            assert width(line, 22) <= w-48, f"Runtime text overflow: {name}: {line}"
            txt(component, x+24, y+80+i*32, line, 22, muted)
    for x, y, label in [(2200, 2600, "同步问答 / 查询向量 / Agent推理"),
                         (770, 2703, "HTTP"), (1730, 2693, "任务ID"),
                         (1730, 2770, "Redis / Asynq"), (2730, 2703, "模型调用"),
                         (1350, 2867, "业务 / 事务"), (1730, 2850, "任务 / 预算 / 索引"),
                         (2450, 2867, "执行队列")]:
        txt(runtime, x, y, label, 21, "#526575", text_anchor="middle")
    txt(runtime, 110, 2930, "Docker Compose · 本地", 26, font_weight=600)
    txt(runtime, 110, 2971, "web / api / worker / postgres / redis", 22, "#526575")
    txt(runtime, 110, 3006, "migrate一次性执行；具名数据卷", 22, "#526575")
    txt(runtime, 110, 3107, "中断恢复：生成失败显式重试 · 解析 / 索引幂等恢复 · 未知调用按预留保守结算一次 · 评分草稿须教师确认发布", 23, "#526575")
    txt(main, 110, 4000, "可靠原文直接索引；问答、出题与标准共用权限RAG（Go内RRF融合）；评阅只读冻结依据，不临时检索追加扣分点。", 23, "#526575")
    changes = {
        ("ingest", "knowledge-review"): "按需提炼 / 分类 / 关联候选",
        ("ingest", "materials"): "可靠原文 · 教师独立发布",
        ("knowledge", "authoring"): "检索选依据 / 考查要求",
        ("knowledge", "grading"): "标准确认时冻结的依据",
        ("knowledge", "recommend"): "待 · 精炼知识接入推荐",
        ("question", "authoring"): "独立题库 / 生成要求",
        ("authoring", "rubric"): "三类草稿",
        ("rubric", "tasks"): "确认题目 + 匹配标准",
        ("learning", "diagnose"): "学习记录 / 作答与发布反馈",
        ("diagnose", "recommend"): "表现 / 证据",
        ("recommend", "intervention"): "规则路径",
        ("intervention", "tasks"): "补练 / 已确认练习",
        ("results", "diagnose"): "正式证据",
        ("maintenance", "question"): "影响清单 / 选择新版 / 整组重评",
        ("results", "maintenance"): "待 · 典型作答案例候选",
        ("maintenance", "knowledge-review"): "待 · 匿名化 / 审核入库",
        ("recommend", "question"): "待 · 自动补练题 → 教师审核",
    }
    pending = {("results", "maintenance"), ("knowledge", "recommend"),
               ("maintenance", "knowledge-review"), ("recommend", "question")}
    for g in root.iter(tag("g")):
        if g.get("class") not in ("edge", "edge-label"):
            continue
        key = (g.get("data-from"), g.get("data-to"))
        g.set("data-status", "planned" if key in pending else "done")
        p = g.find(tag("path"))
        if p is not None:
            if key in pending:
                p.set("stroke-dasharray", "10 7")
            else:
                p.attrib.pop("stroke-dasharray", None)
        if g.get("class") == "edge-label" and key in changes:
            t, r = g.find(tag("text")), g.find(tag("rect"))
            t.text = changes[key]
            tw, cx = width(t.text, 22), float(t.get("x"))
            r.set("x", str(cx - tw / 2 - 9))
            r.set("width", str(tw + 18))
    root.find(tag("title")).text = f"HaJi Mark 全景关系网 · {AS_OF} 本地实现状态"
    root.find(tag("desc")).text = "保留19个原业务节点与42条关系，新增对话助理与授权执行层；按完全实现、部分实现、未实现逐项标注。"
    for cls in ("node", "edge"):
        def identities(tree):
            return [(e.get("data-node"), e.get("data-from"), e.get("data-to"))
                    for e in tree.iter(tag("g")) if e.get("class") == cls]
        assert identities(root) == identities(original), f"Original {cls} removed or reordered"
    def paths(tree):
        return [g.find(tag("path")).get("d") for g in tree.iter(tag("g")) if g.get("class") == "edge"]
    assert paths(root) == paths(original), "Original edge routes changed"
    def regions(tree):
        return [ET.tostring(g, encoding="unicode") for g in tree.iter(tag("g")) if g.get("class") == "module-region"]
    assert regions(root) == regions(original), "Original module boundaries changed"
    agent_layer(main, root)
    return root


class Figure:
    def __init__(self, title, height=1480):
        self.root = ET.Element(tag("svg"), {"width": "2400", "height": str(height), "viewBox": f"0 0 2400 {height}", "role": "img", "aria-label": title})
        el(self.root, "title").text = title
        defs = el(self.root, "defs")
        for state, color in (("done", "#85929B"), ("planned", COL["planned"])):
            m = el(defs, "marker", id=state, viewBox="0 0 10 10", refX=9, refY=5, markerWidth=8, markerHeight=8, orient="auto-start-reverse")
            el(m, "path", d="M 0 1 L 9 5 L 0 9 Z", fill=color)
        self.main = el(self.root, "g", font_family="Microsoft YaHei, sans-serif")
        box(self.main, 0, 0, 2400, height, "#F7F6F2", rx=0)
        txt(self.main, 80, 76, title, 40, font_weight=600)
        txt(self.main, 2320, 76, f"{AS_OF} · 本地", 23, "#62656A", text_anchor="end")
        legend(self.main, 136, detailed=True)
        self.edges = el(self.main, "g", **{"class": "links"})
        self.nodes = el(self.main, "g", **{"class": "nodes"})
        self.labels = el(self.main, "g", **{"class": "labels"})
        self.geometry, self.paths = {}, []

    def node(self, id, x, y, title, body, role="system", w=500, h=180, status="done"):
        self.geometry[id] = (x, y, w, h)
        g = el(self.nodes, "g", **{"class": "node", "data-node": id, "role": "button", "tabindex": "0", "aria-label": title})
        node_content(g, x, y, w, h, title, [(status, s) for s in body], role, status)

    def edge(self, a, b, pts, label="", at=None, state="done"):
        self.paths.append((a, b, pts))
        g = el(self.edges, "g", **{"class": "edge", "data-from": a, "data-to": b, "data-status": state})
        attrs = {"stroke_dasharray": "10 7"} if state == "planned" else {}
        el(g, "path", d="M " + " L ".join(f"{x} {y}" for x, y in pts), fill="none", stroke="#85929B", stroke_width=2.7, stroke_linejoin="round", marker_end=f"url(#{state})", **attrs)
        if label:
            x, y = at
            tw = width(label, 21)
            g = el(self.labels, "g", **{"class": "edge-label", "data-from": a, "data-to": b, "data-status": state})
            box(g, x-tw/2-8, y-23, tw+16, 30, "#F7F6F2", rx=4)
            txt(g, x, y, label, 21, "#526575", text_anchor="middle")

    def note(self, text, y=1395):
        box(self.main, 80, y-37, 2240, 64, "#EAE9E3", rx=8)
        txt(self.main, 105, y+3, text, 23, "#62656A")

    def validate(self):
        issues = []
        for a, b, pts in self.paths:
            assert a in self.geometry and b in self.geometry
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                assert x1 == x2 or y1 == y2, (a, b, "not orthogonal")
                for key, (x, y, w, h) in self.geometry.items():
                    if key in (a, b):
                        continue
                    if (x1 == x2 and x+2 < x1 < x+w-2 and max(min(y1, y2), y+2) < min(max(y1, y2), y+h-2)) or (y1 == y2 and y+2 < y1 < y+h-2 and max(min(x1, x2), x+2) < min(max(x1, x2), x+w-2)):
                        issues.append(f"{a}->{b} crosses {key}")
        assert not issues, issues
        return self.root


def materials():
    f = Figure("01  学习资料模块", height=1810)
    f.node("input",80,200,"教师导入",["文件 + 来源说明 / 地址 + 提炼许可", "PDF / DOCX / PPTX / 文本 / 表格"],"teacher")
    f.node("source",660,200,"原始资料",["原件 / 网页正文图片快照 / 原网址", "SHA256 / 许可 / 来源版本"],"data")
    f.node("parse",1240,200,"解析与质量检查",["正文 / 常规表格 / 中文印刷OCR", "保留页、幻灯片、内容块定位", "失败保留旧修订，显式重试"])
    f.node("gate",1820,200,"按片段检查质量",["可靠片段可以继续处理", "OCR / 异常片段进入待核队列"])
    f.node("ready",80,510,"可靠原文片段",["不可变片段ID / 位置 / 原文版本", "学习资料发布与知识提炼各自独立"],"data")
    f.node("vision",660,510,"按需视觉识别",["教师选原图 / 拖选或数值裁剪", "公式LaTeX / 图表 / 连接方向", "保存不确定项；仅生成候选"],"ai")
    f.node("revision",1240,510,"生成原文新修订",["追加校正文本与可靠性标记", "旧修订与历史引用保留"])
    f.node("review",1820,510,"教师核对与校正",["原图 ↔ 转写 / OCR / 公式排版", "编辑恢复 / 并发版本核对", "未核对内容不进入正式用途"],"teacher")
    f.node("publish",80,830,"教师编排与发布",["选择全文或指定片段", "学习资料独立版本与发布状态"],"teacher")
    f.node("material",660,830,"已发布学习资料",["正文 / 来源 / 位置 / 资料版本", "部分发布不允许完整原件下载"],"data")
    f.node("index",1240,830,"原文直接建立索引",["按可靠片段分块 → Embedding", "生成中文关键词索引", "无需先调用生成模型精炼"])
    f.node("extract",1820,830,"按需AI提炼",["仅使用许可允许的可靠原文", "提出概念、规则、方法等候选", "不阻塞完整学习资料发布"],"ai")
    f.node("student",660,1140,"学生学习",["阅读 / 原文定位 / 笔记 / 收藏", "学习完成记录 → 学情与干预"],"external")
    f.node("rag",1240,1140,"共享权限RAG",["发布状态 / 课程 / 用途过滤", "向量 + 关键词 → RRF融合", "供问答、出题与标准选依据"],"external")
    f.node("knowledge",1820,1140,"知识库模块",["接收原文逐字出处与候选", "教师审定后独立生效"],"external")
    f.node("suggest",80,1450,"自动目录与归类建议",["解析后提出章节 / 专题 / 标签", "课程知识点 / 相关知识召回", "逐项校验引用与输入版本"],"ai")
    f.node("adopt",660,1450,"教师选择与采纳",["可改专题 / 标签 / 知识点", "只追加所选目录，不覆盖旧目录", "重复采纳幂等，保留决定审计"],"teacher")
    f.node("topics",1240,1450,"独立组织与关联",["学习章节目录 ≠ 多个专题库", "一份资料可关联多个专题", "归类不复制原件或扩大权限"],"data")
    f.node("impact",1820,1450,"来源更新与影响",["普通新版保留旧版可用", "归档 / 撤回只限制未来用途", "知识 / 题库 / 作业引用可追溯"],"external")
    f.edge("parse","vision",[(1490,380),(1490,435),(910,435),(910,510)])
    f.edge("vision","review",[(910,510),(910,455),(2070,455),(2070,510)])
    f.edge("ready","suggest",[(80,600),(40,600),(40,1540),(80,1540)])
    f.edge("suggest","adopt",[(580,1540),(660,1540)])
    f.edge("adopt","topics",[(1160,1540),(1240,1540)])
    f.edge("knowledge","impact",[(2070,1320),(2070,1450)])
    f.edge("input","source",[(580,290),(660,290)])
    f.edge("source","parse",[(1160,290),(1240,290)])
    f.edge("parse","gate",[(1740,290),(1820,290)])
    f.edge("gate","ready",[(2070,380),(2070,435),(330,435),(330,510)],"可靠片段",(1150,425))
    f.edge("gate","review",[(2070,380),(2070,510)],"待核",(2145,475))
    f.edge("review","revision",[(1820,600),(1740,600)])
    f.edge("revision","ready",[(1490,690),(1490,710),(330,710),(330,690)],"校正后可靠原文",(1010,720))
    f.edge("ready","publish",[(330,690),(330,830)],"选段 / 全文",(425,765))
    f.edge("ready","index",[(580,600),(620,600),(620,755),(1490,755),(1490,830)],"直接索引",(1230,742))
    f.edge("ready","extract",[(580,565),(600,565),(600,735),(2070,735),(2070,830)],"许可允许时",(1910,725))
    f.edge("publish","material",[(580,920),(660,920)])
    f.edge("material","student",[(910,1010),(910,1140)],"发布内容",(1015,1082))
    f.edge("index","rag",[(1490,1010),(1490,1140)],"片段索引",(1590,1082))
    f.edge("extract","knowledge",[(2070,1010),(2070,1140)],"候选 + 原文回链",(2195,1082))
    f.note("原文发布、直接索引、知识提炼三条分支独立。视觉按需，目录与分类由教师采纳；手写识别暂不纳入。",y=1750)
    return f.validate()


def knowledge():
    f = Figure("02  知识库模块")
    f.node("source",80,200,"许可允许的可靠原文",["原文片段 / 来源版本 / 定位", "学习资料与知识库不共用发布状态"],"data")
    f.node("ai",660,200,"按需AI提炼与关联",["概念 / 规则 / 方法 / 示例 / 误区", "分类、适用条件、知识点与关联建议", "保留逐字出处；只生成候选"],"ai")
    f.node("candidate",1240,200,"知识候选",["内容 / 条件 / 关联建议 / 原文证据", "候选不可直接供学生或评分使用"],"data")
    f.node("review",1820,200,"教师审核",["编辑内容、分类、条件与关联", "核对出处；不合适的候选不确认"],"teacher")
    f.node("trace",80,510,"原文与知识互链",["定位原片段与来源版本", "旧知识、旧依据快照保留"],"data")
    f.node("policy",660,510,"教师设定用途与可见性",["学习用途 / 评分用途分别设置", "学生可见性独立控制"],"teacher")
    f.node("confirmed",1240,510,"确认知识版本",["教师确认后成为可用知识条目", "新条目不自动替换或归档旧版"],"data")
    f.node("lifecycle",1820,510,"修订、归档与撤回许可",["维护来源与知识生命周期", "立即限制未来检索与选用", "不覆盖历史评分依据与成绩"],"teacher")
    f.node("student",80,830,"学生精炼学习与问答",["可见且学习用途的确认知识", "带引用解释 → 原文定位", "不开放教师内部评分知识"],"external")
    f.node("index",660,830,"知识索引与资格过滤",["Embedding空间按模型 / 维度隔离", "课程 / 确认 / 用途 / 来源许可", "检索不能扩大数据访问权限"])
    f.node("rag",1240,830,"共享混合检索",["pgvector精确余弦 + 中文FTS", "RRF融合 → 有权限的原文 / 知识", "学习检索与评分选依据分开"],"data")
    f.node("question",1820,830,"题目与标准选依据",["教师选择资料 / 知识片段", "服务端重读并核对真实来源", "题目、解答和标准先作草稿"],"external")
    f.node("compare",80,1140,"AI比较相关知识",["RAG召回或教师明确选范围", "双侧原文 / 适用条件 / 差异", "相似度不直接判定冲突"],"ai")
    f.node("decision",660,1140,"教师逐项处理",["不采纳 / 合并 / 并存 / 替换 / 暂缓", "输入过期拒绝；合并保留多来源", "权限取交集；不撤整份来源许可"],"teacher")
    f.node("topics",1240,1140,"多专题与引用影响",["专题 / 标签 / 知识点独立关联", "来源 → 知识 → 题库 → 作业", "保存处理决定，按需整组重评"],"data")
    f.node("frozen",1820,1140,"评阅只使用冻结依据",["标准确认时保留依据快照", "正式评阅不临时检索增加扣分点", "历史结果可回查当时原文"],"external")
    for a,b,pts in [
        ("source","ai",[(580,290),(660,290)]),
        ("ai","candidate",[(1160,290),(1240,290)]),
        ("candidate","review",[(1740,290),(1820,290)]),
        ("review","confirmed",[(2070,380),(2070,435),(1490,435),(1490,510)]),
        ("confirmed","policy",[(1240,600),(1160,600)]),
        ("policy","index",[(910,690),(910,830)]),
        ("confirmed","lifecycle",[(1740,600),(1820,600)]),
        ("confirmed","trace",[(1490,690),(1490,720),(330,720),(330,690)]),
        ("index","rag",[(1160,920),(1240,920)]),
        ("rag","question",[(1740,920),(1820,920)]),
        ("question","frozen",[(2070,1010),(2070,1140)]),
    ]: f.edge(a,b,pts)
    f.edge("lifecycle","index",[(2070,690),(2070,755),(910,755),(910,830)],"更新未来使用资格",(1710,744))
    f.edge("candidate","compare",[(1490,380),(1490,420),(40,420),(40,1230),(80,1230)])
    f.edge("compare","decision",[(580,1230),(660,1230)])
    f.edge("decision","confirmed",[(910,1140),(910,1090),(1780,1090),(1780,600),(1740,600)])
    f.edge("decision","topics",[(1160,1230),(1240,1230)])
    f.edge("rag","student",[(1490,1010),(1490,1080),(330,1080),(330,1010)],"只返回学生可见学习内容",(930,1068))
    f.note("学习资料是完整教学内容；知识库是带条件、用途与出处的精炼条目。二者共用检索能力，各自审核、发布与保留版本。")
    return f.validate()


def questions():
    f = Figure("03  题目与评分标准模块", height=1660)
    f.node("basis",80,200,"资料 / 知识依据",["教师选择课程内合法片段", "服务端重读出处、版本与用途", "不接收客户端伪造的依据正文"],"data",w=680)
    f.node("generate",860,200,"AI出题 / 分析 / 标准起草",["选定依据 + 考查要求 → 三类草稿", "可单独分析题目或起草标准", "不读取待评学生答案"],"ai",w=680)
    f.node("manual",1640,200,"整卷拆题 / 手工 / JSON",["三题型 / 跨页 / 公式题图 / 片段全覆盖", "无解答留空；提取与生成分别留出处", "教师拆分 / 合并 / 重排 / 边界校正"],"teacher",w=680)
    f.node("requirement",80,500,"教师考查要求",["考查内容 / 难度 / 题型 / 满分", "独立于具体作业与学生答案"],"teacher",w=680)
    f.node("draft",860,500,"生成候选与主动采纳",["题目 + 参考解答 + 标准草稿", "分别编辑与采纳；不自动生效", "条件变化后旧候选不能覆盖新编辑"],"data",w=680)
    f.node("edit",1640,500,"教师分开审定",["检查题意、参考解答、评分点和来源", "标准含部分分、可接受表达和错误条件", "题目 / 参考解答 / 标准分别确认"],"teacher",w=680)
    f.node("question",80,800,"确认题目版本",["课程下独立题库 / 不可变版本", "历史、使用记录、停用 / 恢复", "可复用于多个作业"],"data",w=680)
    f.node("reference",860,800,"确认参考解答",["同一题目版本独立确认状态", "仅教师可见，不向学生开放", "不能用待评答案反推或调整规则"],"data",w=680)
    f.node("rubric",1640,800,"匹配的确认标准版本",["归属确切题目版本 / 分项加和等于满分", "关联原文、知识与依据快照", "改满分另建题目及匹配标准版本"],"data",w=680)
    f.node("assignment",80,1120,"作业选用与发布",["选确认题目 + 匹配标准 + 依据快照", "发布时事务固定，整组作答同一绑定", "新版本不改变旧作业与历史成绩"],"external",w=680)
    f.node("grading",860,1120,"固定规则评阅与核对",["主观题AI草稿 / 客观题固定规则", "核对字段、分数、引用与版本绑定", "代码题仅按文本评阅，不执行代码"],"external",w=680)
    f.node("release",1640,1120,"教师复核与正式结果",["教师修改 → 确认 → 发布", "学生正式反馈 / CSV导出 / 学情证据", "AI草稿不直接成为正式成绩"],"external",w=680)
    f.node("answer",860,1410,"原始学生作答",["不可变原文 / attempt / 哈希 / 任务版本", "只进入评阅，不参与制定题目与标准"],"data",w=680,h=155)
    f.node("audit",80,1410,"筛选、分页与采纳审计",["专题 / 知识点 / 题型 / 状态 / 关键词", "反查原卷、生成任务、所选依据及版本"],"system",w=680,h=155)
    f.node("regrade",1640,1410,"变更影响与整组重评",["关闭作业按题冻结每人最新有效提交", "同一新标准，逐份确认后整组发布"],"external",w=680,h=155)
    f.edge("basis","generate",[(760,290),(860,290)],"所选依据",(809,270))
    f.edge("requirement","generate",[(760,590),(810,590),(810,345),(860,345)])
    f.edge("generate","draft",[(1200,380),(1200,500)],"三类候选",(1310,450))
    f.edge("manual","edit",[(1980,380),(1980,500)])
    f.edge("draft","edit",[(1540,590),(1640,590)])
    f.edge("edit","question",[(1980,680),(1980,740),(420,740),(420,800)])
    f.edge("edit","reference",[(1980,680),(1980,740),(1200,740),(1200,800)])
    f.edge("edit","rubric",[(1980,680),(1980,800)])
    f.edge("question","assignment",[(420,980),(420,1120)])
    f.edge("reference","assignment",[(1200,980),(1200,1040),(500,1040),(500,1120)])
    f.edge("rubric","assignment",[(1980,980),(1980,1070),(580,1070),(580,1120)],"发布前校验版本、满分与来源许可",(1480,1058))
    f.edge("assignment","grading",[(760,1210),(860,1210)])
    f.edge("answer","grading",[(1200,1410),(1200,1300)],"原文版本",(1310,1370))
    f.edge("grading","release",[(1540,1210),(1640,1210)])
    f.edge("assignment","audit",[(420,1300),(420,1410)])
    f.edge("release","regrade",[(1980,1300),(1980,1410)])
    f.note("题库独立于作业；题目、参考解答与标准分别审定。新版本不改旧绑定，重评追加新成绩并保留历史。", y=1610)
    return f.validate()


def changes():
    f = Figure("04  内容变更与整组重评", height=1510)
    f.node("source",80,200,"来源 / 知识新版本",["旧版保留，普通更新不自动停用", "明确归档 / 撤回才限制未来用途"],"data")
    f.node("impact",660,200,"查询实际引用关系",["来源 → 多来源知识 → 题目 / 标准", "作业 / 正式结果，按对象去重"])
    f.node("decide",1240,200,"教师保存处理决定",["无需处理 / 后续选新版 / 整组重评", "站内可回查，不自动改绑历史"],"teacher")
    f.node("future",1820,200,"未来任务明确选新版",["题目、解答、标准仍分别确认", "已发布作业保留当时固定版本"],"external")
    f.node("scope",80,540,"关闭作业并选择一道题",["预览每人最新有效提交", "题干 / 选项 / 满分改变须另建任务"],"teacher")
    f.node("freeze",660,540,"冻结独立重评批次",["名单 / attempt / 原文哈希 / 旧结果", "统一新版标准与依据；一题一活动批次"],"data")
    f.node("draft",1240,540,"逐份评分草稿",["AI草稿或人工；客观题固定规则", "原句校验 / 分数加和 / 编辑版本", "失败显式重试，不发布半组"])
    f.node("review",1820,540,"教师逐份复核",["同屏核对原文、规则与依据", "保存 / 修改 / 确认每份结果", "未全组确认时禁用发布"],"teacher")
    f.node("gate",1820,900,"事务发布前再核对",["作业仍关闭 / 名单与原文未变", "旧成绩基线 / 全组确认齐全", "冲突拒绝；取消保留旧成绩"])
    f.node("publish",1240,900,"整组原子发布",["新增正式修订，不改旧作业绑定", "重复发布幂等；保留全部历史"],"data")
    f.node("consumer",660,900,"正式结果统一消费",["学生反馈 / CSV / 班级与个人学情", "同一批正式修订去重计分"],"external")
    f.node("history",80,900,"历史与取消批次",["旧规则 / 旧成绩 / 旧依据可追溯", "来源撤回不删除已保存历史"] ,"data")
    for a,b,pts in [
        ("source","impact",[(580,290),(660,290)]),
        ("impact","decide",[(1160,290),(1240,290)]),
        ("decide","future",[(1740,290),(1820,290)]),
        ("decide","scope",[(1490,380),(1490,440),(330,440),(330,540)]),
        ("scope","freeze",[(580,630),(660,630)]),
        ("freeze","draft",[(1160,630),(1240,630)]),
        ("draft","review",[(1740,630),(1820,630)]),
        ("review","gate",[(2070,720),(2070,900)]),
        ("gate","publish",[(1820,990),(1740,990)]),
        ("publish","consumer",[(1240,990),(1160,990)]),
        ("consumer","history",[(660,990),(580,990)]),
    ]: f.edge(a,b,pts)
    f.note("发布前学生继续看到旧结果；取消或失败不暴露部分新成绩。批次只处理所选已关闭作业的一道题。",y=1380)
    return f.validate()


FIGURES = [
    ("00_全景架构_实现状态", "全景架构", panorama),
    ("01_学习资料_业务流程", "学习资料", materials),
    ("02_知识库_业务流程", "知识库", knowledge),
    ("03_题目与评分标准_业务流程", "题目与评分标准", questions),
    ("04_内容变更与整组重评", "变更与重评", changes),
]

VIEWER = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HaJi Mark · 业务流程与实现架构</title><style>
*{box-sizing:border-box}body{margin:0;background:#E4E3DE;color:#242424;font:14px "Microsoft YaHei",sans-serif;height:100vh;display:flex;flex-direction:column}header{padding:12px 20px;background:#242424;color:white;display:flex;flex-wrap:wrap;align-items:center;gap:10px}strong{font-size:17px;margin-right:auto}nav{display:flex;gap:6px;flex-wrap:wrap}button,a,select{font:inherit;border:1px solid #888;border-radius:5px;padding:6px 11px;background:transparent;color:white;text-decoration:none;cursor:pointer}button.active{background:#BB5226;border-color:#BB5226}select option{color:#242424;background:white}.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}main{overflow:auto;padding:24px;flex:1;min-height:0}.canvas{margin:auto}svg{display:block;width:100%;height:auto}.node{cursor:pointer}.dim{opacity:.12}.selected>rect:first-child{stroke:#BB5226;stroke-width:5}output{min-width:48px;text-align:center}.hide-modules .module-zones{display:none}.panel{display:none}.panel.active{display:block}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #F8B06C;outline-offset:2px}
</style></head><body><header><strong>HaJi Mark · 流程与实现架构</strong><nav aria-label="图表">TABS</nav><div class="toolbar"><select id="module" aria-label="查看模块关系"><option value="">全部模块</option>MODULES</select><label><input id="boundaries" type="checkbox" checked>模块边界</label><button id="fit">适宽</button><button id="minus" aria-label="缩小">−</button><output id="level"></output><button id="plus" aria-label="放大">＋</button><button id="reset">重置关系</button><a id="svg-link">SVG</a><a id="png-link">PNG</a></div></header><main>PANELS</main><script>
const files=FILES,panels=[...document.querySelectorAll('.panel')],buttons=[...document.querySelectorAll('nav button')],pane=document.querySelector('main'),picker=document.getElementById('module');let active=0,scale=1;
function canvas(){return panels[active].querySelector('.canvas')}function all(sel){return [...canvas().querySelectorAll(sel)]}
function zoom(s){scale=Math.max(.15,Math.min(2.5,s));canvas().style.width=(Number(canvas().querySelector('svg').getAttribute('width'))*scale)+'px';document.getElementById('level').value=Math.round(scale*100)+'%'}
function fit(){zoom((pane.clientWidth-48)/Number(canvas().querySelector('svg').getAttribute('width')))}
function highlight(ids=[]){const wanted=new Set(ids),near=new Set(ids);all('.edge,.edge-label').forEach(e=>{const hit=!wanted.size||wanted.has(e.dataset.from)||wanted.has(e.dataset.to);e.classList.toggle('dim',!hit);if(hit){near.add(e.dataset.from);near.add(e.dataset.to)}});all('.node').forEach(n=>{n.classList.toggle('dim',wanted.size>0&&!near.has(n.dataset.node));n.classList.toggle('selected',wanted.has(n.dataset.node))})}
function show(index){active=index;panels.forEach((p,i)=>p.classList.toggle('active',i===index));buttons.forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-pressed',String(i===index))});picker.disabled=index!==0;document.getElementById('boundaries').disabled=index!==0;picker.value='';document.getElementById('svg-link').href=files[index]+'.svg';document.getElementById('png-link').href=files[index]+'.png';highlight();fit();pane.scrollTo(0,0);history.replaceState(null,'','#'+index)}
buttons.forEach((b,i)=>b.onclick=()=>show(i));document.querySelectorAll('.node').forEach(n=>{const run=()=>{picker.value='';highlight(n.classList.contains('selected')?[]:[n.dataset.node])};n.onclick=run;n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run()}}});
picker.onchange=()=>highlight(all('.node').filter(n=>n.dataset.module===picker.value).map(n=>n.dataset.node));document.querySelectorAll('.module-label').forEach(n=>{const run=()=>{picker.value=n.dataset.module;picker.dispatchEvent(new Event('change'))};n.onclick=run;n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run()}}});document.getElementById('boundaries').onchange=e=>canvas().classList.toggle('hide-modules',!e.target.checked);document.getElementById('fit').onclick=fit;document.getElementById('plus').onclick=()=>zoom(scale*1.25);document.getElementById('minus').onclick=()=>zoom(scale/1.25);document.getElementById('reset').onclick=()=>{picker.value='';highlight()};document.addEventListener('keydown',e=>{if(e.key==='Escape'){picker.value='';highlight()}});show(Math.min(files.length-1,Math.max(0,Number(location.hash.slice(1))||0)));
</script></body></html>'''


def main():
    OUT.mkdir(exist_ok=True)
    panels, report = [], []
    for filename, label, build in FIGURES:
        root = build()
        # Prefix fragment IDs so four inline SVGs have independent markers / titles.
        prefix = filename[:2] + "-"
        for e in root.iter():
            if e.get("id"):
                e.set("id", prefix + e.get("id"))
            for attr, val in list(e.attrib.items()):
                if "url(#" in val:
                    e.set(attr, val.replace("url(#", f"url(#{prefix}"))
                elif attr == "aria-labelledby":
                    e.set(attr, " ".join(prefix+x for x in val.split()))
        svg = ET.tostring(root, encoding="unicode")
        (OUT / (filename + ".svg")).write_text(svg, encoding="utf-8")
        panels.append(f'<section class="panel" aria-label="{label}"><div class="canvas">{svg}</div></section>')
        report.append({"file": filename, "nodes": sum(e.get("class")=="node" for e in root.iter()),
                       "edges": sum(e.get("class")=="edge" for e in root.iter()),
                       "size": [int(root.get("width")), int(root.get("height"))]})
    modules = [("materials","学习资料"),("knowledge","知识库"),("questions","题目与标准"),("learning","学习与答疑"),("assignments","作业测验"),("grading","评阅反馈"),("intervention","推荐干预"),("diagnosis","学情诊断"),("agent","对话与授权执行")]
    html = VIEWER.replace("TABS", "".join(f'<button data-index="{i}">{label}</button>' for i,(_,label,_) in enumerate(FIGURES)))
    html = html.replace("MODULES", "".join(f'<option value="{k}">{v}</option>' for k,v in modules))
    html = html.replace("PANELS", "".join(panels)).replace("FILES", json.dumps([f[0] for f in FIGURES], ensure_ascii=False))
    (OUT / "index.html").write_text(html, encoding="utf-8")
    (OUT / "structure-check.json").write_text(json.dumps({"scope":"local-implementation", "date":AS_OF, "code_baseline":CODE_BASELINE, "original_business_nodes":19, "original_business_edges":42, "added_agent_nodes":6, "added_agent_edges":5, "original_network_preserved":True, "original_edge_routes_preserved":True, "original_module_boundaries_preserved":True, "figures":report}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
