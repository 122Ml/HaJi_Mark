import { Field } from "../shared/Field";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Pagination,
  Select,
  Tag,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import {
  Feedback,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
} from "../shared/ui";
import { DraftNotice, useEditorDraft } from "./editing";
import { hasControlNull, utf8ByteLength } from "./validation";

interface Post {
  id: string;
  kind: string;
  title: string;
  content: string;
  parent_id: string | null;
  author_name: string;
  author_role?: string;
  created_at: string;
}

interface ComposerState {
  kind: string;
  title: string;
  content: string;
}

const KIND_TITLES: Record<string, string> = {
  announcement: "课程公告",
  question: "课程提问",
  discussion: "课程讨论",
};

const KIND_TAGS: Record<string, string> = {
  announcement: "公告",
  question: "提问",
  discussion: "讨论",
};

const MAX_TITLE_BYTES = 500;
const MAX_CONTENT_BYTES = 30_000;
const PAGE_SIZE = 10;

function truncateUTF8(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let result = "";
  let used = 0;
  for (const ch of text) {
    const chBytes = utf8ByteLength(ch);
    if (used + chBytes > maxBytes) break;
    result += ch;
    used += chBytes;
  }
  return result;
}

function safeReplyTitle(parentTitle: string): string {
  const trimmed = parentTitle.trim();
  if (!trimmed) return "";
  return truncateUTF8(`回复：${trimmed}`, MAX_TITLE_BYTES);
}

export function InteractionPage() {
  const { session } = useSession();
  const { course } = useLearning();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<Post[]>("/interactions");
  const action = useAction();

  const defaultKind = teacher ? "announcement" : "question";
  const initialComposer = useMemo<ComposerState>(
    () => ({
      kind: defaultKind,
      title: "",
      content: "",
    }),
    [defaultKind],
  );

  const composer = useEditorDraft<ComposerState>(
    `interaction-new:${course?.id || ""}`,
    initialComposer,
    !!course,
  );
  const form = composer.value;

  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [page, setPage] = useState(1);

  const { topLevelPosts, repliesByParent } = useMemo(() => {
    const all = query.data || [];
    const parents: Post[] = [];
    const replyMap = new Map<string, Post[]>();

    for (const p of all) {
      if (!p.parent_id && p.kind !== "reply") {
        parents.push(p);
      } else if (p.parent_id) {
        const list = replyMap.get(p.parent_id);
        if (list) list.push(p);
        else replyMap.set(p.parent_id, [p]);
      }
    }

    // Sort replies chronologically (oldest -> newest) inside each thread.
    for (const list of replyMap.values()) {
      list.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }

    return { topLevelPosts: parents, repliesByParent: replyMap };
  }, [query.data]);

  const filteredPosts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return topLevelPosts.filter((p) => {
      if (kindFilter && p.kind !== kindFilter) return false;
      if (!keyword) return true;
      const replies = repliesByParent.get(p.id) || [];
      return (
        p.title.toLowerCase().includes(keyword) ||
        p.content.toLowerCase().includes(keyword) ||
        p.author_name.toLowerCase().includes(keyword) ||
        replies.some(
          (r) =>
            r.content.toLowerCase().includes(keyword) ||
            r.author_name.toLowerCase().includes(keyword),
        )
      );
    });
  }, [topLevelPosts, repliesByParent, search, kindFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function handlePublish() {
    const trimmedTitle = form.title.trim();
    const trimmedContent = form.content.trim();
    if (utf8ByteLength(trimmedTitle) > MAX_TITLE_BYTES || hasControlNull(trimmedTitle)) {
      setFormError("标题不能超过 500 字节且不能包含非法空字符");
      return;
    }
    if (
      !trimmedContent ||
      utf8ByteLength(trimmedContent) > MAX_CONTENT_BYTES ||
      hasControlNull(trimmedContent)
    ) {
      setFormError("内容不能为空，且不能超过 30,000 字节");
      return;
    }
    setFormError("");
    const created = await action.run(
      "/interactions",
      {
        kind: form.kind,
        title: trimmedTitle,
        content: trimmedContent,
      },
      "POST",
      "内容已发布到当前课程",
    );
    if (created) {
      composer.reset(initialComposer);
    }
  }

  const visiblePosts = filteredPosts.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  return (
    <div className="live-page">
      <PageHeader
        title="课程互动"
        subtitle={course?.title}
        meta={!query.isPending && !query.error ? <MetaTag>{topLevelPosts.length} 条主题</MetaTag> : undefined}
      />
      {query.error && (
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      )}
      <Feedback message={action.message} failed={action.failed} />
      <div className="interaction-layout">
        <div className="live-stack">
          {topLevelPosts.length > 0 && (
            <div className="filter-bar">
              <Input.Search
                aria-label="搜索课程互动"
                placeholder="搜索标题、正文、回复或发布者"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                allowClear
              />
              <Select
                aria-label="筛选互动类型"
                value={kindFilter}
                onChange={(val) => {
                  setKindFilter(val);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部类型" },
                  { value: "announcement", label: "公告" },
                  { value: "discussion", label: "讨论" },
                  { value: "question", label: "提问" },
                ]}
              />
            </div>
          )}

          {visiblePosts.map((p) => {
            const replies = repliesByParent.get(p.id) || [];
            return (
              <Card
                className="card-panel"
                key={p.id}
                title={p.title || KIND_TITLES[p.kind] || "课程互动"}
              >
                <MetaTags>
                  <MetaTag>{KIND_TAGS[p.kind] || p.kind}</MetaTag>
                  {p.author_role === "teacher" && <Tag color="cyan">教师</Tag>}
                  <span className="live-meta">{p.author_name}</span>
                  <span className="live-meta">{when(p.created_at)}</span>
                </MetaTags>
                <p className="live-prose">{p.content}</p>
                {replies.map((r) => (
                  <blockquote key={r.id}>
                    <strong>{r.author_name}</strong>{" "}
                    {r.author_role === "teacher" && <Tag color="cyan">教师</Tag>}
                    <span className="live-meta"> · {when(r.created_at)}</span>
                    <p className="live-prose">{r.content}</p>
                  </blockquote>
                ))}
                <InlineReply post={p} />
              </Card>
            );
          })}

          {query.isPending ? (
            <LoadingState label="正在读取课程互动…" />
          ) : !query.error && !topLevelPosts.length ? (
            <Card className="card-panel">
              <EmptyState title="还没有课程互动" />
            </Card>
          ) : !query.error && !filteredPosts.length ? (
            <Card className="card-panel">
              <EmptyState title="没有匹配的课程互动" />
            </Card>
          ) : null}

          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={filteredPosts.length}
            onChange={setPage}
            showSizeChanger={false}
            hideOnSinglePage
            responsive
          />
        </div>

        <Card className="card-panel interaction-composer" title="发布内容">
          <Form
            className="live-form"
            onFinish={() => {
              void handlePublish();
            }}
            layout="vertical"
          >
            <DraftNotice
              restored={composer.restored}
              storageError={composer.storageError}
              onDiscard={() => {
                setFormError("");
                composer.reset(initialComposer);
              }}
            />
            {formError && (
              <Alert type="error" showIcon role="alert" message={formError} />
            )}
            <Field className="ui-field" label="类型">
              <Select
                aria-label="类型"
                value={form.kind}
                onChange={(val) => {
                  setFormError("");
                  composer.change((prev) => ({ ...prev, kind: val }));
                }}
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
              </Select>
            </Field>
            <Field className="ui-field" label="标题">
              <Input
                aria-label="标题"
                value={form.title}
                onChange={(e) => {
                  setFormError("");
                  composer.change((prev) => ({ ...prev, title: e.target.value }));
                }}
              />
            </Field>
            <Field className="ui-field" label="内容" required>
              <Input.TextArea
                aria-label="内容"
                rows={4}
                value={form.content}
                onChange={(e) => {
                  setFormError("");
                  composer.change((prev) => ({
                    ...prev,
                    content: e.target.value,
                  }));
                }}
              />
            </Field>
            <Button
              disabled={action.busy || !form.content.trim()}
              htmlType="submit"
              type="primary"
            >
              发布
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}

function InlineReply({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const [replyError, setReplyError] = useState("");
  const draft = useEditorDraft(`discussion-reply:${post.id}`, "", true, {
    blockNavigation: open,
  });
  const action = useAction();

  const hasUnsentDraft = !!draft.value.trim();

  async function handleSubmitReply() {
    const trimmed = draft.value.trim();
    if (
      !trimmed ||
      utf8ByteLength(trimmed) > MAX_CONTENT_BYTES ||
      hasControlNull(trimmed)
    ) {
      setReplyError("回复内容不能为空，且不能超过 30,000 字节");
      return;
    }
    setReplyError("");
    const saved = await action.run(
      "/interactions",
      {
        kind: "reply",
        parent_id: post.id,
        title: safeReplyTitle(post.title),
        content: trimmed,
      },
      "POST",
      "回复已发布到当前讨论",
    );
    if (saved) {
      draft.reset("");
      setOpen(false);
    }
  }

  return (
    <div className="discussion-reply">
      <div className="live-inline">
        <Button
          aria-expanded={open}
          onClick={() => {
            setReplyError("");
            action.setMessage("");
            setOpen((prev) => !prev);
          }}
        >
          {open ? "收起回复" : "回复"}
        </Button>
        {!open && hasUnsentDraft && <Tag color="warning">草稿未发</Tag>}
      </div>
      {open && (
        <Form
          layout="vertical"
          onFinish={() => {
            void handleSubmitReply();
          }}
        >
          <DraftNotice
            restored={draft.restored}
            storageError={draft.storageError}
            onDiscard={() => {
              setReplyError("");
              draft.reset("");
            }}
          />
          {replyError && (
            <Alert type="error" showIcon role="alert" message={replyError} />
          )}
          <Field
            className="ui-field"
            label={`回复：${post.title || KIND_TITLES[post.kind] || "课程互动"}`}
            required
          >
            <Input.TextArea
              aria-label="回复内容"
              autoFocus
              rows={3}
              value={draft.value}
              onChange={(e) => {
                setReplyError("");
                draft.change(e.target.value);
              }}
            />
          </Field>
          <div className="live-inline">
            <Button
              type="primary"
              htmlType="submit"
              loading={action.busy}
              disabled={!draft.value.trim()}
            >
              发布回复
            </Button>
            {hasUnsentDraft && (
              <Button
                htmlType="button"
                onClick={() => {
                  setReplyError("");
                  draft.reset("");
                }}
              >
                清空草稿
              </Button>
            )}
          </div>
        </Form>
      )}
      <Feedback message={action.message} failed={action.failed} />
    </div>
  );
}
