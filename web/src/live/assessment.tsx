import { Field } from "../shared/Field";
import {
  Table,
  Pagination,
  Input,
  Select,
  Modal,
  Button,
  Card,
  Form,
  InputNumber,
  Collapse,
  Radio,
} from "antd";
import { useEditorDraft, DraftNotice } from "./editing";
import { requestJSON } from "../shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { reviewNames, type QueueItem } from "./grading";
import type { Point, Resource } from "./course";
import { EmptyState, ErrorState, LoadingState, StatusTag, MetaTag, MetaTags } from "../shared/ui";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link, useCourseNavigate as useNavigate } from "./context";
import { useSession } from "../shared/session";
import { RubricManager, PointFeedback } from "./rubrics";
import { BankQuestionPicker } from "./question-bank";
import { SubmissionImport } from "./submission-import";
import { RichContent, PublishedAssets } from "./content-render";
import {
  useLearning,
  useLiveQuery,
  useAction,
  Feedback,
  names,
  when,
} from "./context";
export interface Assignment {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  version: number;
  max_score: number;
  due_at: string | null;
  question_count?: number;
  submitted_count?: number;
  draft_count?: number;
  feedback_count?: number;
}
export interface Question {
  bank_question_version_id?: string | null;
  bound_rubric_id?: string | null;
  knowledge_point_id?: string;
  resource_id?: string;
  id: string;
  prompt: string;
  type: string;
  max_score: number;
  rubric: string;
  options: string[];
}
export interface Submission {
  id: string;
  assignment_id: string;
  question_id: string;
  student_id: string;
  student_name: string;
  answer_text: string;
  answer_sha256: string;
  attempt: number;
  status: string;
  submitted_at: string;
  assignment_version: number;
}
export interface Revision {
  point_scores?: PointFeedback[];
  rubric_id?: string | null;
  id: string;
  score: number;
  feedback: string;
  state: string;
  revision: number;
  method: string;
  released_at: string | null;
}
export function AssignmentList({ quiz = false }: { quiz?: boolean }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const root = teacher ? "teacher" : "student";
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") || "",
    state = params.get("state") || "",
    sort = params.get("sort") || "new",
    point = params.get("point") || "";
  const query = useLiveQuery<{ rows: Assignment[]; total: number }>(
    `/assignment-worklist?${new URLSearchParams({ page: String(page), size: "12", search, state, sort, point, kind: quiz ? "quiz" : "homework" })}`,
  );
  const action = useAction();
  const list = query.data?.rows || [];
  const returnTo = `/${root}/${quiz ? "quiz" : "homework"}?${params}`;
  function filter(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values))
      v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  }
  return (
    <div className="live-page">
      <div className="list-toolbar">
        <Input.Search
          aria-label="搜索作业"
          placeholder="搜索作业名称"
          defaultValue={search}
          onSearch={(v) => filter({ search: v, page: "1" })}
          allowClear
        />
        <Select
          aria-label="作业状态"
          value={state}
          options={[
            { value: "", label: "全部状态" },
            ...(teacher ? [{ value: "draft", label: "草稿" }] : []),
            { value: "published", label: "进行中" },
            { value: "closed", label: "已关闭" },
          ]}
          onChange={(v) => filter({ state: v, page: "1" })}
        />
        <Select
          aria-label="作业排序"
          value={sort}
          options={[
            { value: "new", label: "最近创建" },
            { value: "due", label: "截止时间优先" },
          ]}
          onChange={(v) => filter({ sort: v, page: "1" })}
        />
        {point && (
          <Button onClick={() => filter({ point: "", page: "1" })}>
            清除知识点筛选
          </Button>
        )}
        {teacher && (
          <Link className="primary-link toolbar-primary" to={quiz ? "/teacher/quiz/new" : "/teacher/homework/new"}>
            {quiz ? "新建测验" : "新建作业"}
          </Link>
        )}
      </div>
      <Feedback message={action.message} failed={action.failed} />
      {query.error ? (
        <Card className="card-panel">
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.isPending ? (
        <Card className="card-panel">
          <LoadingState />
        </Card>
      ) : !list.length ? (
        <Card className="card-panel">
          <EmptyState title={`当前没有${quiz ? "测验" : "作业"}`}>
            {teacher
              ? "新建后先保存为草稿，确认题目与标准后再发布。"
              : "教师发布后会显示在这里。"}
          </EmptyState>
        </Card>
      ) : (
        <Card className="card-panel">
          <div className="section-head">
            <h2>{quiz ? "全部测验" : "全部作业"}</h2>
            <MetaTag>共 {query.data?.total || 0} 项</MetaTag>
          </div>
          {list.map((a) => (
            <article className="live-row" key={a.id}>
              <div>
                <h3>{a.title}</h3>
                {a.description && <p>{a.description}</p>}
                {!teacher && (
                  <MetaTags>
                    <StatusTag
                      status={a.feedback_count ? "released" : a.submitted_count ? (a.submitted_count === a.question_count ? "submitted" : "partial") : a.draft_count ? "draft" : "not_started"}
                      label={a.feedback_count
                        ? "反馈已发布"
                        : a.submitted_count
                          ? a.submitted_count === a.question_count
                            ? "已提交"
                            : "部分提交"
                          : a.draft_count
                            ? "草稿"
                            : "未开始"}
                    />
                    <MetaTag>已提交 {a.submitted_count}/{a.question_count} 题</MetaTag>
                    <MetaTag>{a.feedback_count} 题有反馈</MetaTag>
                  </MetaTags>
                )}
                <MetaTags>
                  <StatusTag status={a.status} label={names[a.status]} />
                  <MetaTag>满分 {a.max_score}</MetaTag>
                  <span className="live-meta">截止 {when(a.due_at)}</span>
                </MetaTags>
              </div>
              <div className="live-inline">
                <Link
                  className="ghost-btn"
                  to={`/${root}/homework/${a.id}?from=${encodeURIComponent(returnTo)}`}
                >
                  {teacher
                    ? "查看题目"
                    : a.status === "closed"
                      ? "查看作答与反馈"
                      : "进入作答"}
                </Link>
                {teacher && (
                  <>
                    {a.status === "draft" && (
                      <Link
                        className="ghost-btn"
                        to={`/teacher/homework/${a.id}/edit?from=${encodeURIComponent(returnTo)}`}
                      >
                        编辑草稿
                      </Link>
                    )}
                    <Link
                      className="ghost-btn"
                      to={`/teacher/homework/${a.id}/submissions?from=${encodeURIComponent(returnTo)}`}
                    >
                      查看提交
                    </Link>
                    {a.status === "draft" && (
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          action.run(`/assignments/${a.id}/state`, {
                            state: "published",
                          })
                        }
                        type="primary"
                      >
                        发布
                      </Button>
                    )}
                    {a.status === "published" && (
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          action.run(`/assignments/${a.id}/state`, {
                            state: "closed",
                          })
                        }
                      >
                        关闭
                      </Button>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
          <Pagination
            current={page}
            pageSize={12}
            total={query.data?.total || 0}
            onChange={(v) => filter({ page: String(v) })}
            showSizeChanger={false}
          />
        </Card>
      )}
    </div>
  );
}
export function AssignmentEditor({
  quiz: requestedQuiz = false,
}: {
  quiz?: boolean;
}) {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const original = useLiveQuery<{
    assignment: Assignment;
    questions: (Question & { correct_answer: string })[];
  }>(`/assignments/${assignmentId}`, !!assignmentId, true);
  const quiz = requestedQuiz || original.data?.assignment.type === "quiz";
  const points = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<Resource[]>("/resources");
  const [savedId, setSavedId] = useState(assignmentId || "");
  const [picking, setPicking] = useState(false);
  const { course } = useLearning();
  const action = useAction();
  const navigate = useNavigate();
  const initialQuestions: (Omit<Question, "id" | "type"> & {
    correct_answer: string;
  })[] = original.data?.questions.map((q) => ({
    ...q,
    options: q.options.length ? q.options : ["", ""],
    knowledge_point_id: q.knowledge_point_id || "",
    resource_id: q.resource_id || "",
  })) || [
    {
      prompt: "",
      max_score: 10,
      rubric: "",
      options: ["", ""],
      correct_answer: "",
      knowledge_point_id: "",
      resource_id: "",
    },
  ];
  const dueDate = original.data?.assignment.due_at
    ? new Date(original.data.assignment.due_at)
    : null;
  const draft = useEditorDraft(
    `assignment:${course?.id}:${assignmentId || "new"}:${requestedQuiz}`,
    {
      title: original.data?.assignment.title || "",
      description: original.data?.assignment.description || "",
      due: dueDate
        ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "",
      questions: initialQuestions,
    },
    !assignmentId || (original.isSuccess && original.isFetchedAfterMount),
  );
  const { title, description, due, questions } = draft.value;
  const setTitle = (title: string) => draft.change((v) => ({ ...v, title }));
  const setDescription = (description: string) =>
    draft.change((v) => ({ ...v, description }));
  const setDue = (due: string) => draft.change((v) => ({ ...v, due }));
  const setQuestions = (
    next: typeof questions | ((v: typeof questions) => typeof questions),
  ) =>
    draft.change((v) => ({
      ...v,
      questions: typeof next === "function" ? next(v.questions) : next,
    }));
  async function save(publish: boolean) {
    const snapshot = draft.value;
    const a = await action.run<Assignment>(
      savedId ? `/assignments/${savedId}` : "/assignments",
      {
        title,
        description,
        type: quiz ? "quiz" : original.data?.assignment.type || "subjective",
        due_at: due ? new Date(due).toISOString() : null,
        questions,
      },
      savedId ? "PUT" : "POST",
    );
    if (!a) return;
    setSavedId(a.id);
    draft.saved(snapshot);
    if (
      publish &&
      !(await action.run(`/assignments/${a.id}/state`, { state: "published" }))
    )
      return;
    navigate(
      params.get("from") || (quiz ? "/teacher/quiz" : "/teacher/homework"),
    );
  }
  if (!draft.ready) {
    return original.error ? (
      <Feedback error={original.error} />
    ) : (
      <p role="status">正在读取作业草稿…</p>
    );
  }
  return (
    <div className="live-page">

      <Feedback message={action.message} failed={action.failed} />
      <Card className="card-panel">
        <DraftNotice {...draft} />
        <Form
          className="live-form"
          onFinish={() => {
            void save(false);
          }}
          layout="vertical"
        >
          <Field
            className="ui-field"
            label={<>{quiz ? "测验标题" : "作业标题"}</>}
            required={true}
          >
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field className="ui-field" label={<>任务说明</>}>
            <Input.TextArea
              aria-label="任务说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field className="ui-field" label={<>截止时间</>}>
            <Input
              aria-label="截止时间"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          <div className="section-head">
            <h2>题目列表</h2>
            <Button onClick={() => setPicking(true)} htmlType="button">
              从题库选题
            </Button>
          </div>
          {questions.map((q, i) => (
            <Card size="small" key={i} title={<>第{i + 1}题</>}>
              {q.bank_question_version_id && (
                <p className="live-meta">
                  使用题库确认版本，题目与标准固定。修改请返回题库另建版本后重新选题。
                </p>
              )}
              <Field
                className="ui-field"
                label={<>题目要求</>}
                required={true}
              >
                <Input.TextArea
                  aria-label="题目要求"
                  readOnly={!!q.bank_question_version_id}
                  required
                  rows={4}
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, prompt: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field className="ui-field" label={<>满分</>} required={true}>
                <InputNumber
                  aria-label="满分"
                  required
                  readOnly={!!q.bank_question_version_id}
                  min={1}
                  max={10000}
                  value={q.max_score}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i
                          ? { ...x, max_score: Number(String(e ?? "")) }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field
                className="ui-field"
                label={<>评分标准</>}
                required={true}
              >
                <Input.TextArea
                  aria-label="评分标准"
                  readOnly={!!q.bank_question_version_id}
                  required
                  rows={3}
                  value={q.rubric}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, rubric: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field className="ui-field" label={<>关联知识点</>}>
                <Select
                  aria-label="关联知识点"
                  disabled={!!q.bank_question_version_id}
                  value={q.knowledge_point_id}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, knowledge_point_id: e } : x,
                      ),
                    )
                  }
                  showSearch
                  optionFilterProp="children"
                >
                  <Select.Option value="">不关联</Select.Option>
                  {points.data?.points
                    .filter((p) => p.kind === "point")
                    .map((p) => (
                      <Select.Option key={p.id} value={p.id}>
                        {p.title}
                      </Select.Option>
                    ))}
                </Select>
              </Field>
              <Field className="ui-field" label={<>评分依据资料</>}>
                <Select
                  aria-label="评分依据资料"
                  disabled={!!q.bank_question_version_id}
                  value={q.resource_id}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) => (j === i ? { ...x, resource_id: e } : x)),
                    )
                  }
                  showSearch
                  optionFilterProp="children"
                >
                  <Select.Option value="">教师手填标准</Select.Option>
                  {resources.data
                    ?.filter((r) => r.status === "published")
                    .map((r) => (
                      <Select.Option key={r.id} value={r.id}>
                        {r.title} · {r.locator} · v{r.version}
                      </Select.Option>
                    ))}
                </Select>
              </Field>
              {quiz && (
                <>
                  <Field
                    className="ui-field"
                    label={<>选项（每行一个）</>}
                    required={true}
                  >
                    <Input.TextArea
                      aria-label="选项（每行一个）"
                      readOnly={!!q.bank_question_version_id}
                      required
                      value={q.options.join("\n")}
                      onChange={(e) =>
                        setQuestions((v) =>
                          v.map((x, j) =>
                            j === i
                              ? { ...x, options: e.target.value.split("\n") }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field
                    className="ui-field"
                    label={<>正确答案</>}
                    name={["questions", i, "correct_answer"]} getValueProps={() => ({ value: q.correct_answer })}
                    rules={[{ validator: async () => { if (!q.correct_answer) throw Error("请选择正确答案"); } }]}
                    required={true}
                  >
                    <Select
                      aria-label="正确答案"
                      disabled={!!q.bank_question_version_id}
                      value={q.correct_answer}
                      onChange={(e) =>
                        setQuestions((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, correct_answer: e } : x,
                          ),
                        )
                      }
                      showSearch
                      optionFilterProp="children"
                    >
                      <Select.Option value="">选择正确答案</Select.Option>
                      {q.options.filter(Boolean).map((v, k) => (
                        <Select.Option key={k} value={v}>{v}</Select.Option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              {questions.length > 1 && (
                <Button
                  onClick={() =>
                    setQuestions((v) => v.filter((_, j) => j !== i))
                  }
                  htmlType="button"
                >
                  移除本题
                </Button>
              )}
            </Card>
          ))}
          <div className="live-inline">
            <Button
              onClick={() =>
                setQuestions((v) => [
                  ...v,
                  {
                    prompt: "",
                    max_score: 10,
                    rubric: "",
                    options: ["", ""],
                    correct_answer: "",
                    knowledge_point_id: "",
                    resource_id: "",
                  },
                ])
              }
              htmlType="button"
            >
              新增题目
            </Button>
            <Button disabled={action.busy || !course} htmlType="submit">
              保存草稿
            </Button>
            <Button
              disabled={action.busy || !course}
              onClick={() => save(true)}
              htmlType="button"
              type="primary"
            >
              保存并发布
            </Button>
          </div>
        </Form>
        <BankQuestionPicker
          open={picking}
          onClose={() => setPicking(false)}
          type={quiz ? "quiz" : original.data?.assignment.type || "subjective"}
          onSelect={(v, r) => {
            const item = {
              prompt: v.prompt,
              max_score: v.max_score,
              rubric: r
                ? r.criteria
                    .map((p) => `${p.title}（${p.max_score}分）：${p.rule}`)
                    .join("\n")
                : "按教师确认的选项答案判分",
              options: v.options,
              correct_answer: v.correct_answer,
              knowledge_point_id: v.knowledge_point_id || "",
              resource_id: "",
              bank_question_version_id: v.id,
              bound_rubric_id: r?.id || null,
            };
            setQuestions((old) =>
              old.length === 1 &&
              !old[0].prompt &&
              !old[0].bank_question_version_id
                ? [item]
                : [...old, item],
            );
          }}
        />
      </Card>
    </div>
  );
}
export function AssignmentDetail() {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const query = useLiveQuery<{ assignment: Assignment; questions: Question[] }>(
    `/assignments/${assignmentId}`,
  );
  const submissions = useLiveQuery<Submission[]>(
    `/assignments/${assignmentId}/submissions`,
  );
  return (
    <div className="live-page">
      <header className="live-heading">
        <h1>{query.data?.assignment.title || "作业详情"}</h1>
        {query.data?.assignment.description && (
          <p>{query.data.assignment.description}</p>
        )}
      </header>
      {params.get("task") && (
        <Link
          className="context-banner"
          to={`/${teacher ? "teacher" : "student"}/intervention?task=${params.get("task")}`}
        >
          返回补学补练任务，检查完成条件
        </Link>
      )}
      <Feedback error={query.error || submissions.error} />
      {query.isPending && <LoadingState />}
      {query.data && (
        <section className="assignment-summary">
          <StatusTag
            status={query.data.assignment.status}
            label={names[query.data.assignment.status]}
          />
          <span>截止：{when(query.data.assignment.due_at)}</span>
          <strong>
            已提交 {new Set(submissions.data?.map((s) => s.question_id)).size}/{" "}
            {query.data.questions.length}题
          </strong>
          {teacher && (
            <Link
              className="primary-link"
              to={`/teacher/homework/${assignmentId}/submissions?${params}`}
            >
              进入批阅队列
            </Link>
          )}
          {teacher && query.data.assignment.status === "closed" && (
            <Link
              className="ghost-btn"
              to={`/teacher/regrades?assignment=${assignmentId}`}
            >
              整组重评
            </Link>
          )}
        </section>
      )}
      {query.data?.questions.map((q) => (
        <QuestionAnswer
          key={q.id}
          question={q}
          assignment={query.data.assignment}
          teacher={teacher}
          submissions={
            submissions.data?.filter((s) => s.question_id === q.id) || []
          }
        />
      ))}
      <Collapse
        className="card-panel"
        items={[
          {
            key: "content",
            label: (
              <>
                {teacher ? "提交记录" : "我的提交历史"}（
                {submissions.data?.length || 0}）
              </>
            ),
            children: (
              <>
                {submissions.data?.map((s) => (
                  <article className="live-row" key={s.id}>
                    <div>
                      <Link
                        to={`/${teacher ? "teacher" : "student"}/homework/submissions/${s.id}/${teacher ? "grade" : "feedback"}`}
                      >
                        {query.data?.questions.find((q) => q.id === s.question_id)?.prompt}
                      </Link>
                      <MetaTags>
                        <StatusTag status={s.status} label={names[s.status]} />
                        <MetaTag>第 {s.attempt} 次提交</MetaTag>
                        <span className="live-meta">{when(s.submitted_at)}</span>
                      </MetaTags>
                    </div>
                  </article>
                ))}
                {!submissions.data?.length && <p>暂无提交记录。</p>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
function QuestionAnswer({
  question: q,
  assignment: a,
  teacher,
  submissions,
}: {
  question: Question;
  assignment: Assignment;
  teacher: boolean;
  submissions: Submission[];
}) {
  const [modal, modalContext] = Modal.useModal();
  const action = useAction();
  const { course } = useLearning();
  const { session } = useSession();
  const cache = useQueryClient();
  const remote = useLiveQuery<{
    answer_text: string;
    updated_at: string;
  } | null>(`/assignments/${a.id}/questions/${q.id}/draft`, !teacher);
  const draft = useEditorDraft(
    `answer:${course?.id}:${q.id}`,
    remote.data?.answer_text || "",
    !teacher && remote.isSuccess,
  );
  const answer = draft.value;
  const [requestID, setRequestID] = useState(crypto.randomUUID());
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [savedAt, setSavedAt] = useState("");
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function saveDraft() {
    if (busy.current || !draft.ready) return;
    busy.current = true;
    setSaving(true);
    setError("");
    const value = answer;
    try {
      await requestJSON(
        `/learning/courses/${course!.id}/assignments/${a.id}/questions/${q.id}/draft`,
        { method: "PUT", body: JSON.stringify({ answer_text: value }) },
        session?.csrf_token,
      );
      if (active.current) {
        draft.saved(value);
        setSavedAt(new Date().toLocaleTimeString());
      }
      await cache.invalidateQueries({
        queryKey: [
          "live",
          course?.id,
          `/assignments/${a.id}/questions/${q.id}/draft`,
        ],
      });
      await cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "live" &&
          q.queryKey[1] === course?.id &&
          String(q.queryKey[2]).startsWith("/assignment-worklist"),
      });
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  }
  useEffect(() => {
    if (!draft.dirty || !draft.ready || saving || error) return;
    const timer = setTimeout(() => void saveDraft(), 900);
    return () => clearTimeout(timer);
  }, [answer, draft.dirty, draft.ready, saving, error]);
  const closed =
    a.status !== "published" ||
    (!!a.due_at && Date.now() >= Date.parse(a.due_at));
  const latest = submissions[0];
  function submit() {
    modal.confirm({
      title: "确认提交本题？",
      content: `本次只提交当前题目。${submissions.length ? "将保留已有记录并新增一次提交。" : "提交后保存本次原文。"}`,
      okText: "确认提交",
      cancelText: "继续编辑",
      onOk: async () => {
        const v = await action.run<Submission>(
          `/assignments/${a.id}/submissions`,
          { question_id: q.id, answer_text: answer, request_id: requestID },
        );
        if (!v) throw Error("提交失败，请重试");
        draft.saved(answer);
        setRequestID(crypto.randomUUID());
        action.setMessage(
          `提交成功 · 第${v.attempt}次 · ${when(v.submitted_at)}`,
        );
      },
    });
  }
  return (
    <Card className="card-panel answer-panel">
      {modalContext}
      <RichContent text={q.prompt} />
      <PublishedAssets kind="questions" id={q.id} />
      <p>满分 {q.max_score}</p>
      {teacher ? (
        <>
          <h3>教师评分标准</h3>
          <p className="live-prose">{q.rubric}</p>
          {q.bank_question_version_id ? (
            <p className="live-meta">
              本作业绑定题库确认版本及标准。
              <Link
                to={`/teacher/question-bank?bank_version=${q.bank_question_version_id}`}
              >
                查看题库版本
              </Link>
            </p>
          ) : (
            q.type !== "quiz" && (
              <RubricManager questionID={q.id} maxScore={q.max_score} />
            )
          )}
        </>
      ) : (
        <>
          <DraftNotice {...draft} />
          <Feedback
            error={remote.error}
            message={error || action.message}
            failed={!!error || action.failed}
          />
          {q.type === "quiz" ? (
            <div role="radiogroup" aria-label="我的作答">
              {q.options.map((o, i) => (
                <Radio
                  className="live-option"
                  key={i}
                  name={q.id}
                  disabled={!draft.ready || closed}
                  checked={answer === o}
                  onChange={() => {
                    draft.change(o);
                    setRequestID(crypto.randomUUID());
                    setError("");
                  }}
                >
                  {o}
                </Radio>
              ))}
            </div>
          ) : (
            <Field className="ui-field" label={<>我的作答</>}>
              <Input.TextArea
                aria-label="我的作答"
                rows={12}
                disabled={!draft.ready || closed}
                value={answer}
                onChange={(e) => {
                  draft.change(e.target.value);
                  setRequestID(crypto.randomUUID());
                  setError("");
                }}
              />
            </Field>
          )}
          <div className="answer-status" role="status">
            {saving
              ? "正在保存…"
              : error
                ? "保存失败，内容已暂存，可重试"
                : draft.dirty
                  ? "尚未保存到平台"
                  : savedAt
                    ? `已保存 ${savedAt}`
                    : remote.data
                      ? `草稿已读取 · ${when(remote.data.updated_at)}`
                      : "尚未开始作答"}
            <span>{answer.length}字</span>
          </div>
          {closed && (
            <p className="live-meta">
              {a.status === "closed" ? "作业已关闭" : "已过截止时间"}
              ，可查看原作答和反馈。
            </p>
          )}
          <div className="live-inline">
            <Button
              disabled={saving || !draft.ready || closed}
              onClick={() => void saveDraft()}
            >
              保存作答草稿
            </Button>
            <Button
              disabled={action.busy || saving || closed || !answer.trim()}
              onClick={submit}
              type="primary"
            >
              提交本题
            </Button>
            {latest && (
              <Link to={`/student/homework/submissions/${latest.id}/feedback`}>
                查看第{latest.attempt}次提交与反馈
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
export function SubmissionList() {
  const { assignmentId } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1),
    search = params.get("search") || "",
    state = params.get("state") || "";
  const q = useLiveQuery<{ rows: QueueItem[]; total: number }>(
    `/assignments/${assignmentId}/worklist?${new URLSearchParams({ page: String(page), size: "20", search, state })}`,
  );
  const detail = useLiveQuery<{
    assignment: Assignment;
    questions: Question[];
  }>(`/assignments/${assignmentId}`);
  const roster = useLiveQuery<{
    total: number;
    submitted: number;
    partial: number;
    not_submitted: number;
    rows: {
      student_id: string;
      display_name: string;
      submitted_questions: number;
      total_questions: number;
    }[];
  }>(`/assignments/${assignmentId}/roster`);
  function filter(values: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  }
  return (
    <div className="live-page">
      <header className="workspace-heading">
        <div>
          <Link to={params.get("from") || "/teacher/homework"}>
            ‹ 返回作业列表
          </Link>

          <p>{detail.data?.assignment.title}</p>
        </div>
        {detail.data && <SubmissionImport key={assignmentId} assignment={detail.data.assignment} questions={detail.data.questions} />}
      </header>
      <Feedback error={q.error || roster.error || detail.error} />
      {roster.data && (
        <section className="assignment-summary">
          <MetaTags>
            <MetaTag>共 {roster.data.total} 人</MetaTag>
            <StatusTag status="submitted" label={`全部提交 ${roster.data.submitted}`} />
            <StatusTag status="partial" label={`部分提交 ${roster.data.partial}`} />
            <StatusTag status="pending" label={`未提交 ${roster.data.not_submitted}`} />
          </MetaTags>
        </section>
      )}
      <Collapse
        className="card-panel"
        items={[
          {
            key: "content",
            label: <>查看提交覆盖名单</>,
            children: (
              <>
                {roster.data?.rows.map((m) => (
                  <div className="live-row" key={m.student_id}>
                    <Link to={`/teacher/dashboard?student=${m.student_id}`}>
                      {m.display_name}
                    </Link>
                    <MetaTag>{m.submitted_questions}/{m.total_questions} 题</MetaTag>
                  </div>
                ))}
              </>
            ),
          },
        ]}
      />
      <Card className="card-panel">
        <div className="list-toolbar">
          <Input.Search
            aria-label="搜索学生"
            placeholder="搜索学生"
            defaultValue={search}
            allowClear
            onSearch={(v) => filter({ search: v, page: "1" })}
          />
          <Select
            aria-label="批阅状态"
            value={state}
            onChange={(v) => filter({ state: v, page: "1" })}
            options={[
              { value: "", label: "全部状态" },
              ...Object.entries(reviewNames).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </div>
        {q.isPending ? (
          <LoadingState />
        ) : (
          <div className="table-wrap">
            <Table<QueueItem>
              rowKey="id" dataSource={q.data?.rows || []} pagination={false} scroll={{ x: 720 }}
              locale={{ emptyText: "当前筛选没有提交" }}
              columns={[
                { title: "学生", dataIndex: "student_name" },
                { title: "题目", dataIndex: "prompt", ellipsis: true },
                { title: "次数", dataIndex: "attempt" },
                { title: "来源", dataIndex: "teacher_imported", render: (value: boolean) => <MetaTag>{value ? "教师导入" : "学生提交"}</MetaTag> },
                { title: "时间", dataIndex: "submitted_at", render: (value: string) => when(value) },
                { title: "状态", dataIndex: "review_state", render: (value: string) => <StatusTag status={value} label={reviewNames[value]} /> },
                { title: "操作", key: "actions", render: (_, s) => <Link to={`/teacher/homework/submissions/${s.id}/grade?${params}`}>批改详情</Link> },
              ]}
            />

          </div>
        )}
        <Pagination
          current={page}
          pageSize={20}
          total={q.data?.total || 0}
          onChange={(v) => filter({ page: String(v) })}
          showSizeChanger={false}
        />
      </Card>
    </div>
  );
}
export { GradePage } from "./grading";
