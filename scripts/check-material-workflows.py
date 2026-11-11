"""Local Docker acceptance. Retains labelled fixtures, raw jobs and test-actor decisions.

Run phases in order: core, ai, retrieval, regrade, paging, edge, edge-ai, resume.
AI phases explicitly make real calls under the shared 50 CNY budget. Source
imports also enqueue automatic suggestions. No business records are removed.
"""
import argparse
import copy
import io
import json
from pathlib import Path
import statistics
import sys
import time
import uuid

import requests

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".local/material-workflows-check.json"
FIX = ROOT / ".local/material-workflows-fixtures"
BASE = "http://127.0.0.1:18080"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--phase", choices=["core", "ai", "retrieval", "paging", "regrade", "edge", "edge-ai", "resume"], required=True)
parser.add_argument("--continue-run", action="store_true", help="Recover the retained core course; no reset or cleanup")
args = parser.parse_args()
accounts = {a["username"]: a for a in json.loads((ROOT / ".local/s1-accounts.json").read_text(encoding="utf-8"))["accounts"]}
report = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() and (args.phase != "core" or args.continue_run) else {"checks": [], "jobs": {}, "actor": "automated local test, not independent teacher acceptance"}


def save(**values):
    report.update(values)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def passed(name, condition=True):
    assert condition, name
    if name not in report["checks"]:
        report["checks"].append(name)
    save()
    print("PASS", name, flush=True)


class Client:
    def __init__(self, username):
        self.s = requests.Session()
        self.s.trust_env = False
        self.csrf = ""
        self.csrf = self.call("POST", "/sessions", {"username": username, "password": accounts[username]["password"]})["csrf_token"]

    def call(self, method, path, body=None, status=200, files=None):
        r = self.s.request(method, BASE + "/api/v1" + path, json=body if files is None else None,
            data=body if files else None, files=files, headers={"Origin": BASE, "X-CSRF-Token": self.csrf}, timeout=115)
        r.encoding = "utf-8"
        assert r.status_code == status, f"{method} {path}: {r.status_code} {r.text[:700]}"
        return r.json().get("data") if "json" in r.headers.get("Content-Type", "") else r.content


t, s, other = [Client(n) for n in ("s1-teacher", "s1-student-a", "s1-teacher-other")]
p = "/learning/courses/" + report.get("course_id", "")


def wait(job, required=True):
    last = ""
    for _ in range(240):
        v = t.call("GET", p + "/jobs/" + job["id"])
        if v["state"] != last:
            print(v["kind"], v["state"], flush=True)
            last = v["state"]
        if v["state"] in ("succeeded", "failed", "canceled"):
            report["jobs"][v["id"]] = v
            save()
            if required:
                assert v["state"] == "succeeded", v.get("error")
            return v
        time.sleep(1)
    raise AssertionError("job timeout: " + job["id"])


def upload(path, **extra):
    data = {"source_note": "三模块本地验收构造资料", "allow_derived": "true", **extra}
    jobs = t.call("POST", p + "/sources", data, files=[("files", (path.name, path.read_bytes()))])
    wait(jobs[0])
    return t.call("GET", p + "/sources/" + jobs[0]["input"]["source_id"])


def knowledge(fragment, **extra):
    body = {"title": "边界值知识", "body": fragment["body"], "category": "测试", "content_kind": "method", "conditions": "整数年龄18到60", "evidence": [{"source_id": fragment["source_id"], "fragment_id": fragment["id"], "quote": fragment["body"]}], "student_visible": False, "use_for_learning": True, "use_for_grading": True, **extra}
    return t.call("POST", p + "/knowledge", body)


def fixtures():
    from PIL import Image, ImageDraw, ImageFont
    from docx import Document
    from docx.oxml import parse_xml
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.util import Inches
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    FIX.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("C:/Windows/Fonts/cambria.ttc", 56)
    for name in ("formula", "chart", "diagram", "low-resolution"):
        im = Image.new("RGB", (1100, 680), "white")
        d = ImageDraw.Draw(im)
        if name == "formula":
            d.text((80, 200), "E = mc²", font=font, fill="black")
            d.text((80, 320), "E: J    m: kg    c: m/s", font=font, fill="black")
        elif name == "chart":
            d.text((150, 20), "Requests (count)", font=font, fill="black")
            d.line((140, 570, 1000, 570), fill="black", width=3)
            d.line((140, 570, 140, 110), fill="black", width=3)
            for x, y, label in ((300, 430, "20"), (550, 290, "40"), (800, 150, "60")):
                d.rectangle((x-50, y, x+50, 570), fill="#286899")
                d.text((x-35, y-70), label, font=font, fill="black")
            d.text((270, 590), "A       B       C", font=font, fill="black")
        elif name == "diagram":
            for x, label in ((50, "Import"), (420, "Review"), (800, "Publish")):
                d.rectangle((x, 250, x+250, 380), outline="black", width=3)
                d.text((x+10, 280), label, font=ImageFont.truetype("C:/Windows/Fonts/cambria.ttc", 45), fill="black")
            for x in (300, 670):
                d.line((x, 315, x+115, 315), fill="black", width=4)
                d.polygon(((x+115,315),(x+95,300),(x+95,330)), fill="black")
        else:
            d.text((30, 200), "Missing axis and units", font=font, fill="#cccccc")
            im = im.resize((110, 68)).resize((1100,680))
        im.save(FIX / (name + ".png"))
    boundary = "边界值分析：年龄范围18到60且只接受整数，测试17、18、19、59、60、61。18、19、59、60合法，17和61非法。范围外输入用来检查系统是否拒绝超范围输入。"
    topics = [("等价类", "等价类划分把输入分为有效类和无效类"), ("单元测试", "单元测试检查独立函数的行为"), ("集成测试", "集成测试检查模块之间的接口"), ("回归测试", "回归测试验证修改没有破坏既有行为"), ("事务", "数据库事务具有原子性、一致性、隔离性和持久性"), ("主键", "主键唯一标识数据库表中的记录"), ("外键", "外键约束表之间的引用完整性"), ("缓存", "缓存保存可复用副本以减少重复读取"), ("队列", "任务队列保存等待处理的异步任务"), ("版本", "版本快照保留发布时的数据内容")]
    public = [boundary] + [f"验收知识{i}：{key}。{body}。" for i,(key,body) in enumerate(topics)]
    (FIX / "retrieval.txt").write_text("\n\n".join(public + ["TEACHER_SECRET_913内部评分密钥标记，仅教师可见，不向学生发布。"]), encoding="utf-8")
    (FIX / "table.csv").write_text("name,count\nA,20\nB,40\nC,60", encoding="utf-8")
    (FIX / "notes.md").write_text("# 软件测试\n\n" + boundary, encoding="utf-8")
    doc = Document()
    doc.add_heading("公式图表构造样例",0)
    doc.add_paragraph(boundary)
    doc.add_paragraph()._p.append(parse_xml('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>'))
    table = doc.add_table(rows=2, cols=2)
    table.cell(0,0).text="阶段"; table.cell(0,1).text="数量"; table.cell(1,0).text="完成"; table.cell(1,1).text="20"
    for name in ("formula", "chart", "diagram", "low-resolution"):
        doc.add_picture(str(FIX/(name+".png")), width=__import__('docx').shared.Inches(5))
    doc.save(FIX/"visuals.docx")
    prs=Presentation(); slide=prs.slides.add_slide(prs.slide_layouts[5]); slide.shapes.title.text="原生图表样例"
    data=CategoryChartData(); data.categories=["A","B","C"]; data.add_series("count",[20,40,60])
    slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.5), Inches(7), Inches(4), data)
    prs.save(FIX/"native-chart.pptx")
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    c=canvas.Canvas(str(FIX/"paper.pdf")); c.setFont("STSong-Light",14)
    for y,text in ((780,"1. 单选题（2分）：哪个年龄合法？"),(750,"A.17    B.18"),(710,"2. 主观题（10分）：列出18到60整数年龄的边界测试值，"),(680,"并说明合法性分类。下一页继续。")):
        c.drawString(60,y,text)
    c.showPage(); c.setFont("STSong-Light",14)
    for y,text in ((780,"第2题续：说明为什么仍需测试范围外输入。"),(740,"3. 代码文本题（5分）：阅读代码，指出条件错误，不执行。"),(700,"if age > 18 and age < 60: accept()")):
        c.drawString(60,y,text)
    c.save()
    return public


try:
    if args.phase == "core":
        public = report["public_reference"] if args.continue_run else fixtures()
        course={"id":report["course_id"]} if args.continue_run else t.call("POST", "/learning/courses", {"title":"三模块验收 " + time.strftime("%m%d-%H%M%S")})
        save(course_id=course["id"], started_at=report.get("started_at",time.strftime("%Y-%m-%d %H:%M:%S")), public_reference=public)
        p="/learning/courses/"+course["id"]
        if not args.continue_run:
            for username in ("s1-student-a","s1-student-b"):
                t.call("POST",p+"/members",{"username":username})
            t.call("POST",p+"/publish",{})
            save(budget_before=t.call("GET",p+"/models")["budget"])
        sources=report.get("sources",{})
        for file in (FIX/"retrieval.txt",FIX/"notes.md",FIX/"table.csv",FIX/"visuals.docx",FIX/"native-chart.pptx",FIX/"paper.pdf",ROOT/".local/rag-fixtures/chinese-scan.pdf",ROOT/".local/rag-fixtures/notes.html"):
            existing=next((v for v in t.call("GET",p+"/sources") if v["filename"]==file.name),None)
            if existing and existing["parse_state"]!="ready":
                pending=t.call("GET",p+"/jobs?kind=parse&source_id="+existing["id"])
                wait(pending[0])
            sources[file.name]=t.call("GET",p+"/sources/"+existing["id"]) if existing else upload(file)
            save(sources=sources)
            passed("parsed " + file.name, bool(sources[file.name]["fragments"]))
        scan=sources["chinese-scan.pdf"]
        passed("Chinese printed OCR is review-only", any(f["quality"]=="needs_review" and "边界" in f["body"] for f in scan["fragments"]))
        src=sources["retrieval.txt"]; sid=src["source"]["id"]
        t.call("POST",p+"/sources",{"source_note":"duplicate"},status=409,files=[("files",("retrieval.txt",(FIX/"retrieval.txt").read_bytes()))])
        passed("duplicate import blocked")
        topics=[t.call("POST",p+"/topics",{"title":v}) for v in ("测试方法","工程基础")]
        point=t.call("POST",p+"/points",{"title":"边界值分析","kind":"point"})
        t.call("PUT",p+"/content-links",{"kind":"source","id":sid,"topic_ids":[v["id"] for v in topics],"tags":["复习"],"knowledge_point_ids":[point["id"]]})
        passed("one source links two topics with separate tags and course point", len(t.call("GET",p+"/topics")["links"])==2)
        save(topic_ids=[v["id"] for v in topics], point_id=point["id"])
        resource=t.call("POST",p+"/sources/"+sid+"/publish",{"title":"软件工程验收公开片段","fragment_ids":[f["id"] for f in src["fragments"][:-1]],"full_source":False})
        save(resource_id=resource["id"])
        k=knowledge(src["fragments"][0],student_visible=True)
        k=t.call("POST",p+"/knowledge/"+k["id"]+"/state",{"state":"confirmed","edit_version":k["edit_version"]})
        save(knowledge_id=k["id"])
        t.call("GET",p+"/sources/"+sid+"/download",status=200)
        s.call("GET",p+"/sources/"+sid+"/download",status=403)
        for suffix in ("/topics","/sources/"+sid+"/assets","/impact","/regrades"):
            s.call("GET",p+suffix,status=403); other.call("GET",p+suffix,status=403)
        csrf=t.csrf; t.csrf=""; t.call("POST",p+"/topics",{"title":"no csrf"},status=403); t.csrf=csrf
        passed("teacher workflow roles, ownership, partial publication and CSRF enforced")
        visual=sources["visuals.docx"]; vid=visual["source"]["id"]
        assets=t.call("GET",p+"/sources/"+vid+"/assets")["assets"]
        passed("native formula and table preserved", any("frac" in f["body"] for f in visual["fragments"]) and any("20" in f["body"] and f["locator"].get("type")=="table" for f in visual["fragments"]))
        passed("native chart data preserved", any('60' in f["body"] and f["locator"].get("type")=="native_chart" for f in sources["native-chart.pptx"]["fragments"]))
        save(visual_source_id=vid, asset_ids=[a["id"] for a in assets])
        asset=assets[0]
        s.call("GET",p+"/assets/"+asset["id"]+"/file",status=403)
        crop=t.call("POST",p+"/assets/"+asset["id"]+"/crop",{"x":0.02,"y":0.02,"width":0.96,"height":0.96,"kind":"formula","parse_revision":visual["source"]["parse_revision"]})
        save(crop_asset_id=crop["id"])
        passed("real crop preserves asset lineage", crop["locator"]["parent_asset_id"]==asset["id"])
        # Exercise all human decisions on explicit constructed candidates.
        for action in ("defer","discard","merge","coexist","replace"):
            candidate=knowledge(src["fragments"][0],title="测试候选 "+action)
            body={"action":action,"edit_version":candidate["edit_version"],"reason":"自动化验收 "+action,"related_ids":[] if action in ("discard","defer") else [k["id"]],"title":"合成知识","body":src["fragments"][0]["body"],"conditions":"整数区间"}
            decision=t.call("POST",p+"/knowledge/"+candidate["id"]+"/decision",body)
            passed("knowledge decision " + action, bool(decision["decision"]["id"]))
        source=t.call("GET",p+"/sources/"+sid)["source"]
        passed("discarded candidate did not revoke source", source["allow_derived"])
        k2=knowledge(src["fragments"][0],title="新版确认知识",supersedes_id=report["knowledge_id"],student_visible=True)
        t.call("POST",p+"/knowledge/"+k2["id"]+"/state",{"state":"confirmed","edit_version":k2["edit_version"]})
        save(knowledge_id=k2["id"])
        fresh=FIX/"new-version.txt"; fresh.write_text(public[0]+"\n\n新版增加版本说明。",encoding="utf-8")
        newer=upload(fresh,supersedes_id=sid)
        passed("ordinary source update keeps old source active", t.call("GET",p+"/sources/"+sid)["source"]["state"]=="active")
        save(new_source_id=newer["source"]["id"])
        for url in ("http://127.0.0.1/secret","http://169.254.169.254/","file:///etc/passwd"):
            t.call("POST",p+"/sources/url",{"url":url,"source_note":"SSRF negative"},status=422)
        passed("private and invalid URL import denied")
        web=wait(t.call("POST",p+"/sources/url",{"url":"https://www.python.org/about/","source_note":"Public single page fixture","title":"Python About snapshot"}),required=False)
        save(web_job_id=web["id"])
        if web["state"]=="succeeded":
            wa=t.call("GET",p+"/sources/"+web["input"]["source_id"]+"/assets")
            passed("public single page snapshot parsed", bool(t.call("GET",p+"/sources/"+web["input"]["source_id"])["source"]["source_url"]))
            save(web_asset_count=len(wa["assets"]))
        wait(t.call("POST",p+"/jobs",{"kind":"index"}))
        impact=t.call("GET",p+"/impact?source_id="+sid)
        passed("source impact includes direct and merged knowledge", any(v["kind"]=="knowledge" for v in impact["items"]))
        decision=t.call("POST",p+"/impact/decisions",{"kind":"source","id":sid,"action":"future_version","reason":"验收：下次作业采用新版，历史保留"})
        save(impact_decision_id=decision["id"],core_finished_at=time.strftime("%Y-%m-%d %H:%M:%S"))
    elif args.phase == "ai":
        save(visual_reference={"formula":"E=mc^2; E:J, m:kg, c:m/s", "chart":"A=20,B=40,C=60; Requests(count)", "diagram":"Import→Review→Publish", "low_resolution":"must disclose uncertainty; no invented units"})
        original=t.call("GET",p+"/sources/"+report["visual_source_id"]+"/assets")["assets"]
        order=sorted([a for a in original if a["id"] in report["asset_ids"]], key=lambda a:a["locator"].get("block",0))
        save(visual_cases=[{"asset_id":a["id"],"fixture":name,"locator":a["locator"]} for a,name in zip(order,("formula","chart","diagram","low_resolution"))])
        results=[]
        for aid in [a["id"] for a in order]:
            previous=next((j for j in report["jobs"].values() if j["kind"]=="vision" and j["input"].get("asset_id")==aid and j["state"]=="succeeded"),None)
            j=previous or wait(t.call("POST",p+"/jobs",{"kind":"vision","asset_id":aid,"profile_id":"deepseek-vision"}),required=False)
            results.append(j)
        save(vision_job_ids=[v["id"] for v in results])
        passed("actual vision requests returned auditable drafts", all(v["state"]=="succeeded" and v["output"]["review_status"]=="pending_teacher_review" for v in results))
        visual=t.call("GET",p+"/sources/"+report["visual_source_id"]+"/assets")
        # Confirmation is test-actor adoption. Raw output remains separately stored above.
        chosen=results[0]; aid=chosen["input"]["asset_id"]
        latest=max(r["revision"] for r in visual["revisions"] if r["asset_id"]==aid)
        rev=t.call("POST",p+"/assets/"+aid+"/revisions",{"base_revision":latest,"body":chosen["output"]["asset_revision"]["body"],"structured":chosen["output"]["asset_revision"]["structured"],"model_job_id":chosen["id"]})
        t.call("POST",p+"/assets/"+aid+"/revisions",{"base_revision":latest,"body":"stale"},status=409)
        detail=t.call("GET",p+"/sources/"+report["visual_source_id"])
        f=next(f for f in detail["fragments"] if f["locator"].get("asset_revision_id")==rev["id"])
        r=t.call("POST",p+"/sources/"+report["visual_source_id"]+"/publish",{"title":"已核对公式图表样例","fragment_ids":[f["id"]],"full_source":False})
        passed("confirmed visual revision publishes only selected asset", len(s.call("GET",p+"/resources/"+r["id"]+"/assets"))==1 and bool(s.call("GET",p+"/assets/"+aid+"/file")))
        save(visual_resource_id=r["id"])
        src=report["sources"]["retrieval.txt"]
        suggestion=wait({"id":report["suggestion_job_id"]}) if report.get("suggestion_job_id") else wait(t.call("POST",p+"/jobs",{"kind":"source_suggest","source_id":src["source"]["id"]}))
        save(suggestion_job_id=suggestion["id"])
        o=suggestion["output"]
        body={"job_id":suggestion["id"],"topic_ids":o["topic_ids"],"tags":o["tags"],"knowledge_point_ids":o["knowledge_point_ids"],"new_topics":[],"outline":[],"reason":"自动化逐项采纳，不增加目录"}
        d=t.call("POST",p+"/sources/"+src["source"]["id"]+"/suggestions/adopt",body)
        again=t.call("POST",p+"/sources/"+src["source"]["id"]+"/suggestions/adopt",body)
        passed("real suggestions have validated references and idempotent adoption", d["id"]==again["id"])
        if report.get("compare_job_id"):
            comparison=wait({"id":report["compare_job_id"]})
            candidate=next(k for k in t.call("GET",p+"/knowledge") if k["id"]==comparison["input"]["knowledge_id"])
        else:
            candidate=knowledge(src["fragments"][0],title="AI比较候选")
            comparison=wait(t.call("POST",p+"/jobs",{"kind":"knowledge_compare","knowledge_id":candidate["id"]}))
        save(compare_job_id=comparison["id"])
        passed("real related-knowledge comparison has exact two-sided evidence", bool(comparison["output"]["comparisons"]))
        # Mutate the candidate after inference; stale comparison must fail closed.
        changed=candidate
        if candidate["edit_version"] == comparison["input"]["edit_version"]:
            changed=t.call("PUT",p+"/knowledge/"+candidate["id"],{**candidate,"body":candidate["body"]+"\n教师修订", "edit_version":candidate["edit_version"]})
        t.call("POST",p+"/knowledge/"+candidate["id"]+"/decision",{"action":"discard","reason":"stale compare test","edit_version":changed["edit_version"],"compare_job_id":comparison["id"]},status=409)
        passed("stale comparison cannot overwrite teacher edit")
        paper=report["sources"]["paper.pdf"]
        split=wait({"id":report["paper_job_id"]}) if report.get("paper_job_id") else wait(t.call("POST",p+"/jobs",{"kind":"paper_split","source_id":paper["source"]["id"]}))
        save(paper_job_id=split["id"])
        qs=copy.deepcopy(split["output"]["questions"])
        passed("actual cross-page split covers three question types", {q["type"] for q in qs}=={"quiz","subjective","code"} and len(qs)==3)
        passed("missing original answers not invented", all(q["answer_origin"]=="missing" and not q["reference_answer"] and not q["correct_answer"] for q in qs))
        for q in qs:
            if q["type"]=="quiz": q.update(correct_answer=q["options"][1],answer_origin="teacher")
        body={"job_id":split["id"],"questions":qs,"excluded":split["output"]["excluded"],"review_status":"pending_teacher_review"}
        adopted=t.call("POST",p+"/sources/"+paper["source"]["id"]+"/paper/adopt",body)
        again=t.call("POST",p+"/sources/"+paper["source"]["id"]+"/paper/adopt",body)
        passed("whole paper adoption is atomic and idempotent", [v["id"] for v in adopted["versions"]]==[v["id"] for v in again["versions"]])
        save(paper_versions=adopted["versions"],budget_after=t.call("GET",p+"/models")["budget"],ai_finished_at=time.strftime("%Y-%m-%d %H:%M:%S"))
    elif args.phase == "retrieval":
        source=report["sources"]["retrieval.txt"]["source"]["id"]
        fs=t.call("GET",p+"/sources/"+source)["fragments"]
        cases=[]
        for i,f in enumerate(fs[:-1]):
            cases.append({"kind":"positive","query":f["body"].split("。")[0],"target":f["id"]})
        for word in ("等价类划分","集成测试接口","事务原子性持久性","外键引用完整性","任务队列异步","缓存副本","版本快照","单元测试函数","回归测试修改"):
            target=next(f["id"] for f in fs[:-1] if any(k in f["body"] and k in word for k in ("等价类","集成测试","事务","外键","队列","缓存","版本","单元测试","回归测试")))
            cases.append({"kind":"positive","query":word,"target":target})
        for word in ("TEACHER_SECRET_913","内部评分密钥","私有评分备注","未发布原卷答案","教师内部规则"):
            cases.append({"kind":"permission","query":word})
        for word in ("量子纠缠实验","线粒体基因组","火星气候模拟","唐代铜钱铸造","聚合物结晶温度"):
            cases.append({"kind":"no_answer","query":word})
        assert len(cases)==30
        save(retrieval_cases=cases)
        results=[]
        for case in cases:
            start=time.monotonic(); result=s.call("POST",p+"/retrieval",{"query":case["query"]}); hits=result["hits"][:5]
            results.append({**case,"mode":result["mode"],"duration_ms":round((time.monotonic()-start)*1000),"hits":hits,"hit":any(case.get("target") in h["fragment_ids"] for h in hits) if case["kind"]=="positive" else None})
            print("QUERY",len(results),case["kind"],flush=True)
        positive=[r for r in results if r["kind"]=="positive"]
        leaks=[r for r in results if any("TEACHER_SECRET_913" in h["body"] or h.get("source_id")==report["sources"]["paper.pdf"]["source"]["id"] for h in r["hits"])]
        recall=sum(r["hit"] for r in positive)/len(positive)
        save(retrieval_results=results,recall_at_5=recall,permission_leaks=len(leaks),retrieval_note="Constructed exact/synonym queries; no-answer records are retrieval candidates, not asserted answers. No independent semantic QA benchmark.")
        passed("30 fixed retrieval queries: Recall@5 >= 90% and zero private leakage", recall>=0.9 and not leaks)
    elif args.phase == "regrade":
        criteria=[{"id":"D1","title":"测试目的","max_score":10,"rule":"根据是否明确检查拒绝超范围输入给部分分"}]
        hits=t.call("POST",p+"/question-bank/evidence",{"source_id":report["sources"]["retrieval.txt"]["source"]["id"]})["hits"]
        bank=t.call("POST",p+"/question-bank",{"title":"整组重评全链路构造","prompt":"说明范围外测试目的","type":"subjective","max_score":10,"reference_answer":"检查拒绝超范围输入","evidence_ids":[hits[0]["id"]]})
        vp=p+"/question-bank/versions/"+bank["id"]
        for suffix in ("/confirm","/reference/confirm"): t.call("POST",vp+suffix,{})
        r=t.call("POST",vp+"/rubrics",{"criteria":criteria})
        t.call("POST",p+"/rubrics/"+r["id"]+"/confirm",{})
        assignments=[t.call("POST",p+"/assignments",{"title":"同题作业"+str(i),"type":"subjective","questions":[{"bank_question_version_id":bank["id"],"bound_rubric_id":r["id"]}]}) for i in (1,2)]
        aid=assignments[0]["id"]; ap=p+"/assignments/"+aid
        for a in assignments: t.call("POST",p+"/assignments/"+a["id"]+"/state",{"state":"published"})
        q=t.call("GET",ap)["questions"][0]
        students=[s,Client("s1-student-b")]; submissions=[]
        for actor in students:
            sub=actor.call("POST",ap+"/submissions",{"question_id":q["id"],"answer_text":"检查拒绝超范围输入","request_id":str(uuid.uuid4())})
            submissions.append(sub)
            rev=t.call("POST",p+"/submissions/"+sub["id"]+"/revisions",{"rubric_id":r["id"],"score":4,"feedback":"原结果4分","request_id":str(uuid.uuid4()),"points":[{"criterion_id":"D1","score":4,"feedback":"原部分分","quote":"拒绝超范围输入"}]})
            for state in ("confirmed","released"): t.call("POST",p+"/revisions/"+rev["id"]+"/state",{"state":state})
        t.call("POST",ap+"/state",{"state":"closed"})
        nr=t.call("POST",vp+"/rubrics",{"criteria":criteria})
        t.call("POST",p+"/rubrics/"+nr["id"]+"/confirm",{})
        body={"question_id":q["id"],"rubric_id":nr["id"],"reason":"更正部分分口径，本地构造验收"}
        passed("whole-group preview freezes latest submissions",t.call("POST",p+"/regrades",{**body,"preview":True})["count"]==2)
        batch=t.call("POST",p+"/regrades",body); bp=p+"/regrades/"+batch["id"]
        t.call("POST",p+"/regrades",body,status=409)
        t.call("POST",bp+"/state",{"state":"released"},status=409)
        for i,sub in enumerate(submissions):
            item={"score":8,"feedback":"整组新结果8分","confirmed":True,"edit_version":1,"points":[{"criterion_id":"D1","score":8,"feedback":"新口径","quote":"拒绝超范围输入"}]}
            t.call("PUT",bp+"/items/"+sub["id"],item)
            t.call("PUT",bp+"/items/"+sub["id"],item,status=409)
            if i==0:
                t.call("POST",bp+"/state",{"state":"released"},status=409)
                passed("partial confirmation keeps old feedback",s.call("GET",p+"/submissions/"+sub["id"])["revisions"][0]["score"]==4)
        t.call("POST",bp+"/state",{"state":"released"}); t.call("POST",bp+"/state",{"state":"released"})
        passed("atomic release updates every student and preserves history",all(len(actor.call("GET",p+"/submissions/"+sub["id"])["revisions"])==2 and actor.call("GET",p+"/submissions/"+sub["id"])["revisions"][0]["score"]==8 for actor,sub in zip(students,submissions)))
        impact=t.call("GET",p+"/impact?source_id="+report["sources"]["retrieval.txt"]["source"]["id"])
        kinds={v["kind"] for v in impact["items"]}
        passed("impact traverses source, knowledge, question, rubric, assignments, results",{"knowledge","question","rubric","assignment","result"}<=kinds and len([v for v in impact["items"] if v["kind"]=="assignment"])==2)
        canceled=t.call("POST",p+"/regrades",body)
        t.call("POST",p+"/regrades/"+canceled["id"]+"/state",{"state":"canceled"})
        t.call("POST",p+"/regrades/"+canceled["id"]+"/state",{"state":"released"},status=409)
        active=t.call("POST",p+"/regrades",body)
        save(regrade_batch_id=active["id"],released_batch_id=batch["id"],regrade_submissions=[v["id"] for v in submissions],regrade_assignment_id=aid,regrade_bank_id=bank["bank_id"],regrade_question_id=q["id"],regrade_rubric_id=nr["id"])
        passed("cancel retains old results and allows a new explicit batch")
    elif args.phase == "paging":
        count=report.get("paging_created",0)
        for i in range(count,1000):
            t.call("POST",p+"/question-bank",{"title":f"分页构造{i:04}","prompt":f"构造题{i}: 验证分页，不代表真实教学内容。","type":"code" if i%2 else "subjective","max_score":10,"knowledge_point_id":report["point_id"]})
            if (i+1)%100==0: save(paging_created=i+1); print("PAGING FIXTURES",i+1,flush=True)
        seen=set(); elapsed=[]
        for page in range(1,21):
            start=time.monotonic(); r=t.call("GET",p+f"/question-bank/search?search=分页构造&page={page}&page_size=50")
            elapsed.append(round((time.monotonic()-start)*1000,2)); assert r["total"]==1000 and len(r["items"])==50
            for v in r["items"]: assert v["id"] not in seen; seen.add(v["id"])
        filtered=t.call("GET",p+"/question-bank/search?search=分页构造&type=code&page=1&page_size=20")
        passed("1000 constructed questions page consistently with server filters",len(seen)==1000 and filtered["total"]==500 and len(filtered["items"])==20)
        save(paging_ms={"median":statistics.median(elapsed),"max":max(elapsed),"samples":elapsed})
    elif args.phase == "edge":
        # Fixed public endpoints; no recursive crawling and no production writes.
        for name, url in (("direct", "https://raw.githubusercontent.com/github/gitignore/main/README.md"),
                          ("redirect", "https://www.python.org/about")):
            key = "edge_url_" + name
            if key not in report:
                response = t.call("POST", p+"/sources/url", {"url":url,"title":"URL验收 "+name,"source_note":"公开单页／直链本地验收"})
                save(**{key:response})
            job = wait(report[key])
            source = t.call("GET",p+"/sources/"+job["input"]["source_id"])
            passed("public URL " + name + " snapshot retains final URL and parsed text", bool(source["fragments"]) and bool(source["source"]["source_url"]))
        t.call("POST",p+"/sources/url",{"url":"https://www.python.org/hajimark-acceptance-missing-page-20261112","source_note":"404 negative"},status=422)
        passed("failed public URL reports error and permits a later independent import")
        decision=t.call("POST",p+"/impact/decisions",{"kind":"source","id":report["new_source_id"],"action":"future_version","reason":"新版影响快照须与前版引用预览一致"})
        expected=t.call("GET",p+"/impact?source_id="+report["sources"]["retrieval.txt"]["source"]["id"])["items"]
        passed("new-version decision saves the same predecessor impact as preview",{(v["kind"],v["id"]) for v in decision["output"]}=={(v["kind"],v["id"]) for v in expected})
        lifecycle=FIX/"lifecycle.txt"
        lifecycle.write_text("LIFECYCLE_739：许可撤回验收，仅供构造。事务提交时应保留旧版本记录。",encoding="utf-8")
        if "lifecycle_source_id" not in report:
            data=upload(lifecycle)
            save(lifecycle_source_id=data["source"]["id"])
        source=t.call("GET",p+"/sources/"+report["lifecycle_source_id"])
        if "lifecycle_knowledge_id" not in report:
            k=knowledge(source["fragments"][0],title="许可撤回构造知识")
            k=t.call("POST",p+"/knowledge/"+k["id"]+"/state",{"state":"confirmed","edit_version":k["edit_version"]})
            save(lifecycle_knowledge_id=k["id"])
        kid=report["lifecycle_knowledge_id"]; sid=report["lifecycle_source_id"]
        # Revocation is checked synchronously even before a new index is built.
        t.call("PUT",p+"/sources/"+sid+"/derivation",{"allow_derived":False})
        hits=t.call("POST",p+"/question-bank/evidence",{"query":"LIFECYCLE_739"})["hits"]
        passed("withdrawn derivation blocks future knowledge evidence", all(h.get("knowledge_id")!=kid for h in hits))
        t.call("POST",p+"/sources/"+sid+"/archive",{})
        t.call("POST",p+"/question-bank/evidence",{"source_id":sid},status=422)
        passed("archived source cannot supply future assignment evidence")
        passed("withdrawal retains knowledge audit record",any(k["id"]==kid for k in t.call("GET",p+"/knowledge")))
        topic=t.call("GET",p+"/topics")["topics"][0]
        t.call("PUT",p+"/topics/"+topic["id"],{"title":topic["title"],"active":False,"edit_version":topic["edit_version"]})
        t.call("PUT",p+"/content-links",{"kind":"source","id":report["new_source_id"],"topic_ids":[topic["id"]],"tags":[],"knowledge_point_ids":[]},status=422)
        passed("inactive topic rejects new links without archiving original content",t.call("GET",p+"/sources/"+report["new_source_id"])["source"]["state"]=="active")
    elif args.phase == "edge-ai":
        paper=FIX/"paper-with-answers.md"
        paper.write_text("# 原卷与答案\n\n1. 单选题（2分）：哪个整数年龄合法？\nA.17\nB.18\n正确答案：B.18\n\n2. 主观题（10分）：说明范围外测试目的。\n参考解答：检查系统拒绝超范围输入。",encoding="utf-8")
        if "answered_paper_source_id" not in report:
            data=upload(paper,allow_derived="false")
            save(answered_paper_source_id=data["source"]["id"])
        sid=report["answered_paper_source_id"]
        if "answered_paper_job_id" not in report:
            j=t.call("POST",p+"/jobs",{"kind":"paper_split","source_id":sid,"profile_id":"bailian-qwen"})
            save(answered_paper_job_id=j["id"])
        job=wait({"id":report["answered_paper_job_id"]})
        questions=job["output"]["questions"]
        passed("real answered paper extracts original answers with distinct origin",len(questions)==2 and all(q["answer_origin"]=="extracted" for q in questions) and any(q["correct_answer"]=="B.18" for q in questions) and any(q["reference_answer"]=="检查系统拒绝超范围输入。" for q in questions))
        adopted=t.call("POST",p+"/sources/"+sid+"/paper/adopt",{**job["output"],"job_id":job["id"]})
        passed("answered paper adopts only as private question drafts",len(adopted["versions"])==2 and all(v["state"]=="draft" for v in adopted["versions"]))
        if "ai_regrade_batch_id" not in report:
            b=t.call("POST",p+"/regrades",{"question_id":report["regrade_question_id"],"rubric_id":report["regrade_rubric_id"],"reason":"真实模型重评草稿验收，结束后取消，不改变正式7分"})
            save(ai_regrade_batch_id=b["id"])
        bp=p+"/regrades/"+report["ai_regrade_batch_id"]
        detail=t.call("GET",bp)
        if detail["batch"]["state"]=="active":
            item=detail["items"][0]
            if "ai_regrade_job_id" not in report:
                j=t.call("POST",bp+"/items/"+item["submission_id"]+"/ai",{"profile_id":"bailian-qwen"})
                save(ai_regrade_job_id=j["id"])
            job=wait({"id":report["ai_regrade_job_id"]})
            output=job["output"]
            t.call("PUT",bp+"/items/"+item["submission_id"],{**output,"ai_job_id":job["id"],"edit_version":item["edit_version"],"confirmed":False})
            passed("real regrade draft saves against frozen answer and unified rubric",job["input"]["rubric_id"]==report["regrade_rubric_id"])
            t.call("POST",bp+"/state",{"state":"canceled"})
        passed("canceling real AI regrade preserves official feedback",s.call("GET",p+"/submissions/"+report["regrade_submissions"][0])["revisions"][0]["score"]==7)
        save(budget_after=t.call("GET",p+"/models")["budget"])
    else:
        passed("restart retained source versions", t.call("GET",p+"/sources/"+report["new_source_id"])["source"]["supersedes_id"]==report["sources"]["retrieval.txt"]["source"]["id"])
        passed("restart retained two topics and audit decision",len(t.call("GET",p+"/topics")["topics"])>=2 and any(d["id"]==report["impact_decision_id"] for d in t.call("GET",p+"/decisions")))
        if report.get("paper_versions"):
            passed("restart retained paper provenance",all(t.call("GET",p+"/question-bank/versions/"+v["id"]+"/provenance")["decisions"] for v in report["paper_versions"]))
        if report.get("regrade_batch_id"):
            batch=t.call("GET",p+"/regrades/"+report["regrade_batch_id"])
            histories=[t.call("GET",p+"/submissions/"+sid)["revisions"] for sid in report["regrade_submissions"]]
            passed("restart retained whole-group publication and history",batch["batch"]["state"]=="released" and len(batch["items"])==2 and all({4,8,7}<={v["score"] for v in history} and next(v for v in history if v["state"]=="released")["score"]==7 for history in histories))
        budget=t.call("GET",p+"/models")["budget"]
        passed("restart leaves no orphan model reservation and stays within budget",budget["reserved_micro_cny"]==0 and budget["spent_micro_cny"]<=budget["limit_micro_cny"])
        save(restarted_at=time.strftime("%Y-%m-%d %H:%M:%S"),budget_final=budget)
    report.pop("error",None)
    save(last_phase=args.phase)
except Exception as e:
    save(error={"phase":args.phase,"message":str(e)})
    raise
