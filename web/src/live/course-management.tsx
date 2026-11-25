import { Field } from "../shared/Field";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  List,
  Pagination,
  Popconfirm,
  Tabs,
  Typography,
} from "antd";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import { APIError, requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import {
  EmptyState,
  ErrorState,
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
  type Course,
} from "./context";
import { labelFor, stateLabels } from "./domain-meta";
import type { Member } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;
const COURSE_TITLE_MAX_BYTES = 200;

export function CourseManagement() {
  const { session, refresh } = useSession();
  const confirm = useConfirm();
  const { course, courses, reload, select } = useLearning();
  const [params, setParams] = useSearchParams();
  const action = useAction();
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tab = params.get("tab") === "members" ? "members" : "settings";

  const filtered = useMemo(
    () =>
      courses.filter((c) =>
        c.title.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [courses, search],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / 8));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function handleCreateCourse() {
    const trimmed = title.trim();
    if (
      !trimmed ||
      utf8ByteLength(trimmed) > COURSE_TITLE_MAX_BYTES ||
      hasControlNull(trimmed)
    ) {
      setError("请填写课程名称（不能为空且不超过 200 字节）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await requestJSON<{ data: Course }>(
        "/learning/courses",
        { method: "POST", body: JSON.stringify({ title: trimmed }) },
        session?.csrf_token,
      );
      await reload();
      select(result.data.id);
      setTitle("");
    } catch (e) {
      if (e instanceof APIError && e.status === 401) {
        refresh();
      }
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="live-page">
      <PageHeader
        title="课程与成员"
        subtitle={course?.title}
        meta={<MetaTag>{courses.length} 门课程</MetaTag>}
      />
      <Form
        className="filter-bar"
        onFinish={() => {
          void handleCreateCourse();
        }}
      >
        <Input
          aria-label="新课程名称"
          placeholder="输入新课程名称…"
          style={{ flex: "1 1 200px", minWidth: 0 }}
          value={title}
          onChange={(e) => {
            setError("");
            setTitle(e.target.value);
          }}
        />
        <Button
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={
            busy ||
            !title.trim() ||
            utf8ByteLength(title.trim()) > COURSE_TITLE_MAX_BYTES
          }
          htmlType="submit"
          type="primary"
        >
          新建课程
        </Button>
      </Form>
      {error && <Alert type="error" showIcon role="alert" message={error} />}
      <div className={course ? "course-manage-grid" : ""}>
        <Card className="card-panel" title="课程列表">
        <div className="live-stack">
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
          {filtered.length > 0 && (
            <div>
              {filtered.slice((page - 1) * 8, page * 8).map((c) => (
                <article className="live-row" key={c.id}>
                  <div>
                    <Typography.Text strong className="item-title">
                      {c.title}
                    </Typography.Text>
                    <MetaTags>
                      {course?.id === c.id && (
                        <StatusTag status="active" label="当前使用中" />
                      )}
                      <StatusTag
                        status={c.status}
                        label={labelFor(
                          stateLabels,
                          c.status,
                          names[c.status] || c.status,
                        )}
                      />
                      <MetaTag>{c.knowledge_point_count} 个知识点</MetaTag>
                    </MetaTags>
                  </div>
                  <Button onClick={() => select(c.id)}>
                    {course?.id === c.id ? "当前课程" : "管理课程"}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </div>
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
        <Card
          className="card-panel"
          title={<span style={{ overflowWrap: "anywhere" }}>{course.title}</span>}
        >
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
              <CourseSettings key={course.id} />
              <div className="live-inline" style={{ marginTop: 16 }}>
                {course.status === "draft" && (
                  <Button
                    disabled={action.busy}
                    onClick={async () => {
                      if (
                        await confirm("发布后已加入课程的学生将可见此课程，确认发布？")
                      ) {
                        await action.run(
                          "/publish",
                          {},
                          "POST",
                          "课程已发布，已加入学生现在可以访问",
                        );
                      }
                    }}
                    type="primary"
                  >
                    发布课程
                  </Button>
                )}
                {course.status !== "archived" && (
                  <Button
                    danger
                    disabled={action.busy}
                    onClick={async () => {
                      if (
                        await confirm("归档后课程转为只读存档（学生与教师保留历史记录），确认归档？", {
                          danger: true,
                        })
                      ) {
                        await action.run(
                          "/state",
                          { state: "archived" },
                          "POST",
                          "课程已归档",
                        );
                      }
                    }}
                  >
                    归档课程
                  </Button>
                )}
                {course.status === "archived" && (
                  <>
                    <Button
                      type="primary"
                      disabled={action.busy}
                      onClick={async () => {
                        if (await confirm("确认恢复发布该课程？恢复后学生可重新访问。")) {
                          await action.run(
                            "/state",
                            { state: "published" },
                            "POST",
                            "课程已恢复发布",
                          );
                        }
                      }}
                    >
                      恢复发布
                    </Button>
                    <Button
                      disabled={action.busy}
                      onClick={async () => {
                        if (await confirm("确认将已归档课程退回草稿状态？")) {
                          await action.run(
                            "/state",
                            { state: "draft" },
                            "POST",
                            "课程已退回草稿",
                          );
                        }
                      }}
                    >
                      退回草稿
                    </Button>
                  </>
                )}
                <Link className="ghost-btn" to="/teacher/curriculum">
                  课程目录
                </Link>
                <Link className="ghost-btn" to="/teacher/materials">
                  学习资料
                </Link>
              </div>
              <Feedback message={action.message} failed={action.failed} />
            </>
          )}
        </Card>
      )}
      </div>
    </div>
  );
}

function CourseSettings() {
  const { course } = useLearning();
  const action = useAction();
  const [name, setName] = useState(course?.title || "");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setName(course?.title || "");
    setValidationError("");
  }, [course?.id, course?.title]);

  const trimmed = name.trim();
  const nameBytes = utf8ByteLength(trimmed);

  async function handleRename() {
    if (!trimmed || nameBytes > COURSE_TITLE_MAX_BYTES || hasControlNull(trimmed)) {
      setValidationError("课程名称不能为空，且不能超过 200 字节");
      return;
    }
    setValidationError("");
    await action.run("", { title: trimmed }, "PUT", "课程名称已更新");
  }

  return (
    <Form
      className="live-form"
      onFinish={() => {
        void handleRename();
      }}
      layout="vertical"
    >
      {validationError && (
        <Alert type="error" showIcon role="alert" message={validationError} />
      )}
      <Field
        className="ui-field"
        label="课程名称"
        required
        extra={
          <Typography.Text
            type={nameBytes > COURSE_TITLE_MAX_BYTES ? "danger" : "secondary"}
          >
            {nameBytes} / {COURSE_TITLE_MAX_BYTES} 字节
          </Typography.Text>
        }
      >
        <Input
          aria-label="课程名称"
          value={name}
          onChange={(e) => {
            setValidationError("");
            setName(e.target.value);
          }}
        />
      </Field>
      <Button
        disabled={
          action.busy ||
          !trimmed ||
          nameBytes > COURSE_TITLE_MAX_BYTES ||
          trimmed === (course?.title || "")
        }
        htmlType="submit"
      >
        保存课程名称
      </Button>
      <Feedback message={action.message} failed={action.failed} />
    </Form>
  );
}

function Members() {
  const members = useLiveQuery<Member[]>("/members");
  const action = useAction();
  const [username, setUsername] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [studentError, setStudentError] = useState("");
  const [student, setStudent] = useState({
    username: "",
    display_name: "",
    password: "",
  });

  const filteredMembers = useMemo(() => {
    const rows = members.data || [];
    const keyword = memberSearch.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(
      (m) =>
        m.display_name.toLowerCase().includes(keyword) ||
        (m.username || "").toLowerCase().includes(keyword),
    );
  }, [members.data, memberSearch]);

  const pwdBytes = utf8ByteLength(student.password);

  async function handleEnroll() {
    const trimmed = username.trim();
    if (!trimmed || utf8ByteLength(trimmed) > 64 || hasControlNull(trimmed)) {
      setEnrollError("请输入有效的学生用户名");
      return;
    }
    setEnrollError("");
    if (
      await action.run(
        "/members",
        { username: trimmed },
        "POST",
        "已将学生加入课程",
      )
    ) {
      setUsername("");
    }
  }

  async function handleCreateStudent() {
    const trimmedUsername = student.username.trim();
    const trimmedName = student.display_name.trim();
    if (!USERNAME_RE.test(trimmedUsername)) {
      setStudentError(
        "用户名须为 3 到 64 位字母、数字或 . _ @ -，不能包含空白字符",
      );
      return;
    }
    if (
      !trimmedName ||
      utf8ByteLength(trimmedName) > 200 ||
      hasControlNull(trimmedName)
    ) {
      setStudentError("请填写不超过 200 字节的学生姓名");
      return;
    }
    if (
      !student.password.trim() ||
      pwdBytes < 12 ||
      pwdBytes > 72 ||
      hasControlNull(student.password)
    ) {
      setStudentError("初始密码须为 12 到 72 字节，且不能全为空白");
      return;
    }
    setStudentError("");
    if (
      await action.run(
        "/students",
        {
          username: trimmedUsername,
          display_name: trimmedName,
          password: student.password,
        },
        "POST",
        "已创建学生账号并加入本课程",
      )
    ) {
      setStudent({
        username: "",
        display_name: "",
        password: "",
      });
    }
  }

  return (
    <>
      <Feedback message={action.message} failed={action.failed} />
      {members.error && (
        <ErrorState
          message={members.error.message}
          onRetry={() => void members.refetch()}
        />
      )}
      {enrollError && (
        <Alert type="error" showIcon role="alert" message={enrollError} />
      )}
      <Form
        className="live-inline"
        onFinish={() => {
          void handleEnroll();
        }}
        layout="vertical"
      >
        <Field className="ui-field" label="学生用户名" required>
          <Input
            aria-label="学生用户名"
            value={username}
            onChange={(e) => {
              setEnrollError("");
              setUsername(e.target.value);
            }}
          />
        </Field>
        <Button disabled={action.busy || !username.trim()} htmlType="submit">
          加入课程
        </Button>
      </Form>
      {!!members.data?.length && members.data.length > 8 && (
        <Input.Search
          aria-label="搜索课程成员"
          placeholder="按姓名或用户名筛选成员"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
          allowClear
          style={{ marginTop: 12 }}
        />
      )}
      <List
        className="member-list"
        loading={members.isPending}
        dataSource={filteredMembers}
        pagination={{
          pageSize: 10,
          hideOnSinglePage: true,
          showSizeChanger: false,
          responsive: true,
        }}
        locale={{ emptyText: "暂无课程成员" }}
        renderItem={(m) => (
          <List.Item
            key={m.id}
            style={{ flexWrap: "wrap", gap: 8 }}
            actions={[
              <Popconfirm
                key="remove"
                title={`确认将“${m.display_name}”移出当前课程？`}
                onConfirm={() =>
                  void action.run(
                    `/members/${m.id}`,
                    undefined,
                    "DELETE",
                    "成员已移出课程",
                  )
                }
              >
                <Button size="small" type="link" danger disabled={action.busy}>
                  移出课程
                </Button>
              </Popconfirm>,
            ]}
          >
            <Link
              style={{ overflowWrap: "anywhere" }}
              to={`/teacher/dashboard?student=${m.id}`}
            >
              {m.display_name}
            </Link>
            <span style={{ overflowWrap: "anywhere" }}>{m.username || ""}</span>
          </List.Item>
        )}
      />
      <Collapse
        items={[
          {
            key: "content",
            label: "新建学生账号并加入本课程",
            children: (
              <Form
                className="live-form"
                onFinish={() => {
                  void handleCreateStudent();
                }}
                layout="vertical"
              >
                {studentError && (
                  <Alert
                    type="error"
                    showIcon
                    role="alert"
                    message={studentError}
                  />
                )}
                <Field
                  className="ui-field"
                  label="新学生用户名"
                  required
                  extra="3 到 64 位字母、数字或 . _ @ -，不含空格"
                >
                  <Input
                    aria-label="新学生用户名"
                    value={student.username}
                    onChange={(e) => {
                      setStudentError("");
                      setStudent({ ...student, username: e.target.value });
                    }}
                  />
                </Field>
                <Field className="ui-field" label="学生姓名" required>
                  <Input
                    aria-label="学生姓名"
                    value={student.display_name}
                    onChange={(e) => {
                      setStudentError("");
                      setStudent({ ...student, display_name: e.target.value });
                    }}
                  />
                </Field>
                <Field
                  className="ui-field"
                  label="初始密码"
                  required
                  extra={
                    <Typography.Text
                      type={
                        student.password && (pwdBytes < 12 || pwdBytes > 72)
                          ? "danger"
                          : "secondary"
                      }
                    >
                      当前 {pwdBytes} 字节（要求 12–72 字节，不能全为空白）
                    </Typography.Text>
                  }
                >
                  <Input.Password
                    aria-label="初始密码"
                    autoComplete="new-password"
                    value={student.password}
                    onChange={(e) => {
                      setStudentError("");
                      setStudent({ ...student, password: e.target.value });
                    }}
                  />
                </Field>
                <Button disabled={action.busy} htmlType="submit">
                  创建学生账号
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </>
  );
}
