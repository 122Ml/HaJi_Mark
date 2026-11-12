"""Render the F01-F19 implementation atlas from source-checked diagram data."""
from html import escape
from pathlib import Path
import json
from PIL import ImageFont
from special import render as render_special

HERE = Path(__file__).resolve().parent
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
INK, MUTED, LINE = "#202b32", "#52636b", "#a7b9bf"
STYLES = {
    "code": ("#e9f3f0", "#17816b", "代码已接通"),
    "manual": ("#fff0df", "#bd7130", "人工确认"),
    "data": ("#e9eff8", "#567fa7", "持久数据"),
    "external": ("#f1f1f1", "#747d82", "外部边界"),
    "pending": ("#f7f7f7", "#929b9e", "当前未实现"),
}


def n(text, kind="code"):
    return (text, kind)


# Each row answers one relationship or path. The evidence list is part of the figure,
# so an implementation claim has a direct source to inspect.
FIGURES = [
    ("F01", "系统上下文图", "边界在哪，外面接了谁？", [
        ("教学用户", [n("教师 / 学生", "external"), n("HaJi Mark 系统")]),
        ("可选外部服务", [n("HaJi Mark 本地 RAG"), n("百炼北京模型接口", "external")]),
        ("当前公网边界", [n("浏览器 / HTTPS", "external"), n("HaJi Mark 公网旧版")]),
        ("公网配置", [n("AI_ENABLED=false", "external")]),
    ], "compose.yaml；compose.rag.yaml；deploy/compose.production.yaml；web/src/live/routes.tsx", "图内的本地 RAG 能力不代表已部署公网。"),
    ("F02", "概念 ER 图", "业务对象之间是什么关系？", [
        ("课程归属 1:N", [n("课程", "data"), n("成员 / 知识点 / 资料", "data")]),
        ("教学 1:N", [n("课程", "data"), n("作业", "data"), n("作业题", "data")]),
        ("题库 1:N", [n("题库条目", "data"), n("题目版本", "data"), n("标准版本", "data")]),
        ("作答 1:N", [n("作业题", "data"), n("正式提交 attempt", "data"), n("评分修订", "data")]),
        ("内容来源", [n("原件", "data"), n("片段 / 知识条目", "data"), n("检索块", "data")]),
        ("干预", [n("课程 + 学生", "data"), n("干预任务", "data")]),
    ], "backend/db/migrations/00001–00012；backend/db/queries", "这里是概念关系；具体外键和可空归属见 F14。"),
    ("F03", "数据主题域图", "数据分几个域，谁拥有写权？", [
        ("身份与课程", [n("identity + learning"), n("用户、会话、选课", "data")]),
        ("学习内容", [n("learning / materials"), n("目录、原件、资料、知识", "data")]),
        ("作业评价", [n("learning / assessment / feedback"), n("题库、作业、提交、评分", "data")]),
        ("证据与干预", [n("learning / path / feedback"), n("学习事件、路径、干预", "data")]),
        ("模型任务", [n("rag / worker"), n("任务、检索块、预算", "data")]),
    ], "backend/internal/identity；backend/internal/learning；backend/internal/rag；backend/db/queries", "写权按当前处理器划分；单个数据库由 sqlc/store 访问。"),
    ("F04", "总体结构图", "系统分几块，谁依赖谁？", [
        ("前端入口", [n("React / TypeScript / Ant Design"), n("session / api client"), n("角色与课程页面")]),
        ("HTTP", [n("Gin API"), n("identity 授权"), n("learning + rag 路由")]),
        ("异步", [n("Go API"), n("Redis / Asynq"), n("Go worker + Python解析")]),
        ("存储", [n("sqlc/store"), n("PostgreSQL / pgvector", "data"), n("原件文件卷", "data")]),
    ], "web/src/app/App.tsx；backend/internal/server；backend/cmd；compose.yaml；compose.rag.yaml", "Python 只承担本地解析，不是独立业务服务。"),
    ("F05", "总体流程图 v2", "业务阶段怎么串，交接什么？", [
        ("准备", [n("教师建课 / 目录"), n("发布学习资料", "manual"), n("学生选课学习")]),
        ("评价", [n("题库题目 / 标准确认", "manual"), n("发布作业"), n("提交原文与 attempt", "data")]),
        ("反馈", [n("规则结果 / 评分草稿"), n("教师确认并发布", "manual"), n("正式反馈 / 学情")]),
        ("跟进", [n("规则学习路径"), n("教师下发干预", "manual"), n("新学习 / 新提交 / 复查")]),
    ], "docs/architecture.md；backend/internal/learning/assessment.go；feedback.go；path.go", "学情是已发布结果的证据汇总，不是能力预测。"),
    ("F06", "工作流程：资料与知识", "资料从导入到发布按什么顺序走？", [
        ("原件", [n("教师上传 / URL快照", "manual"), n("解析正文 / 表格 / OCR"), n("异常核对 / 新修订", "manual")]),
        ("学习资料", [n("可靠片段", "data"), n("教师选段或全文发布", "manual"), n("学生阅读 / 笔记")]),
        ("知识", [n("选定依据", "data"), n("AI 提炼候选"), n("教师编辑确认", "manual"), n("按用途检索")]),
        ("失败", [n("解析 / 模型失败"), n("保留失败与原文", "data"), n("教师校正或显式重试", "manual")]),
    ], "backend/internal/learning/materials.go；knowledge_decisions.go；backend/internal/rag/jobs.go", "公开URL只支持单页／直链；复杂版式与独立语义评价未完成。"),
    ("F07", "工作流程：命题与标准", "题目与标准怎么生成和冻结？", [
        ("来源", [n("手工 / JSON / 题卷 / 所选依据"), n("候选题目 + 参考解答"), n("教师分别确认", "manual")]),
        ("标准", [n("确认题目版本", "data"), n("标准草稿 / 评分点"), n("教师确认匹配满分", "manual")]),
        ("使用", [n("已确认题目 + 标准", "data"), n("作业固定版本组合", "data"), n("新版本不改旧作业")]),
        ("异常", [n("无原卷答案"), n("解答保持空白", "data"), n("教师补充并确认", "manual")]),
    ], "backend/internal/learning/question_bank.go；rubrics.go；paper.go；backend/db/migrations/00011_question_bank.sql", "AI 只生成候选；没有原卷答案时不伪造提取结果。"),
    ("F08", "工作流程：作答与提交", "学生怎么作答，怎么算提交成功？", [
        ("准备", [n("已发布作业"), n("学生本人题目"), n("私人答题草稿", "data")]),
        ("提交", [n("学生确认提交", "manual"), n("课程 / 截止 / 幂等校验"), n("事务写入 attempt + SHA256", "data")]),
        ("结果", [n("服务端提交回执"), n("个人提交历史", "data")]),
        ("拒绝", [n("截止 / 关闭 / 越权 / 重复"), n("明确拒绝或复用请求结果")]),
    ], "backend/internal/learning/assessment.go；drafts.go；backend/db/migrations/00003_learning_business.sql", "自动保存草稿和正式提交是两个动作。"),
    ("F09", "工作流程：评阅与发布", "AI 评分到教师发布经过谁？", [
        ("依据", [n("冻结题目 + 标准 + 原文", "data"), n("AI 草稿或教师人工评分"), n("逐点核对", "manual")]),
        ("状态", [n("评分修订 draft", "data"), n("教师 confirmed", "manual"), n("教师 released", "manual")]),
        ("消费", [n("正式修订", "data"), n("学生反馈 / CSV / 学情")]),
        ("例外", [n("客观题答案规则"), n("规则直接 released", "data")]),
    ], "backend/internal/learning/feedback.go；rubrics.go；backend/internal/rag/jobs.go", "AI 评分草稿不会自行发布。"),
    ("F10", "工作流程：诊断与干预", "诊断结果怎么变成干预动作？", [
        ("现有证据", [n("已发布评分 + 学习记录", "data"), n("班级 / 个人证据视图"), n("教师选定学生与依据", "manual")]),
        ("执行", [n("干预 draft", "data"), n("教师 assigned", "manual"), n("学生学习 / 练习并提交")]),
        ("复查", [n("下发后新证据", "data"), n("教师 reviewed", "manual")]),
        ("未接通", [n("AI 共性错因诊断", "pending"), n("自动生成个性补练", "pending")]),
    ], "backend/internal/learning/feedback.go；path.go；workspace.go；docs/architecture.md", "现有路径是规则生成；不称为 AI 诊断。"),
    ("F11", "六类生命周期", "这些对象什么时候算完成？", [
        ("课程", [n("draft", "data"), n("published", "data")]),
        ("学习资料", [n("draft", "data"), n("published", "data")]),
        ("作业", [n("draft", "data"), n("published", "data"), n("closed", "data")]),
        ("题目 / 标准", [n("draft", "data"), n("confirmed", "data")]),
        ("评分修订", [n("draft", "data"), n("confirmed", "data"), n("released", "data")]),
        ("干预", [n("draft", "data"), n("assigned", "data"), n("submitted", "data"), n("reviewed", "data")]),
    ], "backend/internal/learning/http.go；backend/db/migrations/00001_course_foundation.sql；00003_learning_business.sql；00009_structured_rubrics.sql", "resources 表允许 archived，但当前无归档操作；不将其画为已接通迁移。"),
    ("F12", "AI 能力边界与证据链", "哪些交 AI，凭什么结论可信？", [
        ("候选生成", [n("原件 / 权限过滤的片段", "data"), n("提炼 / 出题 / 标准候选"), n("教师逐项确认", "manual")]),
        ("评阅", [n("冻结提交 + 绑定标准", "data"), n("AI 逐点草稿"), n("教师确认发布", "manual")]),
        ("检索", [n("授权资料 / 知识", "data"), n("混合检索 + 引用"), n("用户核对原文", "manual")]),
        ("边界", [n("模型调用 / 任务记录", "data"), n("失败 / 未知预算留痕", "data"), n("独立效果评测", "pending")]),
    ], "backend/internal/rag；backend/internal/learning/rubrics.go；backend/db/migrations/00010_materials_knowledge_rag.sql", "引用和模型元数据支持追溯，不证明内容正确。"),
    ("F13", "数据流图 DFD", "数据在哪里产生、存放、消费？", [
        ("教学内容", [n("教师输入 / 文件 / URL"), n("PG 元数据 + 文件卷", "data"), n("资料 / 知识 / 检索")]),
        ("任务", [n("教师发起 AI 请求"), n("PG: processing_jobs + 预算", "data"), n("worker / 模型接口")]),
        ("作答", [n("学生提交"), n("PG: 草稿 / 正式提交", "data"), n("评分 / 个人记录")]),
        ("评价", [n("教师确认发布", "manual"), n("PG: 标准 / 评分修订", "data"), n("反馈 / 学情 / 路径")]),
    ], "compose.yaml；compose.rag.yaml；backend/db/migrations/00003_learning_business.sql；00010_materials_knowledge_rag.sql", "Redis 承担队列；持久业务事实和任务记录在 PostgreSQL。"),
    ("F14", "数据表关系图", "当前数据库怎么建立主要关系？", [
        ("课程", [n("courses", "data"), n("enrollments / knowledge_points", "data")]),
        ("资料", [n("material_sources", "data"), n("material_fragments", "data"), n("resources / retrieval_chunks", "data")]),
        ("题库", [n("question_bank", "data"), n("bank_question_versions", "data"), n("rubric_versions", "data")]),
        ("作业", [n("assignments", "data"), n("questions", "data"), n("submissions", "data"), n("grading_revisions", "data")]),
        ("重评", [n("regrade_batches", "data"), n("regrade_items", "data"), n("grading_revisions", "data")]),
        ("检索", [n("embedding_spaces", "data"), n("chunk_embeddings", "data")]),
    ], "backend/db/migrations/00001–00012；backend/db/queries", "仅列主干；rubric_versions 互斥归属旧 questions 或新题库版本，约束见迁移。"),
    ("F15", "关键时序图：四条调用", "一次调用经过谁，失败怎么兜？", [
        ("正式提交", [n("学生 → API"), n("鉴权 / 截止 / 幂等"), n("PG 事务: attempt", "data"), n("回执 / 冲突")]),
        ("资料解析", [n("教师 → API", "manual"), n("PG task + Redis", "data"), n("worker / parser"), n("片段或失败留痕", "data")]),
        ("AI 评分", [n("教师 → API", "manual"), n("固定标准 / 预算", "data"), n("worker / 模型"), n("草稿或显式重试")]),
        ("整组重评", [n("教师确认逐份", "manual"), n("PG 锁 + 基线校验", "data"), n("同事务发布", "data"), n("冲突整组回滚")]),
    ], "backend/internal/learning/assessment.go；regrade.go；backend/internal/rag/jobs.go；docs/research/three-module-acceptance-2026-11-12.md", "生成任务中断不会自动重发未知模型调用。"),
    ("F16", "接口关系图", "谁调用谁，契约止于哪个边界？", [
        ("浏览器", [n("React API client"), n("同源 /api/v1"), n("Gin session + CSRF")]),
        ("业务", [n("Gin identity"), n("learning / rag handlers"), n("sqlc/store → PG", "data")]),
        ("异步", [n("API 写 processing_jobs", "data"), n("Redis / Asynq"), n("Go worker")]),
        ("外部", [n("RAG API / worker"), n("模型供应商", "external")]),
    ], "web/src/shared/api.ts；backend/internal/learning/http.go；backend/internal/identity；backend/internal/rag；compose.yaml", "学生与教师数据权限由服务端对象归属校验决定。"),
    ("F17", "页面信息架构树", "有哪些页面，分几层？", [
        ("共同", [n("登录 / 会话"), n("角色工作台"), n("顶部课程选择 + 账号")]),
        ("教师：课程", [n("课程管理 / 课程目录"), n("资料 / 知识库 / 检索"), n("内容变更")]),
        ("教师：评价", [n("题库 / 作业 / 测验"), n("提交批阅 / 整组重评"), n("看板 / 干预 / 交流")]),
        ("学生", [n("课程学习 / 知识 / 问答"), n("作业 / 测验 / 正式反馈"), n("路径 / 老师任务 / 交流")]),
    ], "web/src/app/navigation.ts；web/src/live/routes.tsx；web/src/app/App.tsx", "这是当前路由层级；历史 replica 页面不计入活动导航。"),
    ("F18", "部署图", "服务跑在哪，哪里跨信任边界？", [
        ("公网旧版", [n("浏览器 / HTTPS", "external"), n("OpenResty TLS", "external"), n("回环 Web → 私网 API"), n("私网 PG / Redis", "data")]),
        ("本地 Compose", [n("浏览器 127.0.0.1:18080", "external"), n("Web / Nginx → API"), n("PG / Redis / worker", "data")]),
        ("本地 RAG 可选", [n("compose.rag.yaml"), n("worker / parser / 文件卷"), n("模型服务出站", "external")]),
        ("隔离", [n("公网 AI 关闭", "external"), n("本地密钥不进仓库"), n("模型不是校内服务", "external")]),
    ], "deploy/compose.production.yaml；deploy/openresty-hajistudy.conf；compose.yaml；compose.rag.yaml", "本地图册描述工作树；不把新功能画入现网旧镜像。"),
    ("F19", "UML 包图：实现组织", "代码里怎么组织？", [
        ("前端", [n("app: 路由 / 主题"), n("live: 师生业务页面"), n("shared: 会话 / API")]),
        ("后端", [n("server: 路由装配"), n("identity: 认证授权"), n("learning / rag: 业务处理")]),
        ("数据", [n("db/queries: SQL"), n("sqlc/store: 生成类型"), n("db/migrations: 版本结构", "data")]),
        ("运行", [n("cmd/api + cmd/worker"), n("tools/parser: Python解析"), n("Compose: 本地 / 生产")]),
    ], "web/src/app；web/src/live；web/src/shared；backend/internal；backend/db；backend/cmd", "Go 项目用包与处理器组织；此图不是虚构的面向对象类层次。"),
]


def split(text, max_width):
    parts = []
    for section in text.split("|"):
        line = ""
        for char in section:
            if line and FONT.getlength(line + char) > max_width:
                parts.append(line)
                line = char
            else:
                line += char
        if line:
            parts.append(line)
    return parts


def render(figure):
    specialized = render_special(figure)
    if specialized is not None:
        return specialized
    fid, title, question, rows, evidence, note = figure
    width, margin, node_w, gap = 1540, 230, 285, 52
    row_h, top = 142, 192
    height = top + len(rows) * row_h + 150
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
           f'<title id="title">{fid} {escape(title)}</title><desc id="desc">{escape(question)} {escape(note)}</desc>',
           f'<rect width="{width}" height="{height}" fill="#fbfcfb"/>',
           f'<rect x="0" y="0" width="12" height="{height}" fill="#17816b"/>',
           f'<text x="60" y="68" font-size="30" font-family="Microsoft YaHei" font-weight="700" fill="{INK}">{fid}　{escape(title)}</text>',
           f'<text x="60" y="112" font-size="21" font-family="Microsoft YaHei" fill="{MUTED}">{escape(question)}</text>',
           f'<text x="60" y="151" font-size="17" font-family="Microsoft YaHei" fill="#17816b">本地代码状态 · 2026-11-12</text>']
    for index, (label, nodes) in enumerate(rows):
        y = top + index * row_h
        out.append(f'<text x="60" y="{y+53}" font-size="22" font-family="Microsoft YaHei" font-weight="600" fill="{INK}">{escape(label)}</text>')
        out.append(f'<line x1="60" y1="{y+109}" x2="1480" y2="{y+109}" stroke="#e4e9e8"/>')
        for col, (text, kind) in enumerate(nodes):
            x = margin + col * (node_w + gap)
            fill, stroke, _ = STYLES[kind]
            dash = ' stroke-dasharray="7 5"' if kind == "pending" else ""
            out.append(f'<rect x="{x}" y="{y}" width="{node_w}" height="86" rx="5" fill="{fill}" stroke="{stroke}" stroke-width="2"{dash}/>')
            parts = split(text, node_w - 34)
            if len(parts) > 3:
                raise ValueError(f"{fid} text overflow: {text}")
            for line_no, part in enumerate(parts):
                ty = y + 44 + (line_no - (len(parts)-1)/2) * 25
                out.append(f'<text x="{x+node_w/2}" y="{ty}" text-anchor="middle" font-size="19" font-family="Microsoft YaHei" fill="{INK}">{escape(part)}</text>')
            if col and (fid, label) not in {("F18", "隔离"), ("F19", "数据"), ("F12", "边界")}:
                ax = x - gap + 10
                out.append(f'<path d="M {ax} {y+43} H {x-12} m -8 -7 l 8 7 -8 7" fill="none" stroke="{LINE}" stroke-width="2"/>')
    footer_y = top + len(rows) * row_h + 8
    for i, part in enumerate(split("证据：" + evidence, 1400)):
        out.append(f'<text x="60" y="{footer_y+20+i*23}" font-size="17" font-family="Microsoft YaHei" fill="{MUTED}">{escape(part)}</text>')
    for i, part in enumerate(split("边界：" + note, 1400)):
        out.append(f'<text x="60" y="{footer_y+70+i*24}" font-size="18" font-family="Microsoft YaHei" fill="#9b6330">{escape(part)}</text>')
    out.append('<text x="60" y="' + str(height-26) + '" font-size="16" font-family="Microsoft YaHei" fill="#738087">实色框：当前代码或人工步骤　　虚线灰框：尚未实现　　箭头：本行的依赖或交接</text></svg>')
    return "\n".join(out)


def main():
    HERE.mkdir(exist_ok=True)
    for figure in FIGURES:
        (HERE / f"{figure[0]}.svg").write_text(render(figure), encoding="utf-8")
    manifest = [
        {"id": f[0], "title": f[1], "question": f[2], "evidence": f[4], "boundary": f[5], "rows": len(f[3])}
        for f in FIGURES]
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    buttons = "".join(f'<button type="button" data-id="{f["id"]}">{f["id"]}　{escape(f["title"])}</button>' for f in manifest)
    html = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HaJi Mark · F01–F19 设计图册</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7f6;color:#202b32;font:15px "Microsoft YaHei",sans-serif}header{padding:18px 24px;background:#193b38;color:#fff;display:flex;align-items:center;gap:20px;flex-wrap:wrap}h1{font-size:22px;margin:0}header p{margin:0;color:#d6e5e0}main{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:calc(100vh - 74px)}nav{border-right:1px solid #cbd8d4;padding:14px;display:flex;flex-direction:column;gap:4px}nav button{border:0;background:transparent;text-align:left;padding:10px 12px;border-radius:4px;cursor:pointer;color:#213e3a;font:inherit}nav button:hover,nav button[aria-current="true"]{background:#dcebe5}section{min-width:0;padding:20px 28px}h2{font-size:20px;margin:0 0 6px}.question{color:#52636b;margin:0 0 16px}.frame{background:#fff;border:1px solid #d2dcd8;overflow:auto}img{display:block;width:100%;min-width:700px;height:auto}.meta{color:#52636b;line-height:1.5}.links{display:flex;gap:16px;flex-wrap:wrap}a{color:#096f60}button:focus-visible,a:focus-visible{outline:3px solid #bd7130;outline-offset:2px}@media(max-width:760px){main{display:block}nav{border:0;border-bottom:1px solid #cbd8d4;flex-direction:row;overflow-x:auto;white-space:nowrap}nav button{flex:none}section{padding:16px}img{min-width:600px}}
</style></head><body><header><h1>HaJi Mark · 设计图册 F01–F19</h1><p>本地代码状态 · 2026-11-12 · 公网仍为旧版且 AI 关闭</p></header><main><nav aria-label="图表">BUTTONS</nav><section><h2 id="title"></h2><p class="question" id="question"></p><div class="frame"><img id="image" alt=""></div><p class="meta" id="boundary"></p><p class="meta" id="evidence"></p><p class="links"><a id="svg" download>下载 SVG</a><a id="png" download>下载 PNG</a></p></section></main><script>
const figures=FIGURES;const buttons=[...document.querySelectorAll('nav button')];function show(id){const f=figures.find(item=>item.id===id);if(!f)return;document.getElementById('title').textContent=f.id+' '+f.title;document.getElementById('question').textContent=f.question;document.getElementById('boundary').textContent='边界：'+f.boundary;document.getElementById('evidence').textContent='证据：'+f.evidence;const image=document.getElementById('image');image.src=f.id+'.svg';image.alt=f.id+' '+f.title+'：'+f.question;document.getElementById('svg').href=f.id+'.svg';document.getElementById('png').href=f.id+'.png';buttons.forEach(button=>button.setAttribute('aria-current',String(button.dataset.id===id)));history.replaceState(null,'','#'+id)}buttons.forEach(button=>button.addEventListener('click',()=>show(button.dataset.id)));show(location.hash.slice(1)||'F01');
</script></body></html>'''
    html = html.replace("BUTTONS", buttons).replace("FIGURES", json.dumps(manifest, ensure_ascii=False))
    (HERE / "index.html").write_text(html, encoding="utf-8")
    print(f"Generated {len(FIGURES)} SVG diagrams")


if __name__ == "__main__":
    main()
