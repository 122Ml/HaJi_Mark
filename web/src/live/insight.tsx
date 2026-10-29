import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ActivityTimeline } from "./activity";
import { useSession } from "../shared/session";
import { useLiveQuery, useAction, Feedback, names, when } from "./context";
import type { Resource } from "./course";
import type { Assignment } from "./assessment";
import type { Point } from "./course";
interface Evidence {
  submission_id: string;
  student_id: string;
  question_id: string;
  answer_text: string;
  attempt: number;
  revision_id: string;
  score: number;
  feedback: string;
  max_score: number;
  prompt: string;
  released_at: string;
  knowledge_point_id: string | null;
  resource_id: string | null;
}
interface Overview {
  id: string;
  display_name: string;
  completed_events: number;
  submitted_assignments: number;
  pending_interventions: number;
}
interface Intervention {
  id: string;
  student_id: string;
  student_name: string;
  title: string;
  description: string;
  status: string;
  answer_text: string;
  review_note: string;
  created_at: string;
  resource_id: string | null;
  assignment_id: string | null;
}
export function OverviewPage({ path = false }: { path?: boolean }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const evidence = useLiveQuery<Evidence[]>("/evidence");
  const overview = useLiveQuery<Overview[]>("/overview", teacher);
  const resources = useLiveQuery<Resource[]>("/resources");
  const assignments = useLiveQuery<Assignment[]>("/assignments");
  const events = useLiveQuery<{ resource_id: string; verb: string }[]>(
    "/events",
    !teacher,
  );
  const points = useLiveQuery<{ points: Point[] }>("");
  const [params, setParams] = useSearchParams();
  const studentFilter = params.get("student") || "";
  const setStudentFilter = (id: string) => setParams(id ? { student: id } : {});
  const rows = (evidence.data || []).filter(
    (r) => !studentFilter || r.student_id === studentFilter,
  );
  const score = rows.reduce((v, r) => v + r.score, 0);
  const max = rows.reduce((v, r) => v + r.max_score, 0);
  const low = rows.filter((r) => r.score / r.max_score < 0.6);
  return (
    <div className="live-page overview-page">
      <header className="live-heading">
        <p>{teacher ? "教学决策" : "学习进度"}</p>
        <h1>
          {teacher
            ? "教学概览"
            : path
              ? "个性化学习路径"
              : "我的学习概览"}
        </h1>
      </header>
      <nav className="live-shortcuts" aria-label="工作台快捷入口">
        {(teacher ? [
          ["课程底座", "/teacher/course-twin", "M6 5h12v14H6z M9 9h6 M9 13h6"],
          ["作业与评阅", "/teacher/homework", "M7 4h10v16H7z M10 9l2 2 3-3 M10 15h4"],
          ["干预任务", "/teacher/intervention", "M5 6h14v11h-8l-4 3v-3H5z M8 10h8 M8 13h5"],
        ] : [
          ["课程学习", "/student/course-content", "M6 5h12v14H6z M9 9h6 M9 13h6"],
          ["作业测验", "/student/homework", "M7 4h10v16H7z M10 9l2 2 3-3 M10 15h4"],
          ["学习路径", "/student/learning", "M5 6h14v11h-8l-4 3v-3H5z M8 10h8 M8 13h5"],
        ]).map(([title, to, icon]) => (
          <Link className="live-shortcut" to={to} key={to}>
            <strong>{title}<span aria-hidden="true">›</span></strong>
            <div className="shortcut-art" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"><path d={icon} /></svg>
            </div>
          </Link>
        ))}
      </nav>
      <Feedback error={evidence.error || overview.error} />
      {!teacher && resources.data && events.data && (
        <section className="card-panel">
          <h2>资料学习进度</h2>
          <p>
            已完成{" "}
            {
              resources.data.filter((r) =>
                events.data.some(
                  (e) => e.resource_id === r.id && e.verb === "completed",
                ),
              ).length
            }{" "}
            / {resources.data.length} 份资料
          </p>
          <Link to="/student/course-content">继续学习课程资料</Link>
        </section>
      )}
      {teacher && (
        <div className="live-inline">
          <label>
            学生范围
            <select
              aria-label="学生范围"
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
            >
              <option value="">全班</option>
              {overview.data?.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-btn"
            onClick={() => {
              const cells = [
                ["学生ID", "题目", "得分", "满分", "提交ID", "评分修订ID"],
                ...rows.map((r) => [
                  r.student_id,
                  r.prompt,
                  String(r.score),
                  String(r.max_score),
                  r.submission_id,
                  r.revision_id,
                ]),
              ];
              const csv =
                "\uFEFF" +
                cells
                  .map((row) =>
                    row
                      .map(
                        (v) =>
                          '"' +
                          (/^[=+@\-]/.test(v) ? "'" : "") +
                          v.replaceAll('"', '""') +
                          '"',
                      )
                      .join(","),
                  )
                  .join("\r\n");
              const url = URL.createObjectURL(
                new Blob([csv], { type: "text/csv;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "课程正式评分证据.csv";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出当前正式结果
          </button>
        </div>
      )}
      <div className="live-metrics">
        <section className="card-panel">
          <span>{teacher ? "课程学生" : "有效评分记录"}</span>
          <strong>{teacher ? overview.data?.length || 0 : rows.length}</strong>
        </section>
        <section className="card-panel">
          <span>已发布作业</span>
          <strong>
            {assignments.data?.filter((a) => a.status === "published").length ||
              0}
          </strong>
        </section>
        <section className="card-panel">
          <span>正式结果表现</span>
          <strong>
            {max ? `${Math.round((score / max) * 100)}%` : "证据不足"}
          </strong>
        </section>
        <section className="card-panel">
          <span>需复习记录</span>
          <strong>{low.length}</strong>
        </section>
      </div>
      <section className="card-panel">
        <h2>知识点表现</h2>
        <div className="live-performance">
          {points.data?.points
            .filter((p) => p.kind === "point")
            .map((p) => {
              const group = rows.filter((r) => r.knowledge_point_id === p.id);
              const sum = group.reduce((v, r) => v + r.score, 0);
              const maximum = group.reduce((v, r) => v + r.max_score, 0);
              return (
                <article key={p.id}>
                  <strong>{p.title}</strong>
                  <span>
                    {" "}
                    ·{" "}
                    {maximum
                      ? `${Math.round((sum / maximum) * 100)}% · ${group.length}条有效结果`
                      : "证据不足"}
                  </span>
                  {maximum > 0 && (
                    <progress
                      aria-label={`${p.title}表现`}
                      value={sum}
                      max={maximum}
                    />
                  )}
                </article>
              );
            })}
        </div>
      </section>
      {teacher ? (
        <section className="card-panel">
          <h2>班级完成与风险</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>完成学习事件</th>
                  <th>已提交作业</th>
                  <th>待执行任务</th>
                  <th>正式结果</th>
                </tr>
              </thead>
              <tbody>
                {overview.data?.map((s) => (
                  <tr key={s.id}>
                    <td><button className="ghost-btn" onClick={() => setStudentFilter(s.id)}>{s.display_name}</button></td>
                    <td>{s.completed_events}</td>
                    <td>{s.submitted_assignments}</td>
                    <td>{s.pending_interventions}</td>
                    <td>
                      {rows.filter((r) => r.student_id === s.id).length} 条{" "}
                      <Link to="/teacher/intervention">查看并安排任务</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card-panel">
          <h2>继续学习</h2>
          <div className="live-inline">
            <Link className="primary-link" to="/student/course-content">
              进入学习中心
            </Link>
            <Link className="ghost-btn" to="/student/homework">
              查看作业
            </Link>
            <Link className="ghost-btn" to="/student/intervention">
              老师任务
            </Link>
          </div>
          {resources.data
            ?.filter((r) => r.status === "published")
            .slice(0, 6)
            .map((r) => (
              <p key={r.id}>
                {r.title} · {r.locator} · v{r.version}
              </p>
            ))}
        </section>
      )}
      <ActivityTimeline teacher={teacher} studentID={teacher ? studentFilter : ""} />
      <section className="card-panel">
        <h2>正式评分证据</h2>
        {!rows.length ? (
          <p>暂无已发布评分。</p>
        ) : (
          rows.map((r) => (
            <article className="live-row" key={r.submission_id}>
              <div>
                <h3>{r.prompt}</h3>
                <p>
                  {r.score} / {r.max_score} · 第{r.attempt}次作答 ·{" "}
                  {when(r.released_at)}
                </p>
                <p>{r.feedback}</p>
              </div>
              <Link
                to={`/${teacher ? "teacher" : "student"}/homework/submissions/${r.submission_id}/${teacher ? "grade" : "feedback"}`}
              >
                查看原始证据
              </Link>
            </article>
          ))
        )}
      </section>
      {teacher && (
        <section className="card-panel">
          <h2>共性难点</h2>
          <p>
            低于本题满分60%的有效作答 {low.length} / {rows.length}，涉及{" "}
            {new Set(low.map((r) => r.student_id)).size}{" "}
            名学生。
          </p>
        </section>
      )}
    </div>
  );
}
export function InterventionPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Intervention[]>("/interventions");
  const resources = useLiveQuery<Resource[]>("/resources");
  const assignments = useLiveQuery<Assignment[]>("/assignments");
  const members = useLiveQuery<{ id: string; display_name: string }[]>(
    "/members",
    teacher,
  );
  const action = useAction();
  const [form, setForm] = useState({
    student_id: "",
    title: "",
    description: "",
    resource_id: "",
    assignment_id: "",
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{teacher ? "教师干预任务包" : "老师任务"}</h1>
      </header>
      <Feedback error={query.error} message={action.message} />
      {teacher && (
        <section className="card-panel">
          <h2>创建任务草稿</h2>
          <form
            className="live-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action.run("/interventions", form))
                setForm({ ...form, title: "", description: "" });
            }}
          >
            <label>
              目标学生
              <select
                aria-label="目标学生"
                required
                value={form.student_id}
                onChange={(e) =>
                  setForm({ ...form, student_id: e.target.value })
                }
              >
                <option value="">选择学生</option>
                {members.data?.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              任务标题
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              补学资料、练习及完成要求
              <textarea
                aria-label="补学资料、练习及完成要求"
                required
                rows={5}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <button className="primary-link" disabled={action.busy}>
              保存任务草稿
            </button>
            <label>
              关联补学资料
              <select
                aria-label="关联补学资料"
                value={form.resource_id}
                onChange={(e) =>
                  setForm({ ...form, resource_id: e.target.value })
                }
              >
                <option value="">不指定资料</option>
                {resources.data
                  ?.filter((r) => r.status === "published")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · v{r.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              关联补练作业
              <select
                aria-label="关联补练作业"
                value={form.assignment_id}
                onChange={(e) =>
                  setForm({ ...form, assignment_id: e.target.value })
                }
              >
                <option value="">不指定作业</option>
                {assignments.data
                  ?.filter((a) => a.status === "published")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
              </select>
            </label>
          </form>
        </section>
      )}
      {query.data?.map((i) => (
        <section key={i.id} className="card-panel">
          <div className="section-head">
            <h2>{i.title}</h2>
            <span>{names[i.status]}</span>
          </div>
          {teacher && <p>学生：{i.student_name}</p>}
          <p className="live-prose">{i.description}</p>
          {i.resource_id && (
            <p>
              <Link
                to={`/${teacher ? "teacher/course-twin" : "student/course-content"}?resource=${i.resource_id}`}
              >
                打开补学资料：
                {resources.data?.find((r) => r.id === i.resource_id)?.title ||
                  "关联资料"}
              </Link>
            </p>
          )}
          {i.assignment_id && (
            <p>
              <Link
                to={`/${teacher ? "teacher" : "student"}/homework/${i.assignment_id}`}
              >
                进入补练作业
              </Link>
            </p>
          )}
          {i.answer_text && (
            <>
              <h3>学生执行结果</h3>
              <p className="live-prose">{i.answer_text}</p>
            </>
          )}
          {i.review_note && (
            <>
              <h3>教师复查</h3>
              <p>{i.review_note}</p>
            </>
          )}
          {teacher && i.status === "draft" && (
            <button
              className="primary-link"
              disabled={action.busy}
              onClick={() =>
                action.run(`/interventions/${i.id}/state`, {
                  state: "assigned",
                })
              }
            >
              确认下发
            </button>
          )}
          {((!teacher && i.status === "assigned") ||
            (teacher && i.status === "submitted")) && (
            <form
              className="live-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(`/interventions/${i.id}/state`, {
                  state: teacher ? "reviewed" : "submitted",
                  content: answers[i.id] || "",
                });
              }}
            >
              <label>
                {teacher ? "复查意见" : "执行结果与新学习证据"}
                <textarea
                  aria-label={teacher ? "复查意见" : "执行结果与新学习证据"}
                  required
                  rows={5}
                  value={answers[i.id] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [i.id]: e.target.value })
                  }
                />
              </label>
              <button className="primary-link" disabled={action.busy}>
                {teacher ? "确认复查完成" : "提交执行结果"}
              </button>
            </form>
          )}
        </section>
      ))}
      {!query.data?.length && (
        <section className="card-panel">
          <p>当前没有任务。</p>
        </section>
      )}
    </div>
  );
}
