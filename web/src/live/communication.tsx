import { useState } from "react";
import { useSession } from "../shared/session";
import { useAction, useLiveQuery, Feedback, when } from "./context";
interface Post {
  id: string;
  kind: string;
  title: string;
  content: string;
  parent_id: string | null;
  author_name: string;
  created_at: string;
}
export function InteractionPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Post[]>("/interactions");
  const action = useAction();
  const [form, setForm] = useState({
    kind: teacher ? "announcement" : "question",
    title: "",
    content: "",
    parent_id: "",
  });
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{teacher ? "教学互动中心" : "互动答疑"}</h1>
      </header>
      <Feedback error={query.error} message={action.message} />
      <section className="card-panel">
        <h2>{form.parent_id ? "回复" : "发布内容"}</h2>
        <form
          className="live-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action.run("/interactions", form))
              setForm({
                ...form,
                kind: teacher ? "announcement" : "question",
                title: "",
                content: "",
                parent_id: "",
              });
          }}
        >
          <label>
            类型
            <select
              aria-label="类型"
              value={form.kind}
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value, parent_id: "" })
              }
            >
              {teacher && (
                <>
                  <option value="announcement">公告</option>
                  <option value="discussion">讨论</option>
                </>
              )}
              <option value="question">课程提问</option>
              {form.parent_id && <option value="reply">回复</option>}
            </select>
          </label>
          <label>
            标题
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            内容
            <textarea
              aria-label="内容"
              required
              rows={4}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </label>
          <button className="primary-link" disabled={action.busy}>
            发布
          </button>
          {form.parent_id && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                setForm({ ...form, kind: "question", parent_id: "" })
              }
            >
              取消回复
            </button>
          )}
        </form>
      </section>
      {query.data
        ?.filter((p) => !p.parent_id)
        .map((p) => (
          <article className="card-panel" key={p.id}>
            <h2>
              {p.title ||
                {
                  announcement: "课程公告",
                  question: "课程提问",
                  discussion: "课程讨论",
                }[p.kind]}
            </h2>
            <p className="live-meta">
              {p.author_name} · {when(p.created_at)}
            </p>
            <p className="live-prose">{p.content}</p>
            {query.data
              ?.filter((r) => r.parent_id === p.id)
              .map((r) => (
                <blockquote key={r.id}>
                  <strong>{r.author_name}</strong> · {when(r.created_at)}
                  <p>{r.content}</p>
                </blockquote>
              ))}
            <button
              className="ghost-btn"
              onClick={() => {
                setForm({
                  kind: "reply",
                  title: `回复：${p.title}`,
                  content: "",
                  parent_id: p.id,
                });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              回复
            </button>
          </article>
        ))}
      {!query.data?.length && <p>还没有课程互动。</p>}
    </div>
  );
}
