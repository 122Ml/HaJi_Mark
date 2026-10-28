import type { Point, Resource } from "./course";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../shared/session";
import {
  useLearning,
  useLiveQuery,
  useAction,
  Feedback,
  names,
  when,
} from "./context";
export interface Assignment {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  version: number;
  max_score: number;
  due_at: string | null;
}
export interface Question {
  knowledge_point_id?: string;
  resource_id?: string;
  id: string;
  prompt: string;
  type: string;
  max_score: number;
  rubric: string;
  options: string[];
}
export interface Submission {
  id: string;
  assignment_id: string;
  question_id: string;
  student_id: string;
  student_name: string;
  answer_text: string;
  answer_sha256: string;
  attempt: number;
  status: string;
  submitted_at: string;
  assignment_version: number;
}
export interface Revision {
  id: string;
  score: number;
  feedback: string;
  state: string;
  revision: number;
  method: string;
  released_at: string | null;
}
export function AssignmentList({ quiz = false }: { quiz?: boolean }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const root = teacher ? "teacher" : "student";
  const query = useLiveQuery<Assignment[]>("/assignments");
  const action = useAction();
  const list = (query.data || []).filter((a) =>
    quiz ? a.type === "quiz" : a.type !== "quiz",
  );
  return (
    <div className="live-page">
      <header className="live-heading">
        <p>{quiz ? "测验中心" : "作业中心"}</p>
        <h1>{quiz ? "测验列表" : teacher ? "作业列表" : "作业测验"}</h1>
        <span>
          {teacher
            ? "创建题目和评分依据，发布后收集学生原始作答。"
            : "查看已发布任务，提交作答并查询正式反馈。"}
        </span>
        {teacher && (
          <Link
            className="primary-link"
            to={quiz ? "/teacher/quiz/new" : "/teacher/homework/new"}
          >
            {quiz ? "新建测验" : "新建作业"}
          </Link>
        )}
      </header>
      <Feedback error={query.error} message={action.message} />
      {query.isPending ? (
        <p role="status">正在读取…</p>
      ) : !list.length ? (
        <section className="card-panel">
          <p>当前没有{quiz ? "测验" : "作业"}。</p>
        </section>
      ) : (
        list.map((a) => (
          <article className="card-panel live-row" key={a.id}>
            <div>
              <h2>{a.title}</h2>
              <p>{a.description}</p>
              <p className="live-meta">
                {names[a.status]} · 满分 {a.max_score} · 截止 {when(a.due_at)}
              </p>
            </div>
            <div className="live-inline">
              <Link className="ghost-btn" to={`/${root}/homework/${a.id}`}>
                {teacher ? "查看题目" : "进入作答"}
              </Link>
              {teacher && (
                <>
                  {a.status === "draft" && (
                    <Link
                      className="ghost-btn"
                      to={`/teacher/homework/${a.id}/edit`}
                    >
                      编辑草稿
                    </Link>
                  )}
                  <Link
                    className="ghost-btn"
                    to={`/teacher/homework/${a.id}/submissions`}
                  >
                    查看提交
                  </Link>
                  {a.status === "draft" && (
                    <button
                      className="primary-link"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(`/assignments/${a.id}/state`, {
                          state: "published",
                        })
                      }
                    >
                      发布
                    </button>
                  )}
                  {a.status === "published" && (
                    <button
                      className="ghost-btn"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(`/assignments/${a.id}/state`, {
                          state: "closed",
                        })
                      }
                    >
                      关闭
                    </button>
                  )}
                </>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
export function AssignmentEditor({
  quiz: requestedQuiz = false,
}: {
  quiz?: boolean;
}) {
  const { assignmentId } = useParams();
  const original = useLiveQuery<{
    assignment: Assignment;
    questions: (Question & { correct_answer: string })[];
  }>(`/assignments/${assignmentId}`, !!assignmentId);
  const quiz = requestedQuiz || original.data?.assignment.type === "quiz";
  const points = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<Resource[]>("/resources");
  const [savedId, setSavedId] = useState(assignmentId || "");
  const { course } = useLearning();
  const action = useAction();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [questions, setQuestions] = useState([
    {
      prompt: "",
      max_score: 10,
      rubric: "",
      options: ["", ""],
      correct_answer: "",
      knowledge_point_id: "",
      resource_id: "",
    },
  ]);
  const initializedAssignment = useRef("");
  useEffect(() => {
    if (
      original.data &&
      initializedAssignment.current !== original.data.assignment.id
    ) {
      initializedAssignment.current = original.data.assignment.id;
      setTitle(original.data.assignment.title);
      setDescription(original.data.assignment.description);
      if (original.data.assignment.due_at) {
        const d = new Date(original.data.assignment.due_at);
        setDue(
          new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16),
        );
      }
      setQuestions(
        original.data.questions.map((q) => ({
          ...q,
          options: q.options.length ? q.options : ["", ""],
          knowledge_point_id: q.knowledge_point_id || "",
          resource_id: q.resource_id || "",
        })),
      );
    }
  }, [original.data]);
  async function save(publish: boolean) {
    const a = await action.run<Assignment>(
      savedId ? `/assignments/${savedId}` : "/assignments",
      {
        title,
        description,
        type: quiz ? "quiz" : "subjective",
        due_at: due ? new Date(due).toISOString() : null,
        questions,
      },
      savedId ? "PUT" : "POST",
    );
    if (!a) return;
    setSavedId(a.id);
    if (
      publish &&
      !(await action.run(`/assignments/${a.id}/state`, { state: "published" }))
    )
      return;
    navigate(quiz ? "/teacher/quiz" : "/teacher/homework");
  }
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{quiz ? "新建测验" : "新建作业"}</h1>
        <p>发布后题目及标准固定，修改内容请创建新作业，保留原始作答依据。</p>
      </header>
      <Feedback message={action.message} />
      <section className="card-panel">
        <form
          className="live-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <label>
            {quiz ? "测验标题" : "作业标题"}
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            任务说明
            <textarea
              aria-label="任务说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            截止时间
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <h2>题目列表</h2>
          {questions.map((q, i) => (
            <fieldset key={i}>
              <legend>第{i + 1}题</legend>
              <label>
                题目要求
                <textarea
                  aria-label="题目要求"
                  required
                  rows={4}
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, prompt: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                满分
                <input
                  required
                  type="number"
                  min={1}
                  max={10000}
                  value={q.max_score}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i
                          ? { ...x, max_score: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                评分标准
                <textarea
                  aria-label="评分标准"
                  required
                  rows={3}
                  value={q.rubric}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, rubric: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                关联知识点
                <select
                  aria-label="关联知识点"
                  value={q.knowledge_point_id}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i
                          ? { ...x, knowledge_point_id: e.target.value }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">不关联</option>
                  {points.data?.points
                    .filter((p) => p.kind === "point")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                评分依据资料
                <select
                  aria-label="评分依据资料"
                  value={q.resource_id}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, resource_id: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="">教师手填标准</option>
                  {resources.data
                    ?.filter((r) => r.status === "published")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · {r.locator} · v{r.version}
                      </option>
                    ))}
                </select>
              </label>
              {quiz && (
                <>
                  <label>
                    选项（每行一个）
                    <textarea
                      aria-label="选项（每行一个）"
                      required
                      value={q.options.join("\n")}
                      onChange={(e) =>
                        setQuestions((v) =>
                          v.map((x, j) =>
                            j === i
                              ? { ...x, options: e.target.value.split("\n") }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    正确答案
                    <select
                      aria-label="正确答案"
                      required
                      value={q.correct_answer}
                      onChange={(e) =>
                        setQuestions((v) =>
                          v.map((x, j) =>
                            j === i
                              ? { ...x, correct_answer: e.target.value }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="">选择正确答案</option>
                      {q.options.filter(Boolean).map((v, k) => (
                        <option key={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {questions.length > 1 && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    setQuestions((v) => v.filter((_, j) => j !== i))
                  }
                >
                  移除本题
                </button>
              )}
            </fieldset>
          ))}
          <div className="live-inline">
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                setQuestions((v) => [
                  ...v,
                  {
                    prompt: "",
                    max_score: 10,
                    rubric: "",
                    options: ["", ""],
                    correct_answer: "",
                    knowledge_point_id: "",
                    resource_id: "",
                  },
                ])
              }
            >
              新增题目
            </button>
            <button className="ghost-btn" disabled={action.busy || !course}>
              保存草稿
            </button>
            <button
              type="button"
              className="primary-link"
              disabled={action.busy || !course}
              onClick={() => save(true)}
            >
              保存并发布
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
export function AssignmentDetail() {
  const { assignmentId } = useParams();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<{ assignment: Assignment; questions: Question[] }>(
    `/assignments/${assignmentId}`,
  );
  const submissions = useLiveQuery<Submission[]>(
    `/assignments/${assignmentId}/submissions`,
  );
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{query.data?.assignment.title || "作业详情"}</h1>
        <p>{query.data?.assignment.description}</p>
        <Link to={teacher ? "/teacher/homework" : "/student/homework"}>
          返回列表
        </Link>
      </header>
      <Feedback error={query.error || submissions.error} />
      {query.data?.questions.map((q) => (
        <QuestionAnswer
          key={q.id}
          question={q}
          assignment={query.data.assignment}
          teacher={teacher}
        />
      ))}
      <section className="card-panel">
        <h2>{teacher ? "提交记录" : "我的提交历史"}</h2>
        {submissions.data?.map((s) => (
          <p key={s.id}>
            <Link
              to={`/${teacher ? "teacher" : "student"}/homework/submissions/${s.id}/${teacher ? "grade" : "feedback"}`}
            >
              第{s.attempt}次提交 · {when(s.submitted_at)} · {names[s.status]}
            </Link>
          </p>
        ))}
        {!submissions.data?.length && <p>暂无提交记录。</p>}
      </section>
    </div>
  );
}
function QuestionAnswer({
  question: q,
  assignment: a,
  teacher,
}: {
  question: Question;
  assignment: Assignment;
  teacher: boolean;
}) {
  const action = useAction();
  const [answer, setAnswer] = useState("");
  const initializedDraft = useRef(false);
  const draft = useLiveQuery<{ answer_text: string } | null>(
    `/assignments/${a.id}/questions/${q.id}/draft`,
    !teacher,
  );
  useEffect(() => {
    if (draft.isSuccess && !initializedDraft.current) {
      initializedDraft.current = true;
      setAnswer(draft.data?.answer_text || "");
    }
  }, [draft.data, draft.isSuccess]);
  const [requestID, setRequestID] = useState(crypto.randomUUID());
  return (
    <section className="card-panel">
      <h2>{q.prompt}</h2>
      <p>满分 {q.max_score}</p>
      {teacher ? (
        <>
          <h3>教师评分标准</h3>
          <p className="live-prose">{q.rubric}</p>
        </>
      ) : (
        <>
          <div>
            <p>我的作答</p>
            {q.type === "quiz" ? (
              <div role="radiogroup" aria-label="我的作答">
                {q.options.map((o, i) => (
                  <label className="live-option" key={i}>
                    <input
                      type="radio"
                      name={q.id}
                      disabled={!draft.isSuccess}
                      checked={answer === o}
                      onChange={() => {
                        setAnswer(o);
                        setRequestID(crypto.randomUUID());
                      }}
                    />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                aria-label="我的作答"
                rows={8}
                disabled={!draft.isSuccess}
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setRequestID(crypto.randomUUID());
                }}
              />
            )}
          </div>
          <Feedback error={draft.error} message={action.message} />
          <div className="live-inline">
            <button
              className="ghost-btn"
              disabled={action.busy || !draft.isSuccess}
              onClick={() =>
                action.run(
                  `/assignments/${a.id}/questions/${q.id}/draft`,
                  { answer_text: answer },
                  "PUT",
                )
              }
            >
              保存作答草稿
            </button>
            <button
              className="primary-link"
              disabled={
                action.busy || a.status !== "published" || !answer.trim()
              }
              onClick={async () => {
                if (
                  await action.run(`/assignments/${a.id}/submissions`, {
                    question_id: q.id,
                    answer_text: answer,
                    request_id: requestID,
                  })
                )
                  action.setMessage("提交成功，可在下方历史中查看反馈");
              }}
            >
              提交作业
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function SubmissionList() {
  const { assignmentId } = useParams();
  const q = useLiveQuery<Submission[]>(
    `/assignments/${assignmentId}/submissions`,
  );
  const detail = useLiveQuery<{
    assignment: Assignment;
    questions: Question[];
  }>(`/assignments/${assignmentId}`);
  const members =
    useLiveQuery<{ id: string; display_name: string }[]>("/members");
  const [onlyPending, setOnlyPending] = useState(false);
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>学生提交与批改</h1>
        <Link to="/teacher/homework">返回作业列表</Link>
      </header>
      <Feedback error={q.error || detail.error || members.error} />
      {detail.data && members.data && q.data && (
        <section className="card-panel">
          <h2>{detail.data.assignment.title} · 提交覆盖</h2>
          {members.data.map((member) => {
            const submitted = new Set(
              q.data
                .filter((s) => s.student_id === member.id)
                .map((s) => s.question_id),
            ).size;
            return (
              <p key={member.id}>
                {member.display_name} · {submitted} /{" "}
                {detail.data!.questions.length} 题 ·{" "}
                {submitted === 0
                  ? "未提交"
                  : submitted === detail.data!.questions.length
                    ? "已全部提交"
                    : "部分提交"}
              </p>
            );
          })}
        </section>
      )}
      <section className="card-panel">
        <label className="live-option">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          仅看待批改提交
        </label>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>题目</th>
                <th>提交次数</th>
                <th>时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {q.data
                ?.filter((s) => !onlyPending || s.status !== "graded")
                .map((s) => (
                  <tr key={s.id}>
                    <td>{s.student_name}</td>
                    <td>
                      {
                        detail.data?.questions.find(
                          (question) => question.id === s.question_id,
                        )?.prompt
                      }
                    </td>
                    <td>{s.attempt}</td>
                    <td>{when(s.submitted_at)}</td>
                    <td>{names[s.status]}</td>
                    <td>
                      <Link to={`/teacher/homework/submissions/${s.id}/grade`}>
                        批改详情
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!q.data?.length && <p>暂无提交。未提交与零分分别记录。</p>}
      </section>
    </div>
  );
}
export function GradePage() {
  const { submissionId } = useParams();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<{
    submission: Submission;
    question: Question;
    revisions: Revision[];
  }>(`/submissions/${submissionId}`);
  const action = useAction();
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [requestID, setRequestID] = useState(crypto.randomUUID());
  const data = query.data;
  const resources = useLiveQuery<Resource[]>("/resources");
  const source = resources.data?.find(
    (r) => r.id === data?.question.resource_id,
  );
  useEffect(() => {
    setScore(0);
    setFeedback("");
    setRequestID(crypto.randomUUID());
  }, [submissionId]);
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{teacher ? "作答复核与评分" : "正式反馈"}</h1>
        <Link to={teacher ? "/teacher/homework" : "/student/homework"}>
          返回作业列表
        </Link>
      </header>
      <Feedback error={query.error} message={action.message} />
      {data && (
        <>
          <div className="live-grid">
            <section className="card-panel">
              <h2>题目与原始作答</h2>
              <p>{data.question.prompt}</p>
              <p className="live-meta">
                第{data.submission.attempt}次 ·{" "}
                {when(data.submission.submitted_at)} · 作业 v
                {data.submission.assignment_version}
              </p>
              <article className="live-prose">
                {data.submission.answer_text}
              </article>
              <details>
                <summary>原文校验信息</summary>
                <p className="live-id">{data.submission.answer_sha256}</p>
              </details>
              {teacher && (
                <>
                  <h3>评分标准</h3>
                  <p className="live-prose">{data.question.rubric}</p>
                  {source && (
                    <details>
                      <summary>
                        评分依据：{source.title} · {source.locator} · v
                        {source.version}
                      </summary>
                      <p className="live-prose">{source.content}</p>
                      {source.source_url && (
                        <a
                          href={source.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看资料来源
                        </a>
                      )}
                    </details>
                  )}
                </>
              )}
            </section>
            <section className="card-panel">
              <h2>{teacher ? "评分修订" : "已发布反馈"}</h2>
              {!data.revisions.length && <p>尚未发布反馈，请等待教师批改。</p>}
              {data.revisions.map((r) => (
                <article className="live-revision" key={r.id}>
                  <h3>
                    {r.score} / {data.question.max_score} · {names[r.state]}
                  </h3>
                  <p>
                    修订 {r.revision} ·{" "}
                    {r.method === "rule" ? "客观规则判分" : "教师评分"}
                  </p>
                  <p className="live-prose">{r.feedback}</p>
                  {teacher &&
                    r === data.revisions[0] &&
                    r.state !== "released" && (
                      <button
                        className="primary-link"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(`/revisions/${r.id}/state`, {
                            state:
                              r.state === "draft" ? "confirmed" : "released",
                          })
                        }
                      >
                        {r.state === "draft" ? "确认评分" : "发布正式反馈"}
                      </button>
                    )}
                </article>
              ))}
            </section>
          </div>
          {teacher && (
            <section className="card-panel">
              <h2>新增评分修订</h2>
              <form
                className="live-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await action.run(`/submissions/${submissionId}/revisions`, {
                      score,
                      feedback,
                      request_id: requestID,
                    })
                  )
                    setRequestID(crypto.randomUUID());
                }}
              >
                <label>
                  终审分数
                  <input
                    required
                    type="number"
                    min={0}
                    max={data.question.max_score}
                    value={score}
                    onChange={(e) => {
                      setScore(Number(e.target.value));
                      setRequestID(crypto.randomUUID());
                    }}
                  />
                </label>
                <label>
                  终审评语
                  <textarea
                    aria-label="终审评语"
                    required
                    rows={5}
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                      setRequestID(crypto.randomUUID());
                    }}
                  />
                </label>
                <button className="ghost-btn" disabled={action.busy}>
                  保存评分草稿
                </button>
              </form>
              <p className="muted">
                草稿不对学生公开。核对原文与标准后确认，再单独发布。
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
