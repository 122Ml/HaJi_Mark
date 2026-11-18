import { Field } from "../shared/Field";
import { ContextAgent } from "./context-agent";
import { useConfirm } from "../shared/confirm";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Drawer,
  Pagination,
  Select,
  Input,
  Button,
  Card,
  Form,
  Collapse,
  InputNumber,
  Typography,
} from "antd";
import { requestJSON } from "../shared/api";
import { useSession } from "../shared/session";
import {
  Link,
  useCourseNavigate,
  useLiveQuery,
  useLearning,
  useAction,
  Feedback,
  names,
  when,
} from "./context";
import { LoadingState, ErrorState, StatusTag, MetaTag, MetaTags } from "../shared/ui";
import { PointGradeForm, RevisionPoints, type RubricVersion } from "./rubrics";
import { useEditorDraft, DraftNotice } from "./editing";
import type { Question, Submission, Revision } from "./assessment";
import type { Resource } from "./course";

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
    submission: Submission;
    question: Question;
    revisions: Revision[];
    import_origin?: { id: string; created_at: string } | null;
  }>(`/submissions/${submissionId}`);
  const data = query.data;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") || "";
  const state = params.get("state") || "";
  const queue = useLiveQuery<{ rows: QueueItem[]; total: number }>(
    `/assignments/${data?.submission.assignment_id}/worklist?${new URLSearchParams({ page: String(page), size: "20", search, state })}`,
    teacher && !!data,
  );
  const rubrics = useLiveQuery<RubricVersion[]>(
    `/questions/${data?.question.id}/rubrics`,
    teacher && !!data && data.question.type !== "quiz",
  );
  const resources = useLiveQuery<Resource[]>("/resources");
  const action = useAction();
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rubricID, setRubricID] = useState("");
  const [selection, setSelection] = useState("");
  const [criterion, setCriterion] = useState("");
  const [quoteRequest, setQuoteRequest] = useState<{
    id: string;
    text: string;
    seq: number;
  } | null>(null);
  const [highlight, setHighlight] = useState("");
  const original = useRef<HTMLElement>(null);
  const latest = data?.revisions[0];
  const confirmed = (rubrics.data || []).filter((r) => r.state === "confirmed");
  const rubric =
    confirmed.find((r) => r.id === rubricID) ||
    confirmed.find((r) => r.id === latest?.rubric_id) ||
    confirmed[0];
  const showEditor =
    teacher && data?.question.type !== "quiz" && (!latest || editing);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values))
      v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  }
  function openSubmission(id: string) {
    navigate(`/teacher/homework/submissions/${id}/grade?${params}`);
  }
  const index = queue.data?.rows.findIndex((r) => r.id === submissionId) ?? -1;
  const next = queue.data?.rows[index + 1];
  async function move(direction: number) {
    if (!queue.data) return;
    const row = queue.data.rows[index + direction];
    if (row) {
      openSubmission(row.id);
      return;
    }
    const targetPage = page + direction;
    setMoving(true);
    setQueueError("");
    try {
      const response = await requestJSON<{ data: { rows: QueueItem[] } }>(
        `/learning/courses/${course!.id}/assignments/${data!.submission.assignment_id}/worklist?${new URLSearchParams({ page: String(targetPage), size: "20", search, state })}`,
      );
      const target =
        direction > 0 ? response.data.rows[0] : response.data.rows.at(-1);
      if (target) {
        const nextParams = new URLSearchParams(params);
        nextParams.set("page", String(targetPage));
        navigate(
          `/teacher/homework/submissions/${target.id}/grade?${nextParams}`,
        );
      }
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : "读取队列失败");
    } finally {
      setMoving(false);
    }
  }
  function locate(quote: string) {
    setHighlight(quote);
  }
  function originalText() {
    const text = data!.submission.answer_text;
    const start = highlight ? text.indexOf(highlight) : -1;
    return start < 0 ? (
      text
    ) : (
      <>
        {text.slice(0, start)}
        <mark>{text.slice(start, start + highlight.length)}</mark>
        {text.slice(start + highlight.length)}
      </>
    );
  }
  useEffect(() => {
    original.current
      ?.querySelector("mark")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  useEffect(() => {
    setQuoteRequest(null);
    setCriterion("");
    setEditing(false);
    setSelection("");
    setHighlight("");
    setRubricID("");
  }, [submissionId]);
  if (query.isPending) return <LoadingState />;
  if (query.error || !data)
    return (
      <ErrorState
        message={query.error?.message || "作答不存在"}
        onRetry={() => void query.refetch()}
      />
    );
  const source = resources.data?.find(
    (r) => r.id === data.question.resource_id,
  );
  return (
    <div
      className={`live-page ${teacher ? "grading-workspace" : "feedback-workspace"}`}
    >
      <div className="workspace-heading">
        <div>
          <Link
            to={`/${teacher ? "teacher" : "student"}/homework/${data.submission.assignment_id}${teacher ? `/submissions?${params}` : ""}`}
          >
            ‹ {teacher ? "返回提交队列" : "返回本次作业"}
          </Link>
          <p>
            {data.submission.student_name ||
              queue.data?.rows.find((r) => r.id === submissionId)
                ?.student_name ||
              (teacher ? "学生作答" : session?.user.display_name)}{" "}
            · 第{data.submission.attempt}次作答 ·{" "}
            {when(data.submission.submitted_at)}
          </p>
        </div>
        <div className="live-inline">
          <MetaTag>{data.import_origin ? "教师导入" : "学生提交"}</MetaTag>
          <ContextAgent context={{kind:"submission",id:data.submission.id,title:"当前作答与反馈"}} />
          <StatusTag
            status={latest?.state || "pending"}
            label={latest ? names[latest.state] : "待批阅"}
          />
          <Button onClick={() => setHistory(true)}>
            历史记录（{data.revisions.length}）
          </Button>
        </div>
      </div>
      <Feedback error={action.failed ? new Error(action.message) : undefined} />
      <div className={`grading-columns ${teacher ? "" : "student-feedback"}`}>
        {teacher && (
          <Card className="grading-queue card-panel" title={<>提交队列</>}>

            <Input.Search
              aria-label="搜索学生"
              placeholder="搜索学生"
              defaultValue={search}
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
                <MetaTag>共 {queue.data?.total || 0} 份</MetaTag>
                {queue.data?.rows.map((r) => (
                  <Button
                    key={r.id}
                    onClick={() => openSubmission(r.id)}
                    aria-current={r.id === submissionId ? "true" : undefined}
                    className={`queue-item ${r.id === submissionId ? "active" : ""}`}
                  >
                    <strong>{r.student_name}</strong>
                    <MetaTags>
                      <StatusTag status={r.review_state} label={reviewNames[r.review_state]} />
                      <MetaTag>第 {r.attempt} 次</MetaTag>
                    </MetaTags>
                    <small>{r.prompt}</small>
                  </Button>
                ))}
                {!queue.data?.rows.length && <p>当前筛选没有提交。</p>}
                <Pagination
                  simple
                  current={page}
                  pageSize={20}
                  total={queue.data?.total || 0}
                  onChange={(p) => update({ page: String(p) })}
                />
              </>
            )}
          </Card>
        )}
        <Card className="card-panel grading-original" title={<>题目与原始作答</>}>

          <p>{data.question.prompt}</p>
          <MetaTags><MetaTag>满分 {data.question.max_score}</MetaTag></MetaTags>
          <article
            ref={original}
            className="live-prose original-answer"
            onMouseUp={() => {
              const sel = window.getSelection();
              if (
                sel &&
                original.current?.contains(sel.anchorNode) &&
                original.current?.contains(sel.focusNode)
              )
                setSelection(sel.toString());
            }}
          >
            {originalText()}
          </article>
          {showEditor && rubric && (
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
                      {p.title}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={
                  !selection || !data.submission.answer_text.includes(selection)
                }
                onClick={() =>
                  setQuoteRequest({
                    id: criterion || rubric.criteria[0].id,
                    text: selection,
                    seq: Date.now(),
                  })
                }
              >
                引用选中文本
              </Button>
            </div>
          )}
          {teacher && (
            <Collapse
              items={[
                {
                  key: "content",
                  label: <>题目评分说明</>,
                  children: (
                    <>
                      <p className="live-prose">{data.question.rubric}</p>
                    </>
                  ),
                },
              ]}
            />
          )}
          {source && (
            <Collapse
              items={[
                {
                  key: "content",
                  label: (
                    <>
                      评分依据：{source.title} · {source.locator} · v
                      {source.version}
                    </>
                  ),
                  children: (
                    <>
                      <p className="live-prose">{source.content}</p>
                      <p>{source.source_note || source.source_url}</p>
                    </>
                  ),
                },
              ]}
            />
          )}
          <Collapse
            items={[
              {
                key: "content",
                label: <>原文校验信息</>,
                children: (
                  <>
                    <p className="live-id">{data.submission.answer_sha256}</p>
                  </>
                ),
              },
            ]}
          />
        </Card>
        <Card className="card-panel grading-editor" title={<>
            {teacher ? (showEditor ? "填写评分" : "当前评分") : "已发布反馈"}
          </>}>

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
                <>
                  <Field className="ui-field" label={<>使用标准版本</>}>
                    <Select
                      aria-label="使用标准版本"
                      value={rubric.id}
                      onChange={async (e) => {
                        if (
                          !editing ||
                          await confirm(
                            "切换标准后使用该版本的独立草稿？当前编辑已暂存。",
                          )
                        )
                          setRubricID(e);
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
                  <PointGradeForm
                    key={`${submissionId}/${rubric.id}/${latest?.id || "new"}`}
                    rubric={rubric}
                    submissionID={submissionId!}
                    initial={
                      latest?.rubric_id === rubric.id ? latest : undefined
                    }
                    quoteRequest={quoteRequest}
                    onLocate={locate}
                    onSaved={() => setEditing(false)}
                  />
                </>
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
                  />
                </>
              )}
            </>
          ) : latest ? (
            <>
              <div className="score-hero">
                {latest.score}
                <small>/ {data.question.max_score}</small>
              </div>
              <p className="live-prose">{latest.feedback}</p>
              <RevisionPoints points={latest.point_scores} onLocate={locate} />
              {teacher && data.question.type !== "quiz" && (
                <Button onClick={() => setEditing(true)}>
                  基于当前评分修改
                </Button>
              )}
              {teacher && latest.state !== "released" && (
                <div className="grading-actions">
                  <Button
                    disabled={action.busy}
                    onClick={() =>
                      action.run(`/revisions/${latest.id}/state`, {
                        state:
                          latest.state === "draft" ? "confirmed" : "released",
                      })
                    }
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
                  disabled={moving || index < 0 || (index === 0 && page === 1)}
                  onClick={() => void move(-1)}
                >
                  上一份
                </Button>
                <Button
                  disabled={
                    moving ||
                    index < 0 ||
                    (!next && page * 20 >= (queue.data?.total || 0))
                  }
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
        width={560}
      >
        {data.revisions.map((r) => (
          <article className="live-revision" key={r.id}>
            <div className="section-head">
              <Typography.Text strong className="item-title">修订 {r.revision}</Typography.Text>
              <MetaTags>
                <StatusTag status={r.state} label={names[r.state]} />
                <MetaTag>{r.score}/{data.question.max_score} 分</MetaTag>
              </MetaTags>
            </div>
            <p>{r.feedback}</p>
            <RevisionPoints
              points={r.point_scores}
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
function WholeGrade({
  submissionID,
  max,
  initial,
  onSaved,
}: {
  submissionID: string;
  max: number;
  initial?: Revision;
  onSaved: () => void;
}) {
  const draft = useEditorDraft(
    `grade:${submissionID}:whole:${initial?.id || "new"}`,
    { score: initial?.score || 0, feedback: initial?.feedback || "" },
  );
  const action = useAction();
  const [request, setRequest] = useState(crypto.randomUUID());
  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const v = draft.value;
        if (
          await action.run(`/submissions/${submissionID}/revisions`, {
            ...v,
            request_id: request,
          })
        ) {
          draft.saved(v);
          onSaved();
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} />
      <Feedback message={action.message} failed={action.failed} />
      <Field className="ui-field" label={<>得分</>} required={true}>
        <InputNumber
          aria-label="得分"
          disabled={action.busy}
          min={0}
          max={max}
          required
          value={draft.value.score}
          onChange={(e) => {
            draft.change({ ...draft.value, score: Number(String(e ?? "")) });
            setRequest(crypto.randomUUID());
          }}
        />
      </Field>
      <Field className="ui-field" label={<>终审评语</>} required={true}>
        <Input.TextArea
          aria-label="终审评语"
          disabled={action.busy}
          required
          value={draft.value.feedback}
          onChange={(e) => {
            draft.change({ ...draft.value, feedback: e.target.value });
            setRequest(crypto.randomUUID());
          }}
        />
      </Field>
      <Button disabled={action.busy} htmlType="submit" type="primary">
        保存评分草稿
      </Button>
    </Form>
  );
}
