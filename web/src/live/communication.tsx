import { Field } from "../shared/Field";
import { Card, Form, Select, Input, Button } from "antd";
import { useState } from "react";
import { useSession } from "../shared/session";
import { useAction, useLiveQuery, Feedback, when } from "./context";
import { EmptyState, LoadingState, MetaTag, MetaTags } from "../shared/ui";
import { DraftNotice, useEditorDraft } from "./editing";
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
      <Card className="card-panel" title={<>{form.parent_id ? "回复" : "发布内容"}</>}>

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
          <Card className="card-panel" key={p.id} title={<>
              {p.title ||
                {
                  announcement: "课程公告",
                  question: "课程提问",
                  discussion: "课程讨论",
                }[p.kind]}
            </>}>

            <MetaTags>
              <MetaTag>{{ announcement: "公告", question: "提问", discussion: "讨论" }[p.kind]}</MetaTag>
              <span className="live-meta">{p.author_name}</span>
              <span className="live-meta">{when(p.created_at)}</span>
            </MetaTags>
            <p className="live-prose">{p.content}</p>
            {query.data
              ?.filter((r) => r.parent_id === p.id)
              .map((r) => (
                <blockquote key={r.id}>
                  <strong>{r.author_name}</strong>· {when(r.created_at)}
                  <p>{r.content}</p>
                </blockquote>
              ))}
            <InlineReply post={p} />
          </Card>
        ))}
      {query.isPending ? <LoadingState /> : !query.error && !query.data?.length && <Card className="card-panel"><EmptyState title="还没有课程互动" /></Card>}
    </div>
  );
}

function InlineReply({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const draft = useEditorDraft(`discussion-reply:${post.id}`, "");
  const action = useAction();
  return <div className="discussion-reply">
    <Button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起回复" : "回复"}</Button>
    {open && <Form layout="vertical" onFinish={async () => {
      if (await action.run("/interactions", { kind: "reply", parent_id: post.id, title: `回复：${post.title}`, content: draft.value }, "POST", "回复已发布到当前讨论")) {
        draft.reset(""); setOpen(false);
      }
    }}>
      <DraftNotice {...draft} />
      <Field className="ui-field" label={`回复：${post.title || "课程互动"}`} required>
        <Input.TextArea aria-label="回复内容" autoFocus required rows={3} value={draft.value} onChange={e => draft.change(e.target.value)} />
      </Field>
      <Button type="primary" htmlType="submit" loading={action.busy} disabled={!draft.value.trim()}>发布回复</Button>
    </Form>}
    <Feedback message={action.message} failed={action.failed} />
  </div>;
}
