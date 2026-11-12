"""Specialized SVG layouts for relationship, data-flow, sequence, and boundary diagrams."""
from html import escape

INK = "#202b32"
MUTED = "#52636b"
PALETTES = {
    "data": ("#e9eff8", "#567fa7"),
    "code": ("#e9f3f0", "#17816b"),
    "manual": ("#fff0df", "#bd7130"),
    "external": ("#f1f1f1", "#747d82"),
    "pending": ("#f7f7f7", "#929b9e"),
}


def text(x, y, value, size=19, color=INK, anchor="start", weight="normal"):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-family="Microsoft YaHei" font-weight="{weight}" fill="{color}">{escape(value)}</text>'


def start(fid, title, question, height):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="1540" height="{height}" viewBox="0 0 1540 {height}" role="img" aria-labelledby="title desc">',
            f'<title id="title">{fid} {escape(title)}</title><desc id="desc">{escape(question)}</desc>',
            f'<rect width="1540" height="{height}" fill="#fbfcfb"/><rect width="12" height="{height}" fill="#17816b"/>',
            text(60, 68, fid + "　" + title, 30, INK, weight="700"),
            text(60, 112, question, 21, MUTED),
            text(60, 151, "本地代码状态 · 2026-11-12", 17, "#17816b")]


def finish(out, evidence, boundary, height):
    out.extend([text(60, height-95, "证据：" + evidence, 16, MUTED),
                text(60, height-58, "边界：" + boundary, 17, "#9b6330"),
                '</svg>'])
    return "\n".join(out)


def box(out, x, y, w, h, label, kind="data", subtitle=""):
    fill, stroke = PALETTES[kind]
    dash = ' stroke-dasharray="7 5"' if kind == "pending" else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{fill}" stroke="{stroke}" stroke-width="2"{dash}/>')
    out.append(text(x+w/2, y+h/2+(0 if subtitle else 7), label, 20, INK, "middle", "600"))
    if subtitle:
        out.append(text(x+w/2, y+h/2+28, subtitle, 16, MUTED, "middle"))


def line(out, x1, y1, x2, y2, label="", dashed=False):
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#829ba1" stroke-width="2"{dash}/>')
    if label:
        out.append(text((x1+x2)/2, (y1+y2)/2-10, label, 16, MUTED, "middle"))


def arrow(out, x1, y, x2, label="", dashed=False):
    line(out, x1, y, x2, y, label, dashed)
    out.append(f'<path d="M{x2-9} {y-6} L{x2} {y} L{x2-9} {y+6}" fill="none" stroke="#829ba1" stroke-width="2"/>')


def er(figure, physical=False):
    fid, title, question, _, evidence, boundary = figure
    height = 1400 if physical else 1260
    out = start(fid, title, question, height)
    groups = (
        [("课程与成员", [("课程", "选课关系", "1:N"), ("课程", "知识点", "1:N"), ("课程", "作业", "1:N")]),
         ("资料与知识", [("原件", "片段", "1:N"), ("原件", "学习资料", "0:N"), ("课程", "知识条目", "1:N")]),
         ("题目与评价", [("题库条目", "题目版本", "1:N"), ("作业", "作业题", "1:N"), ("作业题", "正式提交", "1:N")])]
        if not physical else
        [("课程外键", [("courses", "enrollments", "1:N"), ("courses", "assignments", "1:N"), ("courses", "material_sources", "1:N")]),
         ("资料外键", [("material_sources", "material_fragments", "1:N"), ("material_sources", "resources", "0:N"), ("retrieval_chunks", "chunk_embeddings", "1:N")]),
         ("评价外键", [("question_bank", "bank_question_versions", "1:N"), ("bank_question_versions", "rubric_versions", "0:N"), ("assignments", "questions", "1:N"), ("questions", "submissions", "1:N"), ("submissions", "grading_revisions", "1:N")])]
    )
    for group_index, (group, relations) in enumerate(groups):
        base_y = 205 + group_index * 270
        out.append(text(60, base_y, group, 22, INK, weight="700"))
        for row_index, (left, right, rel) in enumerate(relations):
            y = base_y + 22 + row_index * 74
            box(out, 300, y, 390, 58, left)
            box(out, 950, y, 390, 58, right)
            line(out, 690, y+29, 950, y+29, rel)
        if group_index < 2:
            out.append(f'<line x1="60" y1="{base_y+251}" x2="1480" y2="{base_y+251}" stroke="#e4e9e8"/>')
    if physical:
        out.append(text(60, 1180, "rubric_versions：question_id 与 bank_question_version_id 恰有其一；questions 可选绑定题库版本与标准。", 17, MUTED))
        boundary = "主干外键视图；完整约束见迁移 00001–00012。"
    else:
        out.append(text(60, 1035, "补充：题库版本可供作业题选用；标准可归属旧作业题或新题库版本。", 17, MUTED))
    return finish(out, evidence, boundary, height)


def dfd(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1000
    out = start(fid, title, question, height)
    out.append(text(60, 215, "输入 / 事件", 20, INK, weight="700"))
    out.append(text(550, 215, "处理", 20, INK, weight="700"))
    out.append(text(1080, 215, "数据存储与消费", 20, INK, weight="700"))
    rows = [
        ("教师：文件 / URL", "导入、解析、确认", "PG元数据 + 文件卷", "发布资料 / 知识 / 检索"),
        ("教师：AI任务", "API排队 → worker", "PG任务、预算 + Redis队列", "候选供教师审核"),
        ("学生：学习 / 提交", "课程归属、截止与幂等", "PG学习事件、草稿、attempt", "评分与个人历史"),
        ("教师：确认 / 发布", "标准与评分状态转换", "PG评分修订、标准版本", "反馈 / 学情 / 路径"),
    ]
    for i, (source, process, store, consume) in enumerate(rows):
        y = 255 + i*163
        box(out, 55, y, 320, 70, source, "manual")
        box(out, 505, y, 390, 70, process, "code")
        box(out, 1020, y, 455, 70, store, "data")
        arrow(out, 375, y+35, 505)
        arrow(out, 895, y+35, 1020)
        out.append(text(1035, y+108, "消费 → " + consume, 17, MUTED))
        out.append(f'<line x1="55" y1="{y+132}" x2="1475" y2="{y+132}" stroke="#e4e9e8"/>')
    return finish(out, evidence, boundary, height)


def states(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1180
    out = start(fid, title, question, height)
    rows = [
        ("课程", ["draft", "published"], ["教师发布"]),
        ("学习资料", ["draft", "published"], ["教师审核发布"]),
        ("作业", ["draft", "published", "closed"], ["教师发布", "教师关闭"]),
        ("题目 / 解答 / 标准", ["draft", "confirmed"], ["分别人工确认"]),
        ("评分修订", ["draft", "confirmed", "released"], ["教师确认", "教师发布"]),
        ("干预", ["draft", "assigned", "submitted", "reviewed"], ["教师下发", "学生提交", "教师复查"]),
    ]
    for i, (name, values, triggers) in enumerate(rows):
        y = 210 + i*137
        out.append(text(60,y+47,name,20,INK,weight="700"))
        for j,value in enumerate(values):
            x = 250 + j*330
            box(out,x,y,200,72,value,"data")
            if j:
                arrow(out,x-130,y+36,x,triggers[j-1])
        out.append(f'<line x1="60" y1="{y+108}" x2="1480" y2="{y+108}" stroke="#e4e9e8"/>')
    return finish(out,evidence,boundary,height)


def sequence(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1400
    out = start(fid, title, question, height)
    examples = [
        ("正式提交", ["学生", "API", "PG事务"], ["提交原文", "鉴权/截止/幂等后写入", "回执或拒绝；保存attempt+哈希"]),
        ("资料解析", ["教师", "API", "PG+Redis", "worker"], ["发起导入", "保存任务", "领取并解析", "片段或失败留痕"]),
        ("AI评分草稿", ["教师", "API", "PG+Redis", "worker/模型"], ["选冻结标准", "预算+任务", "执行生成", "草稿或失败；显式重试"]),
        ("整组重评", ["教师", "API", "PG事务"], ["确认逐份", "校验基线并整组发布", "统一结果或整组回滚"]),
    ]
    xs = [270, 620, 970, 1320]
    for i, (name, actors, messages) in enumerate(examples):
        y = 210 + i*250
        out.append(text(60, y+22, name, 20, INK, weight="700"))
        for j, actor in enumerate(actors):
            box(out, xs[j]-110, y, 220, 52, actor, "manual" if j in (0,3) else "code")
            line(out, xs[j], y+52, xs[j], y+218, dashed=True)
        for j, msg in enumerate(messages[:len(actors)-1]):
            arrow(out, xs[j]+8, y+90+j*43, xs[j+1]-8, msg)
        result = messages[-1]
        for x1, x2, yy, label in [(xs[len(actors)-1]-8, xs[1]+8, y+184, result), (xs[1]-8, xs[0]+8, y+215, "状态 / 回执")]:
            line(out, x1, yy, x2, yy, label, dashed=True)
            out.append(f'<path d="M{x2+9} {yy-6} L{x2} {yy} L{x2+9} {yy+6}" fill="none" stroke="#829ba1" stroke-width="2"/>')
        out.append(f'<line x1="55" y1="{y+240}" x2="1480" y2="{y+240}" stroke="#e4e9e8"/>')
    return finish(out, evidence, boundary, height)


def ia(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1020
    out = start(fid, title, question, height)
    box(out, 550, 190, 440, 66, "登录 → 角色工作台", "code")
    out.append(text(190, 315, "教师端 /teacher", 23, INK, weight="700"))
    out.append(text(965, 315, "学生端 /student", 23, INK, weight="700"))
    line(out, 660, 256, 660, 284)
    line(out, 660, 284, 80, 284)
    line(out, 80, 284, 80, 322)
    line(out, 880, 256, 880, 284)
    line(out, 880, 284, 800, 284)
    line(out, 800, 284, 800, 322)
    line(out, 80, 322, 80, 830)
    line(out, 800, 322, 800, 646)
    teacher = ["顶部课程选择、个人设置", "课程管理 / 目录 / 学习资料", "知识库 / 检索 / 内容变更", "题库 / 作业 / 测验 / 重评", "看板 / 干预 / 互动", "教研 / 行业人工记录"]
    student = ["顶部课程选择、个人设置", "课程学习 / 知识库 / 问答", "作业 / 测验 / 正式反馈", "学习路径 / 老师任务 / 互动"]
    for i, label in enumerate(teacher):
        y = 340 + i*92
        box(out, 115, y, 590, 62, label, "code")
        line(out, 80, y+31, 115, y+31)
    for i, label in enumerate(student):
        y = 340 + i*92
        box(out, 835, y, 590, 62, label, "code")
        line(out, 800, y+31, 835, y+31)
    return finish(out, evidence, boundary, height)


def deploy(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1030
    out = start(fid, title, question, height)
    for y, label, color in [(195, "公网旧版 / hajistudy.online", "#f0f3f2"), (570, "本地开发 / 127.0.0.1:18080", "#edf4f1")]:
        out.append(f'<rect x="400" y="{y}" width="1080" height="330" rx="8" fill="{color}" stroke="#c0cfca"/>')
        out.append(f'<rect x="750" y="{y+58}" width="700" height="176" rx="5" fill="none" stroke="#92a8a3" stroke-dasharray="8 5"/>')
        out.append(text(425, y+40, label + " · 主机边界", 22, INK, weight="700"))
        out.append(text(780, y+82, "Docker 私有网络", 16, MUTED))
    public = [(100,"浏览器 HTTPS","external"),(440,"OpenResty TLS","external"),(780,"Web + API","code"),(1120,"私网 PG / Redis","data")]
    local = [(100,"本地浏览器","external"),(440,"Web + API","code"),(780,"PG / Redis / worker","data"),(1120,"可选模型出站","external")]
    for nodes, y in [(public,300),(local,675)]:
        for i,(x,label,kind) in enumerate(nodes):
            box(out,x,y,260,78,label,kind)
            if i:
                arrow(out,nodes[i-1][0]+260,y+39,x)
    out.append(text(399, 286, "公网跨界", 16, MUTED, "middle"))
    out.append(text(750, 286, "代理至容器", 16, MUTED, "middle"))
    out.append(text(399, 662, "本机回环", 16, MUTED, "middle"))
    out.append(text(750, 662, "容器私网", 16, MUTED, "middle"))
    out.append(text(95, 458, "公网：生产 Compose 私网，AI_ENABLED=false；当前新模块未部署。", 19, MUTED))
    out.append(text(95, 833, "本地：compose.rag.yaml 显式启用解析与模型；原件文件卷只供 API / worker。", 19, MUTED))
    return finish(out, evidence, boundary, height)


def packages(figure):
    fid, title, question, _, evidence, boundary = figure
    height = 1130
    out = start(fid, title, question, height)
    groups = [
        ("web / React", 80, 220, ["app：角色路由、主题", "live：业务页面", "shared：会话、API客户端"]),
        ("backend / Go", 805, 220, ["server：路由装配", "identity：会话授权", "learning / rag：业务处理"]),
        ("backend / 数据", 80, 595, ["db/queries：SQL", "internal/store：sqlc生成", "db/migrations：结构版本"]),
        ("运行入口", 805, 595, ["cmd/api、cmd/worker", "tools/parser：Python解析", "Compose：本地与公网配置"]),
    ]
    for title, x, y, items in groups:
        out.append(f'<rect x="{x}" y="{y}" width="650" height="315" rx="8" fill="#f5f8f7" stroke="#a7b9bf" stroke-width="2"/>')
        out.append(text(x+24,y+43,title,23,INK,weight="700"))
        for i,item in enumerate(items):
            box(out,x+24,y+65+i*76,600,58,item,"code" if i<2 else "data")
    arrow(out,730,375,805,"HTTP调用")
    return finish(out,evidence,boundary,height)


def render(figure):
    fid = figure[0]
    if fid == "F02": return er(figure)
    if fid == "F11": return states(figure)
    if fid == "F13": return dfd(figure)
    if fid == "F14": return er(figure, physical=True)
    if fid == "F15": return sequence(figure)
    if fid == "F17": return ia(figure)
    if fid == "F18": return deploy(figure)
    if fid == "F19": return packages(figure)
    return None
