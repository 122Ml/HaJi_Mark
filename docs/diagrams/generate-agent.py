"""Generate the local Agent architecture without changing the historical network."""
from pathlib import Path
import xml.etree.ElementTree as E

OUT = Path(__file__).resolve().parent / "agent"
OUT.mkdir(exist_ok=True)
NS = "http://www.w3.org/2000/svg"
E.register_namespace("", NS)
root = E.Element(f"{{{NS}}}svg", width="1840", height="1690", viewBox="0 0 1840 1690", role="img", **{"aria-label": "HaJi Mark 对话助理与业务闭环架构"})


def el(name, **attrs):
    return E.SubElement(root, f"{{{NS}}}{name}", {k.replace("_", "-"): str(v) for k, v in attrs.items()})


def text(x, y, value, size=21, color="#274944", weight=400):
    el("text", x=x, y=y, font_family="Microsoft YaHei, sans-serif", font_size=size, fill=color, font_weight=weight).text = value


def box(x, y, w, h, title, lines, fill="#FFFFFF"):
    el("rect", x=x, y=y, width=w, height=h, rx=14, fill=fill, stroke="#B6D6CE", stroke_width=2)
    text(x+22, y+35, title, 25, "#005F58", 600)
    for i, value in enumerate(lines):
        text(x+22, y+68+i*30, value)


def edge(points, label="", xy=None, dashed=False):
    el("polyline", points=" ".join(f"{x},{y}" for x, y in points), fill="none", stroke="#5B827A", stroke_width=2, marker_end="url(#arrow)", **({"stroke-dasharray": "7 5"} if dashed else {}))
    if label:
        text(*xy, label, 19, "#426C64")


defs = el("defs")
marker = E.SubElement(defs, f"{{{NS}}}marker", id="arrow", markerWidth="9", markerHeight="9", refX="8", refY="4", orient="auto")
E.SubElement(marker, f"{{{NS}}}path", d="M0,0 L8,4 L0,8", fill="#5B827A")
el("rect", width=1840, height=1690, fill="#F5FAF8")
text(40, 55, "HaJi Mark · 对话助理与业务闭环", 34, "#064D47", 600)
text(1390, 55, "本地实现 · 2026-11-17", 22)
box(40, 95, 1750, 90, "师生对话工作区 · React / Ant Design", ["消息与附件  ·  模型与权限模式  ·  输入／单选／多选问题卡  ·  逐操作审批  ·  执行记录与文件下载"], "#E4F4EF")
edge([(885,185),(885,230)])
box(560,230,650,120,"Gin API ＋持久运行时",["会话／课程／本人权限 · CSRF · 幂等发送", "检查点 · 后台等待 · 取消／显式恢复 · 调用限额"])
box(40,230,400,120,"业务事件 SSE",["游标重放 · 心跳 · 重连", "非供应商 token 流"],"#EAF3F9")
box(1390,230,400,120,"PostgreSQL 运行记录",["对话 · 消息 · 运行 · 步骤", "问题／审批 · 附件 · 事件"],"#EAF3F9")
edge([(560,290),(440,290)])
edge([(240,230),(240,185)])
edge([(1210,290),(1390,290)],"检查点／审计",(1225,275))
edge([(885,350),(885,405)])
box(560,405,650,90,"协调 Agent",["按目标单层、顺序委派；专家隔离上下文"])
edge([(885,495),(885,530),(230,530),(230,560)])
for x in (680,1130,1580):
    edge([(885,530),(x,530),(x,560)])
xs=(40,490,940,1390)
specialists=[("资料与知识 Agent",["导入／解析／原文核对", "发布／提炼／专题与冲突"]), ("题目与标准 Agent",["独立出题／参考解答／标准", "精确依据 · 分别确认"]), ("作业与评阅 Agent",["作业／评分／重评／导出", "固定版本 · 逐字证据"]), ("学习支持 Agent",["可见资料问答／笔记／路径", "正式证据／补学任务"])]
for x,(title,lines) in zip(xs,specialists):
    box(x,560,380,140,title,lines,"#E9F6F1")
    edge([(x+190,700),(x+190,745),(885,745)])
edge([(885,745),(885,790)])
box(40,790,1050,135,"类型化工具与权限门禁",["只读：禁止写入  ·  自动审查：草稿自动、修改审批  ·  完整操作：白名单修改", "角色／课程／对象归属  ·  作答上下文隔离  ·  正式确认与发布始终审批"],"#FFF2DF")
box(1160,790,630,135,"必要信息与操作决定",["问题卡：补全信息与选项", "审批卡：绑定确切参数、模式和业务快照"],"#FFF2DF")
edge([(1090,855),(1160,855)])
edge([(1790,855),(1815,855),(1815,140),(1790,140)],"",dashed=True)
edge([(885,925),(885,1000)])
box(40,1000,1750,100,"进程内 Business Gateway → 原业务路由重新鉴权",["有效数据库会话  ·  不授予管理员权限  ·  不开放 SQL／shell／任意 HTTP  ·  状态／版本／证据／事务条件继续由原处理器校验"])
edge([(40,1050),(15,1050),(15,375),(530,375),(530,290),(560,290)],dashed=True)
for x in xs:
    edge([(885,1100),(885,1150),(x+190,1150),(x+190,1200)])
business=[("学习资料与知识库",["原件／可靠片段／发布资料", "许可／专题／确认知识", "学生可见与学习／评分用途"]), ("独立题库与评分标准",["题目／解答／标准分别确认", "所选依据快照与版本", "不读取待评学生作答"]), ("作业、提交与评阅",["绑定题目＋标准版本", "原文提交／逐点评分／确认", "正式发布／整组重评／CSV"]), ("学生反馈与补学",["只读已发布结果及依据", "学情／规则路径／补学补练", "新学习与作答 → 教师复查"])]
for x,(title,lines) in zip(xs,business):
    box(x,1200,380,165,title,lines)
for x,label in ((420,"依据"),(870,"绑定"),(1320,"发布")):
    edge([(x,1280),(x+70,1280)],label,(x+10,1260))
edge([(1580,1365),(1580,1400),(1125,1400),(1125,1365)],"新证据／复查",(1280,1390),True)
for x in xs:
    edge([(x+190,1365),(x+190,1460)],dashed=True)
infra=[("持久后台任务",["PG Outbox → Redis / Asynq", "Go Worker → 解析／OCR／索引", "回传真实终态，不把入队当完成"]), ("PostgreSQL / pgvector",["原业务表仍是唯一事实源", "许可过滤 · 向量＋关键词／RRF", "原文／版本／评分历史保留"]), ("服务端模型 Profiles",["生成／Embedding／视觉分开", "运行时与 Worker 按用途调用", "共享50元预算 · 未知调用不重发"]), ("私有文件卷",["对话附件／原件／图像资产", "正式反馈 CSV 按会话授权", "存储路径与密钥不返回浏览器"])]
for x,(title,lines) in zip(xs,infra):
    box(x,1460,380,165,title,lines,"#EAF3F9")
text(40,1660,"实线：业务与执行关系    虚线：交互返回／存储与服务依赖    具体实测范围见本轮验收记录",20)
(OUT/"architecture.svg").write_text(E.tostring(root,encoding="unicode"),encoding="utf-8")
print(OUT/"architecture.svg")
