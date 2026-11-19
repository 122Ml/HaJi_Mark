import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Collapse, Form, Input, Popconfirm, Select, Space } from "antd";
import { Field } from "../shared/Field";
import { LoadingState, StatusTag } from "../shared/ui";
import { Feedback, useAction, useLiveQuery, when } from "./context";
import type { Point } from "./types";
import { cleanTags, dedupeStrings, hasControlNull, utf8ByteLength } from "./validation";

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
  const [open, setOpen] = useState(false);
  const q = useLiveQuery<TopicData>("/topics", open);
  const action = useAction();
  const [editing, setEditing] = useState<Topic | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");

  const topics = q.data?.topics || [];
  const visibleTopics = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter((t) =>
      `${t.title} ${t.description}`.toLowerCase().includes(needle),
    );
  }, [topics, search]);

  const staleConflict =
    action.error?.status === 409 && action.error.code === "stale_revision";
  const duplicateConflict =
    action.error?.status === 409 && action.error.code === "duplicate_topic";

  function clearEditor() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setFormError("");
  }

  function validateTopicInput(rawTitle: string, rawDescription: string): string {
    const trimmed = rawTitle.trim();
    if (!trimmed) return "请填写专题名称";
    if (hasControlNull(trimmed) || hasControlNull(rawDescription)) {
      return "专题名称或说明包含非法字符";
    }
    if (utf8ByteLength(trimmed) > 300) {
      return "专题名称不能超过 300 字节";
    }
    if (utf8ByteLength(rawDescription) > 5000) {
      return "专题说明不能超过 5000 字节";
    }
    return "";
  }

  return (
    <Collapse
      className="card-panel"
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: <>专题管理</>,
          children: (
            <>
              <Feedback
                error={q.error || (formError ? new Error(formError) : undefined)}
                message={action.message}
                failed={action.failed}
              />
              {staleConflict && (
                <Alert
                  type="warning"
                  showIcon
                  message="专题版本已变化，请刷新后再保存。"
                  action={
                    <Button
                      size="small"
                      htmlType="button"
                      onClick={async () => {
                        const refreshed = await q.refetch();
                        const latest = refreshed.data?.topics.find(
                          (t) => t.id === editing?.id,
                        );
                        if (latest) {
                          setEditing(latest);
                          setTitle(latest.title);
                          setDescription(latest.description);
                        } else {
                          clearEditor();
                        }
                        action.setMessage("");
                      }}
                    >
                      刷新专题列表
                    </Button>
                  }
                />
              )}
              {duplicateConflict && (
                <Alert
                  type="warning"
                  showIcon
                  message="课程内已存在同名专题，请更换名称或直接选择已有专题编辑。"
                />
              )}
              {q.isPending ? (
                <LoadingState />
              ) : (
                <>
                  {topics.length > 8 && (
                    <Input.Search
                      aria-label="搜索专题"
                      placeholder="筛选已有专题"
                      allowClear
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  )}
                  {!topics.length ? (
                    <p className="live-meta">暂无专题，可在下方新建课程专题。</p>
                  ) : !visibleTopics.length ? (
                    <p className="live-meta">没有匹配的专题。</p>
                  ) : (
                    <div className="live-inline">
                      {visibleTopics.map((t) => (
                        <Button
                          key={t.id}
                          htmlType="button"
                          type={editing?.id === t.id ? "primary" : "default"}
                          onClick={() => {
                            setEditing(t);
                            setTitle(t.title);
                            setDescription(t.description);
                            setFormError("");
                          }}
                        >
                          {t.title}
                          {!t.active && (
                            <StatusTag status="archived" label="已停用" />
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <Form
                className="live-form"
                onFinish={async () => {
                  const err = validateTopicInput(title, description);
                  if (err) {
                    setFormError(err);
                    return;
                  }
                  setFormError("");
                  const trimmedTitle = title.trim();
                  const r = await action.run<Topic>(
                    editing ? `/topics/${editing.id}` : "/topics",
                    {
                      title: trimmedTitle,
                      description,
                      active: editing?.active ?? true,
                      edit_version: editing?.edit_version,
                    },
                    editing ? "PUT" : "POST",
                    undefined,
                    { invalidatePrefixes: ["topics", "question-bank"] },
                  );
                  if (r) {
                    clearEditor();
                  }
                }}
                layout="vertical"
              >
                <Field
                  className="ui-field"
                  label={<>专题名称</>}
                  required={true}
                >
                  <Input
                    aria-label="专题名称"
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (formError) setFormError("");
                    }}
                  />
                </Field>
                <Field className="ui-field" label={<>说明</>}>
                  <Input.TextArea
                    aria-label="说明"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      if (formError) setFormError("");
                    }}
                  />
                </Field>
                <div className="live-inline">
                  <Button
                    disabled={action.busy || !title.trim()}
                    htmlType="submit"
                    type="primary"
                  >
                    {editing ? "保存专题" : "新增专题"}
                  </Button>
                  {editing && (
                    <>
                      <Button
                        disabled={action.busy}
                        onClick={async () => {
                          const nextTitle = title.trim() || editing.title;
                          const err = validateTopicInput(nextTitle, description);
                          if (err) {
                            setFormError(err);
                            return;
                          }
                          setFormError("");
                          const updated = await action.run<Topic>(
                            `/topics/${editing.id}`,
                            {
                              title: nextTitle,
                              description,
                              active: !editing.active,
                              edit_version: editing.edit_version,
                            },
                            "PUT",
                            undefined,
                            { invalidatePrefixes: ["topics", "question-bank"] },
                          );
                          if (updated) {
                            setEditing(updated);
                            setTitle(updated.title);
                            setDescription(updated.description);
                          }
                        }}
                        htmlType="button"
                      >
                        {editing.active ? "停用" : "恢复"}
                      </Button>
                      <Popconfirm
                        title={`确认永久删除专题“${editing.title}”？`}
                        description="删除后将移除该专题与资料、知识条目及题目的关联，原内容本身保留。"
                        onConfirm={async () => {
                          const removed = await action.run(
                            `/topics/${editing.id}`,
                            undefined,
                            "DELETE",
                            "专题已删除",
                            { invalidatePrefixes: ["topics", "question-bank"] },
                          );
                          if (removed) clearEditor();
                        }}
                      >
                        <Button danger disabled={action.busy} htmlType="button">
                          删除专题
                        </Button>
                      </Popconfirm>
                      <Button onClick={clearEditor} htmlType="button">
                        取消
                      </Button>
                    </>
                  )}
                </div>
                {editing?.active && (
                  <p className="live-meta">
                    停用后，已关联该专题的资料或知识再次保存关联时需先移除已停用专题。
                  </p>
                )}
              </Form>
            </>
          ),
        },
      ]}
    />
  );
}

export function ContentLinks({
  kind,
  id,
}: {
  kind: "source" | "knowledge" | "question";
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useLiveQuery<TopicData>("/topics", open && !!id);
  const action = useAction();
  const [ids, setIds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pointIDs, setPoints] = useState<string[]>([]);
  const [validationError, setValidationError] = useState("");
  const points = useLiveQuery<{ points: Point[] }>(
    "",
    open && kind === "source",
  );
  const key =
    kind === "source"
      ? "source_id"
      : kind === "knowledge"
        ? "knowledge_id"
        : "bank_version_id";

  useEffect(() => {
    setDirty(false);
    setValidationError("");
  }, [id, kind]);

  useEffect(() => {
    if (!dirty && q.data) {
      setIds(
        dedupeStrings(
          q.data.links.filter((l) => l[key] === id).map((l) => l.topic_id),
        ),
      );
      const meta = q.data.tags.find(
        (t) => t.object_kind === kind && t.object_id === id,
      );
      setTags(cleanTags(meta?.tags || []));
      setPoints(dedupeStrings(meta?.knowledge_point_ids || []));
    }
  }, [q.data, id, dirty, key, kind]);

  const topics = q.data?.topics || [];
  const activeTopicIDs = useMemo(
    () => new Set(topics.filter((t) => t.active).map((t) => t.id)),
    [topics],
  );
  const inactiveSelected = useMemo(
    () => (q.data ? ids.filter((tid) => !activeTopicIDs.has(tid)) : []),
    [q.data, ids, activeTopicIDs],
  );

  const validPoints = useMemo(
    () => (points.data?.points || []).filter((p) => p.kind === "point"),
    [points.data?.points],
  );

  function validateLinks(
    nextIDs: string[],
    nextTags: string[],
    nextPoints: string[],
  ): string {
    if (nextIDs.length > 30) return "关联专题最多 30 项";
    if (nextTags.length > 30) return "标签最多 30 项";
    if (nextPoints.length > 100) return "关联知识点最多 100 项";
    for (const tag of nextTags) {
      if (hasControlNull(tag) || utf8ByteLength(tag) > 100) {
        return `标签「${tag}」长度不能超过 100 字节`;
      }
    }
    if (q.data && nextIDs.some((tid) => !activeTopicIDs.has(tid))) {
      return "所选专题包含已停用或已失效专题，请先移除后再保存";
    }
    return "";
  }

  return (
    <Collapse
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: <>专题与标签</>,
          children: (
            <div className="live-form">
              <Feedback
                error={
                  q.error ||
                  points.error ||
                  (validationError ? new Error(validationError) : undefined)
                }
                message={action.message}
                failed={action.failed}
              />
              {q.isPending ? (
                <LoadingState />
              ) : (
                <>
                  {inactiveSelected.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`当前关联包含 ${inactiveSelected.length} 个已停用专题，保存前需移除。`}
                      action={
                        <Button
                          size="small"
                          htmlType="button"
                          onClick={() => {
                            setIds(
                              ids.filter((tid) => activeTopicIDs.has(tid)),
                            );
                            setDirty(true);
                            setValidationError("");
                          }}
                        >
                          移除已停用专题
                        </Button>
                      }
                    />
                  )}
                  <Field className="ui-field" label={<>所属专题</>}>
                    <Select
                      aria-label="所属专题"
                      mode="multiple"
                      optionFilterProp="label"
                      placeholder={
                        topics.length
                          ? "选择课程专题"
                          : "暂无可用专题，请先在专题管理中创建"
                      }
                      value={ids}
                      options={topics.map((t) => ({
                        value: t.id,
                        label: t.title + (t.active ? "" : "（已停用）"),
                        disabled: !t.active,
                      }))}
                      onChange={(v) => {
                        setIds(dedupeStrings(v));
                        setDirty(true);
                        setValidationError("");
                      }}
                    />
                  </Field>
                  <Field className="ui-field" label={<>标签</>}>
                    <Select
                      aria-label="内容标签"
                      mode="tags"
                      placeholder="输入标签后按回车（最多 30 项）"
                      value={tags}
                      onChange={(v) => {
                        setTags(cleanTags(v));
                        setDirty(true);
                        setValidationError("");
                      }}
                    />
                  </Field>
                  {kind === "source" && (
                    <Field className="ui-field" label={<>课程知识点</>}>
                      <Select
                        mode="multiple"
                        aria-label="资料关联知识点"
                        optionFilterProp="label"
                        loading={points.isPending}
                        placeholder={
                          validPoints.length
                            ? "选择关联知识点"
                            : "当前课程暂无可选知识点"
                        }
                        value={pointIDs}
                        onChange={(v) => {
                          setPoints(dedupeStrings(v));
                          setDirty(true);
                          setValidationError("");
                        }}
                        options={validPoints.map((p) => ({
                          value: p.id,
                          label: p.title,
                        }))}
                      />
                    </Field>
                  )}
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={action.busy || !dirty}
                      onClick={async () => {
                        const cleanIDs = dedupeStrings(ids);
                        const normalizedTags = cleanTags(tags);
                        const validPointSet = new Set(
                          validPoints.map((p) => p.id),
                        );
                        const cleanPointIDs =
                          kind === "source"
                            ? dedupeStrings(pointIDs).filter(
                                (pid) =>
                                  !points.data || validPointSet.has(pid),
                              )
                            : [];
                        const err = validateLinks(
                          cleanIDs,
                          normalizedTags,
                          cleanPointIDs,
                        );
                        if (err) {
                          setValidationError(err);
                          return;
                        }
                        setValidationError("");
                        const saved = await action.run(
                          "/content-links",
                          {
                            kind,
                            id,
                            topic_ids: cleanIDs,
                            tags: normalizedTags,
                            knowledge_point_ids: cleanPointIDs,
                          },
                          "PUT",
                          undefined,
                          {
                            invalidatePrefixes: [
                              "topics",
                              "question-bank",
                              "sources",
                              "knowledge",
                            ],
                          },
                        );
                        if (saved) {
                          setIds(cleanIDs);
                          setTags(normalizedTags);
                          setPoints(cleanPointIDs);
                          setDirty(false);
                        }
                      }}
                    >
                      保存关联
                    </Button>
                  </Space>
                </>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

const decisionNames: Record<string, string> = {
  source_suggestions: "资料归类确认",
  asset_crop: "图像区域裁剪",
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
  const [open, setOpen] = useState(false);
  const q = useLiveQuery<
    {
      id: string;
      kind: string;
      reason: string;
      created_at: string;
    }[]
  >(`/decisions?object_id=${encodeURIComponent(id)}`, open && !!id);

  return (
    <Collapse
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: <>处理记录</>,
          children: (
            <>
              <Feedback error={q.error} />
              {q.isPending ? (
                <LoadingState />
              ) : q.data?.length ? (
                q.data.map((d) => (
                  <article className="rag-hit" key={d.id}>
                    <strong>{decisionNames[d.kind] || "内容处理"}</strong>
                    {d.reason && <p>{d.reason}</p>}
                    <small>{when(d.created_at)}</small>
                  </article>
                ))
              ) : (
                <p>暂无处理记录</p>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
