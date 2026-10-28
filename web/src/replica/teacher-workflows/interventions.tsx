import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Link,
  Modal,
  Notice,
  Panel,
  SourcePage,
  useLocalState,
} from "../ui";
import {
  submissions as initialSubmissions,
  taskPacks as initialTaskPacks,
  type TaskPack,
  type Submission,
} from "../demo";
import { Refresh, Table, TeacherHero, now, statusName, uid } from "./common";

interface Draft {
  id: string;
  student: string;
  title: string;
  description: string;
  resources: string[];
  questions: string[];
}

export function TeacherIntervention() {
  const [packs, setPacks] = useLocalState<TaskPack[]>(
    "taskPacks",
    initialTaskPacks,
  );
  const [records] = useLocalState<Submission[]>(
    "submissions",
    initialSubmissions,
  );
  const [identified, setIdentified] = useLocalState(
    "interventionIdentified",
    false,
  );
  const [drafts, setDrafts] = useLocalState<Draft[]>("interventionDrafts", []);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Draft>();
  const visiblePacks = packs.filter(
    (p) => identified || p.id !== "showcase_pkg_zyh",
  );
  function generate() {
    const draft = {
      id: uid("pack"),
      student: "曾懿涵",
      title: "数据采集流程补学任务",
      description:
        "围绕 数据采集流程 安排资源复习、测验和一道练习，请按任务包完成学习与练习",
      resources: ["数据采集流程：复习课程资源并记录关键步骤"],
      questions: ["请说明数据采集的主要流程，并解释如何检查数据质量。"],
    };
    setDrafts((prev) => [...prev, draft]);
    setNotice(
      "已生成本地示例任务草稿，未调用模型。请教师核查证据和任务后确认推送。",
    );
  }
  function patch(id: string, p: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }
  function publish() {
    if (!confirm) return;
    setPacks((prev) => [
      ...prev,
      {
        id: confirm.id,
        title: confirm.title,
        student: confirm.student,
        status: "assigned",
        progress: 0,
        description: [
          confirm.description,
          ...confirm.resources.map((v) => `资源学习：${v}`),
          ...confirm.questions.map((v) => `练习：${v}`),
        ].join("\n"),
      },
    ]);
    setDrafts((prev) => prev.filter((d) => d.id !== confirm.id));
    setConfirm(undefined);
    setNotice("任务包已在本地推送，学生端“老师任务”可见。");
  }
  return (
    <SourcePage name="TeacherInterventionView">
      <div className="intervention-shell">
        <TeacherHero
          eyebrow="AI 干预"
          title="教师智能干预任务包"
          description="教师根据诊断证据生成可编辑任务包，确认后推送给学生执行，并持续跟踪完成情况。"
        >
          <Refresh onClick={() => setNotice("已读取当前浏览器中的任务包。")} />
          <Button
            onClick={() => {
              setIdentified(true);
              setNotice("已载入本地示例学生的诊断与提交证据。");
            }}
          >
            识别薄弱点
          </Button>
        </TeacherHero>
        {notice && <Notice>{notice}</Notice>}
        <Panel
          title="学生概览"
          extra={<span className="muted">共 {identified ? 1 : 0} 人</span>}
        >
          <Table
            headers={[
              "学生",
              "总体掌握度",
              "薄弱点数量",
              "作业提交数",
              "作业均分",
              "操作",
            ]}
            rows={
              identified
                ? [
                    [
                      "曾懿涵",
                      "54.5%",
                      169,
                      records.length,
                      `${(records.filter((r) => r.status === "graded").reduce((sum, r) => sum + (r.score || 0), 0) / (records.filter((r) => r.status === "graded").length || 1)).toFixed(1)} 分`,
                      <div className="actions-row">
                        <Link
                          className="ghost-btn small"
                          to="/teacher/dashboard?tab=学生画像"
                        >
                          查看证据
                        </Link>
                        <Button small onClick={generate}>
                          生成任务包
                        </Button>
                      </div>,
                    ],
                  ]
                : []
            }
            empty="暂无学生数据"
          />
        </Panel>
        <Panel
          title="任务包草稿（教师可编辑）"
          extra={<span className="muted">草稿可编辑，推送后学生可见</span>}
        >
          {drafts.length ? (
            drafts.map((draft) => (
              <article className="draft-card" key={draft.id}>
                <div className="section-head">
                  <h3>{draft.student} · 任务包草稿</h3>
                  <Button
                    small
                    onClick={() =>
                      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
                    }
                  >
                    移除草稿
                  </Button>
                </div>
                <label className="field">
                  <span>任务包标题</span>
                  <input
                    className="input"
                    value={draft.title}
                    onChange={(e) => patch(draft.id, { title: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>任务说明</span>
                  <textarea
                    className="input input-textarea"
                    rows={3}
                    value={draft.description}
                    onChange={(e) =>
                      patch(draft.id, { description: e.target.value })
                    }
                  />
                </label>
                <div className="task-edit-section">
                  <div className="section-head">
                    <strong>资源学习任务</strong>
                    <Button
                      small
                      onClick={() =>
                        patch(draft.id, { resources: [...draft.resources, ""] })
                      }
                    >
                      添加资源
                    </Button>
                  </div>
                  {draft.resources.map((resource, i) => (
                    <div className="question-block" key={i}>
                      <div className="two-col">
                        <label className="field">
                          <span>学习内容</span>
                          <input
                            className="input"
                            value={resource}
                            onChange={(e) =>
                              patch(draft.id, {
                                resources: draft.resources.map((r, index) =>
                                  index === i ? e.target.value : r,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>资源类型</span>
                          <select className="input">
                            <option>课程资源</option>
                            <option>视频</option>
                            <option>文章</option>
                          </select>
                        </label>
                      </div>
                      <Button
                        small
                        onClick={() =>
                          patch(draft.id, {
                            resources: draft.resources.filter(
                              (_, index) => index !== i,
                            ),
                          })
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="task-edit-section">
                  <div className="section-head">
                    <strong>巩固练习</strong>
                    <Button
                      small
                      onClick={() =>
                        patch(draft.id, { questions: [...draft.questions, ""] })
                      }
                    >
                      添加练习
                    </Button>
                  </div>
                  {draft.questions.map((question, i) => (
                    <div className="question-block" key={i}>
                      <label className="field">
                        <span>题目 {i + 1}</span>
                        <textarea
                          className="input"
                          rows={3}
                          value={question}
                          onChange={(e) =>
                            patch(draft.id, {
                              questions: draft.questions.map((q, index) =>
                                index === i ? e.target.value : q,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        small
                        onClick={() =>
                          patch(draft.id, {
                            questions: draft.questions.filter(
                              (_, index) => index !== i,
                            ),
                          })
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  诊断依据：数据采集流程掌握度
                  46%，作业反馈与学习记录。任务内容由教师确认后生效。
                </p>
                <Button
                  disabled={
                    !draft.title.trim() ||
                    !draft.description.trim() ||
                    !draft.questions.length ||
                    draft.questions.some((q) => !q.trim())
                  }
                  onClick={() => setConfirm(draft)}
                >
                  确认并推送任务包
                </Button>
              </article>
            ))
          ) : (
            <div className="state-card">暂无草稿，请先为学生生成任务包。</div>
          )}
        </Panel>
        <Panel title="学生执行进度">
          <Table
            headers={[
              "包ID",
              "学生",
              "状态",
              "完成度（题目）",
              "评分概览",
              "备注",
              "更新时间",
              "操作",
            ]}
            rows={visiblePacks.map((pack) => [
              pack.id,
              pack.student,
              statusName(pack.status),
              `${pack.progress}% (${pack.progress === 100 ? 1 : 0}/1)`,
              pack.status === "reviewed" ? "已复查" : "-",
              pack.comment || "-",
              "-",
              <Link
                className="ghost-btn small"
                to={`/teacher/intervention/${pack.id}`}
              >
                查看详情
              </Link>,
            ])}
            empty="暂未推送任务包"
          />
        </Panel>
        <Panel
          title="诊断证据时间线"
          extra={<span className="muted">资源学习、作业与测验回流</span>}
          className="teacher-intervention-evidence-panel"
        >
          {identified ? (
            <div className="teacher-intervention-evidence-list">
              {records.map((record) => (
                <article
                  className="teacher-intervention-evidence-row"
                  key={record.id}
                >
                  <span className="teacher-intervention-evidence-type">
                    作业{record.status === "graded" ? "评分" : "提交"}
                  </span>
                  <span className="teacher-intervention-evidence-node">
                    曾懿涵
                  </span>
                  <span className="teacher-intervention-evidence-summary">
                    {record.status === "graded"
                      ? `教师确认 ${record.score} 分；${record.comment}`
                      : "原始作答已提交，等待教师确认评分"}
                  </span>
                  <span className="teacher-intervention-evidence-time">
                    {record.submittedAt}
                  </span>
                </article>
              ))}
              <Notice>
                这里展示本地演示记录，不根据待审核的 AI 建议分生成正式评价。
              </Notice>
            </div>
          ) : (
            <div className="state-card">暂无诊断证据，请先识别薄弱点。</div>
          )}
        </Panel>
        {confirm && (
          <Modal
            title="确认推送任务包"
            onClose={() => setConfirm(undefined)}
            footer={
              <>
                <Button onClick={() => setConfirm(undefined)}>取消</Button>
                <Button onClick={publish}>确认推送</Button>
              </>
            }
          >
            <p>
              将“{confirm.title}”推送给 {confirm.student}
              。学生可在本地“老师任务”中完成作答。
            </p>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

export function TeacherInterventionDetail() {
  const { packageId } = useParams();
  const [packs, setPacks] = useLocalState<TaskPack[]>(
    "taskPacks",
    initialTaskPacks,
  );
  const pack = packs.find((p) => p.id === packageId);
  const [comment, setComment] = useState(pack?.comment || "");
  const [notice, setNotice] = useState("");
  if (!pack)
    return (
      <Panel title="任务包不存在">
        <Link to="/teacher/intervention">返回任务包列表</Link>
      </Panel>
    );
  return (
    <SourcePage name="TeacherInterventionDetailView">
      <div className="teacher-intervention-detail-shell">
        <TeacherHero
          eyebrow="任务包详情"
          title={pack.title}
          description="跟踪学生任务执行、查看原始作答并完成教师复查。"
        >
          <Link className="ghost-btn" to="/teacher/intervention">
            返回列表
          </Link>
        </TeacherHero>
        {notice && <Notice>{notice}</Notice>}
        <Panel title="任务包概览">
          <div className="summary-grid">
            <p>学生：{pack.student}</p>
            <p>状态：{statusName(pack.status)}</p>
            <p>完成进度：{pack.progress}%</p>
            <p>任务包ID：{pack.id}</p>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{pack.description}</p>
        </Panel>
        <Panel title="学生执行与作答">
          <p>学习资源复习 · {pack.progress === 100 ? "已完成" : "待完成"}</p>
          <h3>题目 1：数据采集流程巩固练习</h3>
          <div className="answer-box">
            <p style={{ whiteSpace: "pre-wrap" }}>
              {pack.answer || "学生尚未提交作答。"}
            </p>
          </div>
        </Panel>
        <Panel title="教师复查">
          <label className="field">
            <span>复查意见</span>
            <textarea
              className="input input-textarea"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <p className="muted">学生点击完成不等于教师复查通过。</p>
          <Button
            disabled={pack.status !== "submitted" && pack.status !== "reviewed"}
            onClick={() => {
              setPacks((prev) =>
                prev.map((p) =>
                  p.id === pack.id
                    ? {
                        ...p,
                        status: "reviewed",
                        comment: comment || "已复查，请继续巩固学习。",
                      }
                    : p,
                ),
              );
              setNotice(`教师复查已于 ${now()} 保存到本地。`);
            }}
          >
            确认复查完成
          </Button>
        </Panel>
      </div>
    </SourcePage>
  );
}
