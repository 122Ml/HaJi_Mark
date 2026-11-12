import { useEffect, useState } from "react";
import { Select } from "antd";
import { Feedback, useAction, useLiveQuery } from "./context";

export type Topic = {
  id: string;
  title: string;
  description: string;
  active: boolean;
  edit_version: number;
};
export type TopicData = {
  topics: Topic[];
  links: {
    topic_id: string;
    source_id: string | null;
    knowledge_id: string | null;
    bank_version_id: string | null;
  }[];
  tags: {
    object_kind: string;
    object_id: string;
    tags: string[];
    knowledge_point_ids: string[];
  }[];
};

export function TopicManager() {
  const q = useLiveQuery<TopicData>("/topics"),
    action = useAction();
  const [editing, setEditing] = useState<Topic | null>(null),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState("");
  return (
    <details className="card-panel">
      <summary>专题管理</summary>
      <Feedback
        error={q.error}
        message={action.message}
        failed={action.failed}
      />
      <div className="live-inline">
        {q.data?.topics.map((t) => (
          <button
            className="ghost-btn"
            key={t.id}
            onClick={() => {
              setEditing(t);
              setTitle(t.title);
              setDescription(t.description);
            }}
          >
            {t.title}
            {!t.active && " · 已停用"}
          </button>
        ))}
      </div>
      <form
        className="live-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run(
            editing ? `/topics/${editing.id}` : "/topics",
            {
              title,
              description,
              active: editing?.active ?? true,
              edit_version: editing?.edit_version,
            },
            editing ? "PUT" : "POST",
          );
          if (r) {
            setEditing(null);
            setTitle("");
            setDescription("");
          }
        }}
      >
        <label>
          专题名称
          <input
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          说明
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="live-inline">
          <button className="primary-link" disabled={action.busy}>
            {editing ? "保存专题" : "新增专题"}
          </button>
          {editing && (
            <>
              <button
                type="button"
                className="ghost-btn"
                disabled={action.busy}
                onClick={async () => {
                  const updated = await action.run<Topic>(
                    `/topics/${editing.id}`,
                    { ...editing, active: !editing.active },
                    "PUT",
                  );
                  if (updated) setEditing(updated);
                }}
              >
                {editing.active ? "停用" : "恢复"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setEditing(null);
                  setTitle("");
                  setDescription("");
                }}
              >
                取消
              </button>
            </>
          )}
        </div>
      </form>
    </details>
  );
}

export function ContentLinks({
  kind,
  id,
}: {
  kind: "source" | "knowledge" | "question";
  id: string;
}) {
  const q = useLiveQuery<TopicData>("/topics"),
    action = useAction();
  const [ids, setIds] = useState<string[]>([]),
    [tags, setTags] = useState<string[]>([]),
    [dirty, setDirty] = useState(false),
    [pointIDs, setPoints] = useState<string[]>([]);
  const points = useLiveQuery<{
    points: { id: string; title: string; kind: string }[];
  }>("", kind === "source");
  const key =
    kind === "source"
      ? "source_id"
      : kind === "knowledge"
        ? "knowledge_id"
        : "bank_version_id";
  useEffect(() => {
    if (!dirty && q.data) {
      setIds(q.data.links.filter((l) => l[key] === id).map((l) => l.topic_id));
      const meta = q.data.tags.find(
        (t) => t.object_kind === kind && t.object_id === id,
      );
      setTags(meta?.tags || []);
      setPoints(meta?.knowledge_point_ids || []);
    }
  }, [q.data, id, dirty, key, kind]);
  return (
    <details>
      <summary>专题与标签</summary>
      <div className="live-form">
        <Feedback
          error={q.error}
          message={action.message}
          failed={action.failed}
        />
        <label>
          所属专题
          <Select
            aria-label="所属专题"
            mode="multiple"
            value={ids}
            options={q.data?.topics.map((t) => ({
              value: t.id,
              label: t.title + (t.active ? "" : "（已停用）"),
              disabled: !t.active,
            }))}
            onChange={(v) => {
              setIds(v);
              setDirty(true);
            }}
          />
        </label>
        <label>
          标签
          <Select
            aria-label="内容标签"
            mode="tags"
            value={tags}
            onChange={(v) => {
              setTags(v);
              setDirty(true);
            }}
          />
        </label>
        {kind === "source" && (
          <label>
            课程知识点
            <Select
              mode="multiple"
              aria-label="资料关联知识点"
              value={pointIDs}
              onChange={(v) => {
                setPoints(v);
                setDirty(true);
              }}
              options={points.data?.points
                .filter((p) => p.kind === "point")
                .map((p) => ({ value: p.id, label: p.title }))}
            />
          </label>
        )}
        <button
          className="ghost-btn"
          disabled={action.busy || !dirty}
          onClick={async () => {
            if (
              await action.run(
                "/content-links",
                {
                  kind,
                  id,
                  topic_ids: ids,
                  tags,
                  knowledge_point_ids: pointIDs,
                },
                "PUT",
              )
            )
              setDirty(false);
          }}
        >
          保存关联
        </button>
      </div>
    </details>
  );
}

const decisionNames: Record<string, string> = {
  source_suggestions: "资料归类确认",
  paper_adopt: "试卷拆题入库",
  question_adopt: "题目草稿采纳",
  rubric_adopt: "标准草稿采纳",
  knowledge_discard: "不采纳知识",
  knowledge_merge: "合并知识",
  knowledge_coexist: "按条件并存",
  knowledge_replace: "替换旧知识",
  knowledge_defer: "暂缓处理",
  impact_no_action: "保留历史内容",
  impact_future_version: "后续任务选用新版",
  impact_regrade: "安排整组重评",
};

export function DecisionHistory({ id }: { id: string }) {
  const q = useLiveQuery<
    {
      id: string;
      kind: string;
      reason: string;
      created_at: string;
    }[]
  >(`/decisions?object_id=${encodeURIComponent(id)}`);
  return (
    <details>
      <summary>处理记录</summary>
      <Feedback error={q.error} />
      {q.data?.length ? (
        q.data.map((d) => (
          <article className="rag-hit" key={d.id}>
            <strong>{decisionNames[d.kind] || "内容处理"}</strong>
            <p>{d.reason}</p>
            <small>{new Date(d.created_at).toLocaleString()}</small>
          </article>
        ))
      ) : (
        <p>暂无处理记录</p>
      )}
    </details>
  );
}
