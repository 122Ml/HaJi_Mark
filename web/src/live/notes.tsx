import { useEffect, useRef, useState } from "react";
import { useLiveQuery, useAction, Feedback } from "./context";
interface Note {
  resource_id: string;
  note: string;
  favorite: boolean;
}
export function ResourceNotes({ resourceId }: { resourceId: string }) {
  const query = useLiveQuery<Note[]>("/notes");
  const action = useAction();
  const [note, setNote] = useState("");
  const [favorite, setFavorite] = useState(false);
  const initialized = useRef("");
  const saved = query.data?.find((n) => n.resource_id === resourceId);
  useEffect(() => {
    if (query.isSuccess && initialized.current !== resourceId) {
      initialized.current = resourceId;
      setNote(saved?.note || "");
      setFavorite(saved?.favorite || false);
    }
  }, [resourceId, saved, query.isSuccess]);
  return (
    <form
      className="live-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          `/resources/${resourceId}/note`,
          { note, favorite },
          "PUT",
        );
      }}
    >
      <h3>学习笔记</h3>
      <Feedback error={query.error} message={action.message} />
      <label>
        我的笔记
        <textarea
          rows={5}
          disabled={!query.isSuccess}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="live-option">
        <input
          type="checkbox"
          disabled={!query.isSuccess}
          checked={favorite}
          onChange={(e) => setFavorite(e.target.checked)}
        />
        收藏这份资料
      </label>
      <button className="ghost-btn" disabled={action.busy || !query.isSuccess}>
        保存笔记与收藏
      </button>
    </form>
  );
}
