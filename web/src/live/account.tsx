import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { useLiveQuery, useAction, Feedback, when } from "./context";
export function ProfilePage() {
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(session?.user.display_name || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(password = false) {
    setBusy(true);
    try {
      await requestJSON(
        `/learning/${password ? "password" : "profile"}`,
        {
          method: "PUT",
          body: JSON.stringify(
            password
              ? { old_password: oldPassword, new_password: newPassword }
              : { display_name: name },
          ),
        },
        session?.csrf_token,
      );
      setMessage(password ? "密码已修改，请重新登录" : "资料已保存");
      setOldPassword("");
      setNewPassword("");
      refresh();
      if (password) navigate("/login", { replace: true });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>个人设置</h1>
        <p>
          用户名：{session?.user.username} · 身份：
          {session?.user.role === "teacher" ? "教师" : "学生"}
        </p>
      </header>
      <Feedback message={message} />
      <section className="card-panel">
        <h2>个人资料</h2>
        <form
          className="live-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            显示姓名
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary-link" disabled={busy}>
            保存资料
          </button>
        </form>
      </section>
      <section className="card-panel">
        <h2>修改密码</h2>
        <form
          className="live-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(true);
          }}
        >
          <label>
            原密码
            <input
              required
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </label>
          <label>
            新密码
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <p>新密码至少12字节；修改后所有已登录设备都需重新登录。</p>
          <button className="ghost-btn" disabled={busy}>
            修改密码
          </button>
        </form>
      </section>
    </div>
  );
}
interface RecordItem {
  id: string;
  title: string;
  content?: string;
  source_url?: string;
  skills?: string;
  created_at: string;
}
export function RecordsPage({ industry = false }: { industry?: boolean }) {
  const path = industry ? "/industry" : "/research";
  const query = useLiveQuery<RecordItem[]>(path);
  const action = useAction();
  const [editing, setEditing] = useState("");
  const [form, setForm] = useState({
    title: "",
    content: "",
    source_url: "",
    skills: "",
  });
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{industry ? "行业能力资料库" : "教研协同中心"}</h1>
        <p>
          {industry
            ? "录入有原始来源的岗位和技能要求，作为课程能力映射的人工审核依据。"
            : "记录课堂观察、学生难点及教学改进措施。"}
        </p>
      </header>
      <Feedback error={query.error} message={action.message} />
      <section className="card-panel">
        <h2>{industry ? "录入岗位与技能" : "新增教研记录"}</h2>
        <form
          className="live-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                editing ? `${path}/${editing}` : path,
                form,
                editing ? "PUT" : "POST",
              )
            ) {
              setForm({ title: "", content: "", source_url: "", skills: "" });
              setEditing("");
            }
          }}
        >
          <label>
            标题
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          {industry ? (
            <>
              <label>
                原始来源链接
                <input
                  required
                  type="url"
                  value={form.source_url}
                  onChange={(e) =>
                    setForm({ ...form, source_url: e.target.value })
                  }
                />
              </label>
              <label>
                技能要求
                <textarea
                  required
                  rows={5}
                  value={form.skills}
                  onChange={(e) => setForm({ ...form, skills: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label>
              教研内容
              <textarea
                required
                rows={6}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </label>
          )}
          <button className="primary-link" disabled={action.busy}>
            {editing ? "保存修改" : "保存记录"}
          </button>
          {editing && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setEditing("");
                setForm({ title: "", content: "", source_url: "", skills: "" });
              }}
            >
              取消编辑
            </button>
          )}
        </form>
      </section>
      {query.data?.map((r) => (
        <article className="card-panel" key={r.id}>
          <h2>{r.title}</h2>
          <p className="live-meta">{when(r.created_at)}</p>
          <p className="live-prose">{r.content || r.skills}</p>
          <div className="live-inline">
            <button
              className="ghost-btn"
              onClick={() => {
                setEditing(r.id);
                setForm({
                  title: r.title,
                  content: r.content || "",
                  skills: r.skills || "",
                  source_url: r.source_url || "",
                });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              编辑
            </button>
            <button
              className="ghost-btn"
              disabled={action.busy}
              onClick={() => {
                if (confirm(`删除记录“${r.title}”？`))
                  void action.run(`${path}/${r.id}`, {}, "DELETE");
              }}
            >
              删除
            </button>
          </div>
          {r.source_url && (
            <a href={r.source_url} target="_blank" rel="noreferrer">
              查看原始来源
            </a>
          )}
        </article>
      ))}
      {!query.data?.length && <p>暂无记录。</p>}
    </div>
  );
}
