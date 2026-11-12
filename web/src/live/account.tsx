import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { Card, Form, Input, Button } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { useLiveQuery, useAction, Feedback, when } from "./context";
import { EmptyState, LoadingState } from "../shared/ui";
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
      <Feedback message={message} />
      <Card className="card-panel" title={<h2>个人资料</h2>}>

        <Form
          className="live-form"
          onFinish={() => {
            void save();
          }}
          layout="vertical"
        >
          <Field className="ui-field" label={<>显示姓名</>} required={true}>
            <Input
              aria-label="显示姓名"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button disabled={busy} htmlType="submit" type="primary">
            保存资料
          </Button>
        </Form>
      </Card>
      <Card className="card-panel" title={<h2>修改密码</h2>}>

        <Form
          className="live-form"
          onFinish={() => {
            void save(true);
          }}
          layout="vertical"
        >
          <Field className="ui-field" label={<>原密码</>} required={true}>
            <Input.Password
              aria-label="原密码"
              required
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </Field>
          <Field className="ui-field" label={<>新密码</>} required={true}>
            <Input.Password
              aria-label="新密码"
              required
              minLength={12}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <p>新密码至少12字节；修改后所有已登录设备都需重新登录。</p>
          <Button disabled={busy} htmlType="submit">
            修改密码
          </Button>
        </Form>
      </Card>
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
  const confirm = useConfirm();
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
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <Card className="card-panel" title={<h2>{industry ? "录入岗位与技能" : "新增教研记录"}</h2>}>

        <Form
          className="live-form"
          onFinish={async () => {
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
          layout="vertical"
        >
          <Field className="ui-field" label={<>标题</>} required={true}>
            <Input
              aria-label="标题"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          {industry ? (
            <>
              <Field
                className="ui-field"
                label={<>原始来源链接</>}
                required={true}
              >
                <Input
                  aria-label="原始来源链接"
                  required
                  type="url"
                  value={form.source_url}
                  onChange={(e) =>
                    setForm({ ...form, source_url: e.target.value })
                  }
                />
              </Field>
              <Field
                className="ui-field"
                label={<>技能要求</>}
                required={true}
              >
                <Input.TextArea
                  aria-label="技能要求"
                  required
                  rows={5}
                  value={form.skills}
                  onChange={(e) => setForm({ ...form, skills: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field
              className="ui-field"
              label={<>教研内容</>}
              required={true}
            >
              <Input.TextArea
                aria-label="教研内容"
                required
                rows={6}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </Field>
          )}
          <Button disabled={action.busy} htmlType="submit" type="primary">
            {editing ? "保存修改" : "保存记录"}
          </Button>
          {editing && (
            <Button
              onClick={() => {
                setEditing("");
                setForm({ title: "", content: "", source_url: "", skills: "" });
              }}
              htmlType="button"
            >
              取消编辑
            </Button>
          )}
        </Form>
      </Card>
      {query.data?.map((r) => (
        <Card className="card-panel" key={r.id} title={<h2>{r.title}</h2>}>

          <p className="live-meta">{when(r.created_at)}</p>
          <p className="live-prose">{r.content || r.skills}</p>
          <div className="live-inline">
            <Button
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
            </Button>
            <Button
              danger
              disabled={action.busy}
              onClick={async () => {
                if (
                  await confirm(`删除记录“${r.title}”？`) &&
                  (await action.run(`${path}/${r.id}`, {}, "DELETE")) &&
                  editing === r.id
                ) {
                  setEditing("");
                  setForm({
                    title: "",
                    content: "",
                    source_url: "",
                    skills: "",
                  });
                }
              }}
            >
              删除
            </Button>
          </div>
          {r.source_url && (
            <a href={r.source_url} target="_blank" rel="noreferrer">
              查看原始来源
            </a>
          )}
        </Card>
      ))}
      {query.isPending ? <LoadingState /> : !query.error && !query.data?.length && <Card className="card-panel"><EmptyState title="暂无记录" /></Card>}
    </div>
  );
}
