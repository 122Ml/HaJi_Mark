import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Form,
  Input,
  Pagination,
  Popover,
  Progress,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { History, Keyboard } from "lucide-react";
import { Field } from "../shared/Field";
import { PageHeader } from "../shared/PageHeader";
import { requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import { useSession } from "../shared/session";
import {
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { PublishedAssets, RichContent } from "./content-render";
import { ContextAgent } from "./context-agent";
import {
  Feedback,
  Link,
  useAction,
  useCourseNavigate,
  useLearning,
  useLiveQuery,
  uuid,
  when,
} from "./context";
import { formatResourceLocator, labelFor, stateLabels } from "./domain-meta";
import { DraftNotice, useEditorDraft } from "./editing";
import {
  PointGradeForm,
  RevisionPoints,
  type LiveRevision,
  type RubricVersion,
} from "./rubrics";
import { IntegerInput } from "./shared-editors";
import type {
  ActiveRegradeNotice,
  Question,
  Resource,
  Submission,
} from "./types";
import { hasControlNull } from "./validation";

export interface QueueItem {
  id: string;
  assignment_id: string;
  question_id: string;
  student_id: string;
  student_name: string;
  prompt: string;
  attempt: number;
  review_state: string;
  submitted_at: string;
  teacher_imported?: boolean;
}

export const reviewNames: Record<string, string> = {
  pending: "待批阅",
  draft: "待确认",
  confirmed: "待发布",
  released: "已发布",
};

type LiveQuestion = Question & {
  bank_question_version_id?: string | null;
  bound_rubric_id?: string | null;
};

type LiveSubmission = Submission & {
  answer_sha256?: string;
};

function findMatchRanges(text: string, needle: string): [number, number][] {
  if (!needle) return [];
  const normChars: string[] = [];
  const indexMap: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\r" && text[i + 1] === "\n") continue;
    normChars.push(text[i] === "\r" ? "\n" : text[i]);
    indexMap.push(i);
  }
  const normText = normChars.join("");
  const normNeedle = needle.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normNeedle) return [];
  const ranges: [number, number][] = [];
  let pos = 0;
  while (pos <= normText.length - normNeedle.length) {
    const found = normText.indexOf(normNeedle, pos);
    if (found < 0) break;
    const origStart = indexMap[found];
    const origEnd = indexMap[found + normNeedle.length - 1] + 1;
    ranges.push([origStart, origEnd]);
    pos = found + normNeedle.length;
  }
  return ranges;
}

function hasFormattedMarkup(text: string): boolean {
  return /(\$\$?|\\\(|\\\[|```|^\s*#{1,6}\s|\*\*|`[^`]+`)/m.test(text);
}

export function GradePage() {
  const confirm = useConfirm();
  const { submissionId } = useParams();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const [params, setParams] = useSearchParams();
  const navigate = useCourseNavigate();
  const { course } = useLearning();
  const [queueError, setQueueError] = useState("");
  const [moving, setMoving] = useState(false);

  const query = useLiveQuery<{
    submission: LiveSubmission;
    question: LiveQuestion;
    revisions: LiveRevision[];
    import_origin?: { id: string; created_at: string } | null;
    active_regrade_batch?: string | ActiveRegradeNotice | null;
  }>(`/submissions/${submissionId}`);
  const data = query.data;

  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") || "";
  const state = params.get("state") || "";
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const queue = useLiveQuery<{ rows: QueueItem[]; total: number }>(
    `/assignments/${data?.submission.assignment_id}/worklist?${new URLSearchParams({
      page: String(page),
      size: "20",
      search,
      state,
    })}`,
    teacher && !!data,
  );
  const rubrics = useLiveQuery<RubricVersion[]>(
    `/questions/${data?.question.id}/rubrics`,
    teacher && !!data && data.question.type !== "quiz",
  );
  const resources = useLiveQuery<Resource[]>(
    "/resources",
    !!data?.question.resource_id,
  );

  const action = useAction();
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [rubricID, setRubricID] = useState("");
  const [selection, setSelection] = useState("");
  const [criterion, setCriterion] = useState("");
  const [quoteRequest, setQuoteRequest] = useState<{
    id: string;
    text: string;
    seq: number;
  } | null>(null);
  const [highlight, setHighlight] = useState<{ text: string; seq: number } | null>(null);
  const [answerView, setAnswerView] = useState<"raw" | "rich">("raw");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const initViewSubRef = useRef("");
  const original = useRef<HTMLElement>(null);
  const saveFormRef = useRef<(() => void) | null>(null);
  const lastNeighborsRef = useRef<{ prevId?: string; nextId?: string }>({});

  const latest = data?.revisions[0];
  const latestRubricID = latest?.rubric_id ?? latest?.rubric_version_id ?? null;
  const confirmed = (rubrics.data || []).filter((r) => r.state === "confirmed");
  const rubric =
    confirmed.find((r) => r.id === rubricID) ||
    confirmed.find((r) => r.id === latestRubricID) ||
    confirmed[0];
  const showEditor =
    teacher && data?.question.type !== "quiz" && (!latest || editing);

  const activeRegradeBatchID = useMemo(() => {
    const raw = data?.active_regrade_batch;
    if (!raw) return "";
    return typeof raw === "string" ? raw : raw.id || "";
  }, [data?.active_regrade_batch]);

  useEffect(() => {
    setQuoteRequest(null);
    setCriterion("");
    setEditing(false);
    setFormDirty(false);
    setSelection("");
    setHighlight(null);
    setRubricID("");
    setQueueError("");
    setAnswerView("raw");
    setPromptExpanded(false);
    initViewSubRef.current = "";
  }, [submissionId, teacher]);

  useEffect(() => {
    if (!data || teacher) return;
    if (initViewSubRef.current === data.submission.id) return;
    initViewSubRef.current = data.submission.id;
    if (hasFormattedMarkup(data.submission.answer_text)) {
      setAnswerView("rich");
    }
  }, [data, teacher]);

  const update = useCallback(
    (values: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const openSubmission = useCallback(
    (id: string, targetPage?: number) => {
      const nextParams = new URLSearchParams(params);
      if (targetPage !== undefined) nextParams.set("page", String(targetPage));
      navigate(`/teacher/homework/submissions/${id}/grade?${nextParams}`);
    },
    [navigate, params],
  );

  const queueRows = queue.data?.rows || [];
  const queueTotal = queue.data?.total || 0;
  const index = queueRows.findIndex((r) => r.id === submissionId);

  useEffect(() => {
    if (index >= 0) {
      lastNeighborsRef.current = {
        prevId: queueRows[index - 1]?.id,
        nextId: queueRows[index + 1]?.id,
      };
    }
  }, [index, queueRows]);

  const fallbackPrevId =
    index < 0 && lastNeighborsRef.current.prevId && queueRows.some((r) => r.id === lastNeighborsRef.current.prevId)
      ? lastNeighborsRef.current.prevId
      : undefined;
  const fallbackNextId =
    index < 0
      ? (lastNeighborsRef.current.nextId && queueRows.some((r) => r.id === lastNeighborsRef.current.nextId)
          ? lastNeighborsRef.current.nextId
          : queueRows[0]?.id)
      : undefined;

  const canPrev =
    !moving &&
    !!queue.data &&
    (index > 0 || (index === 0 && page > 1) || (index < 0 && (!!fallbackPrevId || page > 1)));
  const canNext =
    !moving &&
    !!queue.data &&
    ((index >= 0 && (index < queueRows.length - 1 || page * 20 < queueTotal)) ||
      (index < 0 && (!!fallbackNextId || page * 20 < queueTotal)));

  const move = useCallback(
    async (direction: -1 | 1) => {
      if (!queue.data || !course || !data) return;
      if (index >= 0) {
        const directRow = queueRows[index + direction];
        if (directRow) {
          openSubmission(directRow.id);
          return;
        }
      } else {
        if (direction > 0 && fallbackNextId) {
          openSubmission(fallbackNextId);
          return;
        }
        if (direction < 0 && fallbackPrevId) {
          openSubmission(fallbackPrevId);
          return;
        }
      }
      const targetPage = page + direction;
      if (targetPage < 1) return;
      setMoving(true);
      setQueueError("");
      try {
        const response = await requestJSON<{ data: { rows: QueueItem[] } }>(
          `/learning/courses/${course.id}/assignments/${data.submission.assignment_id}/worklist?${new URLSearchParams({
            page: String(targetPage),
            size: "20",
            search,
            state,
          })}`,
        );
        const target =
          direction > 0 ? response.data.rows[0] : response.data.rows.at(-1);
        if (target) {
          openSubmission(target.id, targetPage);
        } else {
          setQueueError(direction > 0 ? "当前筛选已到达队列末尾。" : "当前筛选已到达队列开头。");
        }
      } catch (e) {
        setQueueError(e instanceof Error ? e.message : "读取队列失败");
      } finally {
        setMoving(false);
      }
    },
    [
      course,
      data,
      fallbackNextId,
      fallbackPrevId,
      index,
      openSubmission,
      page,
      queue.data,
      queueRows,
      search,
      state,
    ],
  );

  // Phase 3 keyboard shortcuts (teacher mode only).
  useEffect(() => {
    if (!teacher) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") {
        event.preventDefault();
        if (showEditor && saveFormRef.current) {
          saveFormRef.current();
        }
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (key === "ArrowUp") {
          event.preventDefault();
          if (canPrev) void move(-1);
          return;
        }
        if (key === "ArrowDown") {
          event.preventDefault();
          if (canNext) void move(1);
          return;
        }
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [teacher, showEditor, canPrev, canNext, move]);

  const captureSelection = useCallback(() => {
    const el = original.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const touchesOriginal =
      el.contains(sel.anchorNode) ||
      el.contains(sel.focusNode) ||
      range.intersectsNode(el);
    if (!touchesOriginal) return;
    try {
      const clamped = document.createRange();
      clamped.selectNodeContents(el);
      if (range.compareBoundaryPoints(Range.START_TO_START, clamped) > 0) {
        clamped.setStart(range.startContainer, range.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, clamped) < 0) {
        clamped.setEnd(range.endContainer, range.endOffset);
      }
      const text = clamped.toString();
      if (text) setSelection(text);
    } catch {
      const fallback = sel.toString();
      if (fallback && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
        setSelection(fallback);
      }
    }
  }, []);

  useEffect(() => {
    if (!showEditor || !rubric || answerView !== "raw") return;
    const onSelectionChange = () => captureSelection();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [showEditor, rubric, answerView, captureSelection]);

  const locate = useCallback((quote: string) => {
    setAnswerView("raw");
    setHighlight({ text: quote, seq: Date.now() });
  }, []);

  const matchRanges = useMemo(
    () =>
      data && highlight?.text
        ? findMatchRanges(data.submission.answer_text, highlight.text)
        : [],
    [data, highlight],
  );

  const selectionMatchRanges = useMemo(
    () =>
      data && selection
        ? findMatchRanges(data.submission.answer_text, selection)
        : [],
    [data, selection],
  );

  useEffect(() => {
    if (!highlight) return;
    const frame = window.requestAnimationFrame(() => {
      original.current
        ?.querySelector("mark")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlight, answerView]);

  if (query.isPending) {
    return (
      <div className="live-page is-wide-workspace">
        <PageHeader title={teacher ? "批阅作答" : "作答反馈"} />
        <LoadingState />
      </div>
    );
  }
  if (query.error || !data) {
    return (
      <div className="live-page is-wide-workspace">
        <PageHeader title={teacher ? "批阅作答" : "作答反馈"} />
        <ErrorState
          message={query.error?.message || "作答不存在"}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const answerText = data.submission.answer_text;
  const studentDisplayName =
    data.submission.student_name ||
    queueRows.find((r) => r.id === submissionId)?.student_name ||
    (teacher ? "学生作答" : session?.user.display_name || "学生");

  function renderHighlightedOriginal(): ReactNode {
    if (!highlight?.text || !matchRanges.length) return answerText;
    const nodes: ReactNode[] = [];
    let cursor = 0;
    matchRanges.forEach(([start, end], i) => {
      if (start > cursor) {
        nodes.push(answerText.slice(cursor, start));
      }
      nodes.push(<mark key={`${start}-${i}`}>{answerText.slice(start, end)}</mark>);
      cursor = end;
    });
    if (cursor < answerText.length) {
      nodes.push(answerText.slice(cursor));
    }
    return nodes;
  }

  const source = resources.data?.find(
    (r) => r.id === data.question.resource_id,
  );
  const latestPoints = latest?.point_scores ?? latest?.point_results;

  return (
    <div
      className={`live-page is-wide-workspace${teacher ? " grading-workspace" : ""}`}
    >
      <PageHeader
        backTo={`/${teacher ? "teacher" : "student"}/homework/${data.submission.assignment_id}${teacher ? `/submissions?${params}` : ""}`}
        backLabel={teacher ? "返回提交队列" : "返回本次作业"}
        title={teacher ? "批阅作答" : "作答反馈"}
        subtitle={`${studentDisplayName} · 第${data.submission.attempt}次作答 · ${when(data.submission.submitted_at)}`}
        meta={
          <>
            <StatusTag
              status={latest?.state || "pending"}
              label={latest ? labelFor(stateLabels, latest.state) : "待批阅"}
            />
            <MetaTag>{data.import_origin ? "教师导入" : "学生提交"}</MetaTag>
            {teacher && queueTotal > 0 && index >= 0 && (
              <MetaTag>第 {index + 1} / {queueTotal} 份</MetaTag>
            )}
          </>
        }
        extra={
          <>
            {teacher && (
              <Popover
                trigger="click"
                placement="bottomRight"
                title="批阅快捷键"
                content={
                  <Space direction="vertical" size={4}>
                    <Typography.Text>
                      <span className="kbd-hint">Alt + ↑ / ↓</span> 切换上一份 / 下一份
                    </Typography.Text>
                    <Typography.Text>
                      <span className="kbd-hint">Ctrl / ⌘ + S</span> 保存当前评分草稿
                    </Typography.Text>
                    <Typography.Text>划选左侧原文可直接引用到右侧评分点</Typography.Text>
                  </Space>
                }
              >
                <Button
                  htmlType="button"
                  icon={<Keyboard size={14} aria-hidden="true" />}
                >
                  快捷键
                </Button>
              </Popover>
            )}
            <ContextAgent
              context={{
                kind: "submission",
                id: data.submission.id,
                title: "当前作答与反馈",
              }}
            />
            <Button
              htmlType="button"
              icon={<History size={14} aria-hidden="true" />}
              onClick={() => setHistory(true)}
            >
              历史记录（{data.revisions.length}）
            </Button>
          </>
        }
      />

      {teacher && activeRegradeBatchID && (
        <Alert
          type="warning"
          showIcon
          message="当前题目存在进行中的整组重评批次，手动评分前请先核对重评状态"
          action={
            <Link to={`/teacher/regrades?batch=${encodeURIComponent(activeRegradeBatchID)}`}>
              前往重评批次
            </Link>
          }
        />
      )}

      <Feedback message={action.message} failed={action.failed} />
      {action.error?.code === "regrade_active" && (
        <Alert
          type="warning"
          showIcon
          message="本题正在整组重评，无法单独保存或发布评分修订。"
          action={
            <Link
              to={
                activeRegradeBatchID
                  ? `/teacher/regrades?batch=${encodeURIComponent(activeRegradeBatchID)}`
                  : "/teacher/regrades"
              }
            >
              前往整组重评
            </Link>
          }
        />
      )}

      <div className={`grading-columns ${teacher ? "" : "student-feedback"}`}>
        {teacher && (
          <Card className="grading-queue card-panel" title={<>提交队列</>}>
            <Input.Search
              aria-label="搜索学生"
              placeholder="搜索学生"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onSearch={(s) => update({ search: s, page: "1" })}
              allowClear
            />
            <Select
              aria-label="批阅状态"
              value={state}
              options={[
                { value: "", label: "全部状态" },
                ...Object.entries(reviewNames).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
              onChange={(v) => update({ state: v, page: "1" })}
            />
            {queue.isPending ? (
              <LoadingState />
            ) : queue.error ? (
              <ErrorState
                message={queue.error.message}
                onRetry={() => void queue.refetch()}
              />
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  <MetaTag>共 {queueTotal} 份</MetaTag>
                </div>
                {queueRows.map((r) => (
                  <Button
                    key={r.id}
                    htmlType="button"
                    onClick={() => openSubmission(r.id)}
                    aria-current={r.id === submissionId ? "true" : undefined}
                    className={`queue-item ${r.id === submissionId ? "active" : ""}`}
                  >
                    <strong>{r.student_name}</strong>
                    <span className="ui-meta-tags">
                      <StatusTag
                        status={r.review_state}
                        label={reviewNames[r.review_state] || r.review_state}
                      />
                      <MetaTag>第 {r.attempt} 次</MetaTag>
                    </span>
                    <small>{r.prompt}</small>
                  </Button>
                ))}
                {!queueRows.length && <p>当前筛选没有提交。</p>}
                <Pagination
                  simple
                  hideOnSinglePage
                  current={page}
                  pageSize={20}
                  total={queueTotal}
                  onChange={(p) => update({ page: String(p) })}
                />
              </>
            )}
          </Card>
        )}

        <Card className="card-panel grading-original" title={<>题目与原始作答</>}>
          <div className="grading-prompt-box">
            <div className="grading-prompt-head">
              <MetaTags>
                <MetaTag>满分 {data.question.max_score}</MetaTag>
                {!teacher && latest?.released_at && (
                  <MetaTag>发布于 {when(latest.released_at)}</MetaTag>
                )}
              </MetaTags>
              {data.question.prompt.length > 180 && (
                <Button
                  size="small"
                  type="link"
                  htmlType="button"
                  onClick={() => setPromptExpanded((v) => !v)}
                >
                  {promptExpanded ? "收起题干" : "展开完整题干"}
                </Button>
              )}
            </div>
            {data.question.prompt.length > 180 && !promptExpanded ? (
              <div className="grading-prompt-preview">{data.question.prompt}</div>
            ) : (
              <>
                <RichContent text={data.question.prompt} />
                <PublishedAssets kind="questions" id={data.question.id} />
              </>
            )}
          </div>

          {data.question.type === "quiz" && data.question.options?.length > 0 && (
            <Space direction="vertical" size="small" className="live-full-width">
              {data.question.options.map((opt, idx) => (
                <div
                  key={idx}
                  className="live-inline"
                  style={{ flexWrap: "nowrap", alignItems: "flex-start" }}
                >
                  <Tag
                    color={opt === answerText ? "processing" : "default"}
                    style={{ flexShrink: 0, marginTop: 3 }}
                  >
                    {String.fromCharCode(65 + idx)}
                    {opt === answerText ? "（已选）" : ""}
                  </Tag>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RichContent text={opt} />
                  </div>
                </div>
              ))}
            </Space>
          )}

          {data.question.type !== "quiz" && (
            <div className="section-head">
              <Typography.Text strong>学生作答</Typography.Text>
              <Segmented
                size="small"
                value={answerView}
                onChange={(v) => {
                  const next = v as "raw" | "rich";
                  setAnswerView(next);
                  if (next === "rich") setSelection("");
                }}
                options={[
                  { value: "raw", label: "作答原文" },
                  { value: "rich", label: "排版预览" },
                ]}
              />
            </div>
          )}

          {highlight && (
            <Space wrap size="small" style={{ marginBottom: 12 }}>
              <MetaTag>
                {matchRanges.length
                  ? `原文高亮：找到 ${matchRanges.length} 处匹配`
                  : "原文中未找到该引用片段"}
              </MetaTag>
              <Button
                size="small"
                htmlType="button"
                onClick={() => setHighlight(null)}
              >
                清除高亮
              </Button>
            </Space>
          )}

          {answerView === "rich" && data.question.type !== "quiz" ? (
            <RichContent text={answerText} />
          ) : (
            <article
              ref={original}
              className="live-prose original-answer"
              onMouseUp={captureSelection}
            >
              {renderHighlightedOriginal()}
            </article>
          )}

          {showEditor && rubric && (
            <Form layout="vertical" component={false}>
              <div className="quote-toolbar">
                <Field className="ui-field" label={<>引用到评分点</>}>
                  <Select
                    aria-label="引用到评分点"
                    value={criterion || rubric.criteria[0]?.id}
                    onChange={(e) => setCriterion(e)}
                    showSearch
                    optionFilterProp="children"
                  >
                    {rubric.criteria.map((p) => (
                      <Select.Option key={p.id} value={p.id}>
                        {p.id} · {p.title}
                      </Select.Option>
                    ))}
                  </Select>
                </Field>
                {selection && (
                  <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>
                    已选中：{selection.length > 60 ? `${selection.slice(0, 60)}…` : selection}
                  </Typography.Text>
                )}
                <Button
                  htmlType="button"
                  disabled={!selection || !selectionMatchRanges.length}
                  onClick={() => {
                    const exactText = answerText.includes(selection)
                      ? selection
                      : selectionMatchRanges.length
                        ? answerText.slice(
                            selectionMatchRanges[0][0],
                            selectionMatchRanges[0][1],
                          )
                        : selection;
                    setQuoteRequest({
                      id: criterion || rubric.criteria[0].id,
                      text: exactText,
                      seq: Date.now(),
                    });
                    setSelection("");
                  }}
                >
                  引用选中文本
                </Button>
              </div>
            </Form>
          )}

          <div className="live-stack" style={{ gap: 12 }}>
            {teacher && data.question.rubric && (
              <Collapse
                items={[
                  {
                    key: "content",
                    label: <>题目评分说明</>,
                    children: <p className="live-prose">{data.question.rubric}</p>,
                  },
                ]}
              />
            )}

            {resources.error && (
              <Alert
                type="warning"
                showIcon
                message={`评分依据资料读取失败：${resources.error.message}`}
              />
            )}

            {source && (
              <Collapse
                items={[
                  {
                    key: "content",
                    label: (
                      <>
                        评分依据：{source.title}
                        {formatResourceLocator(source.locator)
                          ? ` · ${formatResourceLocator(source.locator)}`
                          : ""}{" "}
                        · v{source.version}
                      </>
                    ),
                    children: (
                      <>
                        <RichContent text={source.content} />
                        <p>{source.source_note || source.source_url}</p>
                      </>
                    ),
                  },
                ]}
              />
            )}

            {data.submission.answer_sha256 && (
              <Collapse
                items={[
                  {
                    key: "content",
                    label: <>原文校验信息</>,
                    children: <p className="live-id">{data.submission.answer_sha256}</p>,
                  },
                ]}
              />
            )}
          </div>
        </Card>

        <Card
          className="card-panel grading-editor"
          title={
            <>
              {teacher ? (showEditor ? "填写评分" : "当前评分") : "已发布反馈"}
            </>
          }
        >
          {showEditor ? (
            <>
              {rubrics.isPending ? (
                <LoadingState />
              ) : rubrics.error ? (
                <ErrorState
                  message={rubrics.error.message}
                  onRetry={() => void rubrics.refetch()}
                />
              ) : rubric ? (
                <div className="live-stack">
                  <Form layout="vertical" component={false}>
                    <Field className="ui-field" label={<>使用标准版本</>}>
                      <Select
                        aria-label="使用标准版本"
                        value={rubric.id}
                        onChange={async (e) => {
                          if (
                            !formDirty ||
                            (await confirm(
                              "切换标准后使用该版本的独立草稿？当前编辑已暂存。",
                            ))
                          ) {
                            setRubricID(e);
                          }
                        }}
                        showSearch
                        optionFilterProp="children"
                      >
                        {confirmed.map((r) => (
                          <Select.Option key={r.id} value={r.id}>
                            v{r.version} · 已确认
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                  </Form>
                  <PointGradeForm
                    key={`${submissionId}/${rubric.id}/${latest?.id || "new"}`}
                    rubric={rubric}
                    submissionID={submissionId!}
                    initial={latestRubricID === rubric.id ? latest : undefined}
                    quoteRequest={quoteRequest}
                    onLocate={locate}
                    onSaved={() => setEditing(false)}
                    onDirtyChange={setFormDirty}
                    saveRef={saveFormRef}
                  />
                </div>
              ) : (
                <>
                  <p>
                    <Link
                      to={`/teacher/homework/${data.submission.assignment_id}`}
                    >
                      配置逐点评分标准
                    </Link>
                  </p>
                  <WholeGrade
                    key={submissionId}
                    submissionID={submissionId!}
                    max={data.question.max_score}
                    initial={latest}
                    onSaved={() => setEditing(false)}
                    saveRef={saveFormRef}
                  />
                </>
              )}
            </>
          ) : latest ? (
            <>
              <div className="grading-score-bar">
                <div className="grading-score-head">
                  <div className="grading-score-num">
                    {latest.score}
                    <small>/ {data.question.max_score} 分</small>
                  </div>
                  <MetaTag>
                    {data.question.max_score > 0
                      ? `${Math.round((latest.score / data.question.max_score) * 100)}%`
                      : "—"}
                  </MetaTag>
                </div>
                <Progress
                  percent={
                    data.question.max_score > 0
                      ? Math.min(100, Math.round((latest.score / data.question.max_score) * 100))
                      : 0
                  }
                  showInfo={false}
                  size="small"
                  strokeColor="var(--teal)"
                />
                {latestPoints && latestPoints.length > 0 && (
                  <div className="grading-dim-chips">
                    {latestPoints.map((p, idx) => (
                      <MetaTag key={p.criterion_id || idx}>
                        {p.title || `评分点 ${idx + 1}`} · {p.score}/{p.max_score}
                      </MetaTag>
                    ))}
                  </div>
                )}
              </div>
              <p className="live-prose">{latest.feedback}</p>
              <RevisionPoints points={latestPoints} onLocate={locate} />
              {teacher && data.question.type !== "quiz" && (
                <Button htmlType="button" onClick={() => setEditing(true)}>
                  基于当前评分修改
                </Button>
              )}
              {teacher && latest.state !== "released" && (
                <div className="grading-actions">
                  <Button
                    htmlType="button"
                    disabled={action.busy}
                    onClick={async () => {
                      const nextState =
                        latest.state === "draft" ? "confirmed" : "released";
                      if (
                        nextState === "released" &&
                        !(await confirm(
                          "发布后学生将立即看到本次得分与评语，确认发布？",
                        ))
                      ) {
                        return;
                      }
                      await action.run(`/revisions/${latest.id}/state`, {
                        state: nextState,
                      });
                    }}
                    type="primary"
                  >
                    {action.busy
                      ? "处理中…"
                      : latest.state === "draft"
                        ? "确认评分"
                        : "发布正式反馈"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p>尚未发布反馈，请等待教师批改。</p>
          )}

          {!teacher && (
            <div className="live-inline">
              <Link className="ghost-btn" to="/student/learning">
                查看学习路径
              </Link>
              <Link
                className="ghost-btn"
                to={`/student/course-content${data.question.resource_id ? `?resource=${data.question.resource_id}` : data.question.knowledge_point_id ? `?node=${data.question.knowledge_point_id}` : ""}`}
              >
                相关学习资料
              </Link>
            </div>
          )}

          {teacher && (
            <>
              <Feedback error={queueError ? new Error(queueError) : null} />
              <div className="queue-navigation">
                <Button
                  htmlType="button"
                  disabled={!canPrev}
                  onClick={() => void move(-1)}
                >
                  上一份
                </Button>
                <Button
                  htmlType="button"
                  disabled={!canNext}
                  onClick={() => void move(1)}
                >
                  下一份
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Drawer
        title="评分历史"
        open={history}
        onClose={() => setHistory(false)}
        width="min(100%, 560px)"
      >
        {data.revisions.map((r) => (
          <article className="live-revision" key={r.id}>
            <div className="section-head">
              <Typography.Text strong className="item-title">
                修订 {r.revision ?? r.version}
              </Typography.Text>
              <MetaTags>
                <StatusTag
                  status={r.state}
                  label={labelFor(stateLabels, r.state)}
                />
                <MetaTag>
                  {r.score}/{data.question.max_score} 分
                </MetaTag>
                {r.released_at && (
                  <span className="live-meta">{when(r.released_at)}</span>
                )}
              </MetaTags>
            </div>
            <p className="live-prose">{r.feedback}</p>
            <RevisionPoints
              points={r.point_scores ?? r.point_results}
              onLocate={(q) => {
                locate(q);
                setHistory(false);
              }}
            />
          </article>
        ))}
        {!data.revisions.length && <p>暂无评分记录。</p>}
      </Drawer>
    </div>
  );
}

interface WholeGradeDraft {
  score: number;
  feedback: string;
  request_id: string;
}

function WholeGrade({
  submissionID,
  max,
  initial,
  onSaved,
  saveRef,
}: {
  submissionID: string;
  max: number;
  initial?: LiveRevision;
  onSaved: () => void;
  saveRef?: MutableRefObject<(() => void) | null>;
}) {
  const initialDraft = useMemo<WholeGradeDraft>(
    () => ({
      score: initial?.score || 0,
      feedback: initial?.feedback || "",
      request_id: uuid(),
    }),
    [initial?.id, initial?.score, initial?.feedback],
  );
  const draft = useEditorDraft<WholeGradeDraft>(
    `grade:${submissionID}:whole:${initial?.id || "new"}`,
    initialDraft,
  );
  const action = useAction();
  const [validationError, setValidationError] = useState("");
  const requestID = draft.value.request_id || initialDraft.request_id;

  const submitWhole = useCallback(async () => {
    const v = draft.value;
    if (!Number.isInteger(v.score) || v.score < 0 || v.score > max) {
      setValidationError(`得分须为 0 至 ${max} 之间的整数。`);
      return;
    }
    if (!v.feedback.trim() || hasControlNull(v.feedback)) {
      setValidationError("请填写终审评语。");
      return;
    }
    setValidationError("");
    const res = await action.run(
      `/submissions/${submissionID}/revisions`,
      {
        score: v.score,
        feedback: v.feedback.trim(),
        request_id: requestID,
      },
      "POST",
      "评分草稿已保存",
    );
    if (res) {
      draft.reset({
        score: v.score,
        feedback: v.feedback.trim(),
        request_id: uuid(),
      });
      onSaved();
    }
  }, [action, draft, max, onSaved, requestID, submissionID]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => {
      if (!action.busy) void submitWhole();
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, action.busy, submitWhole]);

  return (
    <Form
      className="live-form"
      onFinish={() => void submitWhole()}
      layout="vertical"
    >
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          draft.reset({ ...initialDraft, request_id: uuid() });
          setValidationError("");
        }}
      />
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      <Feedback message={action.message} failed={action.failed} />
      {action.error?.code === "request_conflict" && (
        <Alert
          type="warning"
          showIcon
          message="当前评分请求号冲突，可重置请求号后重新保存。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => {
                draft.change((v) => ({ ...v, request_id: uuid() }));
                action.setMessage("");
              }}
            >
              重置请求号
            </Button>
          }
        />
      )}
      <Field className="ui-field" label={<>得分</>} required={true}>
        <IntegerInput
          aria-label="得分"
          disabled={action.busy}
          min={0}
          max={max}
          value={draft.value.score}
          onChange={(score) => {
            setValidationError("");
            draft.change((v) => ({ ...v, score, request_id: uuid() }));
          }}
        />
      </Field>
      <Field className="ui-field" label={<>终审评语</>} required={true}>
        <Input.TextArea
          aria-label="终审评语"
          disabled={action.busy}
          value={draft.value.feedback}
          onChange={(e) => {
            setValidationError("");
            draft.change((v) => ({
              ...v,
              feedback: e.target.value,
              request_id: uuid(),
            }));
          }}
        />
      </Field>
      <Button disabled={action.busy} htmlType="submit" type="primary">
        保存评分草稿
      </Button>
    </Form>
  );
}
