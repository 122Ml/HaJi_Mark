import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Radio,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { Field } from "../shared/Field";
import { requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import { PageHeader } from "../shared/PageHeader";
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
  useCourseNavigate as useNavigate,
  useLearning,
  useLiveQuery,
  uuid,
  when,
} from "./context";
import {
  formatResourceLocator,
  labelFor,
  questionTypeLabels,
  stateLabels,
} from "./domain-meta";
import { DraftNotice, useEditorDraft } from "./editing";
import { reviewNames, type QueueItem } from "./grading";
import { BankQuestionPicker } from "./question-bank";
import { RubricManager } from "./rubrics";
import { IntegerInput, QuizOptionsEditor } from "./shared-editors";
import { SubmissionImport } from "./submission-import";
import type {
  Assignment,
  Point,
  Question,
  Resource,
  Submission,
} from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

import type { LiveAssignment } from "./assignment-list";

export type { Assignment, Question, Revision, Submission } from "./types";
export { AssignmentList } from "./assignment-list";
export { GradePage } from "./grading";

const MAX_QUESTIONS = 50;
const MAX_ANSWER_BYTES = 200000;

type LiveQuestion = Question & {
  bank_question_version_id?: string | null;
  bound_rubric_id?: string | null;
};

type LiveSubmission = Submission & {
  answer_sha256?: string;
};

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

interface DraftQuestion {
  id?: string;
  prompt: string;
  max_score: number;
  rubric: string;
  options: string[];
  correct_answer: string;
  knowledge_point_id: string;
  resource_id: string;
  bank_question_version_id?: string | null;
  bound_rubric_id?: string | null;
}

interface AssignmentDraft {
  title: string;
  description: string;
  type: string;
  due: string;
  questions: DraftQuestion[];
}

function emptyQuestion(quiz: boolean): DraftQuestion {
  return {
    prompt: "",
    max_score: 10,
    rubric: quiz ? "按教师确认的选项答案判分" : "",
    options: quiz ? ["", ""] : [],
    correct_answer: "",
    knowledge_point_id: "",
    resource_id: "",
  };
}

export function AssignmentEditor({
  quiz: requestedQuiz = false,
}: {
  quiz?: boolean;
}) {
  const confirm = useConfirm();
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const original = useLiveQuery<{
    assignment: LiveAssignment;
    questions: (LiveQuestion & { correct_answer?: string })[];
  }>(`/assignments/${assignmentId}`, !!assignmentId, true);
  const quiz = requestedQuiz || original.data?.assignment.type === "quiz";
  const points = useLiveQuery<{ points: Point[] }>("");
  const resources = useLiveQuery<Resource[]>("/resources");
  const [savedId, setSavedId] = useState(assignmentId || "");
  const [picking, setPicking] = useState(false);
  const [validationError, setValidationError] = useState("");
  const { course } = useLearning();
  const action = useAction();
  const navigate = useNavigate();

  const leafPoints = useMemo(
    () => (points.data?.points || []).filter((p) => p.kind === "point"),
    [points.data],
  );
  const publishedResources = useMemo(
    () => (resources.data || []).filter((r) => r.status === "published"),
    [resources.data],
  );

  const initialDraft = useMemo<AssignmentDraft>(() => {
    const isQuiz = requestedQuiz || original.data?.assignment.type === "quiz";
    const initialQuestions: DraftQuestion[] = original.data?.questions.length
      ? original.data.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          max_score: q.max_score,
          rubric: q.rubric,
          options: isQuiz
            ? q.options?.length >= 2
              ? q.options
              : ["", ""]
            : [],
          correct_answer: isQuiz ? q.correct_answer || "" : "",
          knowledge_point_id: q.knowledge_point_id || "",
          resource_id: q.resource_id || "",
          bank_question_version_id: q.bank_question_version_id || null,
          bound_rubric_id: q.bound_rubric_id || null,
        }))
      : [emptyQuestion(isQuiz)];

    const dueDate =
      original.data?.assignment.due_at &&
      dayjs(original.data.assignment.due_at).isValid()
        ? dayjs(original.data.assignment.due_at).format("YYYY-MM-DDTHH:mm")
        : "";

    return {
      title: original.data?.assignment.title || "",
      description: original.data?.assignment.description || "",
      type: isQuiz ? "quiz" : original.data?.assignment.type || "subjective",
      due: dueDate,
      questions: initialQuestions,
    };
  }, [original.data, requestedQuiz]);

  const draft = useEditorDraft<AssignmentDraft>(
    `assignment:${course?.id}:${assignmentId || "new"}:${requestedQuiz}`,
    initialDraft,
    !assignmentId || (original.isSuccess && original.isFetchedAfterMount),
  );

  const { title, description, due, questions } = draft.value;
  const assignmentType = quiz
    ? "quiz"
    : draft.value.type === "code"
      ? "code"
      : "subjective";
  const hasBankBound = questions.some((q) => !!q.bank_question_version_id);
  const totalScore = questions.reduce(
    (sum, q) => sum + (Number(q.max_score) || 0),
    0,
  );
  const parsedDue = due && dayjs(due).isValid() ? dayjs(due) : null;
  const dueInPast = !!parsedDue && parsedDue.valueOf() < Date.now();

  const setTitle = (nextTitle: string) => {
    setValidationError("");
    draft.change((v) => ({ ...v, title: nextTitle }));
  };
  const setDescription = (nextDescription: string) => {
    setValidationError("");
    draft.change((v) => ({ ...v, description: nextDescription }));
  };
  const setType = (nextType: string) => {
    setValidationError("");
    draft.change((v) => ({ ...v, type: nextType }));
  };
  const setDue = (nextDue: string) => {
    setValidationError("");
    draft.change((v) => ({ ...v, due: nextDue }));
  };
  const setQuestions = (
    next: DraftQuestion[] | ((v: DraftQuestion[]) => DraftQuestion[]),
  ) => {
    setValidationError("");
    draft.change((v) => ({
      ...v,
      questions: typeof next === "function" ? next(v.questions) : next,
    }));
  };

  function moveQuestion(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    setQuestions((list) => {
      const copy = [...list];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function validateAll(): string | null {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || utf8ByteLength(trimmedTitle) > 500 || hasControlNull(trimmedTitle)) {
      return `请填写${quiz ? "测验标题" : "作业标题"}（不超过 500 字节）。`;
    }
    if (utf8ByteLength(description) > 30000 || hasControlNull(description)) {
      return "任务说明不能超过 30000 字节且不能包含非法空字符。";
    }
    if (due && !dayjs(due).isValid()) {
      return "截止时间格式无效，请重新选择或清空。";
    }
    if (questions.length < 1 || questions.length > MAX_QUESTIONS) {
      return `题目数量须在 1 到 ${MAX_QUESTIONS} 题之间。`;
    }
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const prompt = q.prompt.trim();
      const rubric = q.rubric.trim();
      if (!prompt || utf8ByteLength(prompt) > 30000 || hasControlNull(prompt)) {
        return `第 ${i + 1} 题缺少有效题目要求（不超过 30000 字节）。`;
      }
      if (!Number.isInteger(q.max_score) || q.max_score < 1 || q.max_score > 10000) {
        return `第 ${i + 1} 题满分须为 1 至 10000 的整数。`;
      }
      if (!rubric || utf8ByteLength(rubric) > 30000 || hasControlNull(rubric)) {
        return `第 ${i + 1} 题缺少评分标准（不超过 30000 字节）。`;
      }
      if (quiz) {
        const cleanedOpts = q.options.map((o) => o.trim());
        if (cleanedOpts.length < 2 || cleanedOpts.length > 8) {
          return `第 ${i + 1} 题须设置 2 至 8 个测验选项。`;
        }
        const seen = new Set<string>();
        for (const opt of cleanedOpts) {
          if (!opt || utf8ByteLength(opt) > 1000 || hasControlNull(opt)) {
            return `第 ${i + 1} 题存在空白或超过 1000 字节的选项。`;
          }
          if (seen.has(opt)) {
            return `第 ${i + 1} 题存在重复选项「${opt}」。`;
          }
          seen.add(opt);
        }
        if (!q.correct_answer.trim() || !seen.has(q.correct_answer.trim())) {
          return `第 ${i + 1} 题请选择属于当前选项列表的正确答案。`;
        }
      }
    }
    return null;
  }

  async function save(publish: boolean) {
    const err = validateAll();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError("");
    if (
      publish &&
      !(await confirm("发布后题目与评分标准将冻结，确认保存并立即发布？"))
    ) {
      return;
    }

    const snapshot = draft.value;
    const dueISO =
      due && dayjs(due).isValid() ? dayjs(due).toDate().toISOString() : null;
    const cleanQuestions = questions.map((q) => ({
      id: q.id || "",
      prompt: q.prompt.trim(),
      max_score: q.max_score,
      rubric: q.rubric.trim(),
      options: quiz ? q.options.map((o) => o.trim()) : [],
      correct_answer: quiz ? q.correct_answer.trim() : "",
      knowledge_point_id: q.knowledge_point_id || "",
      resource_id: q.resource_id || "",
      bank_question_version_id: q.bank_question_version_id || "",
      bound_rubric_id: q.bound_rubric_id || "",
    }));

    const a = await action.run<Assignment>(
      savedId ? `/assignments/${savedId}` : "/assignments",
      {
        title: title.trim(),
        description: description.trim(),
        type: assignmentType,
        due_at: dueISO,
        questions: cleanQuestions,
      },
      savedId ? "PUT" : "POST",
      publish ? undefined : "草稿已保存",
    );
    if (!a) return;
    setSavedId(a.id);
    draft.saved(snapshot);

    if (publish) {
      const published = await action.run(
        `/assignments/${a.id}/state`,
        { state: "published" },
        "POST",
        "作业已发布，题目与标准版本已冻结",
      );
      if (!published) {
        // Persist URL to the newly created draft so refreshing never orphans it.
        if (!assignmentId) {
          navigate(`/teacher/homework/${a.id}/edit`, { replace: true });
        }
        return;
      }
    }

    navigate(
      params.get("from") || (quiz ? "/teacher/quiz" : "/teacher/homework"),
    );
  }

  const editorTitle = assignmentId
    ? quiz
      ? "编辑测验"
      : "编辑作业"
    : quiz
      ? "新建测验"
      : "新建作业";
  const editorBackTo = params.get("from") || (quiz ? "/teacher/quiz" : "/teacher/homework");
  const editorBackLabel = quiz ? "返回测验" : "返回作业列表";

  if (assignmentId && original.error) {
    return (
      <div className="live-page">
        <PageHeader
          backTo={editorBackTo}
          backLabel={editorBackLabel}
          title={editorTitle}
          subtitle={course?.title}
        />
        <ErrorState
          message={original.error.message}
          onRetry={() => void original.refetch()}
        />
      </div>
    );
  }

  if (assignmentId && original.data && original.data.assignment.status !== "draft") {
    return (
      <div className="live-page">
        <PageHeader
          backTo={editorBackTo}
          backLabel={editorBackLabel}
          title={editorTitle}
          subtitle={course?.title}
        />
        <Card className="card-panel">
          <Alert
            type="warning"
            showIcon
            message="该作业已发布或已关闭，题目不可再编辑。"
            action={
              <Link to={`/teacher/homework/${assignmentId}`}>查看作业详情</Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (!draft.ready) {
    return (
      <div className="live-page">
        <PageHeader
          backTo={editorBackTo}
          backLabel={editorBackLabel}
          title={editorTitle}
          subtitle={course?.title}
        />
        <LoadingState label="正在读取作业草稿…" />
      </div>
    );
  }

  return (
    <div className="live-page">
      <PageHeader
        backTo={editorBackTo}
        backLabel={editorBackLabel}
        title={editorTitle}
        subtitle={course?.title}
      />
      <Feedback message={action.message} failed={action.failed} />
      {(points.error || resources.error) && (
        <Alert
          type="warning"
          showIcon
          message={`辅助选项读取失败：${points.error?.message || resources.error?.message}`}
        />
      )}
      <Card className="card-panel">
        <DraftNotice
          restored={draft.restored}
          storageError={draft.storageError}
          onDiscard={() => {
            draft.reset(initialDraft);
            setValidationError("");
          }}
        />
        <Form
          className="live-form"
          onFinish={() => void save(false)}
          layout="vertical"
        >
          <Field
            className="ui-field"
            label={<>{quiz ? "测验标题" : "作业标题"}</>}
            required={true}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={action.busy}
            />
          </Field>

          {!quiz && (
            <Field className="ui-field" label={<>作业类型</>}>
              <Select
                aria-label="作业类型"
                value={assignmentType}
                disabled={action.busy || hasBankBound}
                onChange={(v) => setType(v)}
                options={[
                  { value: "subjective", label: questionTypeLabels.subjective },
                  { value: "code", label: questionTypeLabels.code },
                ]}
              />
            </Field>
          )}
          {!quiz && hasBankBound && (
            <p className="live-meta">
              已绑定题库题目，如需切换题型请先移除题库题目。
            </p>
          )}

          <Field className="ui-field" label={<>任务说明</>}>
            <Input.TextArea
              aria-label="任务说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={action.busy}
            />
          </Field>

          <Field className="ui-field" label={<>截止时间</>}>
            <DatePicker
              aria-label="截止时间"
              showTime={{ format: "HH:mm" }}
              format="YYYY-MM-DD HH:mm"
              value={parsedDue}
              disabled={action.busy}
              onChange={(date) =>
                setDue(date ? date.format("YYYY-MM-DDTHH:mm") : "")
              }
            />
          </Field>
          {dueInPast && (
            <Alert
              type="warning"
              showIcon
              message="截止时间早于当前时间，发布后学生将无法提交，请核对是否需要调整。"
            />
          )}

          <div className="section-head">
            <Space wrap>
              <Typography.Text strong className="item-title">
                题目列表
              </Typography.Text>
              <MetaTag>
                {questions.length} / {MAX_QUESTIONS} 题
              </MetaTag>
              <MetaTag>合计满分 {totalScore} 分</MetaTag>
            </Space>
            <Button
              disabled={action.busy || questions.length >= MAX_QUESTIONS}
              onClick={() => setPicking(true)}
              htmlType="button"
            >
              从题库选题
            </Button>
          </div>

          {questions.map((q, i) => (
            <Card
              size="small"
              key={q.id || `new-${i}`}
              title={<>第 {i + 1} 题</>}
              extra={
                <Space size="small">
                  <Button
                    size="small"
                    htmlType="button"
                    disabled={action.busy || i === 0}
                    onClick={() => moveQuestion(i, -1)}
                  >
                    上移
                  </Button>
                  <Button
                    size="small"
                    htmlType="button"
                    disabled={action.busy || i === questions.length - 1}
                    onClick={() => moveQuestion(i, 1)}
                  >
                    下移
                  </Button>
                  {questions.length > 1 && (
                    <Button
                      size="small"
                      danger
                      disabled={action.busy}
                      onClick={() =>
                        setQuestions((v) => v.filter((_, j) => j !== i))
                      }
                      htmlType="button"
                    >
                      移除本题
                    </Button>
                  )}
                </Space>
              }
            >
              <Field
                className="ui-field"
                label={<>题目要求</>}
                required={true}
              >
                <Input.TextArea
                  aria-label={questions.length === 1 ? "题目要求" : `第 ${i + 1} 题 题目要求`}
                  readOnly={!!q.bank_question_version_id}
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
              {q.prompt.trim() && (
                <Collapse
                  items={[
                    {
                      key: "preview",
                      label: <>题干公式与排版预览</>,
                      children: <RichContent text={q.prompt} />,
                    },
                  ]}
                />
              )}
              <Field className="ui-field" label={<>满分</>} required={true}>
                {q.bank_question_version_id ? (
                  <InputNumber
                    aria-label={questions.length === 1 ? "满分" : `第 ${i + 1} 题 满分`}
                    readOnly
                    precision={0}
                    min={1}
                    max={10000}
                    value={q.max_score}
                  />
                ) : (
                  <IntegerInput
                    aria-label={questions.length === 1 ? "满分" : `第 ${i + 1} 题 满分`}
                    min={1}
                    max={10000}
                    value={q.max_score}
                    disabled={action.busy}
                    onChange={(val) =>
                      setQuestions((v) =>
                        v.map((x, j) =>
                          j === i ? { ...x, max_score: val } : x,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Field
                className="ui-field"
                label={<>评分标准</>}
                required={true}
              >
                <Input.TextArea
                  aria-label={questions.length === 1 ? "评分标准" : `第 ${i + 1} 题 评分标准`}
                  readOnly={!!q.bank_question_version_id}
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
                  aria-label={questions.length === 1 ? "关联知识点" : `第 ${i + 1} 题 关联知识点`}
                  disabled={action.busy || !!q.bank_question_version_id}
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
                  {leafPoints.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.title}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Field className="ui-field" label={<>评分依据资料</>}>
                <Select
                  aria-label={questions.length === 1 ? "评分依据资料" : `第 ${i + 1} 题 评分依据资料`}
                  disabled={action.busy || !!q.bank_question_version_id}
                  value={q.resource_id}
                  onChange={(e) =>
                    setQuestions((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, resource_id: e } : x,
                      ),
                    )
                  }
                  showSearch
                  optionFilterProp="children"
                >
                  <Select.Option value="">教师手填标准</Select.Option>
                  {publishedResources.map((r) => {
                    const loc = formatResourceLocator(r.locator);
                    return (
                      <Select.Option key={r.id} value={r.id}>
                        {r.title}
                        {loc ? ` · ${loc}` : ""} · v{r.version}
                      </Select.Option>
                    );
                  })}
                </Select>
              </Field>
              {quiz && (
                <Field
                  className="ui-field"
                  label={<>选项与正确答案</>}
                  required={true}
                >
                  <QuizOptionsEditor
                    options={q.options}
                    correctAnswer={q.correct_answer}
                    disabled={action.busy || !!q.bank_question_version_id}
                    onChange={(nextOptions, nextCorrect) =>
                      setQuestions((v) =>
                        v.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                options: nextOptions,
                                correct_answer: nextCorrect,
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </Field>
              )}
            </Card>
          ))}

          {validationError && (
            <Alert type="error" showIcon role="alert" message={validationError} />
          )}

          <div className="live-inline">
            <Button
              disabled={action.busy || questions.length >= MAX_QUESTIONS}
              onClick={() =>
                setQuestions((v) => [...v, emptyQuestion(quiz)])
              }
              htmlType="button"
            >
              新增题目
            </Button>
            {questions.length >= MAX_QUESTIONS && (
              <span className="live-meta">已达到单次作业 50 题上限</span>
            )}
            <Button disabled={action.busy || !course} htmlType="submit">
              保存草稿
            </Button>
            <Button
              disabled={action.busy || !course}
              onClick={() => void save(true)}
              htmlType="button"
              type="primary"
            >
              保存并发布
            </Button>
          </div>
        </Form>

        <BankQuestionPicker
          open={picking}
          embedded
          onClose={() => setPicking(false)}
          type={assignmentType}
          onSelect={(v, r) => {
            if (questions.length >= MAX_QUESTIONS) return;
            const item: DraftQuestion = {
              prompt: v.prompt,
              max_score: v.max_score,
              rubric: r
                ? r.criteria
                    .map((p) => `${p.title}（${p.max_score}分）：${p.rule}`)
                    .join("\n")
                : "按教师确认的选项答案判分",
              options: quiz ? v.options : [],
              correct_answer: quiz ? v.correct_answer : "",
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
  const query = useLiveQuery<{
    assignment: LiveAssignment;
    questions: LiveQuestion[];
  }>(`/assignments/${assignmentId}`);
  const submissions = useLiveQuery<LiveSubmission[]>(
    `/assignments/${assignmentId}/submissions`,
  );

  const submissionsByQuestion = useMemo(() => {
    const map = new Map<string, LiveSubmission[]>();
    for (const s of submissions.data || []) {
      const arr = map.get(s.question_id);
      if (arr) arr.push(s);
      else map.set(s.question_id, [s]);
    }
    return map;
  }, [submissions.data]);

  const questionIndexMap = useMemo(() => {
    const map = new Map<string, { index: number; prompt: string }>();
    (query.data?.questions || []).forEach((q, idx) => {
      map.set(q.id, { index: idx + 1, prompt: q.prompt });
    });
    return map;
  }, [query.data?.questions]);

  const questions = query.data?.questions || [];
  const submittedQuestionCount = submissionsByQuestion.size;

  const detailBackTo = `/${teacher ? "teacher" : "student"}/${query.data?.assignment.type === "quiz" ? "quiz" : "homework"}`;
  const detailBackLabel = query.data?.assignment.type === "quiz" ? "返回测验" : "返回作业列表";

  return (
    <div className="live-page">
      <PageHeader
        backTo={detailBackTo}
        backLabel={detailBackLabel}
        title={query.data?.assignment.title || "作业详情"}
        subtitle={query.data?.assignment.description}
        meta={
          query.data ? (
            <>
              <StatusTag
                status={query.data.assignment.status}
                label={labelFor(stateLabels, query.data.assignment.status)}
              />
              <MetaTag>截止：{when(query.data.assignment.due_at)}</MetaTag>
              <MetaTag>
                {teacher
                  ? `共 ${questions.length} 题 · 已收到 ${submissions.data?.length || 0} 份提交`
                  : `已提交 ${submittedQuestionCount}/ ${questions.length} 题`}
              </MetaTag>
            </>
          ) : undefined
        }
        extra={
          query.data ? (
            <>
              <ContextAgent
                context={{
                  kind: "assignment",
                  id: query.data.assignment.id,
                  title: query.data.assignment.title,
                }}
              />
              {teacher && query.data.assignment.status === "closed" && (
                <Link
                  className="ghost-btn"
                  to={`/teacher/regrades?assignment=${assignmentId}&new=1`}
                >
                  整组重评
                </Link>
              )}
              {teacher && (
                <Link
                  className="primary-link"
                  to={`/teacher/homework/${assignmentId}/submissions?${params}`}
                >
                  进入批阅队列
                </Link>
              )}
            </>
          ) : undefined
        }
      />
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

      {questions.length > 1 && (
        <Card size="small" className="card-panel">
          <Space wrap size="small">
            <Typography.Text strong>题目导航：</Typography.Text>
            {questions.map((q, idx) => {
              const hasSub = (submissionsByQuestion.get(q.id)?.length || 0) > 0;
              return (
                <Button
                  key={q.id}
                  size="small"
                  htmlType="button"
                  type={!teacher && hasSub ? "primary" : "default"}
                  ghost={!teacher && hasSub}
                  onClick={() =>
                    document
                      .getElementById(`question-${q.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  第 {idx + 1} 题{!teacher && hasSub ? " ✓" : ""}
                </Button>
              );
            })}
          </Space>
        </Card>
      )}

      {query.data &&
        questions.map((q, idx) => (
          <QuestionAnswer
            key={q.id}
            index={idx + 1}
            question={q}
            assignment={query.data.assignment}
            teacher={teacher}
            submissions={submissionsByQuestion.get(q.id) || []}
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
                {submissions.data?.map((s) => {
                  const qInfo = questionIndexMap.get(s.question_id);
                  const preview = qInfo
                    ? `第 ${qInfo.index} 题 · ${qInfo.prompt.slice(0, 70)}`
                    : "查看题目作答";
                  return (
                    <article className="live-row" key={s.id}>
                      <div>
                        <Link
                          to={`/${teacher ? "teacher" : "student"}/homework/submissions/${s.id}/${teacher ? "grade" : "feedback"}`}
                        >
                          {teacher && s.student_name
                            ? `${s.student_name} — ${preview}`
                            : preview}
                        </Link>
                        <MetaTags>
                          {teacher && s.student_name && (
                            <MetaTag>{s.student_name}</MetaTag>
                          )}
                          <StatusTag
                            status={s.status}
                            label={labelFor(stateLabels, s.status)}
                          />
                          <MetaTag>第 {s.attempt} 次提交</MetaTag>
                          <span className="live-meta">
                            {when(s.submitted_at)}
                          </span>
                        </MetaTags>
                      </div>
                    </article>
                  );
                })}
                {!submissions.data?.length && <p>暂无提交记录。</p>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

interface AnswerDraft {
  answer: string;
  request_id: string;
}

function QuestionAnswer({
  index,
  question: q,
  assignment: a,
  teacher,
  submissions,
}: {
  index: number;
  question: LiveQuestion;
  assignment: LiveAssignment;
  teacher: boolean;
  submissions: LiveSubmission[];
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

  const initialDraft = useMemo<AnswerDraft>(
    () => ({
      answer: remote.data?.answer_text || "",
      request_id: uuid(),
    }),
    [remote.data?.answer_text],
  );

  const draft = useEditorDraft<AnswerDraft | string>(
    `answer:${course?.id}:${q.id}`,
    initialDraft,
    !teacher && remote.isSuccess,
  );

  const answer =
    typeof draft.value === "string" ? draft.value : draft.value.answer;
  const requestID =
    typeof draft.value === "string"
      ? initialDraft.request_id
      : draft.value.request_id || initialDraft.request_id;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [receipt, setReceipt] = useState<LiveSubmission | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const busy = useRef(false);
  const active = useRef(true);
  const debounceRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);
  const latestAnswerRef = useRef(answer);
  const dirtyRef = useRef(draft.dirty);
  const closedRef = useRef(false);
  latestAnswerRef.current = answer;
  dirtyRef.current = draft.dirty;

  useEffect(() => {
    setError("");
    setReceipt(null);
    setSavedAt("");
    action.clearError();
  }, [q.id, action.clearError]);

  useEffect(() => {
    if (teacher || a.status !== "published" || !a.due_at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [teacher, a.status, a.due_at]);

  const dueMs = a.due_at ? Date.parse(a.due_at) : NaN;
  const hasValidDue = Number.isFinite(dueMs);
  const remainingMs = hasValidDue ? dueMs - now : null;
  const closed = a.status !== "published" || (remainingMs !== null && remainingMs <= 0);
  closedRef.current = closed;

  const showCountdown =
    !teacher &&
    !closed &&
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= 24 * 3600 * 1000;

  const flushKeepalive = useCallback(() => {
    if (
      teacher ||
      !course ||
      closedRef.current ||
      !dirtyRef.current ||
      !draft.ready
    ) {
      return;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
    void fetch(
      `/api/v1/learning/courses/${course.id}/assignments/${a.id}/questions/${q.id}/draft`,
      {
        method: "PUT",
        credentials: "same-origin",
        keepalive: true,
        headers,
        body: JSON.stringify({ answer_text: latestAnswerRef.current }),
      },
    ).catch(() => {});
  }, [a.id, course, draft.ready, q.id, session?.csrf_token, teacher]);

  useEffect(() => {
    active.current = true;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushKeepalive();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flushKeepalive();
    };
  }, [flushKeepalive]);

  const saveDraft = useCallback(
    async (explicitValue?: string) => {
      if (teacher || !course || busy.current || !draft.ready || closedRef.current) {
        return;
      }
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const valueToSave = explicitValue ?? latestAnswerRef.current;
      const snapshot = draft.value;
      const seq = saveSeqRef.current + 1;
      saveSeqRef.current = seq;
      busy.current = true;
      setSaving(true);
      setError("");
      try {
        await requestJSON(
          `/learning/courses/${course.id}/assignments/${a.id}/questions/${q.id}/draft`,
          { method: "PUT", body: JSON.stringify({ answer_text: valueToSave }) },
          session?.csrf_token,
        );
        if (active.current && seq === saveSeqRef.current) {
          draft.saved(snapshot);
          setSavedAt(new Date().toLocaleTimeString("zh-CN"));
        }
      } catch (e) {
        if (active.current && seq === saveSeqRef.current) {
          setError(e instanceof Error ? e.message : "保存失败");
        }
      } finally {
        busy.current = false;
        if (active.current) setSaving(false);
      }
      void cache.invalidateQueries({
        queryKey: [
          "live",
          course.id,
          `/assignments/${a.id}/questions/${q.id}/draft`,
        ],
      });
      void cache.invalidateQueries({
        predicate: (entry) =>
          entry.queryKey[0] === "live" &&
          entry.queryKey[1] === course.id &&
          String(entry.queryKey[2]).startsWith("/assignment-worklist"),
      });
    },
    [a.id, cache, course, draft, q.id, session?.csrf_token, teacher],
  );

  useEffect(() => {
    if (teacher || closed || !draft.dirty || !draft.ready || saving || error) {
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void saveDraft();
    }, 900);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [answer, closed, draft.dirty, draft.ready, error, saveDraft, saving, teacher]);

  const answerBytes = useMemo(() => utf8ByteLength(answer), [answer]);
  const answerTooLarge = answerBytes > MAX_ANSWER_BYTES;
  const answerHasNull = useMemo(() => hasControlNull(answer), [answer]);
  const quizSelectionValid =
    q.type !== "quiz" || (!!answer && q.options.includes(answer));
  const latest = submissions[0];

  function updateAnswer(nextAnswer: string) {
    draft.change({ answer: nextAnswer, request_id: uuid() });
    setError("");
  }

  function submit() {
    if (closed) return;
    if (q.type === "quiz" && !quizSelectionValid) {
      setError("请先选择一个测验选项后再提交。");
      return;
    }
    if (!answer.trim() || answerTooLarge || answerHasNull) {
      setError(
        answerTooLarge
          ? `作答内容不能超过 ${MAX_ANSWER_BYTES} 字节。`
          : "请填写有效作答内容后再提交。",
      );
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    modal.confirm({
      title: "确认提交本题？",
      content: `本次只提交当前题目。${submissions.length ? "将保留已有记录并新增一次提交。" : "提交后保存本次原文。"}`,
      okText: "确认提交",
      cancelText: "继续编辑",
      onOk: async () => {
        const submittedAnswer = answer;
        const v = await action.run<LiveSubmission>(
          `/assignments/${a.id}/submissions`,
          {
            question_id: q.id,
            answer_text: submittedAnswer,
            request_id: requestID,
          },
        );
        if (!v) return;
        draft.reset({ answer: submittedAnswer, request_id: uuid() });
        setReceipt(v);
        action.setMessage(
          `提交成功 · 第${v.attempt}次 · ${when(v.submitted_at)}`,
        );
        // Best-effort sync server draft so DB never retains stale pre-edit text.
        if (course) {
          void requestJSON(
            `/learning/courses/${course.id}/assignments/${a.id}/questions/${q.id}/draft`,
            {
              method: "PUT",
              body: JSON.stringify({ answer_text: submittedAnswer }),
            },
            session?.csrf_token,
          ).catch(() => {});
        }
      },
    });
  }

  const showAssets = !teacher || !!q.bank_question_version_id;

  return (
    <Card
      id={`question-${q.id}`}
      className="card-panel answer-panel"
      title={<>第 {index} 题 · 满分 {q.max_score} 分</>}
    >
      {modalContext}
      <RichContent text={q.prompt} />
      {showAssets && <PublishedAssets kind="questions" id={q.id} />}
      {teacher ? (
        <>
          <Typography.Text strong className="item-title">
            教师评分标准
          </Typography.Text>
          <p className="live-prose">{q.rubric}</p>
          {q.bank_question_version_id ? (
            <p className="live-meta">
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
          {showCountdown && remainingMs !== null && (
            <Alert
              type="warning"
              showIcon
              message={`距离截止时间还剩 ${formatCountdown(remainingMs)}，请及时保存并提交。`}
            />
          )}
          {closed && (
            <Alert
              type="info"
              showIcon
              message={`${a.status === "closed" ? "作业已关闭" : "已过截止时间"}，停止接收新提交，可查看原作答与反馈。`}
            />
          )}
          {!closed && q.type === "quiz" && submissions.length > 0 && (
            <Alert
              type="info"
              showIcon
              message="客观测验默认仅允许作答 1 次；若需重测，需先由教师下发针对本题的补学任务。"
            />
          )}
          <DraftNotice
            restored={draft.restored}
            storageError={draft.storageError}
            onDiscard={() => {
              draft.reset({
                answer: remote.data?.answer_text || "",
                request_id: uuid(),
              });
              setError("");
            }}
          />
          <Feedback
            error={remote.error}
            message={error || action.message}
            failed={!!error || action.failed}
          />
          {action.error?.code === "request_conflict" && (
            <Alert
              type="warning"
              showIcon
              message="提交请求号冲突，可重置请求号后重新提交。"
              action={
                <Button
                  size="small"
                  htmlType="button"
                  onClick={() => {
                    draft.change({ answer, request_id: uuid() });
                    action.setMessage("");
                  }}
                >
                  重置请求号
                </Button>
              }
            />
          )}
          {q.type === "quiz" ? (
            <Radio.Group
              aria-label="我的作答"
              name={q.id}
              value={answer}
              disabled={!draft.ready || closed}
              onChange={(e) => updateAnswer(String(e.target.value))}
            >
              <Space direction="vertical" className="live-full-width">
                {q.options.map((o, i) => (
                  <Radio className="live-option" key={i} value={o}>
                    {o}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          ) : (
            <Field className="ui-field" label={<>我的作答</>}>
              <Input.TextArea
                aria-label="我的作答"
                rows={12}
                disabled={!draft.ready || closed}
                value={answer}
                onChange={(e) => updateAnswer(e.target.value)}
              />
            </Field>
          )}
          <div className="answer-status" role="status">
            <span>
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
            </span>
            <span>
              {answer.length}字
              {answerBytes > 150000
                ? `（${answerBytes}/${MAX_ANSWER_BYTES} 字节）`
                : ""}
            </span>
          </div>
          {answerTooLarge && (
            <Alert
              type="error"
              showIcon
              role="alert"
              message={`作答内容超过 ${MAX_ANSWER_BYTES} 字节上限，请精简后再提交。`}
            />
          )}
          {receipt && (
            <Alert
              type="success"
              showIcon
              message={`已记录第 ${receipt.attempt} 次提交（${when(receipt.submitted_at)}）`}
              action={
                <Link to={`/student/homework/submissions/${receipt.id}/feedback`}>
                  {q.type === "quiz" ? "查看判分结果" : "查看本次提交"}
                </Link>
              }
            />
          )}
          <div className="live-inline">
            <Button
              htmlType="button"
              disabled={saving || !draft.ready || closed || answerTooLarge}
              onClick={() => void saveDraft()}
            >
              保存作答草稿
            </Button>
            <Button
              htmlType="button"
              disabled={
                action.busy ||
                saving ||
                closed ||
                !answer.trim() ||
                !quizSelectionValid ||
                answerTooLarge ||
                answerHasNull
              }
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
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") || "";
  const state = params.get("state") || "";
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const q = useLiveQuery<{ rows: QueueItem[]; total: number }>(
    `/assignments/${assignmentId}/worklist?${new URLSearchParams({
      page: String(page),
      size: "20",
      search,
      state,
    })}`,
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
    for (const [k, v] of Object.entries(values)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  }

  return (
    <div className="live-page">
      <PageHeader
        backTo={params.get("from") || "/teacher/homework"}
        backLabel="返回作业列表"
        title="提交列表"
        subtitle={detail.data?.assignment.title}
        meta={
          roster.data ? (
            <>
              <MetaTag>共 {roster.data.total} 人</MetaTag>
              <StatusTag
                status="submitted"
                label={`全部提交 ${roster.data.submitted}`}
              />
              <StatusTag
                status="partial"
                label={`部分提交 ${roster.data.partial}`}
              />
              <StatusTag
                status="pending"
                label={`未提交 ${roster.data.not_submitted}`}
              />
            </>
          ) : undefined
        }
        extra={
          detail.data ? (
            <SubmissionImport
              key={assignmentId}
              assignment={detail.data.assignment}
              questions={detail.data.questions}
            />
          ) : undefined
        }
      />

      <Feedback error={q.error || roster.error || detail.error} />

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
                    <MetaTag>
                      {m.submitted_questions}/{m.total_questions} 题
                    </MetaTag>
                  </div>
                ))}
              </>
            ),
          },
        ]}
      />

      <div className="filter-bar">
        <Input.Search
          aria-label="搜索学生"
          placeholder="搜索学生"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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

      <Card className="card-panel">
        {q.isPending ? (
          <LoadingState />
        ) : (
          <div className="table-wrap">
            <Table<QueueItem>
              rowKey="id"
              dataSource={q.data?.rows || []}
              pagination={false}
              scroll={{ x: 720 }}
              locale={{ emptyText: "当前筛选没有提交" }}
              columns={[
                { title: "学生", dataIndex: "student_name" },
                { title: "题目", dataIndex: "prompt", ellipsis: true },
                { title: "次数", dataIndex: "attempt" },
                {
                  title: "来源",
                  dataIndex: "teacher_imported",
                  render: (value: boolean) => (
                    <MetaTag>{value ? "教师导入" : "学生提交"}</MetaTag>
                  ),
                },
                {
                  title: "时间",
                  dataIndex: "submitted_at",
                  onCell: () => ({ style: { whiteSpace: "nowrap" } }),
                  render: (value: string) => when(value),
                },
                {
                  title: "状态",
                  dataIndex: "review_state",
                  render: (value: string) => (
                    <StatusTag
                      status={value}
                      label={reviewNames[value] || value}
                    />
                  ),
                },
                {
                  title: "操作",
                  key: "actions",
                  render: (_, s) => (
                    <Link
                      to={`/teacher/homework/submissions/${s.id}/grade?${params}`}
                    >
                      批改详情
                    </Link>
                  ),
                },
              ]}
            />
          </div>
        )}
        <Pagination
          hideOnSinglePage
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
