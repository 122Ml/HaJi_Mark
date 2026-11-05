import { useState } from "react";
import { Pagination } from "antd";
import { Link } from "./context";
import { Feedback, useLiveQuery, when } from "./context";

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

export function ActivityTimeline({ teacher, studentID }: { teacher: boolean; studentID: string }) {
  const [page,setPage]=useState(1);
  const query = useLiveQuery<Activity[]>(`/activity${studentID ? `?student_id=${encodeURIComponent(studentID)}` : ""}`);
  return (
    <section className="card-panel activity-section">
      <h2>{teacher ? "学生学习与提交记录" : "我的学习与提交记录"}</h2>
      <Feedback error={query.error} />
      {query.isPending && <p role="status">正在读取记录…</p>}
      {query.data?.length === 0 && <p>暂无记录。</p>}
      {query.data?.slice((page-1)*10,page*10).map((event) => (
        <article className="live-row" key={event.id}>
          <div>
            <h3>{event.display_name} · {event.verb === "submission.submitted" ? "提交作答" : event.verb === "completed" ? "完成学习" : "打开资料"}</h3>
            <p>{event.title} · v{event.object_version} · {when(event.occurred_at)}</p>
            {event.resource_id && <p>来源：{event.source_note || event.source_url || "尚未登记来源"} · {event.locator}</p>}
            {event.submission_id && <p>第{event.attempt}次作答 · 原文指纹 {event.answer_sha256.slice(0, 12)}…</p>}
            <details><summary>核对记录编号</summary><p>事件：{event.id}</p><p>对象：{event.submission_id || event.resource_id}</p></details>
          </div>
          <Link to={event.submission_id
            ? `/${teacher ? "teacher" : "student"}/homework/submissions/${event.submission_id}/${teacher ? "grade" : "feedback"}`
            : `/${teacher ? "teacher/course-twin" : "student/course-content"}?resource=${event.resource_id}`}>
            查看{event.submission_id ? "原始作答" : "资料原文"}
          </Link>
        </article>
      ))}
      <Pagination current={page} pageSize={10} total={query.data?.length||0} onChange={setPage} showSizeChanger={false}/>
    </section>
  );
}
