import { Field } from "../shared/Field";
import { useState } from "react";
import { Tabs, Input, Pagination, Card, Form, Button, Collapse, List, Alert } from "antd";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../shared/session";
import { requestJSON } from "../shared/api";
import { EmptyState, ErrorState } from "../shared/ui";
import {
  Feedback,
  Link,
  names,
  useAction,
  useLearning,
  useLiveQuery,
  type Course,
} from "./context";

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
  const filtered = courses.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="live-page">
      <Card className="card-panel">
        <Form
          className="live-inline"
          onFinish={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await requestJSON<{ data: Course }>(
                "/learning/courses",
                { method: "POST", body: JSON.stringify({ title }) },
                session?.csrf_token,
              );
              await reload();
              select(result.data.id);
              setTitle("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "创建失败");
            } finally {
              setBusy(false);
            }
          }}
          layout="vertical"
        >
          <Field
            className="ui-field"
            label={<>新课程名称</>}
            required={true}
          >
            <Input
              aria-label="新课程名称"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy || !title.trim()}
            htmlType="submit"
            type="primary"
          >
            新建课程
          </Button>
        </Form>
        {error && (
          <Alert type="error" showIcon role="alert" message={<>
            {error}
          </>} />
        )}
        <Input.Search
          aria-label="搜索课程"
          placeholder="搜索课程名称"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          allowClear
        />
        {filtered.slice((page - 1) * 8, page * 8).map((c) => (
          <article className="live-row" key={c.id}>
            <div>
              <h2>{c.title}</h2>
              <span className="live-meta">
                {names[c.status]} · {c.knowledge_point_count}个知识点
              </span>
            </div>
            <Button
              onClick={() => select(c.id)}
              type={course?.id === c.id ? "primary" : "default"}
            >
              {course?.id === c.id ? "当前课程" : "管理课程"}
            </Button>
          </article>
        ))}
        {!courses.length && (
          <EmptyState title="还没有课程">
            新建课程后，可以维护目录、资料和作业。
          </EmptyState>
        )}
        {!!courses.length && !filtered.length && (
          <EmptyState title="没有匹配课程" />
        )}
        <Pagination
          current={page}
          total={filtered.length}
          pageSize={8}
          onChange={setPage}
          showSizeChanger={false}
          hideOnSinglePage
          responsive
        />
      </Card>
      {course && (
        <Card className="card-panel" title={<h2>{course.title}</h2>}>

          <Tabs
            activeKey={tab}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              next.set("tab", value);
              setParams(next);
            }}
            items={[
              { key: "settings", label: "课程设置" },
              { key: "members", label: "课程成员" },
            ]}
          />
          {tab === "members" ? (
            <Members />
          ) : (
            <>
              <CourseSettings key={`${course.id}:${course.version}`} />
              {course.status === "draft" && (
                <Button
                  disabled={action.busy}
                  onClick={() => action.run("/publish")}
                  type="primary"
                >
                  发布课程
                </Button>
              )}
              <Feedback message={action.message} failed={action.failed} />
              <div className="live-inline">
                <Link className="ghost-btn" to="/teacher/curriculum">
                  课程目录
                </Link>
                <Link className="ghost-btn" to="/teacher/materials">
                  学习资料
                </Link>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function CourseSettings() {
  const { course } = useLearning();
  const action = useAction();
  const [name, setName] = useState(course?.title || "");
  return (
    <Form
      className="live-form"
      onFinish={() => {
        void action.run("", { title: name }, "PUT");
      }}
      layout="vertical"
    >
      <Field className="ui-field" label={<>课程名称</>} required={true}>
        <Input
          aria-label="课程名称"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Button disabled={action.busy} htmlType="submit">
        保存课程名称
      </Button>
      <Feedback message={action.message} failed={action.failed} />
    </Form>
  );
}

function Members() {
  const members =
    useLiveQuery<{ id: string; display_name: string; username: string }[]>(
      "/members",
    );
  const action = useAction();
  const [username, setUsername] = useState("");
  const [student, setStudent] = useState({
    username: "",
    display_name: "",
    password: "",
  });
  return (
    <>
      <Feedback message={action.message} failed={action.failed} />
      {members.error && (
        <ErrorState
          message={members.error.message}
          onRetry={() => void members.refetch()}
        />
      )}
      <Form
        className="live-inline"
        onFinish={async () => {
          if (await action.run("/members", { username })) setUsername("");
        }}
        layout="vertical"
      >
        <Field className="ui-field" label={<>学生用户名</>} required={true}>
          <Input
            aria-label="学生用户名"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Button disabled={action.busy} htmlType="submit">
          加入课程
        </Button>
      </Form>
      <List className="member-list" dataSource={members.data || []} locale={{ emptyText: "暂无课程成员" }} renderItem={m => <List.Item key={m.id}><Link to={`/teacher/dashboard?student=${m.id}`}>{m.display_name}</Link><span>{m.username}</span></List.Item>} />
      <Collapse
        items={[
          {
            key: "content",
            label: <>新建学生账号并加入本课程</>,
            children: (
              <>
                <Form
                  className="live-form"
                  onFinish={async () => {
                    if (await action.run("/students", student))
                      setStudent({
                        username: "",
                        display_name: "",
                        password: "",
                      });
                  }}
                  layout="vertical"
                >
                  <Field
                    className="ui-field"
                    label={<>新学生用户名</>}
                    required={true}
                  >
                    <Input
                      aria-label="新学生用户名"
                      required
                      value={student.username}
                      onChange={(e) =>
                        setStudent({ ...student, username: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    className="ui-field"
                    label={<>学生姓名</>}
                    required={true}
                  >
                    <Input
                      aria-label="学生姓名"
                      required
                      value={student.display_name}
                      onChange={(e) =>
                        setStudent({ ...student, display_name: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    className="ui-field"
                    label={<>初始密码</>}
                    required={true}
                  >
                    <Input.Password
                      aria-label="初始密码"
                      required
                      minLength={12}
                      autoComplete="new-password"
                      value={student.password}
                      onChange={(e) =>
                        setStudent({ ...student, password: e.target.value })
                      }
                    />
                  </Field>
                  <Button disabled={action.busy} htmlType="submit">
                    创建学生账号
                  </Button>
                </Form>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
