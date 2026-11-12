import { Field } from "../shared/Field";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Input, Select, Pagination, Button, Card, Form } from "antd";
import { useSession } from "../shared/session";
import {
  Link,
  useLearning,
  useLiveQuery,
  useAction,
  Feedback,
  names,
  when,
} from "./context";
import { useEditorDraft, DraftNotice } from "./editing";
import { LoadingState, ErrorState, StatusTag, EmptyState } from "../shared/ui";
import type { Resource } from "./course";
import type { Assignment, Submission, Question } from "./assessment";
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
}
interface Evidence {
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
export function InterventionPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const [params, setParams] = useSearchParams();
  const { course } = useLearning();
  const query = useLiveQuery<Intervention[]>("/interventions");
  const [search, setSearch] = useState("");
  const state = params.get("state") || "";
  const student = params.get("student") || "";
  const [page, setPage] = useState(1);
  const creating = params.get("new") === "1";
  const setCreating = (value: boolean) => patch({ new: value ? "1" : "" });
  const selected = query.data?.find((i) => i.id === params.get("task"));
  function patch(values: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  }
  const rows = (query.data || []).filter(
    (i) =>
      (!state || i.status === state) &&
      (!student || i.student_id === student) &&
      `${i.title} ${i.student_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="live-page">
      <div className="page-actions">
        teacher && (
        <Button onClick={() => setCreating(true)} type="primary">
          新建补学补练任务
        </Button>
        )
      </div>
      <div className="list-toolbar">
        <Input.Search
          aria-label="搜索任务"
          placeholder="搜索任务或学生"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="任务状态"
          value={state}
          onChange={(v) => {
            patch({ state: v });
            setPage(1);
          }}
          options={[
            { value: "", label: "全部任务" },
            ...Object.entries({
              draft: "草稿",
              assigned: "待执行",
              submitted: "待复查",
              reviewed: "已复查",
            }).map(([value, label]) => ({ value, label })),
          ]}
        />
        {student && (
          <Button onClick={() => patch({ student: "" })}>查看全部学生</Button>
        )}
      </div>
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
          {rows.slice((page - 1) * 10, page * 10).map((i) => (
            <article className="live-row" key={i.id}>
              <div>
                <h2>{i.title}</h2>
                <p>
                  {teacher ? i.student_name : ""}{" "}
                  <StatusTag status={i.status} label={names[i.status]} />
                </p>
                <p>
                  {i.resource_id ? "补学资料" : ""}
                  {i.resource_id && i.assignment_id ? " ＋ " : ""}
                  {i.assignment_id ? "补练作业" : ""}
                </p>
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
            current={page}
            pageSize={10}
            total={rows.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </Card>
      )}
      <Drawer
        title="补学补练任务"
        open={!!selected}
        onClose={() => patch({ task: "" })}
        width={760}
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
          onClose={() => setCreating(false)}
          width={680}
        >
          {creating && (
            <TaskCreator
              key={`${course?.id}/${student}/${params.get("submission")}`}
              student={student}
              source={params.get("submission") || ""}
              point={params.get("point") || ""}
              onCreated={(id) => {
                patch({ task: id, new: "" });
              }}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
function TaskCreator({
  student,
  source,
  point,
  onCreated,
}: {
  student: string;
  source: string;
  point: string;
  onCreated: (id: string) => void;
}) {
  const { course } = useLearning();
  const action = useAction();
  const members =
    useLiveQuery<{ id: string; display_name: string }[]>("/members");
  const resources = useLiveQuery<Resource[]>("/resources");
  const assignments = useLiveQuery<Assignment[]>("/assignments");
  const origin = useLiveQuery<{ submission: Submission; question: Question }>(
    `/submissions/${source}`,
    !!source,
  );
  const draft = useEditorDraft(
    `intervention:${course?.id}:${student}:${source}`,
    {
      student_id: student,
      title: "",
      description: "",
      resource_id: "",
      assignment_id: "",
    },
  );
  const form = draft.value;
  const change = (key: keyof typeof form, value: string) =>
    draft.change((v) => ({ ...v, [key]: value }));
  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const v = draft.value;
        const result = await action.run<Intervention>("/interventions", {
          ...v,
          description: v.description + (source ? `\n关联作答：${source}` : ""),
        });
        if (result) {
          draft.saved(v);
          onCreated(result.id);
        }
      }}
      layout="vertical"
    >
      <DraftNotice {...draft} />
      <Feedback
        error={
          members.error || resources.error || assignments.error || origin.error
        }
        message={action.message}
        failed={action.failed}
      />
      {origin.data && (
        <aside className="context-banner">
          <strong>来自：{origin.data.question.prompt}</strong>
          <p>第{origin.data.submission.attempt}次作答</p>
          <Link to={`/teacher/homework/submissions/${source}/grade`}>
            查看原始依据
          </Link>
        </aside>
      )}
      <Field className="ui-field" label={<>指定学生</>} required name="student_id" getValueProps={() => ({ value: form.student_id })} rules={[{ validator: async () => { if (!form.student_id) throw Error("请选择学生"); } }]}>
        <Select
          aria-label="指定学生"
          disabled={members.isPending || !!source}
          value={form.student_id}
          onChange={(e) => change("student_id", e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">选择学生</Select.Option>
          {members.data?.map((m) => (
            <Select.Option key={m.id} value={m.id}>
              {m.display_name}
            </Select.Option>
          ))}
        </Select>
      </Field>
      <Field className="ui-field" label={<>任务标题</>} required={true}>
        <Input
          aria-label="任务标题"
          required
          value={form.title}
          onChange={(e) => change("title", e.target.value)}
        />
      </Field>
      <Field
        className="ui-field"
        label={<>补学资料、练习及完成要求</>}
        required={true}
      >
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
          value={form.resource_id}
          onChange={(e) => change("resource_id", e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">不指定资料</Select.Option>
          {resources.data
            ?.filter((r) => r.status === "published")
            .sort(
              (a, b) =>
                Number(b.knowledge_point_id === point) -
                Number(a.knowledge_point_id === point),
            )
            .map((r) => (
              <Select.Option key={r.id} value={r.id}>
                {r.title} · v{r.version}
              </Select.Option>
            ))}
        </Select>
      </Field>
      <Field className="ui-field" label={<>关联补练作业</>}>
        <Select
          aria-label="关联补练作业"
          value={form.assignment_id}
          onChange={(e) => change("assignment_id", e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">不指定作业</Select.Option>
          {assignments.data
            ?.filter((a) => a.status === "published")
            .map((a) => (
              <Select.Option key={a.id} value={a.id}>
                {a.title}
              </Select.Option>
            ))}
        </Select>
      </Field>
      <p className="live-meta">
        下发后，学生需要完成关联资料并为补练作业逐题产生新提交。
      </p>
      <Button disabled={action.busy} htmlType="submit" type="primary">
        保存任务草稿
      </Button>
    </Form>
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
  const evidence = useLiveQuery<Evidence>(
    `/interventions/${i.id}/evidence`,
    i.status !== "draft",
  );
  const resources = useLiveQuery<Resource[]>("/resources");
  const draft = useEditorDraft(
    `task-response:${i.id}:${teacher ? "review" : "answer"}`,
    "",
  );
  const ready =
    !evidence.isFetching &&
    !evidence.error &&
    evidence.data?.learning_ready &&
    evidence.data?.practice_ready;
  const source = i.description.match(/关联作答：([a-f0-9-]{36})/);
  return (
    <div className="live-page">
      <h2>{i.title}</h2>
      <p>
        {i.student_name} ·{" "}
        <StatusTag status={i.status} label={names[i.status]} />
      </p>
      <p className="live-prose">
        {i.description.replace(/\n关联作答：[a-f0-9-]{36}/, "")}
      </p>
      {source && teacher && (
        <Link to={`/teacher/homework/submissions/${source[1]}/grade`}>
          查看任务原始依据
        </Link>
      )}
      <Feedback message={action.message} failed={action.failed} />
      {i.status !== "draft" && (
        <section className="evidence-checklist">
          <h3>本次完成条件</h3>
          <Feedback error={evidence.error} />
          {evidence.isPending ? (
            <LoadingState />
          ) : (
            evidence.data && (
              <>
                <p>下发于 {when(evidence.data.assigned_at)}</p>
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
          </Link>
        )}
      </div>
      {i.answer_text && (
        <section>
          <h3>学生执行结果</h3>
          <p className="live-prose">{i.answer_text}</p>
        </section>
      )}
      {i.review_note && (
        <section>
          <h3>教师复查</h3>
          <p>{i.review_note}</p>
        </section>
      )}
      {teacher && i.status === "draft" && (
        <Button
          disabled={action.busy}
          onClick={() =>
            action.run(`/interventions/${i.id}/state`, { state: "assigned" })
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
            if (
              await action.run(`/interventions/${i.id}/state`, {
                state: teacher ? "reviewed" : "submitted",
                content: v,
              })
            )
              draft.saved(v);
          }}
          layout="vertical"
        >
          <DraftNotice {...draft} />
          <Field
            className="ui-field"
            label={<>{teacher ? "复查意见" : "执行结果与新学习证据"}</>}
            required={true}
          >
            <Input.TextArea
              aria-label={teacher ? "复查意见" : "执行结果与新学习证据"}
              required
              rows={4}
              value={draft.value}
              onChange={(e) => draft.change(e.target.value)}
            />
          </Field>
          <Button
            disabled={action.busy || (!teacher && !ready)}
            htmlType="submit"
            type="primary"
          >
            {teacher ? "确认复查完成" : "提交执行结果"}
          </Button>
          {!teacher && !ready && (
            <p>请先完成上方未满足的条件，再提交执行结果。</p>
          )}
        </Form>
      )}
    </div>
  );
}
