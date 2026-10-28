import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Link,
  Modal,
  Notice,
  Panel,
  SourcePage,
  useLocalState,
} from "../ui";
import {
  assignments as initialAssignments,
  submissions as initialSubmissions,
  chapters,
  knowledge,
  type Assignment,
  type Submission,
} from "../demo";
import { Refresh, Table, TeacherHero, now, statusName, uid } from "./common";

interface Question {
  title: string;
  content: string;
  reference: string;
  rubric: string;
  options?: string;
  testCases?: string;
}
interface EditableAssignment extends Assignment {
  description?: string;
  rubric?: string;
  context?: string;
  className?: string;
  allowLate?: boolean;
  coverage?: string[];
  questions?: Question[];
}
const blankQuestion = (): Question => ({
  title: "",
  content: "",
  reference: "",
  rubric: "",
});
interface ClassSubmission extends Submission {
  student: string;
}
const classSubmissions: ClassSubmission[] = [
  {
    id: "class-liu",
    student: "刘一鸣",
    assignmentId: initialAssignments[0].id,
    answer: "识别缺失数据、重复数据和格式不一致，按业务规则清洗并验证。",
    status: "graded",
    aiScore: 74,
    score: 76,
    submittedAt: "2026/6/30 16:35:58",
  },
  {
    id: "class-zhao",
    student: "赵萌",
    assignmentId: initialAssignments[0].id,
    answer: "检查数据并清理错误记录。",
    status: "submitted",
    aiScore: 49,
    submittedAt: "2026/6/30 16:35:58",
  },
  {
    id: "class-chen",
    student: "陈曦",
    assignmentId: initialAssignments[0].id,
    answer: "结合业务目标识别、处理和验证数据质量问题，并保存处理记录。",
    status: "graded",
    aiScore: 80,
    score: 82,
    submittedAt: "2026/6/30 16:35:58",
  },
  {
    id: "class-wang",
    student: "王启宇",
    assignmentId: initialAssignments[0].id,
    answer: "删除重复值、补充缺失值并统一格式。",
    status: "graded",
    aiScore: 58,
    score: 60,
    submittedAt: "2026/6/30 16:35:58",
  },
];

export function HomeworkList() {
  const navigate = useNavigate();
  const [items, setItems] = useLocalState<EditableAssignment[]>(
    "assignments",
    initialAssignments,
  );
  const [view, setView] = useState<EditableAssignment>();
  const [close, setClose] = useState<EditableAssignment>();
  const [ai, setAi] = useState(false);
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("主观题");
  const [notice, setNotice] = useState("");
  function generate() {
    if (!topic.trim()) {
      setNotice("请先填写出题主题。");
      return;
    }
    const assignment: EditableAssignment = {
      id: uid("assignment"),
      title: `${topic}练习`,
      chapter: topic,
      type,
      status: "draft",
      question: `请结合课程资料说明${topic}的主要步骤，并举例解释。`,
      deadline: "",
      maxScore: 100,
      description: "本地示例草稿，请教师核对后发布。",
      rubric: "概念准确 40 分；流程完整 40 分；案例与解释 20 分。",
    };
    setItems((prev) => [...prev, assignment]);
    setAi(false);
    navigate(`/teacher/homework/${assignment.id}/edit`);
  }
  return (
    <SourcePage name="TeacherHomeworkListView">
      <div className="homework-shell">
        <section className="card-panel homework-hero">
          <div>
            <p className="eyebrow">作业中心</p>
            <h1>作业列表</h1>
            <p className="hero-desc">
              AI
              出题已提升为主入口，支持主观题/客观题/选择题/代码题并可快速弹窗创建。
            </p>
          </div>
          <div className="actions-row">
            <Button onClick={() => navigate("/teacher/homework/new")}>
              新建作业
            </Button>
            <Button
              className="emphasis"
              onClick={() => {
                setNotice("");
                setAi(true);
              }}
            >
              AI一键出题
            </Button>
          </div>
        </section>
        {notice && <Notice>{notice}</Notice>}
        <section className="card-panel ai-promo">
          <div>
            <h3>AI 智能出题</h3>
            <p className="muted">
              输入主题即可生成完整作业草稿，支持四种题型与可编辑题目结构。
            </p>
          </div>
          <div className="actions-row">
            <Button
              className="emphasis"
              onClick={() => {
                setNotice("");
                setAi(true);
              }}
            >
              立即生成草稿
            </Button>
          </div>
        </section>
        <Panel
          title="我的作业"
          extra={
            <Refresh
              onClick={() => setNotice("已读取当前浏览器中的作业记录。")}
            />
          }
        >
          <Table
            headers={[
              "标题",
              "类型",
              "状态",
              "课程",
              "章节",
              "班级",
              "题目数",
              "截止时间",
              "操作",
            ]}
            rows={items.map((item) => [
              item.title,
              item.type,
              statusName(item.status),
              "course_big_data",
              item.chapter || "-",
              item.className || "大数据2201",
              item.questions?.length || 1,
              item.deadline || "-",
              <div className="actions-cell">
                <Button small onClick={() => setView(item)}>
                  查看
                </Button>
                <Button
                  small
                  onClick={() => navigate(`/teacher/homework/${item.id}/edit`)}
                >
                  编辑
                </Button>
                <Button
                  small
                  onClick={() =>
                    navigate(`/teacher/homework/${item.id}/submissions`)
                  }
                >
                  批改
                </Button>
                {item.status === "draft" ? (
                  <Button
                    small
                    onClick={() => {
                      setItems((prev) =>
                        prev.map((a) =>
                          a.id === item.id ? { ...a, status: "published" } : a,
                        ),
                      );
                      setNotice("作业已在本地发布，可切换到学生端查看。");
                    }}
                  >
                    发布
                  </Button>
                ) : (
                  item.status === "published" && (
                    <Button small onClick={() => setClose(item)}>
                      关闭
                    </Button>
                  )
                )}
              </div>,
            ])}
          />
        </Panel>
        {view && (
          <Modal title="作业详情" onClose={() => setView(undefined)}>
            <div className="summary-grid">
              <p>标题：{view.title}</p>
              <p>类型：{view.type}</p>
              <p>状态：{statusName(view.status)}</p>
              <p>满分：{view.maxScore}</p>
              <p>截止：{view.deadline || "未设置"}</p>
              <p>章节：{view.chapter}</p>
            </div>
            <p className="multiline">
              {view.description ||
                "ai_education_showcase_20260629 演示作业，用于填充教师端和学生端作业数据。"}
            </p>
            <h3>题目 1：{view.title}</h3>
            <p>{view.question}</p>
            <Link to={`/teacher/homework/${view.id}/submissions`}>
              查看学生提交
            </Link>
          </Modal>
        )}
        {close && (
          <Modal
            title="关闭作业"
            onClose={() => setClose(undefined)}
            footer={
              <>
                <Button onClick={() => setClose(undefined)}>取消</Button>
                <Button
                  onClick={() => {
                    setItems((prev) =>
                      prev.map((a) =>
                        a.id === close.id ? { ...a, status: "closed" } : a,
                      ),
                    );
                    setClose(undefined);
                    setNotice("作业已在本地关闭。");
                  }}
                >
                  确认关闭
                </Button>
              </>
            }
          >
            <p>确认关闭“{close.title}”？学生将不能继续提交此作业。</p>
          </Modal>
        )}
        {ai && (
          <Modal
            title="AI 智能出题"
            onClose={() => setAi(false)}
            footer={
              <>
                <Button onClick={() => setAi(false)}>取消</Button>
                <Button className="emphasis" onClick={generate}>
                  生成草稿
                </Button>
              </>
            }
          >
            <Notice>
              当前为本地固定规则示例，不调用真实模型；生成内容需教师审核。
            </Notice>
            <label className="full-width">
              出题主题
              <input
                className="input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="请输入知识点或主题"
              />
            </label>
            <label className="full-width">
              题型
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {["主观题", "客观题", "选择题", "代码题"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {notice && <Notice>{notice}</Notice>}
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

export function HomeworkEdit() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useLocalState<EditableAssignment[]>(
    "assignments",
    initialAssignments,
  );
  const original = items.find((a) => a.id === assignmentId);
  const [form, setForm] = useState<EditableAssignment>(
    () =>
      original || {
        id: uid("assignment"),
        title: "",
        chapter: "",
        type: "主观题",
        status: "draft",
        question: "",
        deadline: "",
        maxScore: 100,
        className: "",
        allowLate: false,
        coverage: [],
      },
  );
  const [questions, setQuestions] = useState<Question[]>(
    () =>
      original?.questions || [
        original
          ? {
              title: original.title,
              content: original.question,
              reference: "",
              rubric: original.rubric || "",
            }
          : blankQuestion(),
      ],
  );
  const [notice, setNotice] = useState("");
  const [ai, setAi] = useState(false);
  function patch(p: Partial<EditableAssignment>) {
    setForm((prev) => ({ ...prev, ...p }));
  }
  function questionPatch(index: number, p: Partial<Question>) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, ...p } : q)),
    );
  }
  function save(status: string) {
    if (
      !form.title.trim() ||
      !questions.length ||
      questions.some((q) => !q.content.trim()) ||
      form.maxScore <= 0
    ) {
      setNotice("请填写作业标题与正数满分，至少保留一道题，并填写题目要求。");
      return;
    }
    const next = {
      ...form,
      status,
      question: questions[0].content,
      questions,
      deadline: form.deadline.replace("T", " "),
    };
    setItems((prev) =>
      prev.some((a) => a.id === next.id)
        ? prev.map((a) => (a.id === next.id ? next : a))
        : [...prev, next],
    );
    navigate("/teacher/homework");
  }
  const coverage = [
    "大数据平台与工具 > SparkMLlib",
    "大数据平台与工具 > 大数据三层架构",
    "数据存储系统 > 数据资产",
    "数据存储系统 > 数据建模与访问 > ACID与BASE模型",
    "大数据应用与挑战 > 商务智能演变 > BI商务智能报告",
    "大数据基础概念 > 大数据生命周期与应用 > DIKW金字塔模型",
    "大数据平台与工具 > TensorFlow > EagerExecution",
    "数据获取 > 数据采集 > ETL(Extract,Transform,Load)",
    "大数据基础概念 > 大数据基本概念 > IT的发展历程",
    "大数据工程实践 > 数据接入 > Kafka 数据接入",
    ...knowledge,
  ];
  return (
    <SourcePage name="TeacherHomeworkEditView">
      <div className="homework-edit-shell">
        <section className="card-panel">
          <div className="section-head">
            <h3>{assignmentId ? "编辑作业" : "新建作业"}</h3>
            <div className="actions-row">
              <Button onClick={() => navigate("/teacher/homework")}>
                返回列表
              </Button>
            </div>
          </div>
          {notice && <Notice>{notice}</Notice>}
          <div className="form-grid">
            <label>
              作业标题
              <input
                className="input"
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label>
              班级
              <select
                className="input"
                value={form.className || ""}
                onChange={(e) => patch({ className: e.target.value })}
              >
                <option value="">未指定班级</option>
                <option>大数据2201</option>
              </select>
            </label>
            <label>
              课程ID
              <select className="input">
                <option>course_big_data</option>
              </select>
            </label>
            <label>
              关联章节
              <select
                className="input"
                value={form.chapter}
                onChange={(e) => patch({ chapter: e.target.value })}
              >
                <option value="">不关联章节</option>
                {[
                  ...chapters,
                  "日志数据清洗",
                  "数据采集流程",
                  "Kafka 数据接入",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              作业类型
              <select
                className="input"
                value={form.type}
                onChange={(e) => patch({ type: e.target.value })}
              >
                {["主观题", "客观题", "选择题", "代码题", "混合题"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              截止时间
              <input
                className="input"
                type="datetime-local"
                value={
                  form.deadline.includes("/")
                    ? ""
                    : form.deadline.replace(" ", "T")
                }
                onChange={(e) => patch({ deadline: e.target.value })}
              />
            </label>
            <label>
              满分
              <input
                className="input"
                type="number"
                min="1"
                value={form.maxScore}
                onChange={(e) => patch({ maxScore: Number(e.target.value) })}
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={!!form.allowLate}
                onChange={(e) => patch({ allowLate: e.target.checked })}
              />
              允许逾期提交
            </label>
          </div>
          <label className="full-width">
            作业简介
            <textarea
              className="input input-textarea"
              rows={3}
              value={form.description || ""}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <label className="full-width">
            评分标准
            <textarea
              className="input input-textarea"
              rows={3}
              value={form.rubric || ""}
              onChange={(e) => patch({ rubric: e.target.value })}
            />
          </label>
          <label className="full-width">
            章节上下文（用于AI出题）
            <textarea
              className="input input-textarea"
              rows={3}
              placeholder="可粘贴本章节重点、教学要求、能力目标等"
              value={form.context || ""}
              onChange={(e) => patch({ context: e.target.value })}
            />
          </label>
          <section className="coverage-panel full-width">
            <div className="coverage-head">
              <div>
                <strong>教师确认覆盖知识点</strong>
                <p>
                  不勾选时，本作业只作为章节综合实践能力证据；勾选后，结果才会作为对应叶子知识点的辅助证据。
                </p>
              </div>
              <Button
                small
                disabled={!form.chapter}
                onClick={() => patch({ coverage: [...knowledge] })}
              >
                选中关联章节下叶子点
              </Button>
            </div>
            <div className="coverage-grid">
              {coverage.map((v) => (
                <label className="coverage-option" key={v}>
                  <input
                    type="checkbox"
                    checked={form.coverage?.includes(v) || false}
                    onChange={(e) =>
                      patch({
                        coverage: e.target.checked
                          ? [...(form.coverage || []), v]
                          : form.coverage?.filter((k) => k !== v),
                      })
                    }
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </section>
          <div className="section-head section-gap">
            <h3>题目列表</h3>
            <Button
              onClick={() => setQuestions((prev) => [...prev, blankQuestion()])}
            >
              新增题目
            </Button>
          </div>
          {questions.map((q, index) => (
            <div className="question-card" key={index}>
              <div className="section-head compact">
                <strong>题目 {index + 1}</strong>
                <Button
                  small
                  onClick={() =>
                    setQuestions((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  删除
                </Button>
              </div>
              <label className="full-width">
                题目标题
                <input
                  className="input"
                  value={q.title}
                  onChange={(e) =>
                    questionPatch(index, { title: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                题目要求
                <textarea
                  className="input input-textarea"
                  rows={4}
                  value={q.content}
                  onChange={(e) =>
                    questionPatch(index, { content: e.target.value })
                  }
                />
              </label>
              {form.type === "选择题" && (
                <label className="full-width">
                  选项（每行一项）
                  <textarea
                    className="input input-textarea"
                    rows={4}
                    placeholder="A. 选项一&#10;B. 选项二"
                    value={q.options || ""}
                    onChange={(e) =>
                      questionPatch(index, { options: e.target.value })
                    }
                  />
                </label>
              )}
              {form.type === "代码题" && (
                <div className="testcase-panel full-width">
                  <strong>测试用例</strong>
                  <label className="full-width">
                    输入 / 预期输出
                    <textarea
                      className="input"
                      rows={3}
                      placeholder="输入：...&#10;预期输出：..."
                      value={q.testCases || ""}
                      onChange={(e) =>
                        questionPatch(index, { testCases: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              <label className="full-width">
                参考答案
                <textarea
                  className="input input-textarea"
                  rows={3}
                  value={q.reference}
                  onChange={(e) =>
                    questionPatch(index, { reference: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                评分点
                <textarea
                  className="input input-textarea"
                  rows={3}
                  value={q.rubric}
                  onChange={(e) =>
                    questionPatch(index, { rubric: e.target.value })
                  }
                />
              </label>
            </div>
          ))}
          <div className="actions-row section-gap">
            <Button onClick={() => setAi(true)}>AI 草稿</Button>
            <Button onClick={() => save("draft")}>保存草稿</Button>
            <Button onClick={() => save("published")}>保存并发布</Button>
          </div>
        </section>
        {ai && (
          <Modal
            title="AI 草稿 · 本地示例"
            onClose={() => setAi(false)}
            footer={
              <>
                <Button onClick={() => setAi(false)}>取消</Button>
                <Button
                  onClick={() => {
                    const title = form.title || form.chapter || "数据质量评估";
                    patch({ title });
                    setQuestions([
                      {
                        title,
                        content: `请说明${title}的主要步骤，并结合课程内容分析一个案例。`,
                        reference:
                          "明确目标与数据来源，检查完整性、一致性和准确性，给出处理方案并验证。",
                        rubric:
                          "概念准确 40 分，流程完整 40 分，案例解释 20 分。",
                      },
                    ]);
                    setAi(false);
                    setNotice("已填入固定规则示例，未调用模型，请教师核查。");
                  }}
                >
                  填入示例草稿
                </Button>
              </>
            }
          >
            <p>
              根据当前标题和章节填写本地示例题目，使用前请核查题目、答案与评分点。
            </p>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

export function HomeworkSubmissions() {
  const { assignmentId } = useParams();
  const [items] = useLocalState<Assignment[]>(
    "assignments",
    initialAssignments,
  );
  const [records] = useLocalState<Submission[]>(
    "submissions",
    initialSubmissions,
  );
  const [classRecords] = useLocalState<ClassSubmission[]>(
    "classSubmissions",
    classSubmissions,
  );
  const assignment = items.find((a) => a.id === assignmentId);
  const [notice, setNotice] = useState("");
  const ownRows = records
    .filter((r) => r.assignmentId === assignmentId)
    .map((r) => ({ ...r, student: "曾懿涵" }));
  const rows = [
    ...classRecords.slice(0, 2).filter((r) => r.assignmentId === assignmentId),
    ...ownRows,
    ...classRecords.slice(2).filter((r) => r.assignmentId === assignmentId),
  ];
  return (
    <SourcePage name="TeacherHomeworkSubmissionsView">
      <div className="homework-submissions-shell">
        <Panel
          title="提交列表"
          extra={
            <div className="actions-row">
              <Refresh onClick={() => setNotice("已读取本地提交记录。")} />
              <Link className="ghost-btn" to="/teacher/homework">
                返回作业列表
              </Link>
            </div>
          }
        >
          {notice && <Notice>{notice}</Notice>}
          <p>
            <strong>作业：</strong>
            {assignment?.title || assignmentId} | 大数据2201
          </p>
          <Table
            headers={["学生", "提交时间", "状态", "AI建议分", "终审分", "操作"]}
            rows={rows.map((r) => [
              r.student,
              r.submittedAt,
              r.status,
              r.aiScore ?? "-",
              r.score ?? "-",
              <Link
                className="ghost-btn small"
                to={`/teacher/homework/submissions/${r.id}/grade`}
              >
                批改详情
              </Link>,
            ])}
            empty="暂无学生提交"
          />
        </Panel>
      </div>
    </SourcePage>
  );
}

export function HomeworkGrade() {
  const { submissionId } = useParams();
  const [records, setRecords] = useLocalState<Submission[]>(
    "submissions",
    initialSubmissions,
  );
  const [classRecords, setClassRecords] = useLocalState<ClassSubmission[]>(
    "classSubmissions",
    classSubmissions,
  );
  const [items] = useLocalState<EditableAssignment[]>(
    "assignments",
    initialAssignments,
  );
  const recordId =
    submissionId === "30466247a5c448e091e9c5c9f413de33"
      ? "sub-clean"
      : submissionId;
  const record =
    records.find((r) => r.id === recordId) ||
    classRecords.find((r) => r.id === recordId);
  const assignment = items.find((a) => a.id === record?.assignmentId);
  const [score, setScore] = useState(record?.score?.toString() || "");
  const [comment, setComment] = useState(record?.comment || "");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!record || !assignment)
    return (
      <Panel title="提交不存在">
        <Link to="/teacher/homework">返回作业列表</Link>
      </Panel>
    );
  function release() {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, score: Number(score), comment, status: "graded" }
          : r,
      ),
    );
    setClassRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, score: Number(score), comment, status: "graded" }
          : r,
      ),
    );
    setConfirm(false);
    setNotice("教师评分已在本地确认发布，学生端可查看正式反馈。");
  }
  return (
    <SourcePage name="TeacherHomeworkGradeView">
      <div className="homework-grade-shell">
        <Panel
          title="批改详情"
          extra={
            <div className="actions-row">
              <Refresh
                onClick={() => setNotice("已读取本地作答与终审记录。")}
              />
              <Link
                className="ghost-btn"
                to={`/teacher/homework/${assignment.id}/submissions`}
              >
                返回提交列表
              </Link>
            </div>
          }
        >
          {notice && <Notice>{notice}</Notice>}
          <div className="summary-grid">
            <div>
              <strong>作业：</strong>
              {assignment.title}
            </div>
            <div>
              <strong>学生：</strong>
              {"student" in record && typeof record.student === "string"
                ? record.student
                : "曾懿涵"}
            </div>
            <div>
              <strong>题型：</strong>
              {assignment.type}
            </div>
            <div>
              <strong>提交时间：</strong>
              {record.submittedAt}
            </div>
            <div>
              <strong>状态：</strong>
              {record.status}
            </div>
            <div>
              <strong>满分：</strong>
              {assignment.maxScore}
            </div>
          </div>
          <div className="question-card">
            <p>
              <strong>题目 1：{assignment.title}</strong>
            </p>
            <p className="multiline">{assignment.question}</p>
            <label className="full-width">学生作答</label>
            <div className="answer-box multiline">
              {record.answer || "（该题未作答）"}
            </div>
          </div>
          <section className="card-panel inner-panel">
            <div className="section-head">
              <h3>AI 辅助批改</h3>
              <Button
                onClick={() =>
                  setNotice(
                    "本地演示不执行模型评分，请依据题目标准和学生原始作答人工评分。",
                  )
                }
              >
                生成 AI 建议
              </Button>
            </div>
            <p>
              <strong>AI建议分：</strong>
              {record.aiScore ?? "-"}
            </p>
            <p>
              <strong>AI评语：</strong>
            </p>
            <div className="answer-box multiline">
              {record.aiScore !== undefined
                ? "历史示例初评：结构完整，需补充细节。"
                : "暂无 AI 建议。"}
            </div>
          </section>
          <section className="card-panel inner-panel">
            <div className="section-head">
              <h3>教师终审</h3>
              <Button
                disabled={record.aiScore === undefined}
                onClick={() => {
                  setScore(String(record.aiScore));
                  setComment("结构完整，需补充细节。");
                  setNotice("已将历史示例建议填入待审核表单，尚未发布成绩。");
                }}
              >
                采用 AI 建议
              </Button>
            </div>
            <div className="form-grid">
              <label>
                终审分数
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={assignment.maxScore}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                />
              </label>
            </div>
            <label className="full-width">
              终审评语
              <textarea
                className="input input-textarea"
                rows={5}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <div className="actions-row">
              <Button
                onClick={() => {
                  if (
                    score === "" ||
                    Number(score) < 0 ||
                    Number(score) > assignment.maxScore
                  )
                    setNotice(`请输入 0–${assignment.maxScore} 之间的分数。`);
                  else setConfirm(true);
                }}
              >
                保存终审结果
              </Button>
            </div>
          </section>
        </Panel>
        {confirm && (
          <Modal
            title="确认发布教师评分"
            onClose={() => setConfirm(false)}
            footer={
              <>
                <Button onClick={() => setConfirm(false)}>取消</Button>
                <Button onClick={release}>确认并发布</Button>
              </>
            }
          >
            <p>将 {score} 分及评语发布到学生端。此操作仅更新本地演示记录。</p>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

interface Quiz {
  id: string;
  title: string;
  course: string;
  status: string;
  question: string;
  options: string[];
  correct: number;
  score: number;
  analysis: string;
  createdAt: string;
  updatedAt: string;
}
export function QuizList() {
  const [quizzes, setQuizzes] = useLocalState<Quiz[]>("teacherQuizzes", []);
  const [edit, setEdit] = useState<Quiz>();
  const [detail, setDetail] = useState<Quiz>();
  const [ai, setAi] = useState(false);
  const [topic, setTopic] = useState("");
  const [notice, setNotice] = useState("");
  const create = (title = "") => ({
    id: uid("quiz"),
    title,
    course: "course_big_data",
    status: "draft",
    question: "",
    options: ["", "", "", ""],
    correct: 0,
    score: 100,
    analysis: "",
    createdAt: now(),
    updatedAt: now(),
  });
  function save() {
    if (
      !edit?.title.trim() ||
      !edit.question.trim() ||
      edit.options.some((o) => !o.trim()) ||
      edit.score <= 0
    ) {
      setNotice("请填写测验标题、题干、全部选项和正数分值。");
      return;
    }
    setQuizzes((prev) =>
      prev.some((q) => q.id === edit.id)
        ? prev.map((q) =>
            q.id === edit.id ? { ...edit, updatedAt: now() } : q,
          )
        : [...prev, edit],
    );
    setEdit(undefined);
    setNotice("测验草稿已保存到本地。");
  }
  return (
    <SourcePage name="TeacherQuizListView">
      <div className="quiz-shell">
        <TeacherHero
          eyebrow="测验中心"
          title="测验列表"
          description="集中查看本课程下的全部测验，支持按主题快速 AI 生成测验草稿，发布后学生即可参与作答。"
        >
          <Refresh onClick={() => setNotice("已读取本地测验记录。")} />
          <Button
            onClick={() => {
              setNotice("");
              setEdit(create());
            }}
          >
            新建测验
          </Button>
          <Button
            className="emphasis"
            onClick={() => {
              setNotice("");
              setAi(true);
            }}
          >
            AI 一键出题
          </Button>
        </TeacherHero>
        {notice && <Notice>{notice}</Notice>}
        <Panel
          title="全部测验"
          extra={<span className="muted">共 {quizzes.length} 条</span>}
        >
          <Table
            headers={[
              "ID",
              "标题",
              "课程",
              "状态",
              "题目数",
              "总分",
              "创建时间",
              "更新时间",
              "操作",
            ]}
            rows={quizzes.map((q) => [
              <span className="cell-id">{q.id.slice(-8)}</span>,
              q.title,
              q.course,
              <span className={`status-chip chip-${q.status}`}>
                {statusName(q.status)}
              </span>,
              1,
              q.score,
              q.createdAt,
              q.updatedAt,
              <div className="actions-cell">
                <Button small onClick={() => setDetail(q)}>
                  查看
                </Button>
                <Button small onClick={() => setEdit(q)}>
                  编辑
                </Button>
                <Button
                  small
                  onClick={() => {
                    setQuizzes((prev) =>
                      prev.map((item) =>
                        item.id === q.id
                          ? {
                              ...item,
                              status:
                                q.status === "published"
                                  ? "closed"
                                  : "published",
                              updatedAt: now(),
                            }
                          : item,
                      ),
                    );
                    setNotice(
                      q.status === "published"
                        ? "测验已在本地关闭。"
                        : "测验已在本地发布。",
                    );
                  }}
                >
                  {q.status === "published" ? "关闭" : "发布"}
                </Button>
              </div>,
            ])}
            empty={
              <div className="quiz-empty">
                <span className="quiz-empty-icon">🧪</span>
                <p>暂无测验</p>
                <p className="muted">
                  点击右上角「新建测验」或「AI 一键出题」创建测验
                </p>
              </div>
            }
          />
        </Panel>
        {ai && (
          <Modal
            title="AI 一键出题"
            onClose={() => setAi(false)}
            footer={
              <>
                <Button onClick={() => setAi(false)}>取消</Button>
                <Button
                  onClick={() => {
                    if (!topic.trim()) {
                      setNotice("请输入主题。");
                      return;
                    }
                    setEdit({
                      ...create(`${topic}测验`),
                      question: `关于${topic}，下列哪项做法更符合数据质量要求？`,
                      options: [
                        "先检查完整性和一致性，再进行后续分析",
                        "忽略缺失值直接分析",
                        "随机删除一半记录",
                        "将所有异常值改为零",
                      ],
                      analysis:
                        "分析前应核查数据质量，并保留可追踪的处理记录。",
                    });
                    setAi(false);
                    setNotice("已填入本地固定示例，未调用真实模型。");
                  }}
                >
                  生成示例草稿
                </Button>
              </>
            }
          >
            <Notice>本地示例仅演示出题流程，不调用模型。</Notice>
            <label className="quiz-edit-field">
              出题主题
              <input
                className="quiz-edit-control"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
          </Modal>
        )}
        {edit && (
          <Modal
            title={
              quizzes.some((q) => q.id === edit.id) ? "编辑测验" : "新建测验"
            }
            onClose={() => setEdit(undefined)}
            footer={
              <>
                <Button onClick={() => setEdit(undefined)}>取消</Button>
                <Button onClick={save}>保存草稿</Button>
              </>
            }
          >
            <div className="quiz-edit-body">
              {notice && <Notice>{notice}</Notice>}
              <label className="quiz-edit-field">
                测验标题
                <input
                  className="quiz-edit-control"
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              <label className="quiz-edit-field">
                课程
                <select className="quiz-edit-control">
                  <option>course_big_data</option>
                </select>
              </label>
              <label className="quiz-edit-field">
                题目内容
                <textarea
                  className="quiz-edit-control"
                  rows={4}
                  value={edit.question}
                  onChange={(e) =>
                    setEdit({ ...edit, question: e.target.value })
                  }
                />
              </label>
              <div className="quiz-edit-options-head">
                <strong>选项与正确答案</strong>
              </div>
              {edit.options.map((option, index) => (
                <div className="quiz-edit-option" key={index}>
                  <span className="quiz-edit-option-key">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <input
                    className="quiz-edit-option-input"
                    value={option}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        options: edit.options.map((v, i) =>
                          i === index ? e.target.value : v,
                        ),
                      })
                    }
                  />
                  <label className="quiz-edit-correct">
                    <input
                      type="radio"
                      name="correct"
                      checked={edit.correct === index}
                      onChange={() => setEdit({ ...edit, correct: index })}
                    />
                    正确
                  </label>
                </div>
              ))}
              <label className="quiz-edit-field">
                分值
                <input
                  className="quiz-edit-control"
                  type="number"
                  min="1"
                  value={edit.score}
                  onChange={(e) =>
                    setEdit({ ...edit, score: Number(e.target.value) })
                  }
                />
              </label>
              <label className="quiz-edit-field">
                解析
                <textarea
                  className="quiz-edit-control"
                  rows={3}
                  value={edit.analysis}
                  onChange={(e) =>
                    setEdit({ ...edit, analysis: e.target.value })
                  }
                />
              </label>
            </div>
          </Modal>
        )}
        {detail && (
          <Modal title={detail.title} onClose={() => setDetail(undefined)}>
            <div className="quiz-question-list">
              <article className="quiz-question-card">
                <div className="quiz-question-head">
                  <span className="quiz-question-no">第 1 题</span>
                  <span>选择题 · {detail.score} 分</span>
                </div>
                <p className="quiz-question-content">{detail.question}</p>
                <ul className="quiz-option-list">
                  {detail.options.map((o, i) => (
                    <li
                      key={i}
                      className={`quiz-option ${i === detail.correct ? "is-correct" : ""}`}
                    >
                      <span className="quiz-option-key">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="quiz-option-text">{o}</span>
                      {i === detail.correct && (
                        <span className="quiz-option-correct">正确答案</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="quiz-question-analysis">
                  解析：{detail.analysis || "暂无解析"}
                </p>
              </article>
            </div>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}
