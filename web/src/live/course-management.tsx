import { useState } from "react";
import { Tabs, Input, Pagination } from "antd";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { PageHeader, EmptyState, ErrorState } from "../shared/ui";
import { Feedback, Link, names, useAction, useLearning, useLiveQuery, type Course } from "./context";

export function CourseManagement() {
  const { session } = useSession();
  const { course, courses, reload, select } = useLearning();
  const [params, setParams] = useSearchParams();
  const action = useAction();
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tab = params.get("tab") === "members" ? "members" : "settings";
  const filtered = courses.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));
  return <div className="live-page">
    <PageHeader title="课程管理" />
    <section className="card-panel">
      <form className="live-inline" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError("");
        try {
          const result = await requestJSON<{ data: Course }>("/learning/courses", { method: "POST", body: JSON.stringify({ title }) }, session?.csrf_token);
          await reload(); select(result.data.id); setTitle("");
        } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); }
        finally { setBusy(false); }
      }}>
        <label>新课程名称<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <button className="primary-link" disabled={busy || !title.trim()}>新建课程</button>
      </form>
      {error && <p role="alert" className="live-error">{error}</p>}
      <Input.Search aria-label="搜索课程" placeholder="搜索课程名称" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} allowClear />
      {filtered.slice((page - 1) * 8, page * 8).map((c) => <article className="live-row" key={c.id}>
        <div><h2>{c.title}</h2><span className="live-meta">{names[c.status]} · {c.knowledge_point_count} 个知识点</span></div>
        <button className={course?.id === c.id ? "primary-link" : "ghost-btn"} onClick={() => select(c.id)}>{course?.id === c.id ? "当前课程" : "管理课程"}</button>
      </article>)}
      {!courses.length && <EmptyState title="还没有课程">新建课程后，可以维护目录、资料和作业。</EmptyState>}
      {!!courses.length && !filtered.length && <EmptyState title="没有匹配课程" />}
      <Pagination current={page} total={filtered.length} pageSize={8} onChange={setPage} showSizeChanger={false} hideOnSinglePage responsive />
    </section>
    {course && <section className="card-panel">
      <h2>{course.title}</h2>
      <Tabs activeKey={tab} onChange={(value) => { const next = new URLSearchParams(params); next.set("tab", value); setParams(next); }} items={[
        { key: "settings", label: "课程设置" }, { key: "members", label: "课程成员" },
      ]} />
      {tab === "members" ? <Members /> : <>
        <CourseSettings key={`${course.id}:${course.version}`} />
        {course.status === "draft" && <button className="primary-link" disabled={action.busy} onClick={() => action.run("/publish")}>发布课程</button>}
        <Feedback message={action.message} failed={action.failed} />
        <div className="live-inline"><Link className="ghost-btn" to="/teacher/curriculum">课程目录</Link><Link className="ghost-btn" to="/teacher/materials">学习资料</Link></div>
      </>}
    </section>}
  </div>;
}

function CourseSettings() {
  const { course } = useLearning();
  const action = useAction();
  const [name, setName] = useState(course?.title || "");
  return <form className="live-form" onSubmit={(e) => { e.preventDefault(); void action.run("", { title: name }, "PUT"); }}>
    <label>课程名称<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
    <button className="ghost-btn" disabled={action.busy}>保存课程名称</button>
    <Feedback message={action.message} failed={action.failed} />
  </form>;
}

function Members() {
  const members = useLiveQuery<{ id: string; display_name: string; username: string }[]>("/members");
  const action = useAction();
  const [username, setUsername] = useState("");
  const [student, setStudent] = useState({ username: "", display_name: "", password: "" });
  return <>
    <Feedback message={action.message} failed={action.failed} />
    {members.error && <ErrorState message={members.error.message} onRetry={() => void members.refetch()} />}
    <form className="live-inline" onSubmit={async (e) => { e.preventDefault(); if (await action.run("/members", { username })) setUsername(""); }}>
      <label>学生用户名<input required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
      <button className="ghost-btn" disabled={action.busy}>加入课程</button>
    </form>
    <ul className="member-list">{members.data?.map((m) => <li key={m.id}><Link to={`/teacher/dashboard?student=${m.id}`}>{m.display_name}</Link> · {m.username}</li>)}</ul>
    <details><summary>新建学生账号并加入本课程</summary>
      <form className="live-form" onSubmit={async (e) => { e.preventDefault(); if (await action.run("/students", student)) setStudent({ username: "", display_name: "", password: "" }); }}>
        <label>新学生用户名<input required value={student.username} onChange={(e) => setStudent({ ...student, username: e.target.value })} /></label>
        <label>学生姓名<input required value={student.display_name} onChange={(e) => setStudent({ ...student, display_name: e.target.value })} /></label>
        <label>初始密码<input required type="password" minLength={12} autoComplete="new-password" value={student.password} onChange={(e) => setStudent({ ...student, password: e.target.value })} /></label>
        <button className="ghost-btn" disabled={action.busy}>创建学生账号</button>
      </form>
    </details>
  </>;
}
