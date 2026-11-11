"""Local-only real-provider acceptance. Retains explicitly labelled test data."""
import argparse
import json
import time
import uuid
from pathlib import Path

import requests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", default="http://127.0.0.1:18080")
parser.add_argument("--accounts", default=".local/s1-accounts.json")
parser.add_argument("--output", default=".local/rag-acceptance.json")
parser.add_argument("--resume", action="store_true")
parser.add_argument("--continue-run", action="store_true", help="Continue the saved course after a failed check")
args = parser.parse_args()
assert args.base.startswith(("http://127.0.0.1:", "http://localhost:")), "Local acceptance only"
accounts = {a["username"]: a for a in json.loads(Path(args.accounts).read_text(encoding="utf-8"))["accounts"]}


class Client:
    def __init__(self, name):
        self.session = requests.Session()
        self.session.trust_env = False
        self.csrf = ""
        self.csrf = self.call("POST", "/sessions", {"username": name, "password": accounts[name]["password"]})["csrf_token"]

    def call(self, method, path, body=None, expected=200, files=None):
        headers = {"Origin": args.base, "X-CSRF-Token": self.csrf}
        response = self.session.request(method, args.base + "/api/v1" + path, json=body if files is None else None,
                                        data=body if files else None, files=files, headers=headers, timeout=115)
        assert response.status_code == expected, f"{method} {path}: {response.status_code}: {response.text[:600]}"
        return response.json().get("data") if response.content and "json" in response.headers.get("Content-Type", "") else response.content


teacher = Client("s1-teacher")
student = Client("s1-student-a")
other = Client("s1-teacher-other")
report = {"started_at": time.strftime("%Y-%m-%d %H:%M:%S"), "checks": []}
if args.continue_run:
    report.update(json.loads(Path(args.output).read_text(encoding="utf-8")))


def checkpoint(**values):
    report.update(values)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def passed(message):
    if message not in report["checks"]:
        report["checks"].append(message)
    print("PASS", message, flush=True)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def wait_job(job):
    previous = ""
    for _ in range(360):
        current = teacher.call("GET", base + "/jobs/" + job["id"])
        status = f"{current['kind']} {current['state']} {current['progress']}%"
        if status != previous:
            print(status, flush=True)
            previous = status
        if current["state"] == "succeeded":
            return current
        assert current["state"] not in ("failed", "canceled"), current.get("error")
        time.sleep(2)
    raise AssertionError("job timeout")


if args.resume:
    old = json.loads(Path(args.output).read_text(encoding="utf-8"))
    report.update(old)
    base = "/learning/courses/" + report["course_id"]
    assert teacher.call("GET", base + "/knowledge")
    assert student.call("GET", base + "/submissions/" + report["submission_id"])["revisions"]
    passed("Docker restart retained knowledge and released grading")
    raise SystemExit(0)

fixtures = Path(".local/rag-fixtures")
fixtures.mkdir(parents=True, exist_ok=True)
public = "边界值分析：年龄范围18到60且只接收整数，应测试17、18、19、59、60、61。18、19、59、60合法；17和61非法。范围外输入用来检查系统是否拒绝超出允许范围的输入。"
private = "教师内部暗号ALPHA_PRIVATE_731。评分内部备注仅供教师，不向学生发布。"
(fixtures / "boundary.txt").write_text(public + "\n\n" + private, encoding="utf-8")
(fixtures / "notes.html").write_text("<h1>软件测试</h1><p>等价类划分把输入域划分为有效类和无效类。</p><script>不可检索脚本</script>", encoding="utf-8")
from docx import Document
doc = Document()
doc.add_heading("软件测试方法", 0)
doc.add_paragraph("边界值分析关注输入区间的端点及其相邻值。")
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text, table.cell(0, 1).text = "方法", "用途"
table.cell(1, 0).text, table.cell(1, 1).text = "等价类划分", "选择代表性输入"
doc.save(fixtures / "methods.docx")
from pptx import Presentation
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "测试设计"
slide.placeholders[1].text = "测试应有明确输入和预期结果。"
prs.save(fixtures / "design.pptx")
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 42)
scan = Image.new("RGB", (1654, 800), "white")
draw = ImageDraw.Draw(scan)
for i, line in enumerate(["软件测试：边界值分析", "年龄范围18到60。", "需要测试端点和相邻整数。"]):
    draw.text((90, 100 + i * 130), line, font=font, fill="black")
scan.save(fixtures / "chinese-scan.pdf", "PDF", resolution=140)

if not report.get("course_id"):
    course = teacher.call("POST", "/learning/courses", {"title": "RAG本地验收 " + time.strftime("%m%d-%H%M")})
    checkpoint(course_id=course["id"])
    base = "/learning/courses/" + course["id"]
    teacher.call("POST", base + "/members", {"username": "s1-student-a"})
    teacher.call("POST", base + "/publish", {})
base = "/learning/courses/" + report["course_id"]
other.call("GET", base + "/sources", expected=403)
student.call("GET", base + "/sources", expected=403)
passed("course boundaries and teacher-only source workspace")
if not teacher.call("GET", base + "/sources"):
    handles = [p.open("rb") for p in sorted(fixtures.iterdir()) if p.suffix in (".txt", ".html", ".docx", ".pptx", ".pdf")]
    try:
        jobs = teacher.call("POST", base + "/sources", {"source_note": "本地验收专用教学构造资料", "allow_derived": "true"}, files=[("files", (Path(h.name).name, h)) for h in handles])
    finally:
        for h in handles:
            h.close()
    for j in jobs:
        wait_job(j)
sources = teacher.call("GET", base + "/sources")
assert len(sources) == 5
assert all(s["parse_state"] == "ready" for s in sources)
passed("TXT HTML DOCX with table PPTX and Chinese scanned PDF parsed")
scan_source = next(s for s in sources if s["filename"] == "chinese-scan.pdf")
scan_detail = teacher.call("GET", base + "/sources/" + scan_source["id"])
assert any("边界" in f["body"] and f["quality"] == "needs_review" for f in scan_detail["fragments"])
passed("real Chinese OCR returned text and required human review")
source = next(s for s in sources if s["filename"] == "boundary.txt")
report["source_id"] = source["id"]
detail = teacher.call("GET", base + "/sources/" + source["id"])
fragment = next(f for f in detail["fragments"] if "17、18、19" in f["body"])
if not report.get("resource_id"):
    resource = teacher.call("POST", base + "/sources/" + source["id"] + "/publish", {"title": "边界值分析公开片段", "fragment_ids": [fragment["id"]], "full_source": False})
    checkpoint(resource_id=resource["id"])
resource = {"id": report["resource_id"]}
student.call("GET", base + "/sources/" + source["id"] + "/download", expected=403)
passed("partial publication denies full-file download")
index = teacher.call("POST", base + "/jobs", {"kind": "index"})
wait_job(index)
hits = student.call("POST", base + "/retrieval", {"query": "年龄范围边界值分析"})
assert hits["hits"] and hits["mode"] == "hybrid"
secret = student.call("POST", base + "/retrieval", {"query": "ALPHA_PRIVATE_731"})
assert all("ALPHA_PRIVATE_731" not in h["body"] for h in secret["hits"])
student.call("POST", base + "/retrieval", {"query": "评分", "purpose": "grading"}, expected=403)
passed("real dense+keyword retrieval filters private fragments and grading purpose")
qa = report.get("qa") or student.call("POST", base + "/assist", {"topic": "年龄18到60，为什么要测试17和61？"})
checkpoint(qa=qa)
assert qa.get("citations") and qa["status"] == "ai_draft"
passed("real grounded Q&A with exact source citations")
extract = {"id": report["extract_job_id"]} if report.get("extract_job_id") else teacher.call("POST", base + "/jobs", {"kind": "extract", "source_id": source["id"], "fragment_ids": [fragment["id"]]})
checkpoint(extract_job_id=extract["id"])
wait_job(extract)
knowledge = teacher.call("GET", base + "/knowledge")
k = next((v for v in knowledge if v["id"] == report.get("knowledge_id")), knowledge[0] if knowledge else None)
assert k
if k["state"] == "draft":
    assert student.call("GET", base + "/knowledge") == []
    k.update(student_visible=True, use_for_grading=True)
    teacher.call("PUT", base + "/knowledge/" + k["id"], k)
    teacher.call("POST", base + "/knowledge/" + k["id"] + "/state", {"state": "confirmed"})
checkpoint(knowledge_id=k["id"])
assert student.call("GET", base + "/knowledge")
passed("real knowledge candidates remain private until teacher edits and confirms")
assignment = {"id": report["assignment_id"]} if report.get("assignment_id") else teacher.call("POST", base + "/assignments", {"title": "RAG评阅验收", "questions": [{"prompt": "年龄仅接受18到60的整数，列出边界测试值、合法性分类和范围外测试目的。", "max_score": 10, "rubric": "按已确认标准评分", "resource_id": resource["id"]}]})
checkpoint(assignment_id=assignment["id"])
assignment_detail = teacher.call("GET", base + "/assignments/" + assignment["id"])
question = assignment_detail["questions"][0]
rubric_job = {"id": report["rubric_job_id"]} if report.get("rubric_job_id") else teacher.call("POST", base + "/jobs", {"kind": "rubric", "question_id": question["id"]})
checkpoint(rubric_job_id=rubric_job["id"])
rubric_job = wait_job(rubric_job)
rubric = {"id": report["rubric_id"]} if report.get("rubric_id") else teacher.call("POST", base + "/questions/" + question["id"] + "/rubrics", {"criteria": rubric_job["output"]["criteria"], "ai_job_id": rubric_job["id"]})
if not report.get("rubric_id"):
    teacher.call("POST", base + "/rubrics/" + rubric["id"] + "/confirm", {})
    checkpoint(rubric_id=rubric["id"])
if assignment_detail["assignment"]["status"] == "draft":
    teacher.call("POST", base + "/assignments/" + assignment["id"] + "/state", {"state": "published"})
submission = {"id": report["submission_id"]} if report.get("submission_id") else student.call("POST", base + "/assignments/" + assignment["id"] + "/submissions", {"question_id": question["id"], "answer_text": public, "request_id": str(uuid.uuid4())})
checkpoint(submission_id=submission["id"])
grade_job = {"id": report["grade_job_id"]} if report.get("grade_job_id") else teacher.call("POST", base + "/jobs", {"kind": "grade", "submission_id": submission["id"], "rubric_id": rubric["id"]})
checkpoint(grade_job_id=grade_job["id"])
grade_job = wait_job(grade_job)
grade = grade_job["output"]
revision = teacher.call("POST", base + "/submissions/" + submission["id"] + "/revisions", {"score": grade["score"], "feedback": grade["feedback"], "points": grade["points"], "rubric_id": rubric["id"], "ai_job_id": grade_job["id"], "request_id": str(uuid.uuid4())})
assert student.call("GET", base + "/submissions/" + submission["id"])["revisions"] == []
teacher.call("POST", base + "/revisions/" + revision["id"] + "/state", {"state": "confirmed"})
teacher.call("POST", base + "/revisions/" + revision["id"] + "/state", {"state": "released"})
assert student.call("GET", base + "/submissions/" + submission["id"])["revisions"][0]["score"] == grade["score"]
passed("real AI rubric and grading adopted, confirmed, released through existing teaching workflow")
teacher.call("POST", base + "/sources/" + source["id"] + "/archive", {})
archived = student.call("POST", base + "/retrieval", {"query": "边界值分析"})
assert all(h.get("source_id") != source["id"] and h.get("knowledge_id") != k["id"] for h in archived["hits"])
passed("archiving removes source and derived knowledge from future retrieval")
budget = teacher.call("GET", base + "/models")["budget"]
assert budget["spent_micro_cny"] + budget["reserved_micro_cny"] <= budget["limit_micro_cny"]
report["budget"] = budget
report["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
passed("shared model accounting remains within 50 CNY cap; historical grades retained")
