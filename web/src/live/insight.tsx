import { Field } from "../shared/Field";
import { Table, Progress, Tabs, Input, Pagination, Button, Card, Select } from "antd";
import { LoadingState, ErrorState } from "../shared/ui";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "./context";
import { ActivityTimeline } from "./activity";
import { EmptyState } from "../shared/ui";
import { useSession } from "../shared/session";
import { useLiveQuery, Feedback, when } from "./context";
import type { Resource } from "./course";
import type { Assignment } from "./assessment";
import type { Point } from "./course";
import { RevisionPoints, PointFeedback } from "./rubrics";
interface Evidence {
  rubric_id: string | null;
  point_scores: PointFeedback[];
  submission_id: string;
  student_id: string;
  question_id: string;
  answer_text: string;
  attempt: number;
  revision_id: string;
  score: number;
  feedback: string;
  max_score: number;
  prompt: string;
  released_at: string;
  knowledge_point_id: string | null;
  resource_id: string | null;
}
interface Overview {
  id: string;
  display_name: string;
  completed_events: number;
  submitted_assignments: number;
  pending_interventions: number;
}
export function OverviewPage() {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const evidence = useLiveQuery<Evidence[]>("/evidence");
  const overview = useLiveQuery<Overview[]>("/overview", teacher);
  const resources = useLiveQuery<Resource[]>("/resources");
  const assignments = useLiveQuery<Assignment[]>("/assignments");
  const events = useLiveQuery<{ resource_id: string; verb: string }[]>(
    "/events",
    !teacher,
  );
  const points = useLiveQuery<{ points: Point[] }>("");
  const [params, setParams] = useSearchParams();
  const studentFilter = params.get("student") || "";
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const students = (overview.data || []).filter(
    (s) =>
      (!studentFilter || s.id === studentFilter) &&
      s.display_name.includes(studentSearch),
  );
  const setStudentFilter = (id: string) => {
    setStudentPage(1);
    setEvidencePage(1);
    const next = new URLSearchParams(params);
    if (id) next.set("student", id);
    else next.delete("student");
    next.set("view", "students");
    setParams(next);
  };
  const view = params.get("view") || (studentFilter ? "students" : "overview");
  const rows = (evidence.data || []).filter(
    (r) => !studentFilter || r.student_id === studentFilter,
  );
  const score = rows.reduce((v, r) => v + r.score, 0);
  const max = rows.reduce((v, r) => v + r.max_score, 0);
  const low = rows.filter((r) => r.score / r.max_score < 0.6);
  if (
    evidence.isPending ||
    assignments.isPending ||
    points.isPending ||
    (teacher && overview.isPending)
  )
    return <LoadingState />;
  if (evidence.error || overview.error || assignments.error || points.error)
    return (
      <ErrorState
        message={
          (evidence.error ||
            overview.error ||
            assignments.error ||
            points.error)!.message
        }
        onRetry={() => {
          void evidence.refetch();
          void assignments.refetch();
          void points.refetch();
          if (teacher) void overview.refetch();
        }}
      />
    );
  return (
    <div
      className={`live-page overview-page ${teacher ? `teacher-overview-${view}` : "student-overview"}`}
    >
      {teacher && (
        <Tabs
          activeKey={view}
          onChange={(v) => {
            const next = new URLSearchParams(params);
            next.set("view", v);
            setParams(next);
          }}
          items={[
            { key: "overview", label: "班级总览" },
            { key: "students", label: "学生与进度" },
            { key: "evidence", label: "评分证据" },
          ]}
        />
      )}
      {studentFilter && teacher && (
        <div className="context-banner">
          <strong>
            {overview.data?.find((s) => s.id === studentFilter)?.display_name}
            的学习详情
          </strong>
          <Link
            className="primary-link"
            to={`/teacher/intervention?new=1&student=${studentFilter}`}
          >
            安排补学补练
          </Link>
          <Button onClick={() => setStudentFilter("")}>返回全班</Button>
        </div>
      )}
      <nav className="live-shortcuts" aria-label="工作台快捷入口">
        {(teacher
          ? [
              [
                "学习资料",
                "/teacher/materials",
                "M6 5h12v14H6z M9 9h6 M9 13h6",
              ],
              [
                "作业中心",
                "/teacher/homework",
                "M7 4h10v16H7z M10 9l2 2 3-3 M10 15h4",
              ],
              [
                "干预任务",
                "/teacher/intervention",
                "M5 6h14v11h-8l-4 3v-3H5z M8 10h8 M8 13h5",
              ],
            ]
          : [
              [
                "课程学习",
                "/student/course-content",
                "M6 5h12v14H6z M9 9h6 M9 13h6",
              ],
              [
                "作业测验",
                "/student/homework",
                "M7 4h10v16H7z M10 9l2 2 3-3 M10 15h4",
              ],
              [
                "学习路径",
                "/student/learning",
                "M5 6h14v11h-8l-4 3v-3H5z M8 10h8 M8 13h5",
              ],
            ]
        ).map(([title, to, icon]) => (
          <Link className="live-shortcut" to={to} key={to}>
            <strong>
              {title}
              <span aria-hidden="true">›</span>
            </strong>
            <div className="shortcut-art" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              >
                <path d={icon} />
              </svg>
            </div>
          </Link>
        ))}
      </nav>
      <Feedback error={evidence.error || overview.error} />
      {!teacher && resources.data && events.data && (
        <Card className="card-panel" title={<h2>资料学习进度</h2>}>

          <p>
            已完成{" "}
            {
              resources.data.filter((r) =>
                events.data.some(
                  (e) => e.resource_id === r.id && e.verb === "completed",
                ),
              ).length
            }{" "}
            / {resources.data.length}份资料
          </p>
          <Link to="/student/course-content">继续学习课程资料</Link>
        </Card>
      )}
      {teacher && (
        <div className="live-inline">
          <Field className="ui-field" label={<>学生范围</>}>
            <Select
              aria-label="学生范围"
              value={studentFilter}
              onChange={(e) => setStudentFilter(e)}
              showSearch
              optionFilterProp="children"
            >
              <Select.Option value="">全班</Select.Option>
              {overview.data?.map((s) => (
                <Select.Option value={s.id} key={s.id}>
                  {s.display_name}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Button
            disabled={!evidence.data || evidence.isFetching || !!evidence.error}
            onClick={() => {
              const cells = [
                [
                  "学生ID",
                  "题目",
                  "得分",
                  "满分",
                  "提交ID",
                  "评分修订ID",
                  "标准版本ID",
                  "逐点评分与依据",
                  "总评",
                ],
                ...rows.map((r) => [
                  r.student_id,
                  r.prompt,
                  String(r.score),
                  String(r.max_score),
                  r.submission_id,
                  r.revision_id,
                  r.rubric_id || "",
                  JSON.stringify(r.point_scores || []),
                  r.feedback,
                ]),
              ];
              const csv =
                "\uFEFF" +
                cells
                  .map((row) =>
                    row
                      .map(
                        (v) =>
                          '"' +
                          (/^[=+@\-]/.test(v) ? "'" : "") +
                          v.replaceAll('"', '""') +
                          '"',
                      )
                      .join(","),
                  )
                  .join("\r\n");
              const url = URL.createObjectURL(
                new Blob([csv], { type: "text/csv;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "课程正式评分证据.csv";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出当前正式结果
          </Button>
        </div>
      )}
      <div className="live-metrics">
        <Card className="card-panel">
          <span>{teacher && !studentFilter ? "课程学生" : "有效评分记录"}</span>
          <strong>
            {teacher && !studentFilter
              ? overview.data?.length || 0
              : rows.length}
          </strong>
        </Card>
        <Card className="card-panel">
          <span>已发布作业</span>
          <strong>
            {assignments.data?.filter((a) => a.status === "published").length ||
              0}
          </strong>
        </Card>
        <Card className="card-panel">
          <span>正式结果表现</span>
          <strong>
            {max ? `${Math.round((score / max) * 100)}%` : "证据不足"}
          </strong>
        </Card>
        <Card className="card-panel">
          <span>需复习记录</span>
          <strong>{low.length}</strong>
        </Card>
      </div>
      <Card className="card-panel knowledge-section" title={<h2>知识点表现</h2>}>

        <div className="live-performance">
          {points.data?.points
            .filter((p) => p.kind === "point")
            .map((p) => {
              const group = rows.filter((r) => r.knowledge_point_id === p.id);
              const sum = group.reduce((v, r) => v + r.score, 0);
              const maximum = group.reduce((v, r) => v + r.max_score, 0);
              return (
                <article key={p.id}>
                  <strong>{p.title}</strong>
                  <span>
                    {" "}
                    ·{" "}
                    {maximum
                      ? `${Math.round((sum / maximum) * 100)}% · ${group.length}条有效结果`
                      : "证据不足"}
                  </span>
                  {maximum > 0 && (
                    <Progress aria-label={`${p.title}表现`} percent={Math.round(sum / maximum * 100)} showInfo={false} size="small" />
                  )}
                </article>
              );
            })}
        </div>
      </Card>
      {teacher ? (
        <Card className="card-panel student-section" title={<h2>{studentFilter ? "该学生完成情况" : "班级完成与风险"}</h2>}>

          {!studentFilter && (
            <Input.Search
              aria-label="搜索学生姓名"
              placeholder="搜索学生姓名"
              value={studentSearch}
              onChange={(e) => {
                setStudentSearch(e.target.value);
                setStudentPage(1);
              }}
            />
          )}
          <div className="table-wrap">
            <Table rowKey="id" pagination={false} scroll={{ x: 650 }}
              dataSource={students.slice((studentPage - 1) * 10, studentPage * 10)}
              columns={[
                { title: "学生", key: "student", render: (_, s) => <Button type="link" onClick={() => setStudentFilter(s.id)}>{s.display_name}</Button> },
                { title: "完成学习事件", dataIndex: "completed_events" },
                { title: "已提交作业", dataIndex: "submitted_assignments" },
                { title: "待执行任务", dataIndex: "pending_interventions" },
                { title: "正式结果", key: "results", render: (_, s) => <>{rows.filter((r) => r.student_id === s.id).length}条 <Link to={`/teacher/intervention?new=1&student=${s.id}`}>安排任务</Link></> },
              ]}
            />
          </div>
          <Pagination
            current={studentPage}
            pageSize={10}
            total={students.length}
            onChange={setStudentPage}
            showSizeChanger={false}
          />
        </Card>
      ) : (
        <Card className="card-panel" title={<h2>继续学习</h2>}>

          <div className="live-inline">
            <Link className="primary-link" to="/student/course-content">
              进入学习中心
            </Link>
            <Link className="ghost-btn" to="/student/homework">
              查看作业
            </Link>
            <Link className="ghost-btn" to="/student/intervention">
              老师任务
            </Link>
          </div>
          {resources.data
            ?.filter((r) => r.status === "published")
            .slice(0, 6)
            .map((r) => (
              <p key={r.id}>
                {r.title} · {r.locator} · v{r.version}
              </p>
            ))}
        </Card>
      )}
      <ActivityTimeline
        key={studentFilter}
        teacher={teacher}
        studentID={teacher ? studentFilter : ""}
      />
      <Card className="card-panel evidence-section" title={<h2>正式评分证据</h2>}>

        {!rows.length ? (
          <EmptyState title="暂无已发布评分">
            教师确认并发布评分后，正式结果会显示在这里。
          </EmptyState>
        ) : (
          rows.slice((evidencePage - 1) * 10, evidencePage * 10).map((r) => (
            <article className="live-row" key={r.submission_id}>
              <div>
                <h3>{r.prompt}</h3>
                <p>
                  {r.score}/ {r.max_score} · 第{r.attempt}次作答 ·{" "}
                  {when(r.released_at)}
                </p>
                <p>{r.feedback}</p>
                <RevisionPoints points={r.point_scores} />
                {teacher && (
                  <Link
                    className="ghost-btn"
                    to={`/teacher/intervention?new=1&student=${r.student_id}&submission=${r.submission_id}&point=${r.knowledge_point_id || ""}`}
                  >
                    根据本次反馈安排任务
                  </Link>
                )}
              </div>
              <Link
                to={`/${teacher ? "teacher" : "student"}/homework/submissions/${r.submission_id}/${teacher ? "grade" : "feedback"}`}
              >
                查看原始证据
              </Link>
            </article>
          ))
        )}
        <Pagination
          current={evidencePage}
          pageSize={10}
          total={rows.length}
          onChange={setEvidencePage}
          showSizeChanger={false}
        />
      </Card>
      {teacher && (
        <Card className="card-panel" title={<h2>共性难点</h2>}>

          <p>
            低于本题满分60%的有效作答 {low.length}/ {rows.length}，涉及{" "}
            {new Set(low.map((r) => r.student_id)).size}名学生。
          </p>
        </Card>
      )}
    </div>
  );
}
export { InterventionPage } from "./interventions";
