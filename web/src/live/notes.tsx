import { Field } from "../shared/Field";
import { Form, Input, Checkbox, Button } from "antd";
import { useEffect } from "react";
import { useEditorDraft, DraftNotice } from "./editing";
import { useLiveQuery, useAction, Feedback } from "./context";
interface Note {
  resource_id: string;
  note: string;
  favorite: boolean;
}
export function ResourceNotes({ resourceId }: { resourceId: string }) {
  const query = useLiveQuery<Note[]>("/notes");
  const action = useAction();
  const saved = query.data?.find((n) => n.resource_id === resourceId);
  const draft = useEditorDraft(
    `note:${resourceId}`,
    { note: saved?.note || "", favorite: saved?.favorite || false },
    query.isSuccess,
  );
  const { note, favorite } = draft.value;
  function setNote(note: string) {
    draft.change((v) => ({ ...v, note }));
  }
  function setFavorite(favorite: boolean) {
    draft.change((v) => ({ ...v, favorite }));
  }
  async function save() {
    const value = draft.value;
    if (await action.run(`/resources/${resourceId}/note`, value, "PUT"))
      draft.saved(value);
  }
  useEffect(() => {
    if (!draft.dirty || !draft.ready || action.busy || action.failed) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [note, favorite, draft.dirty, draft.ready, action.busy, action.failed]);
  return (
    <Form
      className="live-form"
      onFinish={() => {
        void save();
      }}
      layout="vertical"
    >
      <h3>学习笔记</h3>
      <DraftNotice {...draft} />
      <p role="status">
        {action.busy ? "正在保存…" : draft.dirty ? "待保存" : "已同步"}
      </p>
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <Field className="ui-field" label={<>我的笔记</>}>
        <Input.TextArea
          aria-label="我的笔记"
          rows={5}
          disabled={!query.isSuccess}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Checkbox
        className="live-option"
        disabled={!query.isSuccess}
        checked={favorite}
        onChange={(e) => setFavorite(e.target.checked)}
      >
        收藏这份资料
      </Checkbox>
      <Button disabled={action.busy || !query.isSuccess} htmlType="submit">
        保存笔记与收藏
      </Button>
    </Form>
  );
}
