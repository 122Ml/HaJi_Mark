import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Pagination,
  Select,
  Space,
  Typography,
} from "antd";
import { Field } from "../shared/Field";
import { PageHeader } from "../shared/PageHeader";
import { useConfirm } from "../shared/confirm";
import { useSession } from "../shared/session";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import {
  Feedback,
  Link,
  names,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { ContextAgent } from "./context-agent";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { useLocationPage, useLocationValue } from "./location-state";
import type { Assignment, Member, Question, Resource, Submission } from "./types";

interface Intervention {
  id: string;
  student_id: string;
  student_name: string;
  title: string;
  description: string;
  status: string;
  answer_text: string;
  review_note: string;
  resource_id: string | null;
  assignment_id: string | null;
  source_submission_id?: string | null;
  diagnosis_report_id?: string | null;
  diagnosis_label_id?: string | null;
}

interface InterventionEvidence {
  assigned_at: string | null;
  learning_ready: boolean;
  practice_ready: boolean;
  learning: { resource_id: string; occurred_at: string }[];
  submissions: {
    id: string;
    question_id: string;
    attempt: number;
    submitted_at: string;
  }[];
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isAssignmentOverdue(assignment: Assignment): boolean {
  if (!assignment.due_at) return false;
  const parsed = Date.parse(assignment.due_at);
  return !Number.isNaN(parsed) && parsed < Date.now();
}

export function InterventionPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { course } = useLearning();
  const query = useLiveQuery<Intervention[]>("/interventions");
  const [search, setSearch] = useLocationValue("search");
  const state = params.get("state") || "";
  const student = params.get("student") || "";
  const taskParam = params.get("task") || "";
  const [page, setPage] = useLocationPage();
  const creating = params.get("new") === "1";
  const [scopeDirty, setScopeDirty] = useState(false);
  const [creatorDirty, setCreatorDirty] = useState(false);
  const drawerDirty = scopeDirty || creatorDirty;

  function patch(values: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  }

  const closeCreator = () => {
    setScopeDirty(false);
    setCreatorDirty(false);
    patch({ new: "", submission: "", point: "" });
  };

  const selected = query.data?.find((i) => i.id === taskParam);
  const statusOptions = useMemo(() => {
    const entries: [string, string][] = teacher
      ? [
          ["draft", "草稿"],
          ["assigned", "待执行"],
          ["submitted", "待复查"],
          ["reviewed", "已复查"],
        ]
      : [
          ["assigned", "待执行"],
          ["submitted", "待复查"],
          ["reviewed", "已复查"],
        ];
    return [
      { value: "", label: "全部任务" },
      ...entries.map(([value, label]) => ({ value, label })),
    ];
  }, [teacher]);

  const effectiveState = !teacher && state === "draft" ? "" : state;

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data || []).filter(
      (i) =>
        (!effectiveState || i.status === effectiveState) &&
        (!student || i.student_id === student) &&
        `${i.title} ${teacher ? i.student_name : ""}`
          .toLocaleLowerCase()
          .includes(needle),
    );
  }, [query.data, effectiveState, student, search, teacher]);

  const totalPages = Math.max(1, Math.ceil(rows.length / 10));
  const safePage = Math.min(page, totalPages);

  return (
    <div className="live-page">
      <PageHeader
        title={teacher ? "补学补练" : "老师任务"}
        subtitle={course?.title}
        extra={
          teacher ? (
            <Button
              onClick={() => patch({ new: "1", submission: "", point: "" })}
              type="primary"
            >
              新建补学补练任务
            </Button>
          ) : undefined
        }
      />
      <div className="filter-bar">
        <Input.Search
          aria-label="搜索任务"
          placeholder={teacher ? "搜索任务或学生" : "搜索任务"}
          value={search}
          allowClear
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <Select
          aria-label="任务状态"
          value={effectiveState}
          onChange={(v) => {
            patch({ state: v, page: "1" });
          }}
          options={statusOptions}
        />
        {student && (
          <Button
            onClick={() =>
              patch({ student: "", submission: "", point: "", page: "1" })
            }
          >
            查看全部学生
          </Button>
        )}
      </div>
      {taskParam && !query.isPending && !query.error && !selected && (
        <Alert
          type="warning"
          showIcon
          role="alert"
          message="未找到指定的补学补练任务，可能无权访问或已被移除。"
          action={
            <Button size="small" onClick={() => patch({ task: "" })}>
              返回列表
            </Button>
          }
        />
      )}
      {query.isPending ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Card className="card-panel">
          {!rows.length && <EmptyState title="当前筛选没有任务" />}
          {rows.slice((safePage - 1) * 10, safePage * 10).map((i) => (
            <article className="live-row" key={i.id}>
              <div>
                <Typography.Text strong className="item-title">
                  {i.title}
                </Typography.Text>
                <MetaTags>
                  <StatusTag
                    status={i.status}
                    label={names[i.status] || i.status}
                  />
                  {teacher && <MetaTag>{i.student_name}</MetaTag>}
                  {i.resource_id && <MetaTag>补学资料</MetaTag>}
                  {i.assignment_id && <MetaTag>补练作业</MetaTag>}
                </MetaTags>
              </div>
              <Button onClick={() => patch({ task: i.id })} type="primary">
                {teacher
                  ? i.status === "submitted"
                    ? "复查完成证据"
                    : "查看任务"
                  : "进入任务"}
              </Button>
            </article>
          ))}
          <Pagination
            current={safePage}
            pageSize={10}
            total={rows.length}
            showSizeChanger={false}
            hideOnSinglePage
            responsive
            onChange={setPage}
          />
        </Card>
      )}
      <Drawer
        title="补学补练任务"
        open={!!selected}
        onClose={() => patch({ task: "" })}
        width="min(100vw, 760px)"
        destroyOnHidden
      >
        {selected && (
          <TaskDetail key={selected.id} item={selected} teacher={teacher} />
        )}
      </Drawer>
      {teacher && (
        <Drawer
          title="新建补学补练任务"
          open={creating}
          onClose={async () => {
            if (
              !drawerDirty ||
              (await confirm("放弃当前未提交的草稿并关闭？草稿仍会保留在浏览器会话中。"))
            ) {
              closeCreator();
            }
          }}
          width="min(100vw, 680px)"
          destroyOnHidden
        >
          {creating && (
            <EditorScope isolated onDirtyChange={setScopeDirty}>
              <TaskCreator
                key={`${course?.id}/${student}/${params.get("submission") || ""}`}
                student={student}
                source={params.get("submission") || ""}
                point={params.get("point") || ""}
                onDirtyChange={setCreatorDirty}
                onCreated={(id) => {
                  setScopeDirty(false);
                  setCreatorDirty(false);
                  patch({ task: id, new: "", submission: "", point: "" });
                }}
              />
            </EditorScope>
          )}
        </Drawer>
      )}
    </div>
  );
}

export function TaskCreator({
  student,
  source,
  point,
  onCreated,
  diagnosis,
  onDirtyChange,
}: {
  student: string;
  source: string;
  point: string;
  onCreated: (id: string) => void;
  diagnosis?: {
    reportID: string;
    labelID: string;
    title: string;
    explanation: string;
  };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { course } = useLearning();
  const action = useAction();
  const members = useLiveQuery<Member[]>("/members");
  const resources = useLiveQuery<Resource[]>("/resources");
  const assignments = useLiveQuery<Assignment[]>("/assignments");
  const [activeSource, setActiveSource] = useState(source);
  const [activePoint, setActivePoint] = useState(point);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setActiveSource(source);
    setActivePoint(point);
  }, [source, point]);

  const origin = useLiveQuery<{ submission: Submission; question: Question }>(
    `/submissions/${activeSource}`,
    !!activeSource,
  );

  const initialForm = useMemo(
    () => ({
      student_id: student,
      title: diagnosis ? `补学补练：${diagnosis.title}` : "",
      description: diagnosis?.explanation || "",
      resource_id: "",
      assignment_id: "",
    }),
    [student, diagnosis],
  );

  const draft = useEditorDraft(
    `intervention:${course?.id}:${student}:${activeSource}:${diagnosis?.reportID || ""}:${diagnosis?.labelID || ""}`,
    initialForm,
  );

  useEffect(() => {
    onDirtyChange?.(draft.dirty);
    return () => onDirtyChange?.(false);
  }, [draft.dirty, onDirtyChange]);

  const form = draft.value;
  const studentID = activeSource
    ? origin.data?.submission.student_id || ""
    : form.student_id;
  const effectivePoint =
    activePoint || origin.data?.question.knowledge_point_id || "";

  const studentEnrolled =
    !studentID ||
    !members.data ||
    members.data.some((m) => m.id === studentID);

  const selectedAssignment = assignments.data?.find(
    (a) => a.id === form.assignment_id,
  );
  const assignmentBlocked =
    !!form.assignment_id &&
    (!selectedAssignment ||
      selectedAssignment.status !== "published" ||
      isAssignmentOverdue(selectedAssignment));

  const change = (key: keyof typeof form, value: string) => {
    setValidationError("");
    draft.change((v) => ({ ...v, [key]: value }));
  };

  const publishedResources = useMemo(
    () =>
      (resources.data || [])
        .filter((r) => r.status === "published")
        .sort(
          (a, b) =>
            Number(Boolean(effectivePoint) && b.knowledge_point_id === effectivePoint) -
            Number(Boolean(effectivePoint) && a.knowledge_point_id === effectivePoint),
        ),
    [resources.data, effectivePoint],
  );

  const assignmentOptions = useMemo(
    () =>
      (assignments.data || [])
        .filter((a) => a.status === "published")
        .map((a) => {
          const overdue = isAssignmentOverdue(a);
          return {
            value: a.id,
            label: overdue ? `${a.title}（已截止，学生无法补交）` : a.title,
            disabled: overdue,
          };
        }),
    [assignments.data],
  );

  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const v = draft.value;
        const cleanTitle = v.title.trim();
        const cleanDesc = v.description.trim();
        if (!cleanTitle || utf8Bytes(cleanTitle) > 500) {
          setValidationError("请填写非空任务标题（不超过 500 字节）。");
          return;
        }
        if (!cleanDesc || utf8Bytes(cleanDesc) > 30000) {
          setValidationError("请填写非空执行要求（不超过 30000 字节）。");
          return;
        }
        if (!studentID || !studentEnrolled) {
          setValidationError("请选择当前课程内的学生。");
          return;
        }
        if (assignmentBlocked) {
          setValidationError("所选补练作业已截止或已关闭，请更换作业或清空关联。");
          return;
        }
        setValidationError("");
        const result = await action.run<Intervention>("/interventions", {
          ...v,
          title: cleanTitle,
          description: cleanDesc,
          student_id: studentID,
          source_submission_id: activeSource,
          diagnosis_report_id: diagnosis?.reportID || "",
          diagnosis_label_id: diagnosis?.labelID || "",
        });
        if (result) {
          draft.saved(v);
          onCreated(result.id);
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} onDiscard={() => draft.reset(initialForm)} />
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      <Feedback
        error={
          members.error || resources.error || assignments.error || origin.error
        }
        message={action.message}
        failed={action.failed}
      />
      {!!activeSource && origin.isPending && (
        <LoadingState label="正在加载关联作答信息…" />
      )}
      {origin.data && (
        <aside className="context-banner">
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
            <strong style={{ overflowWrap: "anywhere" }}>
              来自：{origin.data.question.prompt}
            </strong>
            <p>第{origin.data.submission.attempt}次作答</p>
          </div>
          <Space wrap>
            <Link to={`/teacher/homework/submissions/${activeSource}/grade`}>
              查看原始依据
            </Link>
            {!diagnosis && (
              <Button
                size="small"
                onClick={() => {
                  setActiveSource("");
                  setActivePoint("");
                  draft.change((v) => ({
                    ...v,
                    student_id: "",
                    resource_id: "",
                  }));
                }}
              >
                清除关联作答
              </Button>
            )}
          </Space>
        </aside>
      )}
      {!studentEnrolled && (
        <Alert
          type="warning"
          showIcon
          message="该学生当前不在本课程名单中，无法为其创建补学补练任务。"
        />
      )}
      {assignmentBlocked && (
        <Alert
          type="warning"
          showIcon
          message="所选补练作业已截止或已关闭，学生将无法提交新的补练作答；请更换进行中的作业或清空关联。"
        />
      )}
      <Field
        className="ui-field"
        label={<>指定学生</>}
        required
        name="student_id"
        getValueProps={() => ({ value: studentID || undefined })}
        rules={[
          {
            validator: async () => {
              if (!studentID) throw Error("请选择学生或等候原始作答加载");
            },
          },
        ]}
      >
        <Select
          aria-label="指定学生"
          disabled={members.isPending || !!activeSource}
          allowClear={!activeSource}
          placeholder="选择学生"
          value={studentID || undefined}
          onChange={(v) => change("student_id", v || "")}
          showSearch
          optionFilterProp="label"
          options={(members.data || []).map((m) => ({
            value: m.id,
            label: m.display_name,
          }))}
        />
      </Field>
      <Field className="ui-field" label={<>任务标题</>} required>
        <Input
          aria-label="任务标题"
          required
          maxLength={200}
          value={form.title}
          onChange={(e) => change("title", e.target.value)}
        />
      </Field>
      <Field className="ui-field" label={<>补学资料、练习及完成要求</>} required>
        <Input.TextArea
          aria-label="补学资料、练习及完成要求"
          required
          rows={4}
          value={form.description}
          onChange={(e) => change("description", e.target.value)}
        />
      </Field>
      <Field className="ui-field" label={<>关联补学资料</>}>
        <Select
          aria-label="关联补学资料"
          allowClear
          placeholder="不指定资料"
          value={form.resource_id || undefined}
          onChange={(v) => change("resource_id", v || "")}
          showSearch
          optionFilterProp="label"
          options={publishedResources.map((r) => ({
            value: r.id,
            label: `${r.title} · v${r.version}`,
          }))}
        />
      </Field>
      <Field className="ui-field" label={<>关联补练作业</>}>
        <Select
          aria-label="关联补练作业"
          allowClear
          placeholder="不指定作业"
          value={form.assignment_id || undefined}
          onChange={(v) => change("assignment_id", v || "")}
          showSearch
          optionFilterProp="label"
          options={assignmentOptions}
        />
      </Field>
      <Button
        disabled={
          action.busy ||
          !studentID ||
          !studentEnrolled ||
          assignmentBlocked ||
          !!origin.error ||
          (!!activeSource && origin.isPending)
        }
        loading={action.busy}
        htmlType="submit"
        type="primary"
      >
        保存任务草稿
      </Button>
    </Form>
  );
}

export function TaskWorkspace({ id }: { id: string }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const q = useLiveQuery<Intervention[]>("/interventions");
  const item = q.data?.find((i) => i.id === id);
  return (
    <>
      <Feedback error={q.error} />
      {q.isPending ? (
        <LoadingState />
      ) : item ? (
        <TaskDetail key={item.id} item={item} teacher={teacher} />
      ) : (
        <EmptyState title="任务不可访问" />
      )}
    </>
  );
}

function TaskDetail({
  item: i,
  teacher,
}: {
  item: Intervention;
  teacher: boolean;
}) {
  const action = useAction();
  const [validationError, setValidationError] = useState("");
  const evidence = useLiveQuery<InterventionEvidence>(
    `/interventions/${i.id}/evidence`,
    i.status !== "draft",
    true,
  );
  const resources = useLiveQuery<Resource[]>("/resources", !!i.resource_id);
  const assignments = useLiveQuery<Assignment[]>(
    "/assignments",
    !!i.assignment_id,
  );
  const draft = useEditorDraft(
    `task-response:${i.id}:${teacher ? "review" : "answer"}`,
    "",
  );
  const ready =
    !evidence.isPending &&
    !evidence.isFetching &&
    !evidence.error &&
    Boolean(evidence.data?.learning_ready) &&
    Boolean(evidence.data?.practice_ready);

  const sourceID =
    i.source_submission_id ||
    i.description.match(/关联作答：([a-f0-9-]{36})/)?.[1];
  const linkedAssignment = assignments.data?.find(
    (a) => a.id === i.assignment_id,
  );
  const maxContentBytes = teacher ? 30000 : 200000;

  return (
    <div className="live-page">
      <PageHeader
        backTo={teacher ? "/teacher/intervention" : "/student/intervention"}
        backLabel="返回任务列表"
        title={i.title}
        subtitle={i.student_name}
        meta={<StatusTag status={i.status} label={names[i.status] || i.status} />}
        extra={<ContextAgent context={{ kind: "intervention", id: i.id, title: i.title }} />}
      />
      <p className="live-prose">
        {i.description.replace(/\n关联作答：[a-f0-9-]{36}/, "")}
      </p>
      {sourceID && teacher && (
        <Link to={`/teacher/homework/submissions/${sourceID}/grade`}>
          查看任务原始依据
        </Link>
      )}
      {teacher && i.diagnosis_report_id && (
        <Link
          to={`/teacher/insight?view=gaps&diagnosis_report=${i.diagnosis_report_id}`}
        >
          查看任务关联的已确认诊断
        </Link>
      )}
      <Feedback message={action.message} failed={action.failed} />
      {i.status !== "draft" && (
        <section className="evidence-checklist">
          <div className="live-heading">
            <Typography.Text strong className="item-title">
              本次完成条件
            </Typography.Text>
            <Button
              size="small"
              loading={evidence.isFetching}
              onClick={() => void evidence.refetch()}
            >
              刷新证据
            </Button>
          </div>
          {evidence.error && (
            <ErrorState
              message={evidence.error.message}
              onRetry={() => void evidence.refetch()}
            />
          )}
          {evidence.isPending ? (
            <LoadingState label="正在读取最新完成证据…" />
          ) : (
            evidence.data && (
              <>
                <p>下发于 {when(evidence.data.assigned_at)}</p>
                {!i.resource_id && !i.assignment_id && (
                  <p>本任务未绑定资料或补练作业，可直接填写执行结果提交。</p>
                )}
                {i.resource_id && (
                  <p>
                    {evidence.data.learning_ready
                      ? "✓ 已有新的学习完成记录"
                      : "○ 待完成关联资料学习"}
                  </p>
                )}
                {i.assignment_id && (
                  <p>
                    {evidence.data.practice_ready
                      ? "✓ 已为全部题目提交新作答"
                      : "○ 待逐题提交新的补练作答"}
                  </p>
                )}
                {evidence.data.learning.map((e, n) => (
                  <p key={n}>学习完成 · {when(e.occurred_at)}</p>
                ))}
                {evidence.data.submissions.map((s) => (
                  <p key={s.id}>
                    <Link
                      to={`/${teacher ? "teacher" : "student"}/homework/submissions/${s.id}/${teacher ? "grade" : "feedback"}`}
                    >
                      第{s.attempt}次作答 · {when(s.submitted_at)}
                    </Link>
                  </p>
                ))}
              </>
            )
          )}
        </section>
      )}
      <div className="live-inline">
        {i.resource_id && (
          <Link
            className="primary-link"
            to={`/${teacher ? "teacher/materials" : "student/course-content"}?resource=${i.resource_id}&task=${i.id}`}
          >
            打开补学资料：
            {resources.data?.find((r) => r.id === i.resource_id)?.title ||
              "关联资料"}
          </Link>
        )}
        {i.assignment_id && (
          <Link
            className="ghost-btn"
            to={`/${teacher ? "teacher" : "student"}/homework/${i.assignment_id}?task=${i.id}`}
          >
            进入补练作业
            {linkedAssignment ? `：${linkedAssignment.title}` : ""}
          </Link>
        )}
      </div>
      {i.answer_text && (
        <section>
          <Typography.Text strong className="item-title">
            学生执行结果
          </Typography.Text>
          <p className="live-prose">{i.answer_text}</p>
        </section>
      )}
      {i.review_note && (
        <section>
          <Typography.Text strong className="item-title">
            教师复查
          </Typography.Text>
          <p className="live-prose">{i.review_note}</p>
        </section>
      )}
      {teacher && i.status === "draft" && (
        <Button
          disabled={action.busy}
          loading={action.busy}
          onClick={() =>
            void action.run(`/interventions/${i.id}/state`, {
              state: "assigned",
            })
          }
          type="primary"
        >
          确认下发
        </Button>
      )}
      {((teacher && i.status === "submitted") ||
        (!teacher && i.status === "assigned")) && (
        <Form
          className="live-form"
          onFinish={async () => {
            const v = draft.value;
            const trimmed = v.trim();
            if (!trimmed) {
              setValidationError(
                teacher ? "请填写复查意见后再提交。" : "请填写执行结果后再提交。",
              );
              return;
            }
            if (utf8Bytes(trimmed) > maxContentBytes) {
              setValidationError(
                `内容超出 ${maxContentBytes} 字节限制，请精简后再提交。`,
              );
              return;
            }
            setValidationError("");
            if (
              await action.run(`/interventions/${i.id}/state`, {
                state: teacher ? "reviewed" : "submitted",
                content: trimmed,
              })
            ) {
              draft.saved(v);
            }
          }}
          layout="vertical"
        >
          <DraftNotice {...draft} onDiscard={() => draft.reset("")} />
          {validationError && (
            <Alert type="error" showIcon role="alert" message={validationError} />
          )}
          <Field
            className="ui-field"
            label={<>{teacher ? "复查意见" : "执行结果与新学习证据"}</>}
            required
          >
            <Input.TextArea
              aria-label={teacher ? "复查意见" : "执行结果与新学习证据"}
              required
              rows={4}
              value={draft.value}
              onChange={(e) => {
                setValidationError("");
                draft.change(e.target.value);
              }}
            />
          </Field>
          <Button
            disabled={action.busy || (!teacher && !ready)}
            loading={action.busy}
            htmlType="submit"
            type="primary"
          >
            {teacher ? "确认复查完成" : "提交执行结果"}
          </Button>
          {!teacher && !ready && (
            <Typography.Text type="secondary">
              {evidence.isPending || evidence.isFetching
                ? "正在核对最新学习与提交证据…"
                : evidence.error
                  ? "完成条件证据读取失败，请点击上方「刷新证据」重试后再提交。"
                  : "请先完成上方未满足的条件，再提交执行结果。"}
            </Typography.Text>
          )}
        </Form>
      )}
    </div>
  );
}
