import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  SourcePage,
  Button,
  Panel,
  DataTable,
  Link,
  Notice,
  Empty,
  useLocalState,
} from "../ui";
import {
  assignments as initialAssignments,
  submissions as initialSubmissions,
  type Assignment,
  type Submission,
} from "../demo";

const statuses: Record<string, string> = {
  submitted: "已提交",
  graded: "已评分",
  pending: "待完成",
};
export function HomeworkPage() {
  const [assignments] = useLocalState<Assignment[]>(
    "assignments",
    initialAssignments,
  );
  const [submissions] = useLocalState<Submission[]>(
    "submissions",
    initialSubmissions,
  );
  const [tab, setTab] = useState("全部");
  const [courseFilter, setCourseFilter] = useState("");
  const [chapterFilter, setChapterFilter] = useState("");
  const navigate = useNavigate();
  const visible = assignments.filter(
    (a) =>
      a.status === "published" &&
      (!courseFilter || "course_big_data".includes(courseFilter)) &&
      (!chapterFilter || a.chapter.includes(chapterFilter)),
  );
  const status = (id: string) =>
    statuses[
      submissions.find((s) => s.assignmentId === id)?.status || "pending"
    ] || "已提交";
  const pending = visible.filter((a) => status(a.id) === "待完成").length;
  const graded = visible.filter((a) => status(a.id) === "已评分").length;
  return (
    <SourcePage name="StudentHomeworkView">
      <div className="homework-student-shell">
        <div className="student-homework-v2-header">
          <div>
            <h1>作业测验</h1>
            <p className="student-homework-v2-desc">
              统一处理作业、在线测验和学习证据回流。
            </p>
          </div>
          <Button onClick={() => navigate(0)}>刷新</Button>
        </div>
        <section className="student-assessment-workbench">
          <article className="card-panel student-assessment-primary">
            <div>
              <p className="eyebrow">下一步评测</p>
              <h2>
                {pending
                  ? "你有 " + pending + " 项作业待完成"
                  : "当前没有待提交作业，可按知识点补一次测验"}
              </h2>
              <p>如果某个知识点诊断依据不足，可以进入在线测验补充直接证据。</p>
            </div>
            <Link className="primary-link" to="/student/quiz">
              进入在线测验
            </Link>
          </article>
          <article className="card-panel student-assessment-evidence">
            <div className="section-head">
              <h2>证据回流</h2>
              <span className="student-assessment-evidence-pill">证据稳定</span>
            </div>
            <div className="student-assessment-evidence-grid">
              {[
                ["作业证据", graded + " 条已评分"],
                ["待完成", pending + " 项"],
                ["在线测验", "按知识点触发"],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <p>
              作业经教师评分后才作为正式评价证据；在线测验完成后会记录到诊断与个性化路径。
            </p>
          </article>
        </section>
        <div className="student-homework-v2-stats">
          {[
            ["全部作业", visible.length],
            ["待完成", pending],
            ["已提交", visible.length - pending - graded],
            ["已评分", graded],
            ["已逾期", 0],
          ].map(([label, value]) => (
            <div className="student-homework-v2-stat-item" key={label}>
              <div className="student-homework-v2-stat-value">{value}</div>
              <div className="student-homework-v2-stat-label">{label}</div>
            </div>
          ))}
        </div>
        <div className="student-homework-v2-filters">
          <input
            className="input input-inline"
            placeholder="课程ID筛选"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
          />
          <input
            className="input input-inline"
            placeholder="章节筛选"
            value={chapterFilter}
            onChange={(e) => setChapterFilter(e.target.value)}
          />
        </div>
        <div className="student-homework-v2-tabs">
          {["全部", "待完成", "已提交", "已评分", "已逾期"].map((t) => (
            <button
              key={t}
              className={
                "student-homework-v2-tab " + (tab === t ? "active" : "")
              }
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="student-homework-v2-list">
          {visible
            .filter((a) => tab === "全部" || status(a.id) === tab)
            .map((a) => (
              <div className="student-homework-v2-card" key={a.id}>
                <div className="student-homework-v2-card-header">
                  <div>
                    <div className="student-homework-v2-card-title">
                      {a.title}
                    </div>
                    <div className="student-homework-v2-card-meta">
                      {[
                        ["题型", a.type],
                        ["课程", "course_big_data"],
                        ["章节", a.chapter],
                        ["班级", "大数据2201"],
                        ["截止", a.deadline],
                        ["题目数", "1"],
                      ].map(([label, v]) => (
                        <span
                          className="student-homework-v2-meta-item"
                          key={label}
                        >
                          <span className="student-homework-v2-meta-label">
                            {label}：
                          </span>{" "}
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="student-homework-v2-card-actions">
                    <span
                      className={
                        "student-homework-v2-status status-" +
                        (status(a.id) === "已评分" ? "graded" : "submitted")
                      }
                    >
                      {status(a.id)}
                    </span>
                    <Button
                      onClick={() =>
                        navigate("/student/homework/" + a.id + "?tab=submit")
                      }
                    >
                      快速作答
                    </Button>
                    <Button
                      onClick={() => navigate("/student/homework/" + a.id)}
                    >
                      查看并提交
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          {!visible.filter((a) => tab === "全部" || status(a.id) === tab)
            .length && <Empty>暂无{tab}作业</Empty>}
        </div>
        <Panel title="我的提交记录">
          <DataTable
            headers={[
              "作业ID",
              "提交时间",
              "状态",
              "AI建议分",
              "教师终审分",
              "教师评语",
            ]}
            rows={submissions.map((s) => [
              s.assignmentId,
              s.submittedAt,
              s.status,
              s.aiScore ?? "-",
              s.status === "graded" ? (s.score ?? "-") : "-",
              s.status === "graded" ? s.comment || "-" : "-",
            ])}
          />
        </Panel>
      </div>
    </SourcePage>
  );
}
export function HomeworkDetail() {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const [assignments] = useLocalState<Assignment[]>(
    "assignments",
    initialAssignments,
  );
  const [submissions, setSubmissions] = useLocalState<Submission[]>(
    "submissions",
    initialSubmissions,
  );
  const [tab, setTab] = useState(
    params.get("tab") === "submit" ? "提交" : "查看",
  );
  const [answer, setAnswer] = useLocalState("draft-" + assignmentId, "");
  const [notice, setNotice] = useState("");
  const assignment = assignments.find(
    (a) => a.id === assignmentId && a.status === "published",
  );
  const history = submissions.filter((s) => s.assignmentId === assignmentId);
  const latest = history[0];
  const questions = (
    assignment as
      | (Assignment & { questions?: { title: string; content: string }[] })
      | undefined
  )?.questions;
  if (!assignment)
    return (
      <Panel title="作业不可见">
        <p>该作业尚未发布或不存在。</p>
        <Link to="/student/homework">返回列表</Link>
      </Panel>
    );
  const submit = () => {
    const s: Submission = {
      id: "sub-" + Date.now(),
      assignmentId: assignment.id,
      answer,
      status: "submitted",
      submittedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    setSubmissions([s, ...submissions]);
    setNotice("本地演示：作答已提交，等待教师确认评分。");
    setTab("结果");
  };
  return (
    <SourcePage name="StudentHomeworkDetailView">
      <div className="homework-detail-shell">
        <section className="card-panel">
          <div className="section-head">
            <h3>作业详情与提交</h3>
            <div className="actions-row">
              <Button onClick={() => window.location.reload()}>刷新</Button>
              <Link className="ghost-btn" to="/student/homework">
                返回列表
              </Link>
            </div>
          </div>
          <div className="summary-grid">
            {[
              ["标题", assignment.title],
              ["类型", assignment.type],
              ["满分", assignment.maxScore],
              ["截止", assignment.deadline],
              ["逾期", "允许"],
              ["状态", assignment.status],
            ].map(([k, v]) => (
              <div key={k}>
                <strong>{k}：</strong>
                {v}
              </div>
            ))}
          </div>
          <div className="tab-row">
            {["查看", "提交", "结果", "提交历史"].map((t) => (
              <button
                className={"tab-btn " + (tab === t ? "active" : "")}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {notice && <Notice>{notice}</Notice>}
          {tab === "查看" && (
            <section>
              <p className="multiline desc">
                ai_education_showcase_20260629
                演示作业，用于填充教师端和学生端作业数据。
              </p>
              {(questions?.length
                ? questions
                : [{ title: assignment.title, content: assignment.question }]
              ).map((q, i) => (
                <div className="question-card" key={i}>
                  <div className="section-head compact">
                    <strong>
                      题目 {i + 1}：{q.title}
                    </strong>
                  </div>
                  <p className="multiline">{q.content}</p>
                </div>
              ))}
            </section>
          )}
          {tab === "提交" && (
            <section>
              <div className="question-card">
                <strong>题目 1：{assignment.title}</strong>
                {(questions?.length
                  ? questions
                  : [{ title: assignment.title, content: assignment.question }]
                ).map((q, i) => (
                  <div key={i}>
                    <strong>
                      题目 {i + 1}：{q.title}
                    </strong>
                    <p>{q.content}</p>
                  </div>
                ))}
                <label>
                  <span>你的作答</span>
                  <textarea
                    rows={10}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="请输入答案，草稿自动保存在本机浏览器"
                  />
                </label>
              </div>
              <div className="actions-row">
                <Button onClick={() => setNotice("草稿已保存在当前浏览器。")}>
                  保存草稿
                </Button>
                <Button primary disabled={!answer.trim()} onClick={submit}>
                  提交作业
                </Button>
              </div>
            </section>
          )}
          {tab === "结果" &&
            (latest ? (
              <section className="question-card">
                <h3>
                  {latest.status === "graded"
                    ? "已评分"
                    : "已提交，等待教师评分"}
                </h3>
                <p>作答：{latest.answer}</p>
                {latest.status === "graded" ? (
                  <>
                    <p>
                      教师终审分：<strong>{latest.score}</strong> /{" "}
                      {assignment.maxScore}
                    </p>
                    <p>教师评语：{latest.comment || "暂无评语"}</p>
                  </>
                ) : (
                  <p>正式成绩将在教师确认并发布后显示。</p>
                )}
              </section>
            ) : (
              <Empty>暂无提交结果</Empty>
            ))}
          {tab === "提交历史" && (
            <DataTable
              headers={["提交时间", "状态", "作答", "教师终审分"]}
              rows={history.map((s) => [
                s.submittedAt,
                statuses[s.status] || "已提交",
                s.answer,
                s.status === "graded" ? (s.score ?? "-") : "-",
              ])}
            />
          )}
        </section>
      </div>
    </SourcePage>
  );
}
export function QuizPage() {
  const [params] = useSearchParams();
  const [quizzes] = useLocalState<
    {
      id: string;
      title: string;
      status: string;
      question: string;
      options: string[];
      correct: number;
      score: number;
      analysis: string;
    }[]
  >("teacherQuizzes", []);
  const quiz = quizzes.find(
    (q) => q.id === params.get("quizId") && q.status === "published",
  );
  const topic =
    quiz?.title ||
    params.get("topic") ||
    params.get("node") ||
    params.get("node_id") ||
    params.get("title");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState("");
  const [, saveResult] = useLocalState<
    { topic: string; score: number; time: string }[]
  >("quizResults", []);
  const questions = quiz
    ? [
        {
          title: quiz.question,
          options: quiz.options,
          correct: quiz.options[quiz.correct],
        },
      ]
    : [
        {
          title: "数据质量评估需要考虑哪些因素？",
          options: [
            "完整性、准确性与一致性",
            "只考虑记录数量",
            "只考虑存储成本",
          ],
          correct: "完整性、准确性与一致性",
        },
        {
          title: "打开学习资源是否等于已经掌握该知识点？",
          options: ["是", "否，需要结合学习过程与测验作业证据"],
          correct: "否，需要结合学习过程与测验作业证据",
        },
      ];
  const score =
    questions.filter((q, i) => answers[i] === q.correct).length *
    (100 / questions.length);
  return (
    <SourcePage name="page-course-content">
      <div className="quiz-shell">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Quiz</p>
            <h1>在线测验</h1>
            <p className="hero-desc">
              基于当前知识点自动生成测验题，完成后可以查看结果、生成总结，并衔接后续学习计划。
            </p>
          </div>
          <Link className="ghost-btn" to="/student/course-content">
            返回课程
          </Link>
        </section>
        {!topic ? (
          <Panel title="测验加载失败">
            <p>缺少测验主题，无法开始测验</p>
            {quizzes
              .filter((q) => q.status === "published")
              .map((q) => (
                <p key={q.id}>
                  <Link to={"/student/quiz?quizId=" + q.id}>
                    {q.title} · 教师发布测验
                  </Link>
                </p>
              ))}
            <Link className="ghost-btn" to="/student/course-content">
              返回课程
            </Link>
          </Panel>
        ) : (
          <Panel title={topic + " · 在线测验"}>
            <Notice>
              {quiz
                ? "本地演示：教师已发布的测验，结果仅保存在本机浏览器。"
                : "本地演示测验，使用固定样例题，未调用 AI。"}
            </Notice>
            {notice && <Notice>{notice}</Notice>}
            {done ? (
              <>
                <h2>测验结果：{score} / 100</h2>
                {questions.map((q, i) => (
                  <div className="question-card" key={q.title}>
                    <strong>{q.title}</strong>
                    <p>你的答案：{answers[i]}</p>
                    <p>参考答案：{q.correct}</p>
                  </div>
                ))}
                <div className="actions-row">
                  <Button
                    onClick={() => {
                      setNotice(
                        "本地总结：结合课程资料巩固完整性、准确性与一致性，使用测验和作业验证学习效果。",
                      );
                    }}
                  >
                    生成学习总结
                  </Button>
                  <Link className="primary-link" to="/student/learning">
                    查看后续学习计划
                  </Link>
                  <Button
                    onClick={() => {
                      setDone(false);
                      setAnswers({});
                    }}
                  >
                    重新作答
                  </Button>
                </div>
              </>
            ) : (
              <>
                {questions.map((q, i) => (
                  <div className="question-card" key={q.title}>
                    <h3>
                      题目 {i + 1}：{q.title}
                    </h3>
                    {q.options.map((o) => (
                      <label
                        style={{ display: "flex", gap: 8, margin: "12px 0" }}
                        key={o}
                      >
                        <input
                          type="radio"
                          name={"quiz-" + i}
                          checked={answers[i] === o}
                          onChange={() => setAnswers({ ...answers, [i]: o })}
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                ))}
                <Button
                  primary
                  disabled={Object.keys(answers).length < questions.length}
                  onClick={() => {
                    setDone(true);
                    saveResult((prev) => [
                      { topic, score, time: new Date().toISOString() },
                      ...prev,
                    ]);
                  }}
                >
                  提交测验
                </Button>
              </>
            )}
          </Panel>
        )}
      </div>
    </SourcePage>
  );
}
