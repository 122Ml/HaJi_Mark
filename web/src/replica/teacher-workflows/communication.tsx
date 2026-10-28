import { useState, type FormEvent } from "react";
import { Button, Modal, Notice, Panel, SourcePage, useLocalState } from "../ui";
import {
  ClassCourseFields,
  Refresh,
  Table,
  TeacherHero,
  now,
  uid,
} from "./common";
import { interactionItems, type InteractionItem } from "./interaction-data";

interface InteractionForm {
  title: string;
  content: string;
  className: string;
  course: string;
}
const emptyForm = (): InteractionForm => ({
  title: "",
  content: "",
  className: "",
  course: "",
});

export function TeacherInteraction() {
  const [items, setItems] = useLocalState<InteractionItem[]>(
    "interactionItems",
    interactionItems,
  );
  const [announcement, setAnnouncement] = useState(emptyForm());
  const [discussion, setDiscussion] = useState(emptyForm());
  const [edit, setEdit] = useState<InteractionItem>();
  const [detailId, setDetailId] = useState("");
  const [deleting, setDeleting] = useState<InteractionItem>();
  const [notice, setNotice] = useState("");
  const [period, setPeriod] = useState("7");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const announcements = items.filter((i) => i.kind === "announcement");
  const discussions = items.filter((i) => i.kind === "discussion");
  const detail = items.find((i) => i.id === detailId);
  function publish(event: FormEvent, kind: InteractionItem["kind"]) {
    event.preventDefault();
    const form = kind === "announcement" ? announcement : discussion;
    if (!form.title.trim() || !form.content.trim()) {
      setNotice("请填写标题和内容。");
      return;
    }
    const time = now();
    setItems((prev) => [
      {
        ...form,
        id: uid(kind),
        kind,
        createdAt: time,
        updatedAt: time,
        questions: [],
      },
      ...prev,
    ]);
    if (kind === "announcement") setAnnouncement(emptyForm());
    else setDiscussion(emptyForm());
    setNotice("已保存到本地互动中心，学生端可查看。");
  }
  function saveEdit() {
    if (!edit?.title.trim() || !edit.content.trim()) return;
    setItems((prev) =>
      prev.map((i) => (i.id === edit.id ? { ...edit, updatedAt: now() } : i)),
    );
    setEdit(undefined);
    setNotice("内容已在本地更新。");
  }
  function actions(item: InteractionItem) {
    return (
      <>
        <Button className="tiny" onClick={() => setEdit(item)}>
          编辑
        </Button>
        <Button className="tiny danger" onClick={() => setDeleting(item)}>
          删除
        </Button>
      </>
    );
  }
  function renderForm(kind: InteractionItem["kind"]) {
    const isAnnouncement = kind === "announcement";
    const form = isAnnouncement ? announcement : discussion;
    const setForm = isAnnouncement ? setAnnouncement : setDiscussion;
    return (
      <form onSubmit={(e) => publish(e, kind)}>
        <label className="field">
          <span>{isAnnouncement ? "公告标题" : "讨论标题"}</span>
          <input
            className="input"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <ClassCourseFields
          className={form.className}
          course={form.course}
          onClass={(v) => setForm({ ...form, className: v })}
          onCourse={(v) => setForm({ ...form, course: v })}
        />
        <label className="field">
          <span>{isAnnouncement ? "公告内容" : "讨论说明"}</span>
          <textarea
            className="input input-textarea"
            rows={4}
            required
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <Button type="submit">
          {isAnnouncement ? "发布公告" : "发起讨论"}
        </Button>
      </form>
    );
  }
  return (
    <SourcePage name="TeacherInteractionView">
      <div className="interaction-shell">
        <TeacherHero
          eyebrow="教学互动"
          title="教学互动中心"
          description="教师可在此发布公告、发起讨论并处理问答。公告和讨论会同步到学生端互动中心，并回流教师六维画像。"
        >
          <Refresh
            onClick={() => setNotice("已读取当前浏览器中的互动记录。")}
          />
        </TeacherHero>
        {notice && <Notice>{notice}</Notice>}
        <Panel
          title="互动分析看板"
          extra={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="input"
                style={{ minWidth: 140 }}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="7">近7天</option>
                <option value="30">近30天</option>
                <option value="90">近90天</option>
              </select>
              <Button
                onClick={() => setNotice(`已更新近${period}天本地互动汇总。`)}
              >
                更新
              </Button>
            </div>
          }
        >
          <div className="metrics-grid">
            {[
              ["公告总数", announcements.length],
              ["讨论总数", discussions.length],
              [
                "近窗学生提问",
                items
                  .flatMap((i) => i.questions)
                  .filter((q) => !["q-1", "q-2"].includes(q.id)).length,
              ],
              [
                "近窗教师回复",
                items
                  .flatMap((i) => i.questions)
                  .filter((q) => !["q-1", "q-2"].includes(q.id) && q.reply)
                  .length,
              ],
              ["平均响应(分钟)", "-"],
            ].map(([label, value]) => (
              <article className="metric-card" key={label}>
                <span className="metric-label">{label}</span>
                <strong className="metric-value">{value}</strong>
              </article>
            ))}
          </div>
          <div className="top-classes">
            <strong>活跃班级 TOP</strong>
            <div className="top-classes-list">
              <span className="meta-chip">
                大数据201 · {discussions.length} 话题
              </span>
            </div>
          </div>
        </Panel>
        <div className="two-col-layout">
          <Panel
            title="发布公告"
            extra={
              <span className="muted">
                自动计入“在线互动频次”和“教学节奏控制”
              </span>
            }
          >
            {renderForm("announcement")}
          </Panel>
          <Panel
            title="发起讨论"
            extra={<span className="muted">自动计入“在线互动频次”</span>}
          >
            {renderForm("discussion")}
          </Panel>
        </div>
        <Panel
          title="公告列表"
          extra={<span className="muted">点击标题查看详情</span>}
        >
          <Table
            headers={[
              "标题",
              "班级",
              "课程",
              "创建时间",
              "最后修改",
              "发布时间",
              "内容摘要",
              "操作",
            ]}
            rows={announcements.map((item) => [
              <button
                className="replica-text-button"
                onClick={() => setDetailId(item.id)}
              >
                <strong>{item.title}</strong>
              </button>,
              item.className || "-",
              item.course || "-",
              item.createdAt,
              item.updatedAt,
              item.createdAt,
              `${item.content.slice(0, 48)}${item.content.length > 48 ? "..." : ""}`,
              actions(item),
            ])}
          />
        </Panel>
        <Panel
          title="讨论区"
          extra={<span className="muted">点击标题查看讨论详情并登记问答</span>}
        >
          <Table
            headers={[
              "讨论标题",
              "班级",
              "课程",
              "学生提问",
              "教师回复",
              "创建时间",
              "更新时间",
              "操作",
            ]}
            rows={discussions.map((item) => [
              <button
                className="replica-text-button"
                onClick={() => setDetailId(item.id)}
              >
                <strong>{item.title}</strong>
              </button>,
              item.className || "-",
              item.course || "-",
              item.questions.length,
              item.questions.filter((q) => q.reply).length,
              item.createdAt,
              item.updatedAt,
              actions(item),
            ])}
          />
        </Panel>
        {detail && (
          <Modal title={detail.title} onClose={() => setDetailId("")}>
            <p className="muted">
              {detail.className || "未指定班级"} ·{" "}
              {detail.course || "未指定课程"} · {detail.createdAt}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{detail.content}</p>
            {detail.kind === "discussion" && (
              <>
                <h3>学生提问与教师回复</h3>
                {detail.questions.length ? (
                  detail.questions.map((q) => (
                    <article className="question-card" key={q.id}>
                      <strong>学生提问</strong>
                      <p>{q.text}</p>
                      {q.reply && (
                        <p>
                          <strong>教师回复：</strong>
                          {q.reply}
                        </p>
                      )}
                      <label className="field">
                        <span>教师回复</span>
                        <textarea
                          className="input"
                          rows={3}
                          value={replies[q.id] ?? q.reply ?? ""}
                          onChange={(e) =>
                            setReplies({ ...replies, [q.id]: e.target.value })
                          }
                        />
                      </label>
                      <Button
                        onClick={() => {
                          const reply = (replies[q.id] ?? q.reply ?? "").trim();
                          if (reply) {
                            setItems((prev) =>
                              prev.map((item) =>
                                item.id === detail.id
                                  ? {
                                      ...item,
                                      updatedAt: now(),
                                      questions: item.questions.map(
                                        (question) =>
                                          question.id === q.id
                                            ? { ...question, reply }
                                            : question,
                                      ),
                                    }
                                  : item,
                              ),
                            );
                            setNotice("教师回复已在本地保存。");
                          }
                        }}
                      >
                        保存回复
                      </Button>
                    </article>
                  ))
                ) : (
                  <p className="muted">暂无学生提问。</p>
                )}
              </>
            )}
          </Modal>
        )}
        {edit && (
          <Modal
            title={edit.kind === "announcement" ? "编辑公告" : "编辑讨论"}
            onClose={() => setEdit(undefined)}
            footer={
              <>
                <Button onClick={() => setEdit(undefined)}>取消</Button>
                <Button onClick={saveEdit}>保存修改</Button>
              </>
            }
          >
            <label className="field">
              <span>标题</span>
              <input
                className="input"
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <ClassCourseFields
              className={edit.className}
              course={edit.course}
              onClass={(v) => setEdit({ ...edit, className: v })}
              onCourse={(v) => setEdit({ ...edit, course: v })}
            />
            <label className="field">
              <span>内容</span>
              <textarea
                className="input"
                rows={5}
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </label>
          </Modal>
        )}
        {deleting && (
          <Modal
            title="确认删除"
            onClose={() => setDeleting(undefined)}
            footer={
              <>
                <Button onClick={() => setDeleting(undefined)}>取消</Button>
                <Button
                  onClick={() => {
                    setItems((prev) =>
                      prev.filter((i) => i.id !== deleting.id),
                    );
                    setDeleting(undefined);
                    setNotice("本地记录已删除。");
                  }}
                >
                  确认删除
                </Button>
              </>
            }
          >
            <p>删除“{deleting.title}”？此操作仅影响本地演示数据。</p>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

interface ResearchRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  url: string;
  className: string;
  course: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}
const researchRecords: ResearchRecord[] = [
  {
    id: "research-1",
    type: "collective_prepare",
    title: "共备数据采集案例",
    description: "围绕采集链路、清洗任务和评价证据统一教学口径。",
    url: "",
    className: "大数据201",
    course: "course_big_data",
    occurredAt: "2026/6/28 16:35:59",
    createdAt: "2026/6/28 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
  },
  {
    id: "research-2",
    type: "resource_review",
    title: "资源绑定复核",
    description: "复核候选资源，只将教师确认后的资源用于学生端展示。",
    url: "",
    className: "大数据201",
    course: "course_big_data",
    occurredAt: "2026/6/27 16:35:59",
    createdAt: "2026/6/27 16:35:59",
    updatedAt: "2026/6/30 16:35:59",
  },
];
export function TeacherResearch() {
  const [records, setRecords] = useLocalState<ResearchRecord[]>(
    "researchRecords",
    researchRecords,
  );
  const blank = (): ResearchRecord => ({
    id: uid("research"),
    type: "research_post",
    title: "",
    description: "",
    url: "",
    className: "",
    course: "",
    occurredAt: "",
    createdAt: now(),
    updatedAt: now(),
  });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<ResearchRecord>();
  const [notice, setNotice] = useState("");
  const [resource, setResource] = useState<ResearchRecord>();
  function save(e: FormEvent) {
    e.preventDefault();
    if (form.url && !/^https?:\/\//i.test(form.url)) {
      setNotice("资源链接请输入 http 或 https 地址。");
      return;
    }
    const next = {
      ...form,
      occurredAt: form.occurredAt || now(),
      updatedAt: now(),
    };
    setRecords((prev) =>
      editing
        ? prev.map((r) => (r.id === next.id ? next : r))
        : [next, ...prev],
    );
    setForm(blank());
    setEditing(false);
    setNotice("教研记录已保存到本地。");
  }
  const patch = (p: Partial<ResearchRecord>) =>
    setForm((prev) => ({ ...prev, ...p }));
  return (
    <SourcePage name="TeacherResearchView">
      <div className="research-shell">
        <TeacherHero
          eyebrow="教研协同"
          title="教研协同中心"
          description="统一记录教研发帖、共享课件、集体备课等行为，自动回流教师六维图“专业投入”和“数字资源”。"
        >
          <Refresh onClick={() => setNotice("已读取本地教研记录。")} />
        </TeacherHero>
        {notice && <Notice>{notice}</Notice>}
        <Panel
          title={editing ? "编辑教研记录" : "新增教研记录"}
          extra={<span className="muted">提交后会自动写入内部教研事件</span>}
        >
          <form onSubmit={save}>
            <div className="two-col">
              <label className="field">
                <span>活动类型</span>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => patch({ type: e.target.value })}
                >
                  <option value="research_post">教研发帖</option>
                  <option value="shared_courseware">共享课件</option>
                  <option value="co_preparation">集体备课</option>
                  {![
                    "research_post",
                    "shared_courseware",
                    "co_preparation",
                  ].includes(form.type) && (
                    <option value={form.type}>{form.type}</option>
                  )}
                </select>
              </label>
              <label className="field">
                <span>发生时间</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.occurredAt.includes("/") ? "" : form.occurredAt}
                  onChange={(e) => patch({ occurredAt: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>标题</span>
              <input
                className="input"
                required
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>描述</span>
              <textarea
                className="input input-textarea"
                rows={4}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <div className="two-col">
              <label className="field">
                <span>资源链接</span>
                <input
                  className="input"
                  placeholder="可选：共享文档或课件链接"
                  value={form.url}
                  onChange={(e) => patch({ url: e.target.value })}
                />
              </label>
              <label className="field">
                <span>班级/教研组</span>
                <select
                  className="input"
                  value={form.className}
                  onChange={(e) => patch({ className: e.target.value })}
                >
                  <option value="">未指定</option>
                  <option>大数据201</option>
                  <option>大数据2201</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>课程</span>
              <select
                className="input"
                value={form.course}
                onChange={(e) => patch({ course: e.target.value })}
              >
                <option value="">未指定</option>
                <option>course_big_data</option>
              </select>
            </label>
            <Button type="submit">保存教研记录</Button>
            {editing && (
              <Button
                onClick={() => {
                  setForm(blank());
                  setEditing(false);
                }}
              >
                取消编辑
              </Button>
            )}
          </form>
        </Panel>
        <Panel
          title="教研记录列表"
          extra={<span className="muted">共 {records.length} 条</span>}
        >
          <Table
            headers={[
              "类型",
              "标题",
              "说明",
              "资源",
              "班级/分组",
              "发生时间",
              "创建时间",
              "最后修改",
              "操作",
            ]}
            rows={records.map((record) => [
              record.type,
              record.title,
              record.description.length > 35
                ? `${record.description.slice(0, 35)}...`
                : record.description,
              record.url ? (
                <a href={record.url} target="_blank" rel="noreferrer">
                  查看资源
                </a>
              ) : (
                <button
                  className="replica-text-button"
                  onClick={() => setResource(record)}
                >
                  查看资源
                </button>
              ),
              record.className || "-",
              record.occurredAt.replace("T", " "),
              record.createdAt,
              record.updatedAt,
              <>
                <Button
                  className="tiny"
                  onClick={() => {
                    setForm(record);
                    setEditing(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  编辑
                </Button>
                <Button
                  className="tiny danger"
                  onClick={() => setDeleting(record)}
                >
                  删除
                </Button>
              </>,
            ])}
          />
        </Panel>
        {deleting && (
          <Modal
            title="确认删除教研记录"
            onClose={() => setDeleting(undefined)}
            footer={
              <>
                <Button onClick={() => setDeleting(undefined)}>取消</Button>
                <Button
                  onClick={() => {
                    setRecords((prev) =>
                      prev.filter((r) => r.id !== deleting.id),
                    );
                    setDeleting(undefined);
                    setNotice("本地教研记录已删除。");
                  }}
                >
                  确认删除
                </Button>
              </>
            }
          >
            <p>确定删除“{deleting.title}”？</p>
          </Modal>
        )}
        {resource && (
          <Modal title={resource.title} onClose={() => setResource(undefined)}>
            <p>{resource.description}</p>
            <Notice>
              参考站的 demo:// 资源没有可下载文件，这里保留本地记录摘要。
            </Notice>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}
