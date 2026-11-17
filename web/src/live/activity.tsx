import { useState } from "react";
import { Pagination, Card, Collapse } from "antd";
import { Link } from "./context";
import { Feedback, useLiveQuery, when } from "./context";
import { EmptyState, LoadingState, MetaTag, MetaTags, StatusTag } from "../shared/ui";

interface Activity {
  id: string;
  display_name: string;
  verb: string;
  resource_id: string | null;
  submission_id: string | null;
  object_version: number;
  occurred_at: string;
  title: string;
  locator: string;
  source_note: string;
  source_url: string;
  attempt: number;
  answer_sha256: string;
}

export function ActivityTimeline({
  teacher,
  studentID,
}: {
  teacher: boolean;
  studentID: string;
}) {
  const [page, setPage] = useState(1);
  const query = useLiveQuery<Activity[]>(
    `/activity${studentID ? `?student_id=${encodeURIComponent(studentID)}` : ""}`,
  );
  return (
    <Card className="card-panel activity-section" title={<h2>{teacher ? "学生学习与提交记录" : "我的学习与提交记录"}</h2>}>

      <Feedback error={query.error} />
      {query.isPending && <LoadingState label="正在读取记录…" />}
      {query.data?.length === 0 && <EmptyState title="暂无记录" />}
      {query.data?.slice((page - 1) * 10, page * 10).map((event) => (
        <article className="live-row" key={event.id}>
          <div>
            <h3>{event.title}</h3>
            <MetaTags>
              <StatusTag status={event.verb.startsWith("submission.") ? "submitted" : event.verb === "completed" ? "completed" : "opened"}
                label={event.verb === "submission.imported" ? "教师导入作答" : event.verb === "submission.submitted"
                ? "提交作答"
                : event.verb === "completed"
                  ? "完成学习"
                  : "打开资料"} />
              <MetaTag>{event.display_name}</MetaTag>
              <MetaTag>v{event.object_version}</MetaTag>
              <span className="live-meta">{when(event.occurred_at)}</span>
            </MetaTags>
            {event.resource_id && (
              <p>
                来源：{event.source_note || event.source_url || "尚未登记来源"} ·{" "}
                {event.locator}
              </p>
            )}
            {event.submission_id && (
              <p>
                第{event.attempt}次作答 · 原文指纹{" "}
                {event.answer_sha256.slice(0, 12)}…
              </p>
            )}
            <Collapse
              items={[
                {
                  key: "content",
                  label: <>核对记录编号</>,
                  children: (
                    <>
                      <p>事件：{event.id}</p>
                      <p>对象：{event.submission_id || event.resource_id}</p>
                    </>
                  ),
                },
              ]}
            />
          </div>
          <Link
            to={
              event.submission_id
                ? `/${teacher ? "teacher" : "student"}/homework/submissions/${event.submission_id}/${teacher ? "grade" : "feedback"}`
                : `/${teacher ? "teacher/materials" : "student/course-content"}?resource=${event.resource_id}`
            }
          >
            查看{event.submission_id ? "原始作答" : "资料原文"}
          </Link>
        </article>
      ))}
      <Pagination
        current={page}
        pageSize={10}
        total={query.data?.length || 0}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
      />
    </Card>
  );
}
