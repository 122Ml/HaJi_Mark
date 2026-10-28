import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  SourcePage,
  Button,
  Panel,
  DataTable,
  Link,
  Notice,
  Modal,
  useLocalState,
} from "../ui";
import { taskPacks as initialPacks, type TaskPack } from "../demo";
import {
  interactionItems,
  type InteractionItem,
} from "../teacher-workflows/interaction-data";
const packStatus: Record<string, string> = {
  assigned: "待处理",
  accepted: "已接受",
  declined: "暂不做",
  in_progress: "进行中",
  submitted: "已提交",
  completed: "已完成",
  reviewed: "已复查",
};
export function InterventionPage() {
  const [packs] = useLocalState<TaskPack[]>("taskPacks", initialPacks);
  return (
    <SourcePage name="StudentInterventionView">
      <div className="intervention-student-shell">
        <section className="hero-panel app-hero app-hero--learning">
          <div className="app-hero-copy">
            <p className="eyebrow">Personalized Pack</p>
            <h1>教师推送任务包</h1>
            <p className="hero-desc">
              仅你可见。点击“进入作答”后可逐题完成，系统会自动计算进度。
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>刷新</Button>
        </section>
        <Panel
          title="我的任务包"
          extra={
            <span className="muted">
              共 {packs.filter((p) => p.status !== "draft").length} 个
            </span>
          }
        >
          <DataTable
            headers={[
              "任务包",
              "教师",
              "状态",
              "进度",
              "题目数",
              "更新时间",
              "操作",
            ]}
            rows={packs
              .filter((p) => p.status !== "draft")
              .map((p) => [
                p.title,
                "",
                packStatus[p.status] || p.status,
                p.progress + "% (" + (p.progress === 100 ? "1" : "0") + "/1)",
                1,
                "-",
                <Link
                  className="ghost-btn"
                  to={"/student/intervention/" + p.id}
                >
                  进入作答
                </Link>,
              ])}
          />
        </Panel>
      </div>
    </SourcePage>
  );
}
export function InterventionDetail() {
  const { packageId } = useParams();
  const [packs, setPacks] = useLocalState<TaskPack[]>(
    "taskPacks",
    initialPacks,
  );
  const p = packs.find((p) => p.id === packageId && p.status !== "draft");
  const [answer, setAnswer] = useState(p?.answer || "");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [resourceDone, setResourceDone] = useLocalState(
    "taskResource-" + packageId,
    false,
  );
  const update = (values: Partial<TaskPack>) =>
    setPacks((prev) =>
      prev.map((t) => (t.id === packageId ? { ...t, ...values } : t)),
    );
  if (!p)
    return (
      <Panel title="任务包不存在">
        <Link to="/student/intervention">返回列表</Link>
      </Panel>
    );
  const accepted = [
    "accepted",
    "in_progress",
    "submitted",
    "completed",
    "reviewed",
  ].includes(p.status);
  return (
    <SourcePage name="StudentInterventionDetailView">
      <div className="intervention-detail-shell">
        <section className="card-panel">
          <div className="section-head">
            <h3>任务包详情</h3>
            <div className="actions-row">
              <Button onClick={() => window.location.reload()}>刷新</Button>
              <Link className="ghost-btn" to="/student/intervention">
                返回列表
              </Link>
            </div>
          </div>
          <div className="summary-grid">
            <div>
              <strong>任务包：</strong>
              {p.id}
            </div>
            <div>
              <strong>教师：</strong>teacher
            </div>
            <div>
              <strong>状态：</strong>
              {packStatus[p.status] || p.status}
            </div>
            <div>
              <strong>进度：</strong>
              {p.progress}% ({p.progress === 100 ? 1 : 0}/1)
            </div>
          </div>
          {notice && <Notice>{notice}</Notice>}
          {!accepted && (
            <div className="actions-row">
              <Button onClick={() => update({ status: "accepted" })}>
                接受并开始
              </Button>
              <Button onClick={() => update({ status: "declined" })}>
                暂不做
              </Button>
            </div>
          )}
          {!accepted && (
            <div className="state-card">请先接受任务包后再开始。</div>
          )}
          <section className="card-panel mini-card">
            <p>
              <strong>教学策略：</strong>
              {p.description}
            </p>
          </section>
          <section className="card-panel mini-card">
            <div className="section-head compact">
              <strong>在线任务</strong>
            </div>
            <div className="intervention-task-list">
              <article className="intervention-task-card">
                <span className="task-kind">资源</span>
                <strong>数据采集流程复习</strong>
                <p>
                  数据采集流程 · 必做 · {resourceDone ? "已完成" : "待完成"}
                </p>
                <div className="actions-row">
                  <Link
                    className="ghost-btn"
                    to="/student/course-content?node=数据采集流程"
                  >
                    打开资源
                  </Link>
                  <Button
                    disabled={!accepted}
                    onClick={() => setResourceDone(!resourceDone)}
                  >
                    {resourceDone ? "取消完成" : "标记完成"}
                  </Button>
                </div>
              </article>
              <article className="intervention-task-card">
                <span className="task-kind">测验</span>
                <strong>数据采集流程测验</strong>
                <p>数据采集流程 · 必做</p>
                <Link
                  className="ghost-btn"
                  to="/student/quiz?topic=数据采集流程"
                >
                  进入测验
                </Link>
              </article>
            </div>
          </section>
          <div className="two-col">
            <section className="card-panel mini-card">
              <div className="section-head compact">
                <strong>题目列表</strong>
              </div>
              <DataTable
                headers={["#", "标题", "状态", "操作"]}
                rows={[
                  [
                    1,
                    "数据采集流程练习",
                    p.answer ? "已完成" : "待作答",
                    <a href="#task-answer">进入作答</a>,
                  ],
                ]}
              />
            </section>
            <section className="card-panel mini-card" id="task-answer">
              <div className="section-head compact">
                <strong>数据采集流程练习</strong>
                <span className="muted">题型：主观题 · 难度：基础</span>
              </div>
              <p className="multiline">
                请说明数据采集的主要步骤，以及各步骤需要保留的评价证据。
              </p>
              <label className="field">
                <span>你的答案</span>
                <textarea
                  className="input input-textarea"
                  rows={10}
                  disabled={!accepted}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="请输入本题答案"
                />
              </label>
              <label className="field">
                <span>本题备注（自动保存在本机）</span>
                <textarea
                  rows={3}
                  className="input input-textarea"
                  disabled={!accepted}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="记录本题疑问、思路或反馈"
                />
              </label>
              <div className="actions-row">
                <Button
                  disabled={!accepted || !answer.trim()}
                  onClick={() => {
                    update({ answer, status: "in_progress" });
                    setNotice("本地演示：答案已保存。");
                  }}
                >
                  保存本题答案
                </Button>
                <Button
                  primary
                  disabled={!accepted || !answer.trim()}
                  onClick={() => {
                    update({ answer, status: "submitted", progress: 100 });
                    setNotice(
                      "本地演示：已提交，等待教师复查。完成任务不等于教师复查通过。",
                    );
                  }}
                >
                  提交任务包
                </Button>
              </div>
              {p.comment && <Notice>教师复查：{p.comment}</Notice>}
            </section>
          </div>
        </section>
      </div>
    </SourcePage>
  );
}
function InteractionTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="industry-table-wrap">
      <table className="industry-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr className="clickable-row" key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function InteractionPage() {
  const [items, setItems] = useLocalState<InteractionItem[]>(
    "interactionItems",
    interactionItems,
  );
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const item = items.find((i) => i.id === selected);
  const titleButton = (i: InteractionItem) => (
    <strong
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") setSelected(i.id);
      }}
      onClick={() => setSelected(i.id)}
      style={{ cursor: "pointer" }}
    >
      {i.title}
    </strong>
  );
  return (
    <SourcePage name="StudentInteractionView">
      <div className="student-interaction-shell">
        <section className="hero-panel app-hero app-hero--student">
          <div className="app-hero-copy">
            <p className="eyebrow">班级互动</p>
            <h1>班级互动中心</h1>
            <p className="hero-desc">
              查看教师公告与讨论话题，点击即可在弹窗中阅读详情并参与提问。
            </p>
          </div>
          <div className="app-hero-actions">
            <Button onClick={() => window.location.reload()}>刷新</Button>
          </div>
        </section>
        <Panel
          title="公告列表"
          extra={<span className="muted">点击公告查看详情</span>}
        >
          <InteractionTable
            headers={[
              "标题",
              "班级",
              "课程",
              "创建时间",
              "最后修改",
              "发布时间",
            ]}
            rows={items
              .filter((i) => i.kind === "announcement")
              .map((i) => [
                titleButton(i),
                i.className,
                i.course,
                i.createdAt,
                i.updatedAt,
                i.createdAt,
              ])}
          />
        </Panel>
        <Panel
          title="讨论话题"
          extra={<span className="muted">点击话题查看详情并参与提问</span>}
        >
          <InteractionTable
            headers={[
              "标题",
              "班级",
              "课程",
              "提问数",
              "回复数",
              "创建时间",
              "更新时间",
            ]}
            rows={items
              .filter((i) => i.kind === "discussion")
              .map((i) => [
                titleButton(i),
                i.className,
                i.course,
                i.questions.length,
                i.questions.filter((q) => q.reply).length,
                i.createdAt,
                i.updatedAt,
              ])}
          />
        </Panel>
      </div>
      {item && (
        <Modal title={item.title} onClose={() => setSelected("")}>
          <p className="muted">
            {item.className} · {item.course} · {item.createdAt}
          </p>
          <p className="multiline">{item.content}</p>
          {item.kind === "discussion" && (
            <>
              <h3>课堂问答</h3>
              {item.questions.map((q) => (
                <article className="list-card" key={q.id}>
                  <strong>学生提问</strong>
                  <p>{q.text}</p>
                  <strong>教师回复</strong>
                  <p>{q.reply || "等待教师回复"}</p>
                </article>
              ))}
              <label>
                <span>我的提问</span>
                <textarea
                  rows={4}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="请输入你的问题"
                />
              </label>
              <Button
                primary
                disabled={!question.trim()}
                onClick={() => {
                  setItems((prev) =>
                    prev.map((i) =>
                      i.id === item.id
                        ? {
                            ...i,
                            questions: [
                              ...i.questions,
                              { id: "q-" + Date.now(), text: question },
                            ],
                          }
                        : i,
                    ),
                  );
                  setQuestion("");
                }}
              >
                提交提问（本地）
              </Button>
            </>
          )}
        </Modal>
      )}
    </SourcePage>
  );
}
export function ProfilePage() {
  const [profile, setProfile] = useLocalState("profile", {
    email: "",
    teacher: "",
    goals: "",
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <div className="profile-shell-vue">
      <div className="student-profile-v2-header">
        <div>
          <h1>⚙️ 个人中心设置</h1>
          <p className="student-profile-v2-desc">管理个人资料和账户安全</p>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      <section className="student-profile-v2-layout">
        <div className="student-profile-v2-overview">
          <div className="student-profile-v2-overview-header">
            <div className="student-profile-v2-avatar">
              <span>曾</span>
            </div>
            <div className="student-profile-v2-user-info">
              <h2>曾懿涵</h2>
              <p className="muted">@曾懿涵</p>
            </div>
          </div>
          <div className="student-profile-v2-stats">
            <div className="student-profile-v2-stat-item">
              <div className="student-profile-v2-stat-label">身份</div>
              <div className="student-profile-v2-stat-value">student</div>
            </div>
            <div className="student-profile-v2-stat-item">
              <div className="student-profile-v2-stat-label">学习目标</div>
              <div className="student-profile-v2-stat-value">
                {profile.goals.split("\n").filter(Boolean).length}
              </div>
            </div>
          </div>
        </div>
        <div className="student-profile-v2-forms">
          <article className="student-profile-v2-card">
            <div className="student-profile-v2-card-header">
              <h2>基本信息</h2>
              <span className="muted">更新个人信息</span>
            </div>
            <form
              className="student-profile-v2-form"
              onSubmit={(e) => {
                e.preventDefault();
                setNotice("本地演示：个人资料已保存到当前浏览器。");
              }}
            >
              <label>
                <span>用户名</span>
                <input disabled value="曾懿涵" />
              </label>
              <label>
                <span>姓名</span>
                <input disabled value="曾懿涵" />
              </label>
              <label className="wide">
                <span>邮箱</span>
                <input
                  type="email"
                  placeholder="请输入邮箱"
                  value={profile.email}
                  onChange={(e) =>
                    setProfile({ ...profile, email: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                <span>指导教师</span>
                <input
                  placeholder="请输入教师用户名或姓名"
                  value={profile.teacher}
                  onChange={(e) =>
                    setProfile({ ...profile, teacher: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                <span>学习目标</span>
                <textarea
                  rows={5}
                  placeholder="每行一个学习目标，例如：掌握 Python 数据分析"
                  value={profile.goals}
                  onChange={(e) =>
                    setProfile({ ...profile, goals: e.target.value })
                  }
                />
              </label>
              <button className="primary-link button-like full-width">
                保存资料
              </button>
            </form>
          </article>
          <article className="student-profile-v2-card">
            <div className="student-profile-v2-card-header">
              <h2>账户安全</h2>
              <span className="muted">修改登录密码</span>
            </div>
            <form
              className="student-profile-v2-form"
              onSubmit={(e) => {
                e.preventDefault();
                setNotice("本地演示未接入账户服务，未修改真实登录密码。");
                setCurrentPassword("");
                setPassword("");
              }}
            >
              <label className="wide">
                <span>当前密码</span>
                <input
                  type="password"
                  required
                  placeholder="请输入当前密码"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label className="wide">
                <span>新密码</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="请输入新密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="ghost-btn full-width">修改密码</button>
            </form>
          </article>
        </div>
      </section>
    </div>
  );
}
