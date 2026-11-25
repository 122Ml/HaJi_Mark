import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Pagination,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Feedback,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import { PageHeader } from "../shared/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../shared/ui";
import { hasControlNull, isValidHTTPUrl, utf8ByteLength } from "./validation";

interface RecordItem {
  id: string;
  title: string;
  content?: string;
  source_url?: string;
  skills?: string;
  created_at: string;
}

interface RecordFormState {
  title: string;
  content: string;
  source_url: string;
  skills: string;
}

const EMPTY_FORM: RecordFormState = {
  title: "",
  content: "",
  source_url: "",
  skills: "",
};

const PAGE_SIZE = 10;

export function RecordsPage({ industry = false }: { industry?: boolean }) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const mode = industry ? "industry" : "research";
  const path = industry ? "/industry" : "/research";
  const query = useLiveQuery<RecordItem[]>(path);
  const action = useAction();

  const [editing, setEditing] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [validationError, setValidationError] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);

  // Reset edit mode when switching between research and industry views.
  useEffect(() => {
    setEditing("");
    setSearch("");
    setPage(1);
    setValidationError("");
  }, [mode, course?.id]);

  const editingRecord = useMemo(
    () => (editing ? query.data?.find((r) => r.id === editing) || null : null),
    [editing, query.data],
  );

  const initialForm = useMemo<RecordFormState>(() => {
    if (!editing || !editingRecord) return EMPTY_FORM;
    return {
      title: editingRecord.title,
      content: editingRecord.content || "",
      source_url: editingRecord.source_url || "",
      skills: editingRecord.skills || "",
    };
  }, [editing, editingRecord]);

  const draftReady = !!course && (!editing || query.isSuccess);
  const draft = useEditorDraft<RecordFormState>(
    `records:${course?.id || ""}:${mode}:${editing || "new"}`,
    initialForm,
    draftReady,
  );
  const form = draft.value;

  const filtered = useMemo(() => {
    const rows = query.data || [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(keyword) ||
        (r.content || "").toLowerCase().includes(keyword) ||
        (r.skills || "").toLowerCase().includes(keyword),
    );
  }, [query.data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function updateField<K extends keyof RecordFormState>(
    key: K,
    val: RecordFormState[K],
  ) {
    setValidationError("");
    draft.change((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSubmit() {
    const trimmedTitle = form.title.trim();
    if (
      !trimmedTitle ||
      utf8ByteLength(trimmedTitle) > 500 ||
      hasControlNull(trimmedTitle)
    ) {
      setValidationError("请填写有效标题（不能为空且不超过 500 字节）");
      return;
    }

    if (industry) {
      const trimmedURL = form.source_url.trim();
      const trimmedSkills = form.skills.trim();
      if (!isValidHTTPUrl(trimmedURL)) {
        setValidationError(
          "请填写完整的 http:// 或 https:// 原始来源链接（不超过 2000 字节）",
        );
        return;
      }
      if (
        !trimmedSkills ||
        utf8ByteLength(trimmedSkills) > 30_000 ||
        hasControlNull(trimmedSkills)
      ) {
        setValidationError("请填写有效的技能要求（不超过 30,000 字节）");
        return;
      }
      setValidationError("");
      const saved = await action.run(
        editing ? `${path}/${editing}` : path,
        {
          title: trimmedTitle,
          source_url: trimmedURL,
          skills: trimmedSkills,
        },
        editing ? "PUT" : "POST",
        editing ? "岗位与技能记录已更新" : "岗位与技能记录已保存",
      );
      if (saved) {
        draft.reset(EMPTY_FORM);
        setEditing("");
      }
      return;
    }

    const trimmedContent = form.content.trim();
    if (
      !trimmedContent ||
      utf8ByteLength(trimmedContent) > 30_000 ||
      hasControlNull(trimmedContent)
    ) {
      setValidationError("请填写有效的教研内容（不超过 30,000 字节）");
      return;
    }
    setValidationError("");
    const saved = await action.run(
      editing ? `${path}/${editing}` : path,
      {
        title: trimmedTitle,
        content: trimmedContent,
      },
      editing ? "PUT" : "POST",
      editing ? "教研记录已更新" : "教研记录已保存",
    );
    if (saved) {
      draft.reset(EMPTY_FORM);
      setEditing("");
    }
  }

  const cardTitle = editing
    ? industry
      ? "编辑岗位与技能"
      : "编辑教研记录"
    : industry
      ? "录入岗位与技能"
      : "新增教研记录";

  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="live-page">
      <PageHeader
        title={industry ? "行业能力" : "教研记录"}
        subtitle={course?.title}
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
          {!!query.data?.length && (
            <div className="filter-bar">
              <Input.Search
                aria-label={industry ? "搜索岗位与技能" : "搜索教研记录"}
                placeholder={industry ? "搜索岗位标题或技能要求" : "搜索教研标题或内容"}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                allowClear
              />
            </div>
          )}

          {visibleRows.map((r) => (
            <Card
              className="card-panel"
              key={r.id}
              title={<span style={{ overflowWrap: "anywhere" }}>{r.title}</span>}
              extra={editing === r.id ? <Tag color="processing">编辑中</Tag> : undefined}
            >
              <p className="live-meta">{when(r.created_at)}</p>
              <p className="live-prose">{r.content || r.skills}</p>
              <div className="live-inline">
                <Button
                  onClick={async () => {
                    if (editing === r.id) {
                      composerRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                      return;
                    }
                    if (
                      draft.dirty &&
                      !(await confirm(
                        "当前表单有未保存内容，切换编辑将保留草稿并打开另一条记录，确认继续？",
                      ))
                    ) {
                      return;
                    }
                    setValidationError("");
                    setEditing(r.id);
                    composerRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  编辑
                </Button>
                <Button
                  danger
                  disabled={action.busy}
                  onClick={async () => {
                    if (
                      !(await confirm(`删除记录“${r.title}”？`, {
                        content: "删除后不可恢复，确认继续？",
                        danger: true,
                      }))
                    ) {
                      return;
                    }
                    if (await action.run(`${path}/${r.id}`, undefined, "DELETE", "记录已删除")) {
                      if (editing === r.id) {
                        draft.reset(EMPTY_FORM);
                        setEditing("");
                      }
                    }
                  }}
                >
                  删除
                </Button>
              </div>
              {r.source_url && (
                <div style={{ marginTop: 12 }}>
                  <Typography.Link
                    href={r.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看原始来源
                  </Typography.Link>
                </div>
              )}
            </Card>
          ))}

          {query.isPending ? (
            <LoadingState label="正在读取记录…" />
          ) : !query.error && !query.data?.length ? (
            <Card className="card-panel">
              <EmptyState title="暂无记录" />
            </Card>
          ) : !query.error && !filtered.length ? (
            <Card className="card-panel">
              <EmptyState title="没有匹配的记录" />
            </Card>
          ) : null}

          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
            showSizeChanger={false}
            hideOnSinglePage
            responsive
          />
        </div>

        <div ref={composerRef} className="interaction-composer">
          <Card className="card-panel" title={cardTitle}>
          <Form
            className="live-form"
            onFinish={() => {
              void handleSubmit();
            }}
            layout="vertical"
          >
            <DraftNotice
              restored={draft.restored}
              storageError={draft.storageError}
              onDiscard={() => {
                setValidationError("");
                draft.reset(initialForm);
              }}
            />
            {validationError && (
              <Alert type="error" showIcon role="alert" message={validationError} />
            )}
            <Field className="ui-field" label="标题" required>
              <Input
                aria-label="标题"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
              />
            </Field>
            {industry ? (
              <>
                <Field className="ui-field" label="原始来源链接" required>
                  <Input
                    aria-label="原始来源链接"
                    placeholder="https://example.com/..."
                    value={form.source_url}
                    onChange={(e) => updateField("source_url", e.target.value)}
                  />
                </Field>
                <Field className="ui-field" label="技能要求" required>
                  <Input.TextArea
                    aria-label="技能要求"
                    rows={5}
                    value={form.skills}
                    onChange={(e) => updateField("skills", e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field className="ui-field" label="教研内容" required>
                <Input.TextArea
                  aria-label="教研内容"
                  rows={6}
                  value={form.content}
                  onChange={(e) => updateField("content", e.target.value)}
                />
              </Field>
            )}
            <div className="live-inline">
              <Button disabled={action.busy} htmlType="submit" type="primary">
                {editing ? "保存修改" : "保存记录"}
              </Button>
              {editing && (
                <Button
                  onClick={async () => {
                    if (
                      draft.dirty &&
                      !(await confirm("放弃当前编辑并返回新增模式？"))
                    ) {
                      return;
                    }
                    setValidationError("");
                    draft.reset(initialForm);
                    setEditing("");
                  }}
                  htmlType="button"
                >
                  取消编辑
                </Button>
              )}
            </div>
          </Form>
        </Card>
        </div>
      </div>
    </div>
  );
}
