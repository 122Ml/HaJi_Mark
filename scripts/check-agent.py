"""Local real-model harness acceptance. Keeps labelled data and checkpoints.

Requires --real-model for paid calls. Never targets production or resets budgets.
Approval responses are limited to the explicit operation whitelist for each phase.
"""
import argparse
import json
import time
import uuid
from pathlib import Path

import requests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", default="http://127.0.0.1:18080")
parser.add_argument("--accounts", default=".local/s1-accounts.json")
parser.add_argument("--output", default=".local/agent-acceptance.json")
parser.add_argument("--phase", choices=["import", "content", "questions", "rubric-correction", "assignment", "grading", "student", "verify"], required=True)
parser.add_argument("--real-model", action="store_true")
parser.add_argument("--retry-phase", action="store_true", help="Archive a stopped/finished attempt before an explicit paid recheck")
parser.add_argument("--resume-run", action="store_true", help="Explicitly resume the saved failed model checkpoint; successful writes are not replayed")
args = parser.parse_args()
assert args.base.startswith(("http://127.0.0.1:", "http://localhost:")), "Local acceptance only"
assert args.phase == "verify" or args.real_model, "Paid acceptance requires --real-model"
assert not (args.retry_phase and args.resume_run), "Choose either new attempt or checkpoint resume"
accounts = {v["username"]: v for v in json.loads(Path(args.accounts).read_text(encoding="utf-8"))["accounts"]}
target = Path(args.output)
report = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {"started_at": time.strftime("%Y-%m-%d %H:%M:%S"), "checks": [], "phases": {}, "snapshots": {}}


def save(**changes):
    report.update(changes)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def passed(message):
    if message not in report["checks"]:
        report["checks"].append(message)
    if args.phase in report["phases"]:
        report["phases"][args.phase]["finished"] = True
    save()
    print("PASS", message, flush=True)


class Client:
    def __init__(self, name):
        self.session = requests.Session()
        self.session.trust_env = False
        self.csrf = ""
        self.csrf = self.call("POST", "/sessions", {"username": name, "password": accounts[name]["password"]})["csrf_token"]

    def response(self, method, path, body=None, files=None):
        return self.session.request(method, args.base + "/api/v1" + path,
                                    json=body if files is None else None, data=body if files else None,
                                    files=files, headers={"Origin": args.base, "X-CSRF-Token": self.csrf}, timeout=120)

    def call(self, method, path, body=None, files=None, expected=200):
        r = self.response(method, path, body, files)
        assert r.status_code == expected, f"{method} {path}: {r.status_code}: {r.text[:600]}"
        return r.json().get("data") if "json" in r.headers.get("Content-Type", "") else r.content


teacher = Client("s1-teacher")
student = Client("s1-student-a")
if not report.get("course_id"):
    assert args.phase == "import", "Start with import"
    course = teacher.call("POST", "/learning/courses", {"title": "Agent真实闭环验收 " + time.strftime("%m%d-%H%M")})
    save(course_id=course["id"])
    teacher.call("POST", "/learning/courses/" + course["id"] + "/members", {"username": "s1-student-a"})
    teacher.call("POST", "/learning/courses/" + course["id"] + "/publish", {})
base = "/learning/courses/" + report["course_id"]
agent = base + "/agent"
status = teacher.call("GET", agent + "/status")
assert status["configured"]
profile = next(p["id"] for p in status["profiles"] if p["available"])
corrected_rules = {
    "D1": "明确选取17、18、19、59、60、61作为测试输入，每个目标值1分；重复不重复计分；其他取值不额外扣分；唯一对应目标值的等价表达可计分，笼统描述不补算。仅查取值覆盖，分类错误不在本维扣分。",
    "D2": "范围内合法、范围外非法分别判定，各1分。已列范围内值说明为合法得1分，已列范围外值说明为非法得1分；未列具体值但明确说范围内合法或范围外非法也可得对应1分；某类错误或自相矛盾仅使该类不得分，不抹去另一类正确证据；未说明不补推。",
    "D3": "明确说明测试范围外输入是为了检查系统是否拒绝超范围输入得2分，否则0分；不设1分档；主张应接受范围外输入得0分。",
}
if "budget_before" not in report:
    save(budget_before=teacher.call("GET", base + "/models")["budget"])
if args.retry_phase and args.phase in report["phases"]:
    old = report["phases"][args.phase]
    owner = student if args.phase == "student" else teacher
    snapshot = owner.call("GET", agent + "/conversations/" + old["conversation_id"])
    run = next(r for r in snapshot["runs"] if r["id"] == old["run_id"])
    assert run["state"] in ("failed", "unknown", "canceled", "succeeded"), "Stop active attempt explicitly before recheck"
    report.setdefault("attempts", []).append({"phase": args.phase, "record": old, "snapshot": snapshot})
    del report["phases"][args.phase]
    save()


def conversation(name, client=teacher, mode="auto-review"):
    field = name + "_conversation"
    if not report.get(field):
        save(**{field: client.call("POST", agent + "/conversations", {"title": "验收 · " + name, "mode": mode, "profile_id": profile})["id"]})
    return report[field]


def run_phase(name, conv, prompt, allowed=(), attachments=(), client=teacher):
    phase = report["phases"].get(name)
    if not phase:
        phase = {"request_id": str(uuid.uuid4()), "prompt": prompt, "conversation_id": conv}
        report["phases"][name] = phase
        save()
    if "run_id" not in phase:
        phase.update(client.call("POST", agent + "/conversations/" + conv + "/messages", {"content": phase["prompt"], "request_id": phase["request_id"], "attachment_ids": list(attachments)}))
        save()
    elif args.resume_run:
        previous = client.call("GET", agent + "/conversations/" + conv)
        saved = next(r for r in previous["runs"] if r["id"] == phase["run_id"])
        assert saved["can_resume"], "Saved run cannot resume safely"
        phase.setdefault("resumes", []).append({"at": time.strftime("%Y-%m-%d %H:%M:%S"), "previous_state": saved["state"], "previous_error": saved["error"]})
        save()
        client.call("POST", agent + "/runs/" + phase["run_id"] + "/resume", {})
    previous = ""
    last_print = 0.0
    for _ in range(420):
        snapshot = client.call("GET", agent + "/conversations/" + conv)
        report["snapshots"][name] = snapshot
        save()
        run = next(r for r in snapshot["runs"] if r["id"] == phase["run_id"])
        phase["state"] = run["state"]
        steps = [s for s in snapshot["steps"] if s["run_id"] == run["id"]]
        state = f"{name}: {run['state']}, steps={len(steps)}" + (f", last={steps[-1]['tool']}:{steps[-1]['state']}" if steps else "")
        if state != previous or time.monotonic() - last_print > 25:
            print(state, flush=True)
            previous, last_print = state, time.monotonic()
        if run["state"] == "succeeded":
            phase["run_finished"] = True
            save()
            return snapshot
        assert run["state"] not in ("failed", "unknown", "canceled"), run.get("error")
        for request in snapshot["requests"]:
            if request["run_id"] != run["id"] or request["state"] != "pending":
                continue
            values = {}
            if request["kind"] == "input":
                answers = {"source_note": "本地验收专用、教师自编教学构造资料", "allow_derived": "允许"} if name == "import" else {"context": "软件测试中的边界值分析", "age_range": "仅接受18到60（含）的整数", "source_hint": "本课程已发布的边界值分析资料"} if name == "student" else {}
                assert answers, "Unexpected input: " + request["prompt"]
                for f in request["fields"]:
                    assert f["key"] in answers, "Unexpected field: " + f["key"]
                    values[f["key"]] = answers[f["key"]]
            else:
                action = request["snapshot"]["tool"]
                assert action in allowed, "Unexpected approval: " + action
                params = request["snapshot"]["arguments"]
                if action == "source_import":
                    assert params["attachment_id"] == report["attachment_id"] and params["allow_derived"] is True
                if action == "assignment_state":
                    assert params["state"] == "published"
                if action == "grade_state":
                    assert params["state"] in ("confirmed", "released")
                if name == "rubric-correction" and action == "rubric_confirm":
                    rubrics = teacher.call("GET", base + "/question-bank/versions/" + report["bank_version_id"] + "/rubrics")
                    proposed = next(r for r in rubrics if r["id"] == params["id"])
                    assert proposed["id"] != report["rubric_id"], "Do not alter or reconfirm the historical standard"
                    assert {c["id"]: c["rule"] for c in proposed["criteria"]} == corrected_rules, "Correction did not preserve teacher-supplied rules verbatim"
                    assert {c["id"]: c["max_score"] for c in proposed["criteria"]} == {"D1": 6, "D2": 2, "D3": 2}
                    assert all(not c.get("partial_credit") and not c.get("error_conditions") for c in proposed["criteria"]), "No extra scoring rules allowed in correction"
            response = client.response("POST", agent + "/requests/" + request["id"] + "/respond", {"decision": "approve", "values": values})
            assert response.status_code in (200, 409), response.text[:600]
            if response.status_code == 200:
                print("REVIEW", request["kind"], request["prompt"], flush=True)
        time.sleep(2)
    raise AssertionError("Run timeout; saved checkpoint and live operation retained")


def sources():
    return teacher.call("GET", base + "/sources") or []


if args.phase == "import":
    conv = conversation("materials")
    if not report.get("attachment_id"):
        content = """# 边界值分析
年龄输入仅接受18到60的整数。边界测试应选择17、18、19、59、60、61。
18、19、59、60是合法年龄；17和61不合法，但仍应作为范围外测试输入。
测试17和61的目的是检查系统是否拒绝超出允许范围的输入。
测试值覆盖、有效性分类、范围外测试目的应分别评价，分类错误不影响测试值覆盖得分。
本文件为本地验收用教师自编资料，不含真实学生信息。
"""
        fixture = Path(".local/agent-boundary.txt")
        fixture.write_text(content, encoding="utf-8")
        with fixture.open("rb") as f:
            a = teacher.call("POST", agent + "/conversations/" + conv + "/attachments", files={"file": (fixture.name, f, "text/plain")})
        save(attachment_id=a["id"])
    result = run_phase("import", conv, "帮我导入附件并完成解析，先不要发布或提炼。导入前请用问题卡收集两个必填项：source_note（文本来源说明）、allow_derived（单选，允许/不允许，指是否授权后续提炼）。收到回答后执行，不要仅描述步骤，等待解析任务完成后核对原文。", ("source_import",), [report["attachment_id"]])
    src = next(s for s in sources() if s["filename"] == "agent-boundary.txt")
    assert src["parse_state"] == "ready" and src["allow_derived"]
    detail = teacher.call("GET", base + "/sources/" + src["id"])
    assert any("17、18、19、59、60、61" in f["body"] for f in detail["fragments"])
    assert any(r["kind"] == "input" and r["state"] == "answered" for r in result["requests"])
    assert student.call("GET", base + "/resources") in (None, [])
    save(source_id=src["id"])
    passed("Real model delegation, input card, approved attachment import and worker parsing; original remains private")

elif args.phase == "content":
    run_phase("content", conversation("materials"), f"处理已导入原件{report['source_id']}：先查询知识列表，如本来源已有合适的知识草稿则复用，否则调用知识提炼后台任务并等待完成。用source_publish将该知识引用的原片段发布为学习资料（保留原文），不能用resource_create复制正文替代。选择其中一条边界值分析知识，设置学生可见、用于学习和评分，确认该知识。仅限本原件，所有正式操作交审批卡，不创建重复原件。", ("source_publish", "resource_publish", "knowledge_update", "knowledge_state"))
    resources = student.call("GET", base + "/resources")
    entries = student.call("GET", base + "/knowledge")
    assert resources and entries
    knowledge = next(k for k in entries if k["state"] == "confirmed" and k["use_for_learning"] and k["use_for_grading"])
    save(resource_id=resources[0]["id"], knowledge_id=knowledge["id"])
    passed("Real extraction, separate learning material publication and confirmed knowledge visible to student")

elif args.phase == "questions":
    snapshot = run_phase("questions", conversation("questions"), f"根据原件{report['source_id']}及知识{report['knowledge_id']}出一道10分主观题：18到60整数年龄边界测试，要求列六个测试值、判断合法性并说明范围外测试目的。先用question_evidence取得精确依据ID，必须新建question_generate后台任务生成题目、参考解答、评分标准，等待真实任务成功后按候选保存，保存时带该任务ai_job_id；失败时报告问题，不能自行编写或复用旧题替代本次任务。分别提交题目、参考解答和评分标准确认卡。不得读取学生作答。只允许整数评分：覆盖六值各1分共6分；范围内合法1分、范围外非法1分共2分；拒绝超范围目的明确2分否则0分；各维独立，分类错误不扣覆盖分。", ("question_confirm", "reference_confirm", "rubric_confirm"))
    steps = [s for s in snapshot["steps"] if s["run_id"] == report["phases"]["questions"]["run_id"]]
    generated = next(s for s in steps if s["tool"] == "question_generate" and s["state"] == "succeeded")
    job_id = generated["result"]["response"]["data"]["id"]
    assert teacher.call("GET", base + "/jobs/" + job_id)["state"] == "succeeded"
    created = next(s for s in steps if s["tool"] == "question_create" and s["state"] == "succeeded" and s["arguments"].get("ai_job_id") == job_id)
    version = teacher.call("GET", base + "/question-bank/versions/" + created["result"]["response"]["data"]["id"])
    assert version["state"] == "confirmed" and version["reference_state"] == "confirmed"
    rubrics = teacher.call("GET", base + "/question-bank/versions/" + version["id"] + "/rubrics")
    rubric = next(r for r in rubrics if r["state"] == "confirmed")
    assert sum(c["max_score"] for c in rubric["criteria"]) == 10
    save(bank_version_id=version["id"], rubric_id=rubric["id"])
    passed("Real AI question/reference/rubric generation saved with evidence and three separate approvals")

elif args.phase == "rubric-correction":
    criteria = [{"id": key, "title": title, "max_score": score, "rule": corrected_rules[key]} for key, title, score in [("D1", "测试值覆盖", 6), ("D2", "有效性分类", 2), ("D3", "范围外测试目的", 2)]]
    snapshot = run_phase("rubric-correction", conversation("questions"), f"教师更正标准：题目版本{report['bank_version_id']}原有标准的部分分描述不符合指定口径。保留原标准和题目、参考解答，使用rubric_create另建该题目的新标准版本，不读取任何学生作答，不重新生成题目。下列criteria是教师给定的完整标准，逐字保留rule，不添加partial_credit、error_conditions等额外给分条件，不附会AI生成任务。保存后提交rubric_confirm审批：" + json.dumps(criteria, ensure_ascii=False), ("rubric_confirm",))
    created = next(s for s in snapshot["steps"] if s["run_id"] == report["phases"]["rubric-correction"]["run_id"] and s["tool"] == "rubric_create" and s["state"] == "succeeded")
    rubric = created["result"]["response"]["data"]
    old = {k: report.get(k) for k in ("rubric_id", "assignment_id", "question_id", "submission_id")}
    save(original_test_binding=old, rubric_id=rubric["id"])
    passed("Teacher-supplied correction creates a new standard with exact 6/2/2 rules; historical binding retained")

elif args.phase == "assignment":
    title = "Agent闭环作业（标准修订）" if report.get("original_test_binding") else "Agent闭环作业"
    snapshot = run_phase("assignment", conversation("assessment"), f"创建并发布一道题的主观题作业，标题{title}。必须引用题库确认版本{report['bank_version_id']}及对应标准{report['rubric_id']}，不复制改写题目，不另建标准。先创建草稿，发布交审批卡。", ("assignment_state",))
    created = next(s for s in snapshot["steps"] if s["run_id"] == report["phases"]["assignment"]["run_id"] and s["tool"] == "assignment_create" and s["state"] == "succeeded")
    assignment = created["result"]["response"]["data"]
    detail = teacher.call("GET", base + "/assignments/" + assignment["id"])
    question = detail["questions"][0]
    assert question["bank_question_version_id"] == report["bank_version_id"]
    assert question["bound_rubric_id"] == report["rubric_id"]
    visible = student.call("GET", base + "/assignments/" + assignment["id"])["questions"][0]
    assert not visible["bank_question_version_id"] and not visible["bound_rubric_id"]
    submission = student.call("POST", base + "/assignments/" + assignment["id"] + "/submissions", {"question_id": question["id"], "answer_text": "测试17、18、19、59、60、61。18、19、59、60合法，17和61非法。测试17和61是为了检查系统是否拒绝超出允许范围的输入。", "request_id": str(uuid.uuid4())})
    save(assignment_id=assignment["id"], question_id=question["id"], submission_id=submission["id"])
    passed("Agent-created assignment fixes bank version/rubric; real student submitted against published question")

elif args.phase == "grading":
    run_phase("grading", conversation("assessment"), f"评阅作业{report['assignment_id']}中的提交{report['submission_id']}。按绑定标准{report['rubric_id']}调用AI评分任务并等待，核对逐字证据、分数加和后保存带ai_job_id的逐点修订草稿，教师确认与正式发布分别交审批卡；完成后导出正式反馈CSV。不得变更题目或标准。", ("grade_state",))
    evidence = student.call("GET", base + "/evidence")
    assert any(e["submission_id"] == report["submission_id"] and e["score"] == 10 for e in evidence)
    snapshot = report["snapshots"]["grading"]
    exported = next(a for a in snapshot["attachments"] if a["kind"] == "export")
    path = agent + "/conversations/" + report["assessment_conversation"] + "/attachments/" + exported["id"] + "/file"
    body = teacher.call("GET", path)
    assert report["submission_id"] in body.decode("utf-8-sig")
    student.call("GET", path, expected=404)
    save(export_id=exported["id"])
    passed("Real AI grading, evidence-checked revision, separate confirmation/release, student feedback and private CSV")

elif args.phase == "student":
    run_phase("student", conversation("student", student), "为什么范围外的年龄也需要测试？请依据已发布的资料回答并保留可核对引用。", client=student)
    snapshot = report["snapshots"]["student"]
    answers = [s["result"]["response"]["data"] for s in snapshot["steps"] if s["run_id"] == report["phases"]["student"]["run_id"] and s["tool"] == "course_answer" and s["state"] == "succeeded"]
    assert answers and answers[-1]["status"] == "ai_draft" and answers[-1]["citations"], "Must use the verified-citation answer endpoint, not unvalidated synthesis"
    assert all(any(c["id"] == hit["id"] and c["quote"] in hit["body"] for hit in answers[-1]["sources"]) for c in answers[-1]["citations"])
    assert not any(s["tool"] in ("sources_list", "source_import", "question_create", "grade_state") for s in snapshot["steps"])
    passed("Student dialogue uses grounded answer tool and cannot access teacher operation tools")

elif args.phase == "verify":
    assert all(report["phases"].get(p, {}).get("finished") for p in ("import", "content", "questions", "assignment", "grading", "student"))
    for name, phase in report["phases"].items():
        owner = student if name == "student" else teacher
        current = owner.call("GET", agent + "/conversations/" + phase["conversation_id"])
        run = next(r for r in current["runs"] if r["id"] == phase["run_id"])
        assert run["state"] == "succeeded", f"Persisted {name} run did not succeed"
        saved = report["snapshots"][name]
        for collection in ("messages", "steps", "requests", "attachments"):
            assert {row["id"] for row in saved[collection]} <= {row["id"] for row in current[collection]}, f"Lost {name} {collection}"
        phase["state"] = run["state"]
        phase["run_finished"] = True
    detail = teacher.call("GET", base + "/assignments/" + report["assignment_id"])
    question = next(q for q in detail["questions"] if q["id"] == report["question_id"])
    assert question["bank_question_version_id"] == report["bank_version_id"] and question["bound_rubric_id"] == report["rubric_id"]
    if report.get("original_test_binding"):
        rubrics = teacher.call("GET", base + "/question-bank/versions/" + report["bank_version_id"] + "/rubrics")
        corrected = next(r for r in rubrics if r["id"] == report["rubric_id"])
        assert {c["id"]: c["rule"] for c in corrected["criteria"]} == corrected_rules
        old = report["original_test_binding"]
        assert any(r["id"] == old["rubric_id"] for r in rubrics), "Historical standard disappeared"
        previous = teacher.call("GET", base + "/assignments/" + old["assignment_id"])
        assert next(q for q in previous["questions"] if q["id"] == old["question_id"])["bound_rubric_id"] == old["rubric_id"]
    assert teacher.call("GET", base + "/sources/" + report["source_id"])["source"]["parse_state"] == "ready"
    assert any(k["id"] == report["knowledge_id"] for k in student.call("GET", base + "/knowledge"))
    assert any(e["submission_id"] == report["submission_id"] and e["score"] == 10 for e in student.call("GET", base + "/evidence"))
    export_path = agent + "/conversations/" + report["assessment_conversation"] + "/attachments/" + report["export_id"] + "/file"
    assert report["submission_id"] in teacher.call("GET", export_path).decode("utf-8-sig")
    student.call("GET", export_path, expected=404)
    other = Client("s1-teacher-other")
    other.call("GET", agent + "/conversations", expected=403)
    student.call("GET", agent + "/conversations/" + report["assessment_conversation"], expected=404)
    passed("Persisted conversations/cards/receipts, fixed and historical standards, formal feedback/export and owner/course isolation rechecked after restart")

budget = teacher.call("GET", base + "/models")["budget"]
assert budget["spent_micro_cny"] + budget["reserved_micro_cny"] <= budget["limit_micro_cny"]
save(budget_after=budget, last_phase=args.phase, last_checked_at=time.strftime("%Y-%m-%d %H:%M:%S"))
print("BUDGET", {k: budget[k] for k in ("limit_micro_cny", "spent_micro_cny", "reserved_micro_cny")}, flush=True)
