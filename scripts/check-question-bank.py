"""Local HTTP acceptance of reusable questions and fixed rubric versions.

Creates labelled records and retains them. --real-ai uses the configured provider
and shared model budget. Confirmations here are automated test-actor operations.
"""
import argparse
import copy
import json
from pathlib import Path
import time
import uuid
import sys

import requests

sys.stdout.reconfigure(encoding="utf-8")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--real-ai", action="store_true")
parser.add_argument("--resume", action="store_true")
parser.add_argument("--continue-real", action="store_true", help="Resume final checks after a successful real grading job without new model calls")
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:18080"
OUTPUT = ROOT / ".local/question-bank-check.json"
accounts = {a["username"]: a for a in json.loads((ROOT / ".local/s1-accounts.json").read_text(encoding="utf-8"))["accounts"]}
report = {"started_at": time.strftime("%Y-%m-%d %H:%M:%S"), "checks": [], "real_ai": args.real_ai}


def uid():
    return str(uuid.uuid4())


def save(**values):
    report.update(values)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def passed(name, condition=True):
    assert condition, name
    report["checks"].append(name)
    save()
    print("PASS", name, flush=True)


class Client:
    def __init__(self, name):
        self.session = requests.Session()
        self.session.trust_env = False
        self.csrf = ""
        self.csrf = self.call("POST", "/sessions", {"username": name, "password": accounts[name]["password"]})["csrf_token"]

    def call(self, method, path, body=None, status=200, files=None):
        r = self.session.request(method, BASE + "/api/v1" + path,
            json=body if files is None else None, data=body if files else None, files=files,
            headers={"Origin": BASE, "X-CSRF-Token": self.csrf}, timeout=115)
        r.encoding = "utf-8"
        assert r.status_code == status, f"{method} {path}: expected {status}, got {r.status_code}: {r.text[:800]}"
        return r.json().get("data") if r.content else None


t, student, other = [Client("s1-" + name) for name in ("teacher", "student-a", "teacher-other")]


def wait(job):
    save(last_job_id=job["id"], last_job_kind=job["kind"])
    previous = ""
    for _ in range(150):
        current = t.call("GET", p + "/jobs/" + job["id"])
        if current["state"] != previous:
            print(current["kind"], current["state"], flush=True)
            previous = current["state"]
        if current["state"] == "succeeded":
            return current
        if current["state"] in ("failed", "canceled"):
            save(failed_job=current)
            raise AssertionError(current.get("error"))
        time.sleep(2)
    raise AssertionError("job timeout")


def finish_real_checks():
    grading = t.call("GET", p + "/jobs/" + report["ai_grade_job_id"])
    assert grading["state"] == "succeeded"
    submission_id = grading["input"]["submission_id"]
    feedback = student.call("GET", p + "/submissions/" + submission_id)["revisions"][0]
    passed("real generated question reaches AI grading and released student feedback", feedback["ai_job_id"] == grading["id"] and feedback["rubric_id"] == report["ai_rubric_id"])
    t.call("POST", p + "/sources/" + report["source_id"] + "/archive", {})
    t.call("POST", p + "/assignments", {"title": "Archived-source use must fail", "type": "subjective", "questions": [{"bank_question_version_id": report["ai_version_id"], "bound_rubric_id": report["ai_rubric_id"]}]}, 422)
    passed("archived source blocks future use without erasing released feedback", bool(student.call("GET", p + "/submissions/" + submission_id)["revisions"]))
    save(ai_submission_id=submission_id, budget_after=t.call("GET", p + "/models")["budget"])


try:
    if args.continue_real:
        report.update(json.loads(OUTPUT.read_text(encoding="utf-8")))
        report.pop("error", None)
        p = "/learning/courses/" + report["course_id"]
        finish_real_checks()
        save(finished_at=time.strftime("%Y-%m-%d %H:%M:%S"))
    elif args.resume:
        report.update(json.loads(OUTPUT.read_text(encoding="utf-8")))
        p = "/learning/courses/" + report["course_id"]
        fixed = t.call("GET", p + "/assignments/" + report["assignment_id"])["questions"][0]
        released = student.call("GET", p + "/submissions/" + report["submission_id"])["revisions"][0]
        passed("restart retained fixed question, rubric and released feedback", fixed["bound_rubric_id"] == report["rubric_id"] == released["rubric_id"])
        passed("restart retained all bank versions", len(t.call("GET", p + "/question-bank/" + report["bank_id"])["versions"]) == 2)
        if report.get("ai_submission_id"):
            ai_feedback = student.call("GET", p + "/submissions/" + report["ai_submission_id"])["revisions"][0]
            passed("restart retained generated question, real grading job and released feedback", ai_feedback["ai_job_id"] == report["ai_grade_job_id"] and ai_feedback["rubric_id"] == report["ai_rubric_id"] and t.call("GET", p + "/question-bank/versions/" + report["ai_version_id"])["state"] == "confirmed")
            save(budget_final=t.call("GET", p + "/models")["budget"])
    else:
        course = t.call("POST", "/learning/courses", {"title": "题库本地验收 " + time.strftime("%m%d-%H%M%S")})
        p = "/learning/courses/" + course["id"]
        save(course_id=course["id"])
        t.call("POST", p + "/members", {"username": "s1-student-a"})
        t.call("POST", p + "/publish", {})
        body = {"title": "整数边界测试", "prompt": "允许年龄18至60的整数输入，请列出边界测试值、分类并说明范围外测试目的。", "type": "subjective", "max_score": 10, "reference_answer": "17、18、19、59、60、61；范围内合法，范围外非法，测试其拒绝行为。"}
        criteria = [{"id": "D1", "title": "测试值覆盖", "max_score": 6, "rule": "17、18、19、59、60、61各1分。"}, {"id": "D2", "title": "合法性分类", "max_score": 2, "rule": "范围内合法1分，范围外非法1分。"}, {"id": "D3", "title": "范围外目的", "max_score": 2, "rule": "说明检查拒绝超范围输入得2分。"}]
        student.call("GET", p + "/question-bank", status=403)
        other.call("POST", p + "/question-bank", body, status=403)
        csrf = t.csrf; t.csrf = ""
        t.call("POST", p + "/question-bank", body, status=403)
        t.csrf = csrf
        passed("bank roles, course ownership and CSRF enforced")
        v = t.call("POST", p + "/question-bank", body)
        save(bank_id=v["bank_id"], question_version_id=v["id"])
        passed("bank question exists before any assignment or answer", v["state"] == v["reference_state"] == "draft" and v["version"] == 1)
        vp = p + "/question-bank/versions/" + v["id"]
        bad = copy.deepcopy(criteria); bad[0]["max_score"] = 5
        t.call("POST", vp + "/rubrics", {"criteria": bad}, 422)
        bad = copy.deepcopy(criteria); bad[0]["evidence_ids"] = ["forged"]
        t.call("POST", vp + "/rubrics", {"criteria": bad}, 422)
        t.call("POST", p + "/question-bank", {**body, "evidence_ids": ["forged"]}, 422)
        passed("invalid score totals and forged source IDs rejected")
        r = t.call("POST", vp + "/rubrics", {"criteria": criteria})
        save(rubric_id=r["id"])
        t.call("POST", p + "/rubrics/" + r["id"] + "/confirm", {}, 422)
        t.call("POST", vp + "/confirm", {})
        t.call("POST", p + "/rubrics/" + r["id"] + "/confirm", {}, 422)
        t.call("POST", vp + "/reference/confirm", {})
        t.call("POST", p + "/rubrics/" + r["id"] + "/confirm", {})
        t.call("POST", vp + "/confirm", {}, 409)
        t.call("POST", p + "/rubrics/" + r["id"] + "/confirm", {}, 409)
        passed("question, reference and rubric require separate confirmations")

        def assignment(version=v, rubric=r, title="固定版本作业", status=200):
            return t.call("POST", p + "/assignments", {"title": title, "type": "subjective", "questions": [{"bank_question_version_id": version["id"], "bound_rubric_id": rubric["id"] if rubric else "", "prompt": "篡改题干", "max_score": 1, "rubric": "篡改标准"}]}, status)

        assignment(rubric=None, status=422)
        first = assignment()
        second = assignment(title="同题另一份作业")
        save(assignment_id=first["id"], second_assignment_id=second["id"])
        q = t.call("GET", p + "/assignments/" + first["id"])["questions"][0]
        save(question_id=q["id"])
        passed("assignment ignores client-tampered prompt and score", q["prompt"] == body["prompt"] and q["max_score"] == 10 and q["bound_rubric_id"] == r["id"])
        passed("same bank version can be used by two assignments", len(t.call("GET", p + "/question-bank/" + v["bank_id"])["uses"]) == 2)
        t.call("POST", p + "/questions/" + q["id"] + "/rubrics", {"criteria": criteria}, 422)
        passed("assignment instance cannot create a drifting rubric")
        t.call("POST", p + "/assignments/" + first["id"] + "/state", {"state": "published"})
        student_q = student.call("GET", p + "/assignments/" + first["id"])["questions"][0]
        passed("student question response hides rules and internal binding", not student_q["rubric"] and not student_q["correct_answer"] and not student_q["bound_rubric_id"] and not student_q["bank_question_version_id"])
        s = student.call("POST", p + "/assignments/" + first["id"] + "/submissions", {"question_id": q["id"], "answer_text": "测试17、18、19、59、60、61，这六个年龄都合法，系统应该全部接受。", "request_id": uid()})
        save(submission_id=s["id"])
        points = [{"criterion_id": "D1", "score": 6, "feedback": "六个值覆盖完整。", "quote": "测试17、18、19、59、60、61"}, {"criterion_id": "D2", "score": 1, "feedback": "范围外值被误判合法。", "quote": "这六个年龄都合法"}, {"criterion_id": "D3", "score": 0, "feedback": "应检查拒绝行为。", "quote": "系统应该全部接受"}]
        grade = {"rubric_id": r["id"], "points": points, "score": 7, "feedback": "取值完整，分类和目的需修正。", "request_id": uid()}
        sp = p + "/submissions/" + s["id"]
        t.call("POST", sp + "/revisions", {"score": 7, "feedback": "绕过标准", "request_id": uid()}, 422)
        revision = t.call("POST", sp + "/revisions", grade)
        passed("student cannot read draft feedback", student.call("GET", sp)["revisions"] == [])
        t.call("POST", p + "/revisions/" + revision["id"] + "/state", {"state": "released"}, 409)
        for state in ("confirmed", "released"):
            t.call("POST", p + "/revisions/" + revision["id"] + "/state", {"state": state})
        passed("fixed rubric grading reaches released student feedback", student.call("GET", sp)["revisions"][0]["score"] == 7)
        r2 = t.call("POST", vp + "/rubrics", {"criteria": criteria})
        t.call("POST", p + "/rubrics/" + r2["id"] + "/confirm", {})
        t.call("POST", sp + "/revisions", {**grade, "rubric_id": r2["id"], "request_id": uid()}, 422)
        t.call("POST", p + "/jobs", {"kind": "grade", "submission_id": s["id"], "rubric_id": r2["id"]}, 422)
        t.call("POST", p + "/jobs", {"kind": "rubric", "question_id": q["id"]}, 422)
        passed("manual and AI grading cannot switch away from fixed rubric")
        v2 = t.call("POST", p + "/question-bank/" + v["bank_id"] + "/versions", {**body, "max_score": 12, "title": "边界测试12分版"})
        assignment(version=v2, status=422)
        t.call("POST", p + "/question-bank/versions/" + v2["id"] + "/rubrics", {"criteria": criteria}, 422)
        passed("score change creates a new draft and requires a matching rubric", v2["version"] == 2)
        fixed = t.call("GET", p + "/assignments/" + first["id"])["questions"][0]
        passed("new question and rubric versions preserve old assignments and results", fixed["max_score"] == 10 and fixed["bound_rubric_id"] == r["id"] and student.call("GET", sp)["revisions"][0]["rubric_id"] == r["id"])
        t.call("POST", p + "/question-bank/" + v["bank_id"] + "/archive", {"archived": True})
        assignment(status=422)
        t.call("POST", p + "/assignments/" + second["id"] + "/state", {"state": "published"}, 422)
        replay = t.call("POST", sp + "/revisions", {**grade, "request_id": uid()})
        passed("archive blocks new use and publication but preserves historical grading", replay["rubric_id"] == r["id"])
        t.call("POST", p + "/question-bank/" + v["bank_id"] + "/archive", {"archived": False})
        t.call("POST", p + "/assignments/" + second["id"] + "/state", {"state": "published"})
        quiz = t.call("POST", p + "/question-bank", {"title": "单选题", "prompt": "选择合法年龄", "type": "quiz", "max_score": 2, "options": ["17", "18"], "correct_answer": "18"})
        t.call("POST", p + "/question-bank/versions/" + quiz["id"] + "/confirm", {})
        qa = t.call("POST", p + "/assignments", {"title": "题库客观题", "type": "quiz", "questions": [{"bank_question_version_id": quiz["id"]}]})
        t.call("POST", p + "/assignments/" + qa["id"] + "/state", {"state": "published"})
        qq = student.call("GET", p + "/assignments/" + qa["id"])["questions"][0]
        qs = student.call("POST", p + "/assignments/" + qa["id"] + "/submissions", {"question_id": qq["id"], "answer_text": "18", "request_id": uid()})
        passed("bank objective question retains deterministic answer-rule grading", student.call("GET", p + "/submissions/" + qs["id"])["revisions"][0]["score"] == 2)

        if args.real_ai:
            save(budget_before=t.call("GET", p + "/models")["budget"])
            text = "边界值分析用于检查输入边界附近的行为。系统只接受18至60的整数年龄，测试17、18、19、59、60、61。18、19、59、60合法，17和61非法。测试范围外值是为了检查系统拒绝超范围输入。"
            jobs = t.call("POST", p + "/sources", {"source_note": "题库真实联调构造资料", "allow_derived": "true"}, files=[("files", ("question-bank-boundary.txt", text.encode("utf-8"), "text/plain"))])
            for job in jobs: wait(job)
            source = t.call("GET", p + "/sources")[0]
            save(source_id=source["id"])
            wait(t.call("POST", p + "/jobs", {"kind": "index"}))
            hits = t.call("POST", p + "/question-bank/evidence", {"source_id": source["id"]})["hits"]
            passed("teacher can choose indexed original-source evidence", bool(hits))
            ids = [hits[0]["id"]]
            gen = wait(t.call("POST", p + "/question-bank/jobs", {"kind": "question_generate", "profile_id": "bailian-qwen", "requirements": "依据所选资料出一道18到60整数年龄的边界测试题，要求列值、合法性分类与范围外目的。评分依次6、2、2分，满分10分。", "max_score": 10, "count": 1, "evidence_ids": ids}))
            save(generate_job_id=gen["id"], generated_output=gen["output"])
            candidate = gen["output"]["questions"][0]
            ai_v = t.call("POST", p + "/question-bank", {**candidate, "type": "subjective", "max_score": 10, "evidence_ids": ids})
            save(ai_bank_id=ai_v["bank_id"], ai_version_id=ai_v["id"])
            ai_r = t.call("GET", p + "/question-bank/versions/" + ai_v["id"] + "/rubrics")[0]
            passed("real AI produces question, reference and rubric as separate drafts", ai_v["state"] == ai_v["reference_state"] == ai_r["state"] == "draft")
            for suffix in ("/confirm", "/reference/confirm"):
                t.call("POST", p + "/question-bank/versions/" + ai_v["id"] + suffix, {})
            t.call("POST", p + "/rubrics/" + ai_r["id"] + "/confirm", {})
            for kind in ("question_analyze", "bank_rubric"):
                job = wait(t.call("POST", p + "/question-bank/jobs", {"kind": kind, "question_id": ai_v["id"], "evidence_ids": ids}))
                save(**{kind + "_job_id": job["id"]})
                passed("real provider completed " + kind, job["output"]["review_status"] == "pending_teacher_review")
            aa = assignment(ai_v, ai_r, "真实AI题库全链路")
            save(ai_assignment_id=aa["id"], ai_rubric_id=ai_r["id"])
            t.call("POST", p + "/assignments/" + aa["id"] + "/state", {"state": "published"})
            aq = student.call("GET", p + "/assignments/" + aa["id"])["questions"][0]
            submission = student.call("POST", p + "/assignments/" + aa["id"] + "/submissions", {"question_id": aq["id"], "answer_text": text, "request_id": uid()})
            grading = wait(t.call("POST", p + "/jobs", {"kind": "grade", "submission_id": submission["id"], "rubric_id": ai_r["id"]}))
            save(ai_grade_job_id=grading["id"])
            g = grading["output"]
            revision = t.call("POST", p + "/submissions/" + submission["id"] + "/revisions", {"score": g["score"], "feedback": g["feedback"], "points": g["points"], "rubric_id": ai_r["id"], "ai_job_id": grading["id"], "request_id": uid()})
            for state in ("confirmed", "released"):
                t.call("POST", p + "/revisions/" + revision["id"] + "/state", {"state": state})
            finish_real_checks()
        save(finished_at=time.strftime("%Y-%m-%d %H:%M:%S"))
except Exception as error:
    save(error=str(error))
    raise
finally:
    for cl in (t, student, other): cl.call("DELETE", "/sessions/current", status=204)
print("PASS", len(report["checks"]), "question-bank checks")
