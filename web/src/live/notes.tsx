import { Field } from "../shared/Field";
import { Alert, Button, Checkbox, Form, Input, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { DraftNotice, useEditorDraft } from "./editing";
import { Feedback, useAction, useLearning, useLiveQuery } from "./context";
import { hasControlNull, utf8ByteLength } from "./validation";

export interface Note {
  resource_id: string;
  note: string;
  favorite: boolean;
}

const MAX_NOTE_BYTES = 100_000;

export function ResourceNotes({ resourceId }: { resourceId: string }) {
  const { course } = useLearning();
  const query = useLiveQuery<Note[]>("/notes");
  const action = useAction();
  const saved = query.data?.find((n) => n.resource_id === resourceId);
  const initial = useMemo(
    () => ({
      note: saved?.note || "",
      favorite: saved?.favorite || false,
    }),
    [saved?.note, saved?.favorite],
  );
  const readyScope = `${course?.id ?? ""}:${resourceId}`;
  const readyNow =
    query.isSuccess &&
    (query.isFetchedAfterMount || (!query.isStale && !query.isFetching));
  const [readyScopeDone, setReadyScopeDone] = useState("");
  useEffect(() => {
    if (readyNow && readyScopeDone !== readyScope) {
      setReadyScopeDone(readyScope);
    }
  }, [readyNow, readyScope, readyScopeDone]);
  const ready = readyNow || readyScopeDone === readyScope;
  const draft = useEditorDraft(`note:${resourceId}`, initial, ready);
  const { note, favorite } = draft.value;

  const [validationError, setValidationError] = useState("");
  const [autoSaveError, setAutoSaveError] = useState("");

  const inFlightRef = useRef(false);
  const pendingRef = useRef<{ silent: boolean } | null>(null);
  const latestRef = useRef(draft.value);
  latestRef.current = draft.value;
  const blockedSnapshotRef = useRef<string | null>(null);

  const noteBytes = utf8ByteLength(note.trim());

  function setNote(nextNote: string) {
    blockedSnapshotRef.current = null;
    setAutoSaveError("");
    setValidationError("");
    draft.change((v) => ({ ...v, note: nextNote }));
  }

  function setFavorite(nextFavorite: boolean) {
    blockedSnapshotRef.current = null;
    setAutoSaveError("");
    setValidationError("");
    draft.change((v) => ({ ...v, favorite: nextFavorite }));
  }

  async function save(silent = false) {
    const current = latestRef.current;
    const trimmed = current.note.trim();
    if (utf8ByteLength(trimmed) > MAX_NOTE_BYTES || hasControlNull(trimmed)) {
      setValidationError(
        `笔记内容不能超过 ${MAX_NOTE_BYTES.toLocaleString()} 字节且不能包含非法空字符`,
      );
      return;
    }
    setValidationError("");

    if (inFlightRef.current) {
      pendingRef.current = {
        silent: pendingRef.current ? pendingRef.current.silent && silent : silent,
      };
      return;
    }

    inFlightRef.current = true;
    let currentSilent = silent;
    try {
      while (true) {
        const snapshot = latestRef.current;
        const bodyNote = snapshot.note.trim();
        if (utf8ByteLength(bodyNote) > MAX_NOTE_BYTES || hasControlNull(bodyNote)) {
          setValidationError(
            `笔记内容不能超过 ${MAX_NOTE_BYTES.toLocaleString()} 字节且不能包含非法空字符`,
          );
          break;
        }
        const savedRecord = await action.run<Note>(
          `/resources/${resourceId}/note`,
          { note: bodyNote, favorite: snapshot.favorite },
          "PUT",
          "笔记与收藏已保存",
          { invalidatePrefixes: ["notes"], silent: currentSilent },
        );
        if (savedRecord) {
          blockedSnapshotRef.current = null;
          setAutoSaveError("");
          draft.saved(snapshot);
        } else {
          blockedSnapshotRef.current = JSON.stringify(snapshot);
          if (currentSilent) {
            setAutoSaveError("自动保存失败，请点击“保存笔记与收藏”重试。");
          } else {
            setAutoSaveError("");
          }
          break;
        }
        const queued = pendingRef.current;
        if (!queued) break;
        pendingRef.current = null;
        currentSilent = queued.silent;
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!draft.dirty || !draft.ready || validationError) return;
    if (blockedSnapshotRef.current === JSON.stringify(draft.value)) return;
    const timer = window.setTimeout(() => {
      void save(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [note, favorite, draft.dirty, draft.ready, validationError]);

  const statusText = query.isPending
    ? "正在读取笔记…"
    : action.busy
      ? "正在保存…"
      : validationError
        ? "内容超出限制"
        : autoSaveError || action.failed
          ? "保存失败，请重试"
          : draft.dirty
            ? "待保存"
            : "已同步";

  return (
    <Form
      className="live-form"
      onFinish={() => {
        void save(false);
      }}
      layout="vertical"
    >
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          blockedSnapshotRef.current = null;
          setValidationError("");
          setAutoSaveError("");
          draft.reset(initial);
        }}
      />
      <p role="status" className="live-meta">
        {statusText}
      </p>
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      {autoSaveError && (
        <Alert type="warning" showIcon role="alert" message={autoSaveError} />
      )}
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      <Field
        className="ui-field"
        label="我的笔记"
        extra={
          <Typography.Text type={noteBytes > MAX_NOTE_BYTES ? "danger" : "secondary"}>
            {noteBytes.toLocaleString()} / {MAX_NOTE_BYTES.toLocaleString()} 字节
          </Typography.Text>
        }
      >
        <Input.TextArea
          aria-label="我的笔记"
          rows={5}
          disabled={!draft.ready}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Checkbox
        disabled={!draft.ready}
        checked={favorite}
        onChange={(e) => setFavorite(e.target.checked)}
      >
        收藏这份资料
      </Checkbox>
      <Button
        disabled={action.busy || !draft.ready || noteBytes > MAX_NOTE_BYTES}
        htmlType="submit"
      >
        保存笔记与收藏
      </Button>
    </Form>
  );
}
