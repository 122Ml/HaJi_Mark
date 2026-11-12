import { Field } from "../shared/Field";
import { Card, Form, Select, Input, Button } from "antd";
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
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <Card className="card-panel" title={<h2>{form.parent_id ? "回复" : "发布内容"}</h2>}>

        <Form
          className="live-form"
          onFinish={async () => {
            if (await action.run("/interactions", form))
              setForm({
                ...form,
                kind: teacher ? "announcement" : "question",
                title: "",
                content: "",
                parent_id: "",
              });
          }}
          layout="vertical"
        >
          <Field className="ui-field" label={<>类型</>}>
            <Select
              aria-label="类型"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e, parent_id: "" })}
              showSearch
              optionFilterProp="children"
            >
              {teacher && (
                <>
                  <Select.Option value="announcement">公告</Select.Option>
                  <Select.Option value="discussion">讨论</Select.Option>
                </>
              )}
              <Select.Option value="question">课程提问</Select.Option>
              {form.parent_id && (
                <Select.Option value="reply">回复</Select.Option>
              )}
            </Select>
          </Field>
          <Field className="ui-field" label={<>标题</>}>
            <Input
              aria-label="标题"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field className="ui-field" label={<>内容</>} required={true}>
            <Input.TextArea
              aria-label="内容"
              required
              rows={4}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </Field>
          <Button disabled={action.busy} htmlType="submit" type="primary">
            发布
          </Button>
          {form.parent_id && (
            <Button
              onClick={() =>
                setForm({ ...form, kind: "question", parent_id: "" })
              }
              htmlType="button"
            >
              取消回复
            </Button>
          )}
        </Form>
      </Card>
      {query.data
        ?.filter((p) => !p.parent_id)
        .map((p) => (
          <Card className="card-panel" key={p.id} title={<h2>
              {p.title ||
                {
                  announcement: "课程公告",
                  question: "课程提问",
                  discussion: "课程讨论",
                }[p.kind]}
            </h2>}>

            <p className="live-meta">
              {p.author_name} · {when(p.created_at)}
            </p>
            <p className="live-prose">{p.content}</p>
            {query.data
              ?.filter((r) => r.parent_id === p.id)
              .map((r) => (
                <blockquote key={r.id}>
                  <strong>{r.author_name}</strong>· {when(r.created_at)}
                  <p>{r.content}</p>
                </blockquote>
              ))}
            <Button
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
            </Button>
          </Card>
        ))}
      {!query.data?.length && <p>还没有课程互动。</p>}
    </div>
  );
}
