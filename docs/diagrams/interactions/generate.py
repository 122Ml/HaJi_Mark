"""Current role-based interaction atlas; reuses the existing obstacle-aware router."""
from pathlib import Path
from html import escape
import json
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / "atlas"))
from drawing import Diagram, PALETTE, rect, text, measure, intersects

DATE = "2026-11-17"
LANES = ("教师", "平台", "AI / 对话助理", "学生")
ROLES = ("teacher", "system", "ai", "data")


class Interaction(Diagram):
    def __init__(self, fid, title, rows):
        super().__init__(fid, title, "", rows=rows, width=2600, row_step=290)
        self.top = 235
        self.jumps = {}

    def n(self, key, col, row, title, body="", jump=None, pending=False):
        self.node(key, col, row, title, body.split(";") if body else (),
                  role="pending" if pending else ROLES[col])
        if jump:
            self.jumps[key] = jump

    def e(self, a, b, label="", dashed=False):
        self.edge(a, b, label, dashed)

    def save(self):
        self._route()
        self.validate()
        height = int(max(max(n["y"] + n["h"] for n in self.nodes.values()),
                         max(p[1] for e in self.links for p in e["path"])) + 75)
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{height}" viewBox="0 0 {self.width} {height}" role="img" aria-label="{escape(self.title)}">',
               f'<title>{self.id} {escape(self.title)}</title>',
               '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1 L9 5 L0 9Z" fill="#839097"/></marker></defs>',
               '<g font-family="Microsoft YaHei, sans-serif">', rect(0, 0, self.width, height, "#F7F6F2"),
               text(80, 77, self.id + "　" + self.title, 40, weight=700),
               text(2520, 77, DATE + " · 本地实现", 21, "#58616A", anchor="end")]
        for col, label in enumerate(LANES):
            x = self.margin + col * (self.nw + self.gap)
            out += [rect(x - 18, 125, self.nw + 36, height - 160, "#EDECE6" if col % 2 == 0 else "#F1F0EB"),
                    text(x, 175, label, 27, "#58616A", 600)]
        out.append('<g class="edges">')
        for edge in self.links:
            d = "M" + " L".join(f"{x},{y}" for x, y in edge["path"])
            dash = ' stroke-dasharray="9 7"' if edge["dashed"] else ""
            out += [f'<g class="edge" data-from="{edge["a"]}" data-to="{edge["b"]}"><title>{escape(edge["label"])}</title><path d="{d}" stroke="#839097" stroke-width="3" fill="none" stroke-linejoin="round" marker-end="url(#arrow)"{dash}/></g>']
        out.append('</g><g class="nodes">')
        for key, n in self.nodes.items():
            x, y, w, h = (n[k] for k in ("x", "y", "w", "h"))
            fill, stroke, fg, muted = PALETTE[n["role"]]
            attrs = ' stroke-dasharray="9 7"' if n["role"] == "pending" else ""
            out += [f'<g class="node" data-node="{key}" tabindex="0" role="button" aria-label="{escape(n["title"])}">',
                    rect(x, y, w, h, fill, stroke, stroke_width=2),
                    text(x + 22, y + 43, n["title"], 27, fg, 650)]
            if attrs:
                out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="none" stroke="{stroke}"{attrs}/>')
            for i, line in enumerate(n["body"]):
                out.append(text(x + 22, y + 85 + i * 32, line, 22, muted))
            if key in self.jumps:
                out.append(text(x + w - 20, y + h - 16, "↗ " + self.jumps[key], 17, muted, anchor="end"))
            out.append('</g>')
        out.append('</g><g class="labels">')
        labels = []
        for e in self.links:
            if not e["label"]:
                continue
            w, h = measure(e["label"], 19) + 20, 29
            candidates = []
            for p, q in zip(e["path"], e["path"][1:]):
                if p[1] == q[1] and abs(q[0] - p[0]) > w + 10:
                    candidates.append(((p[0] + q[0] - w) / 2, p[1] - h - 5, w, h))
                if p[0] == q[0] and abs(p[1] - q[1]) > 60:
                    candidates += [(p[0] + 10, (p[1] + q[1] - h) / 2, w, h),
                                   (p[0] - w - 10, (p[1] + q[1] - h) / 2, w, h)]
            obstacles = [(n["x"] - 5, n["y"] - 5, n["w"] + 10, n["h"] + 10) for n in self.nodes.values()] + labels
            chosen = next((c for c in candidates if c[0] > 28 and c[0] + c[2] < self.width - 28 and c[1] > 200 and not any(intersects(c, o, 5) for o in obstacles)), None)
            if chosen:
                labels.append(chosen)
                x, y, w, h = chosen
                out += [f'<g class="edge-label" data-from="{e["a"]}" data-to="{e["b"]}">', rect(x, y, w, h, "#F7F6F2"),
                        text(x + w / 2, y + 21, e["label"], 19, "#526575", anchor="middle"), '</g>']
        out.append('</g></g></svg>')
        (HERE / (self.id + ".svg")).write_text("\n".join(out), encoding="utf-8")
        meta = dict(id=self.id, title=self.title, width=self.width, height=height,
                    nodes=[dict(id=k, title=n["title"], body=n["body"], role=n["role"], jump=self.jumps.get(k)) for k, n in self.nodes.items()],
                    edges=[dict(source=e["a"], target=e["b"], label=e["label"]) for e in self.links])
        print(f"{self.id}: {len(self.nodes)} nodes / {len(self.links)} links", flush=True)
        return meta


def overview():
    f = Interaction("I00", "全平台交互总览", 8)
    f.n("course", 0, 0, "课程与教学组织", "课程 / 成员 / 目录 / 知识点", "I01")
    f.n("context", 1, 0, "登录 · 顶栏选课", "角色权限 / 课程隔离 / 编辑恢复", "I01")
    f.n("agent", 2, 0, "自然语言发起操作", "附件 / 选项 / 审批 / 页面工作台", "I08")
    f.n("home", 3, 0, "进入我的课程", "概览 / 待办 / 学习路径", "I06")
    f.n("source", 0, 1, "导入与核对原件", "文件 / 网页 / 文本 / 解析校正", "I02")
    f.n("content", 1, 1, "发布学习内容", "目录关联 / 学生可见 / 原件权限", "I02")
    f.n("parse", 2, 1, "解析 · 提出加工建议", "本地解析 / AI分类 / 视觉与提炼", "I02")
    f.n("read", 3, 1, "阅读 · 笔记 · 收藏", "课程学习 / 完成记录", "I02")
    f.n("reviewkb", 0, 2, "审定精炼知识", "编辑 / 用途 / 重复与冲突决定", "I03")
    f.n("rag", 1, 2, "权限检索与引用", "学习资料 + 确认知识 / 原句定位", "I03")
    f.n("qa", 2, 2, "提炼 · 带引用问答", "专题与关联候选 / 问答历史", "I03")
    f.n("ask", 3, 2, "查知识 · 提问", "学习可见条目 / 引用回看", "I03")
    f.n("bank", 0, 3, "题目 / 解答 / 标准审定", "各自编辑确认 / 版本冻结", "I04")
    f.n("versions", 1, 3, "独立题库与固定依据", "题目版本 + 匹配标准 + 来源快照", "I04")
    f.n("author", 2, 3, "辅助出题 · 标准起草", "选依据与考查要求 / 不读作答", "I04")
    f.n("assignment", 0, 4, "发布作业与测验", "引用确认版本 / 截止时间", "I05")
    f.n("attempt", 1, 4, "正式提交与规则判分", "原文 / 版本 / 哈希 / 提交历史", "I05")
    f.n("grading", 2, 4, "按固定标准评阅", "逐点评分草稿 / 证据核对", "I05")
    f.n("submit", 3, 4, "草稿 · 作答 · 提交", "逐题提交 / 服务端回执", "I05")
    f.n("release", 0, 5, "逐份修改 / 确认 / 发布", "教师CSV导入 / 正式反馈导出", "I05")
    f.n("evidence", 1, 5, "正式结果与学习证据", "评分缺口 / 班级看板 / 证据溯源", "I06")
    f.n("diagnose", 2, 5, "共性诊断 · 路径排序", "同题同标准 / 规则候选内AI排序", "I06")
    f.n("feedback", 3, 5, "反馈 · 路径 · 老师任务", "失分原句 / 学习与练习入口", "I06")
    f.n("intervene", 0, 6, "复核诊断 · 下发干预", "选已有学习 / 练习目标 / 复查", "I06")
    f.n("impact", 1, 6, "内容变更与整组重评", "保留历史 / 提示影响 / 统一发布", "I07")
    f.n("future", 2, 6, "未实现：自动发布新补练", "当前由教师选择已有练习", pending=True)
    f.n("execute", 3, 6, "执行任务 · 提供新证据", "下发后学习 / 新作答 / 教师复查", "I06")
    f.n("research", 0, 7, "教研记录 · 行业能力", "人工维护 / 关联课程与知识点", "I09")
    f.n("discussion", 1, 7, "课程互动", "公告 / 提问 / 讨论 / 回复", "I09")
    f.n("communicate", 3, 7, "提问与回复", "查看公告 / 参与课程讨论", "I09")
    for a,b,label in [("course","context","配置"),("context","home","选课"),("context","agent","另一操作入口"),
                      ("source","parse","解析"),("parse","source","异常校正"),("source","content","选片段发布"),("content","read","阅读"),
                      ("source","reviewkb","选择提炼范围"),("reviewkb","qa","提炼候选"),("qa","reviewkb","人工审定"),
                      ("content","rag","学习索引"),("reviewkb","rag","授权知识"),("ask","rag","查询"),("rag","qa","引用依据"),("qa","ask","带引用回复"),
                      ("rag","author","教师选依据"),("bank","author","生成草稿"),("author","bank","审定"),("bank","versions","确认版本"),
                      ("versions","assignment","引用"),("assignment","submit","开放作答"),("submit","attempt","正式提交"),
                      ("attempt","grading","主观题草稿"),("grading","release","复核"),("release","evidence","发布后计入"),("evidence","feedback","正式反馈"),
                      ("evidence","diagnose","受限证据"),("diagnose","intervene","复核并下发"),("intervene","feedback","学习 / 练习目标"),
                      ("feedback","execute","执行"),("execute","evidence","新证据"),("execute","intervene","复查"),
                      ("reviewkb","impact","更新影响"),("bank","impact","标准更正"),("impact","evidence","整组统一发布"),
                      ("research","course","教学调整"),("course","discussion","发布公告"),("communicate","discussion","提问 / 回复"),("discussion","communicate","回看")]: f.e(a,b,label)
    return f


def access():
    f = Interaction("I01", "登录、课程与编辑上下文", 6)
    for args in [
        ("t",0,0,"登录教师账号","进入教学看板"),("s",3,0,"登录学生账号","进入本人概览"),
        ("auth",1,0,"验证会话与身份","失败保留输入 / 重试登录"),
        ("select",1,1,"顶栏切换课程","保持模块 / 清理旧对象参数"),
        ("manage",0,1,"创建课程 · 维护成员","课程管理中配置课程与成员"),
        ("empty",3,1,"查看本人已加入课程","无课程时联系教师"),
        ("directory",0,2,"维护课程目录与依赖","节点编辑 / 资料关联 / 知识点"),
        ("permission",1,2,"核对对象与课程权限","越权阻断 / 重新选择授权课程"),
        ("learn",3,2,"按目录进入课程学习","仅展示已授权发布内容"),
        ("edit",0,3,"进入对象编辑器","本地草稿与服务端版本分开"),
        ("draft",1,3,"发现未保存改动","切页 / 切课 / 返回均可取消"),
        ("save",0,4,"保存或放弃后离开","也可取消导航继续编辑"),
        ("persist",1,4,"真实保存与版本校验","失败保留编辑 / 冲突先刷新核对"),
        ("profile",3,4,"个人设置","修改本人资料 / 密码 / 退出"),
        ("teacherprofile",0,5,"个人设置","修改本人资料 / 密码 / 退出"),
        ("logout",1,5,"会话结束或失效","返回登录 / 私有数据不越账号恢复")]: f.n(*args)
    for a,b,label in [("t","auth","登录"),("s","auth","登录"),("auth","select","成功"),("manage","select","选用课程"),
                      ("select","empty","学生"),("select","permission","打开对象"),("manage","directory","配置"),("directory","permission","保存"),
                      ("permission","learn","学生可见"),("permission","edit","教师可编辑"),("edit","draft","离开"),("draft","save","确认选择"),
                      ("save","edit","取消离开"),("save","persist","保存"),("persist","select","切课 / 切页"),
                      ("profile","logout","退出"),("teacherprofile","logout","退出")]: f.e(a,b,label)
    return f


def materials():
    f = Interaction("I02", "学习资料：导入、加工与阅读", 7)
    for args in [
        ("import",0,0,"导入文件 / 网页 / 文本","PDF / DOCX / PPTX / 表格 / 扫描件"),
        ("original",1,0,"保存原件与来源快照","原网址 / 文件 / 版本 / 提炼许可"),
        ("parse",2,0,"本地解析 · AI分类建议","正文 / 表格 / 中文印刷OCR / 位置"),
        ("correct",0,1,"核对解析 · 选择视觉区域","修正文段 / 核对公式图表结果"),
        ("reliable",1,1,"可靠原文与图像证据","异常定位 / 修订不覆盖原件"),
        ("vision",2,1,"按需识别印刷公式与图表","保存原图 / 识别结果 / 待核对"),
        ("publish",0,2,"选学习片段 · 关联目录","设置可见性 / 确认发布"),
        ("published",1,2,"学生可见学习内容","部分发布不开放完整原件"),
        ("read",3,2,"浏览目录 · 阅读资料","查看已发布内容与允许的附件"),
        ("index",1,3,"直接索引可靠原文","检索权限不因索引扩大", "I03"),
        ("extract",0,3,"选择知识提炼范围","确认专题 / 标签建议 / 提炼许可", "I03"),
        ("learn",3,3,"笔记 · 收藏 · 完成学习","保留本人阅读与完成记录"),
        ("job",2,3,"按所选范围提炼候选","与学习发布 / 直接索引独立", "I03"),
        ("revision",0,4,"新增修订 / 归档 / 撤回许可","明确操作后核对影响", "I07"),
        ("history",1,4,"保存版本与历史引用","普通新版不自动停用旧版", "I07"),
        ("qa",3,4,"查引用 · 提问","跳转资料问答或知识条目", "I03"),
        ("failure",1,5,"解析或模型失败","显示失败位置与任务状态"),
        ("retry",0,5,"校正 / 换文件 / 显式重试","未知生成不自动再次付费调用"),
        ("receipt",1,6,"完成状态与保存回执","排队中不显示为加工完成")]: f.n(*args)
    for a,b,label in [("import","original","保存"),("original","parse","自动任务"),("parse","correct","待核对"),
                      ("correct","vision","按需调用"),("vision","correct","回看图像"),("correct","reliable","保存校正"),
                      ("reliable","publish","学习发布分支"),("publish","published","确认"),("published","read","学生阅读"),
                      ("read","learn","记录"),("learn","qa","查资料"),("reliable","index","直接索引分支"),
                      ("reliable","extract","提炼分支"),("extract","job","选择后执行"),("revision","history","版本操作"),
                      ("parse","failure","失败"),("vision","failure","失败"),("failure","retry","教师处理"),
                      ("retry","original","替换文件"),("job","receipt","终态"),("index","receipt","完成")]: f.e(a,b,label)
    return f


def knowledge():
    f = Interaction("I03", "知识库、比较决策与资料问答", 7)
    for args in [
        ("scope",0,0,"选原文范围与专题","维护多专题 / 标签 / 知识点"),
        ("candidate",2,0,"提炼知识 · 检索相似项","概念 / 方法 / 规则 / 条件 / 来源"),
        ("edit",0,1,"编辑候选与适用条件","逐字来源 / 用途 / 学生可见性"),
        ("compare",2,1,"比较重复或冲突知识","双方原文 / 条件 / 差异 / 建议"),
        ("decide",0,2,"逐项决定并填写理由","暂缓 / 不采纳 / 合成 / 并存 / 替换"),
        ("confirmed",1,2,"确认知识与版本关系","替换只停用旧项未来使用"),
        ("example",0,3,"教师自行编写教学示例","独立来源 / 不用于评分"),
        ("index",1,3,"构建授权检索空间","已发布资料 + 确认知识"),
        ("browse",3,3,"浏览知识与专题","仅学习可见内容 / 关联资料"),
        ("teacherask",0,4,"检索依据 / 提问","可选学习或评分许可范围"),
        ("search",1,4,"检索 · 权限与用途过滤","向量 + 中文FTS + RRF"),
        ("ask",3,4,"资料问答","检索结果 / 提问 / 选择模型"),
        ("response",2,4,"基于引用生成回复","证据不足如实说明 / 不补造来源"),
        ("history",1,5,"保存本人问答历史","问题 / 回复 / 当时引用快照"),
        ("reopen",3,5,"回看 / 刷新 / 复用问题","回看不重新调用模型"),
        ("author",0,5,"将所选依据用于出题","仍需确认题目与评分标准", "I04"),
        ("error",1,6,"失败 / 无授权结果","保留问题 / 显式重试 / 调整范围")]: f.n(*args)
    for a,b,label in [("scope","candidate","执行提炼"),("candidate","edit","候选"),("edit","compare","比较"),
                      ("compare","decide","人工决定"),("decide","confirmed","确认"),("decide","edit","暂缓继续改"),
                      ("example","confirmed","保存示例"),("confirmed","index","按用途索引"),("confirmed","browse","学习可见"),
                      ("browse","ask","提问"),("teacherask","search","查询"),("ask","search","查询"),
                      ("index","search","召回"),("search","response","可见证据"),("response","history","保存"),
                      ("history","reopen","回看引用"),("reopen","ask","复用后主动发送"),("search","author","选择依据"),
                      ("response","error","失败"),("search","error","无结果")]: f.e(a,b,label)
    return f


def questions():
    f = Interaction("I04", "题库、参考解答与评分标准", 7)
    for args in [
        ("input",0,0,"手工录题 / JSON / 整卷导入","单选 / 主观 / 代码文本"),
        ("scope",0,1,"选择资料与知识依据","考查要求 / 题型 / 满分"),
        ("split",2,0,"整卷解析与拆题候选","跨页 / 印刷公式 / 图表证据"),
        ("draft",2,1,"生成题目 + 解答 + 标准","三份草稿 / 不读取学生作答"),
        ("correct",0,2,"拆分 / 合并 / 校正边界","核对题干 / 选项 / 来源"),
        ("bank",1,2,"独立题库与来源记录","筛选 / 选用 / 采纳审计"),
        ("question",0,3,"编辑并确认题目","选项 / 题型 / 知识点 / 版本"),
        ("answer",0,4,"编辑并确认参考解答","与题目和标准分别确认"),
        ("rubric",2,4,"按确定题目起草标准","选定依据 / 评分点 / 部分分"),
        ("standard",0,5,"编辑并确认评分标准","维度 / 计分规则 / 满分加和"),
        ("versions",1,5,"冻结题目与匹配标准版本","草稿不可发布 / 引用精确版本"),
        ("use",0,6,"建立作业 / 测验","选择确认题目与匹配标准", "I05"),
        ("change",1,6,"需要更正时新增版本","改满分另建标准 / 不覆盖历史", "I07")]: f.n(*args)
    for a,b,label in [("input","split","整卷"),("split","correct","人工校正"),("correct","bank","采纳"),("input","bank","手工 / JSON"),
                      ("scope","draft","AI辅助"),("draft","bank","保存候选"),("bank","question","选中编辑"),
                      ("bank","answer","单独审定"),("question","rubric","单独生成标准"),("rubric","standard","草稿"),
                      ("bank","standard","单独编辑标准"),("question","versions","确认题目"),("answer","versions","确认解答"),
                      ("standard","versions","确认匹配标准"),("versions","use","引用"),("versions","change","更正")]: f.e(a,b,label)
    return f


def assessment():
    f = Interaction("I05", "作业、测验、评阅与正式反馈", 9)
    for args in [
        ("create",0,0,"创建作业 / 测验","选题 / 标准版本 / 时间与要求"),
        ("publish",1,0,"检查后发布","确认版本 / 满分 / 课程归属"),
        ("open",3,0,"查看任务与题目","作答要求 / 截止 / 提交状态"),
        ("csv",0,1,"CSV批量导入作答","单题 ≤ 200份 / 选择对应学生"),
        ("preview",1,1,"预览校验 · 尚未写入","学生匹配 / 空值 / 重复 / 错误行"),
        ("draft",3,1,"填写与保存草稿","文本 / 代码文本 / 单选"),
        ("confirmimport",0,2,"核对预览并确认导入","取消不写入 / 失败修正后重传"),
        ("attempt",1,2,"新增不可变提交记录","原文 / 哈希 / 版本 / 操作者"),
        ("submit",3,2,"逐题明确提交","二次核对 / 查看服务端回执"),
        ("reject",1,3,"逾期 / 关闭：拒绝提交","学生提交与教师补录同样禁止"),
        ("history",3,3,"回看提交历史","草稿不等于提交 / 查看有效版本"),
        ("manual",0,3,"查看原文 · 人工评阅","也可选择生成主观题评分草稿"),
        ("rules",1,4,"客观题规则判分","固定正确选项 / 固定分值"),
        ("ai",2,4,"生成主观题逐点草稿","固定标准 / 逐字证据 / 问题建议"),
        ("check",1,5,"核对结构、加和与引用","标记异常 / 不代替语义复核"),
        ("review",0,5,"逐份修改或确认","核对原文 / 标准 / 评分依据"),
        ("release",0,6,"另行发布正式结果","未确认不发布 / 正式CSV导出"),
        ("formal",1,6,"保存正式版本与证据","未发布草稿学生不可见"),
        ("feedback",3,6,"查看已发布反馈","逐点分数 / 失分原句 / 改进建议"),
        ("next",3,7,"进入关联学习与任务","知识点缺口 / 学习路径", "I06"),
        ("failure",1,7,"草稿任务失败或状态未知","保留原文 / 人工评阅 / 显式重试"),
        ("regrade",0,8,"关闭后更正标准","另建整组重评 / 保留原成绩", "I07")]: f.n(*args)
    for a,b,label in [("create","publish","发布"),("publish","open","开放"),("open","draft","作答"),
                      ("draft","submit","正式提交"),("submit","attempt","开放期内"),("submit","reject","已截止 / 关闭"),
                      ("csv","preview","读取文件"),("preview","confirmimport","人工核对"),("confirmimport","attempt","原子追加"),
                      ("confirmimport","reject","已截止 / 关闭"),("attempt","history","回执"),("attempt","manual","查看"),
                      ("attempt","rules","单选题"),("manual","ai","按需生成"),("ai","check","完成"),
                      ("check","review","核对"),("manual","review","人工打分"),("review","release","确认后另行发布"),
                      ("rules","formal","规则结果"),("release","formal","正式结果"),("formal","feedback","可见"),
                      ("feedback","next","继续学习"),("ai","failure","失败"),("failure","manual","人工处理"),
                      ("release","regrade","标准更正")]: f.e(a,b,label)
    return f


def learning():
    f = Interaction("I06", "正式证据、诊断、路径与干预闭环", 8)
    for args in [
        ("dashboard",0,0,"教学看板 · 查看学情","班级 / 学生 / 题目 / 标准维度"),
        ("evidence",1,0,"汇总已发布有效结果","去重 / 同题同标准 / 实际有效人数"),
        ("home",3,0,"我的概览与评分缺口","本人正式结果 / 原句与评分点"),
        ("request",0,1,"选择题目与标准发起诊断","查看原句证据 / 选择生成模型"),
        ("diagnose",2,1,"生成共性问题诊断草稿","只用正式失分答案 / 引用核对"),
        ("review",0,2,"编辑 · 标签维护 · 确认诊断","证据变化时禁止确认旧报告"),
        ("snapshot",1,2,"保存诊断与输入快照","保留任务 / 原句 / 教师确认"),
        ("prefs",3,2,"设置学习偏好","查看路径 / 保存偏好与历史"),
        ("candidates",1,3,"规则生成授权学习候选","知识 / 资料 / 已有练习目标"),
        ("rank",2,3,"在规则候选内AI排序","不新增无授权目标 / 保留排序依据"),
        ("path",3,3,"选学习路径项","阅读资料 / 知识 / 进入已有练习"),
        ("create",0,4,"创建并下发干预任务","选学生 / 目标 / 截止 / 验收要求"),
        ("task",3,4,"查看老师任务","开始学习或练习 / 查看要求"),
        ("act",3,5,"学习 / 新作答 / 提交证据","要求下发之后产生的新证据"),
        ("verify",1,5,"验证证据归属与时间","教师导入不冒充学生执行"),
        ("assess",0,6,"复查执行结果","通过 / 继续改进 / 查看关联证据"),
        ("result",3,6,"查看复查结论","继续学习并形成下一轮证据"),
        ("future",2,7,"未实现：自动发布新补练","当前由教师选择已有练习", None, True)]: f.n(*args)
    for a,b,label in [("evidence","dashboard","班级"),("evidence","home","本人"),("dashboard","request","发起"),
                      ("request","diagnose","受限输入"),("diagnose","review","草稿"),("review","snapshot","确认"),
                      ("evidence","candidates","规则依据"),("prefs","candidates","偏好"),("candidates","rank","可选AI排序"),
                      ("rank","path","推荐"),("candidates","path","规则路径"),("review","create","制定任务"),
                      ("home","path","缺口关联"),("path","act","自主学习"),("create","task","下发"),
                      ("task","act","执行"),("act","verify","新证据"),("verify","assess","可复查"),
                      ("assess","result","反馈"),("assess","task","继续改进"),("act","evidence","正式结果后计入")]: f.e(a,b,label)
    return f


def changes():
    f = Interaction("I07", "内容变更与整组重评", 7)
    for args in [
        ("change",0,0,"新增资料 / 知识 / 标准版本","普通更新或明确归档 / 撤回"),
        ("impact",1,0,"列出关联与影响","来源 / 知识 / 题目 / 作业引用"),
        ("decide",0,1,"核对影响 · 决定未来用途","普通更新保留旧版可追溯使用"),
        ("lifecycle",1,1,"落实明确生命周期操作","归档 / 替换停用 / 撤回才限制使用"),
        ("history",1,2,"保留发布与评分依据快照","不改写历史 / 提示评估是否重评"),
        ("start",0,2,"为关闭作业的单题建重评批次","选择同满分、兼容题目的新版标准"),
        ("reject",1,3,"题干 / 选项 / 满分已变更","拒绝旧答案重评 / 另建任务"),
        ("freeze",1,4,"冻结每人有效提交与基线","同一新版标准 / 原文与哈希"),
        ("grade",2,4,"按新版标准生成草稿","逐份执行 / 固定同一依据"),
        ("review",0,5,"逐份核对、修改并确认","未全部确认不能发布"),
        ("atomic",1,5,"整组原子发布","核对基线 / 保留旧成绩与旧依据"),
        ("student",3,5,"看到整组发布后的正式结果","原反馈仍可追溯"),
        ("error",1,6,"基线变化 / 草稿失败 / 未确认","阻断发布 / 明确处理后继续"),
        ("retry",0,6,"核对失败项或另建批次","未知生成不自动付费重试")]: f.n(*args)
    for a,b,label in [("change","impact","保存新版本"),("impact","decide","核对"),("decide","lifecycle","明确确认"),
                      ("lifecycle","history","历史保留"),("decide","start","评估重评"),("start","reject","不兼容"),
                      ("start","freeze","符合条件"),("freeze","grade","批次执行"),("grade","review","草稿"),
                      ("review","atomic","全部确认"),("atomic","student","统一可见"),("atomic","error","条件不满足"),
                      ("grade","error","失败"),("error","retry","人工处理"),("retry","review","继续复核")]: f.e(a,b,label)
    return f


def agent():
    f = Interaction("I08", "对话助理、操作门禁与复杂编辑", 9)
    for args in [
        ("teacher",0,0,"新建课程对话 · 发送要求","选模型 / 权限模式 / 上传附件"),
        ("session",1,0,"保存本人私有会话与附件","附件需另行导入才成为业务原件"),
        ("student",3,0,"向学习助理发起请求","仅本人数据与课程授权内容"),
        ("plan",2,1,"识别意图 · 顺序委派专家","资料知识 / 出题标准 / 评阅 / 学习"),
        ("gate",1,1,"逐工具校验权限与参数","read-only / auto-review / full-access"),
        ("answer",0,2,"填写输入 / 选择候选 / 审批","精确参数下批准或拒绝本次操作"),
        ("question",2,2,"需要信息或操作审批","输入框 / 单选 / 多选 / 审批卡片"),
        ("denied",1,2,"阻断未授权操作","只读禁写 / 越权拒绝 / 审批未通过"),
        ("studentinput",3,2,"补充输入 / 确认本人操作","不扩大学生权限"),
        ("editor",0,3,"在抽屉工作台复杂编辑","原文 / 知识 / 题目标准 / 目录"),
        ("more",1,3,"复用现有七类编辑器","另含作答导入 / 诊断 / 整卷拆题"),
        ("saved",0,4,"真实保存后返回对话","未保存可暂时关闭 / 不可冒充完成"),
        ("receipt",1,4,"服务端重读对象与保存回执","核对版本与哈希 / 继续本次运行"),
        ("tool",2,4,"执行已授权业务工具","正式确认 / 发布始终逐操作审批"),
        ("gateway",1,5,"通过既有业务权限路由执行","无任意SQL / Shell / HTTP权限"),
        ("wait",2,5,"等待长任务真实终态","排队不算完成 / 展示步骤与结果"),
        ("stream",1,6,"持久化公开文本与执行事件","SSE / 刷新重连 / 历史分页"),
        ("result",0,6,"查看结果 · 打开关联页面","成功回执 / 异常处理 / 后续操作"),
        ("studentresult",3,6,"查看本人结果与引用","保留学习上下文 / 跳转授权页面"),
        ("stop",0,7,"停止 / 拒绝 / 明确恢复","已完成操作保留 / 未知写不重放"),
        ("unknown",1,7,"失败与未知状态隔离","不自动再次收费 / 检查点恢复"),
        ("studentstop",3,7,"停止运行 / 拒绝操作","保留已完成操作 / 查看运行状态"),
        ("isolate",1,8,"读过作答或学情后隔离出题","当前会话禁止出题与标准工具"),
        ("new",0,8,"另建无作答上下文对话","隔离后再起草题目与标准")]: f.n(*args)
    for a,b,label in [("teacher","session","发送"),("student","session","发送"),("session","plan","协调"),
                      ("plan","gate","工具请求"),("gate","question","缺信息 / 需审批"),("question","answer","教师"),
                      ("question","studentinput","学生"),("answer","gate","提交选择"),("studentinput","gate","提交输入"),
                      ("gate","editor","复杂编辑"),("editor","more","复用"),("more","saved","保存"),
                      ("saved","receipt","返回并继续"),("receipt","tool","确认已保存"),("gate","tool","获准"),
                      ("tool","gateway","业务执行"),("gateway","wait","异步任务"),("wait","stream","终态回执"),
                      ("gateway","stream","同步回执"),("stream","result","教师"),("stream","studentresult","学生"),
                      ("gate","denied","禁止执行"),("denied","result","显示原因"),
                      ("teacher","stop","运行中停止"),("question","stop","拒绝审批"),
                      ("student","studentstop","运行中停止"),("studentstop","unknown","中断处理"),
                      ("stop","unknown","中断处理"),("wait","unknown","失败 / 未知"),
                      ("gateway","isolate","读取作答 / 学情"),("isolate","new","隔离提示")]: f.e(a,b,label)
    return f


def community():
    f = Interaction("I09", "课程互动、教研与行业能力", 5)
    for args in [
        ("publish",0,0,"发布公告 / 讨论 / 课程提问","输入标题与正文"),
        ("save",1,0,"校验身份与课程并保存","作者 / 类型 / 时间 / 回复关联"),
        ("ask",3,0,"课程提问","输入问题 / 提交"),
        ("list",1,1,"课程帖子与回复列表","只展示当前课程内容"),
        ("answer",0,1,"查看帖子 · 回复","取消回复可恢复发布状态"),
        ("reply",3,1,"查看公告 · 参与回复","查看提问与讨论历史"),
        ("research",0,2,"维护教研记录","主题 / 结论 / 关联课程内容"),
        ("record",1,2,"保存人工教研与能力记录","可查询 / 关联教学调整"),
        ("industry",0,3,"维护行业能力与知识关联","教师录入 / 不自动抓取行业信息"),
        ("error",1,4,"失败保留输入","显示错误 / 修改后明确重试")]: f.n(*args)
    for a,b,label in [("publish","save","发布"),("ask","save","提问"),("save","list","刷新列表"),
                      ("list","answer","教师"),("list","reply","学生"),("answer","save","回复"),("reply","save","回复"),
                      ("research","record","保存"),("industry","record","保存"),("save","error","失败"),
                      ("record","error","失败")]: f.e(a,b,label)
    return f


SOURCES = {
    "I00": ["web/src/app/navigation.ts", "web/src/live/routes.tsx", "docs/architecture.md"],
    "I01": ["web/src/live/course-management.tsx", "web/src/live/curriculum.tsx", "web/src/live/editing.tsx", "web/src/live/account.tsx"],
    "I02": ["web/src/live/knowledge.tsx", "backend/internal/learning/materials.go", "backend/internal/rag/vision.go"],
    "I03": ["web/src/live/knowledge-review.tsx", "web/src/live/retrieval-history.tsx", "backend/internal/learning/assist.go"],
    "I04": ["web/src/live/question-bank.tsx", "backend/internal/learning/question_bank.go", "backend/internal/rag/question_bank.go"],
    "I05": ["web/src/live/assessment.tsx", "web/src/live/grading.tsx", "web/src/live/submission-import.tsx", "backend/internal/learning/submission_import.go"],
    "I06": ["web/src/live/intelligence.tsx", "web/src/live/path.tsx", "web/src/live/interventions.tsx", "backend/internal/learning/intelligence.go"],
    "I07": ["web/src/live/content-impact.tsx", "web/src/live/regrades.tsx", "backend/internal/learning/regrade.go"],
    "I08": ["docs/agent-harness.md", "web/src/live/agent.tsx", "web/src/live/agent-editor.tsx", "backend/internal/agent/catalog.go"],
    "I09": ["web/src/live/communication.tsx", "web/src/live/activity.tsx"],
}
ROUTES = {
    "dashboard":"I06", "home":"I06", "assistant":"I08", "intervention":"I06", "courses":"I01", "curriculum":"I01",
    "materials":"I02", "course-content":"I02", "knowledge":"I03", "retrieval":"I03", "content-impact":"I07",
    "question-bank":"I04", "homework":"I05", "quiz":"I05", "regrades":"I07", "interaction":"I09",
    "research":"I09", "industry-intelligence":"I09", "learning":"I06", "profile":"I01",
}


def main():
    figures = [builder().save() for builder in (overview, access, materials, knowledge, questions, assessment, learning, changes, agent, community)]
    navigation = (ROOT / "web/src/app/navigation.ts").read_text(encoding="utf-8")
    coverage = []
    for role in ("teacher", "student"):
        section = navigation.split(f"export const {role}Navigation", 1)[1].split("\n];", 1)[0]
        for route, title in re.findall(r'\["([\w-]+)", "([^"]+)"\]', section) + [("profile", "个人设置")]:
            assert route in ROUTES, (role, route, "missing interaction map")
            coverage.append(dict(role=role, route=route, title=title, figure=ROUTES[route]))
    for fid, sources in SOURCES.items():
        assert all((ROOT / p).exists() for p in sources), (fid, "missing source")
    manifest = dict(date=DATE, scope="local-current-working-tree", baseline="4d82dbf + 方案B及当前前端", figures=figures, route_coverage=coverage, sources=SOURCES,
                    not_implemented=["自动生成并发布新补练"], checks=["orthogonal-routing", "no-edge-through-unrelated-node", "no-node-overlap", "navigation-coverage"])
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    template = (HERE / "viewer.html").read_text(encoding="utf-8")
    panels = "\n".join((HERE / (f["id"] + ".svg")).read_text(encoding="utf-8").replace('id="arrow"', 'id="'+f["id"]+'-arrow"').replace('url(#arrow)', 'url(#'+f["id"]+'-arrow)') for f in figures)
    (HERE / "index.html").write_text(template.replace("<!--PANELS-->", panels).replace("/*MANIFEST*/null", json.dumps(manifest, ensure_ascii=False)), encoding="utf-8")
    print(f"PASS: {len(figures)} figures / {len(coverage)} role routes", flush=True)


if __name__ == "__main__":
    main()
