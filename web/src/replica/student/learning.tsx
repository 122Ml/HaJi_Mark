import { useState } from "react";
import { SourcePage, Button, Notice, useLocalState } from "../ui";
import nodes from "./path-data.json";
import supplemental from "./supplemental-data.json";
export function LearningPage() {
  const [goal, setGoal] = useState("");
  const [version, setVersion] = useLocalState("pathVersion", 1);
  const [status, setStatus] = useLocalState<Record<string, string>>(
    "pathStatus",
    {},
  );
  const [order, setOrder] = useState("priority");
  const [notice, setNotice] = useState("");
  return (
    <SourcePage name="page-my-learning">
      <div className="path-page-shell">
        <section className="path-page-heading">
          <div>
            <p className="path-page-eyebrow">Personalized Learning Path</p>
            <h1>个性化学习路径</h1>
            <p>
              根据学生画像、课程学习进度、测验作业与资源学习证据，生成后续学习顺序和配套资源推荐。
            </p>
          </div>
        </section>
        {notice && <Notice>{notice}</Notice>}
        <div className="student-learning-v2-path-panel">
          <div className="student-learning-v2-path-header">
            <div>
              <h2>🎯 个性化学习路径</h2>
              <p className="muted">
                综合学生画像、学习进度、测验与作业证据，推荐后续学习顺序和配套资源
              </p>
            </div>
            <div className="student-learning-v2-path-header-actions">
              <Button
                onClick={() => {
                  setVersion(version + 1);
                  setNotice("本地演示：已生成示例路径新版本，未调用 AI。");
                }}
              >
                重新规划
              </Button>
            </div>
          </div>
          <section className="student-learning-v2-path-course-context">
            <div>
              <span>课程范围</span>
              <strong>大数据分析</strong>
              <p>
                路径依据当前课程的整体学习情况生成，资源推荐来自该课程知识点绑定的
                B站、YouTube、CSDN 与教师资源。
              </p>
            </div>
            <label className="student-learning-v2-path-course-select">
              <span>切换课程</span>
              <select>
                <option>大数据分析</option>
              </select>
            </label>
          </section>
          <section className="student-learning-v2-path-manual-goal">
            <div>
              <strong>按目标规划</strong>
              <p>输入本阶段想完成的学习目标，系统会生成一个新的路径版本。</p>
            </div>
            <form
              className="student-learning-v2-path-manual-form"
              onSubmit={(e) => {
                e.preventDefault();
                setVersion(version + 1);
                setNotice(
                  "本地目标已保存：" +
                    goal +
                    "。当前路径使用固定样例，尚未接入推荐服务。",
                );
              }}
            >
              <input
                maxLength={80}
                placeholder="例如：两周内补齐 Kafka 和 Flink 基础"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <button
                className="student-learning-v2-resource-watch"
                disabled={!goal.trim()}
              >
                生成目标路径
              </button>
            </form>
          </section>
          <div className="student-learning-v2-path-meta">
            {[
              ["路径版本", "v" + version],
              ["版本状态", "当前生效"],
              ["生成来源", "诊断生成"],
              ["诊断依据", "部分证据 · 49.38%"],
              ["课程", "course_big_data"],
              ["生成时间", "6/30 16:37"],
              ["依据报告", "diag_037893100e3d408b90d5ae1c6bc630fa"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="student-learning-v2-path-basis">
            <strong>生成依据</strong>
            <p>根据诊断报告 diag_037893100e3d408b90d5ae1c6bc630fa 生成</p>
            <p>
              正式路径节点必须来自已发布课程图谱；无法映射的内容进入
              supplemental_items。
            </p>
          </div>
          <div className="student-learning-v2-path-controls">
            <label>
              <input
                type="radio"
                name="sort"
                checked={order === "priority"}
                onChange={() => setOrder("priority")}
              />{" "}
              按优先级排序
            </label>
            <label>
              <input
                type="radio"
                name="sort"
                checked={order === "mastery"}
                onChange={() => setOrder("mastery")}
              />{" "}
              按掌握度排序
            </label>
          </div>
          <div className="student-learning-v2-path-nodes">
            <div className="student-learning-v2-path-nodes-header">
              <strong>推荐学习路径（4 个知识点）</strong>
            </div>
            <div className="student-learning-v2-path-node-list">
              {[...nodes]
                .sort((a, b) =>
                  order === "mastery"
                    ? parseFloat(a.mastery.replace("掌握度 ", "")) -
                      parseFloat(b.mastery.replace("掌握度 ", ""))
                    : 0,
                )
                .map((n, i) => (
                  <article
                    className="student-learning-v2-path-node-item"
                    key={n.title}
                  >
                    <div className="student-learning-v2-path-node-rank">
                      {i + 1}
                    </div>
                    <div className="student-learning-v2-path-node-content">
                      <div className="student-learning-v2-path-node-title">
                        {n.title}
                      </div>
                      <div className="student-learning-v2-path-node-meta">
                        <span>{n.mastery}</span>
                        <span>优先级 -</span>
                        <span>来源 已发布课程图谱</span>
                        <span>证据 部分证据</span>
                        <span className="student-learning-v2-path-status is-pending">
                          {status[n.title] || "待学习"}
                        </span>
                      </div>
                      <div className="student-learning-v2-path-node-basis">
                        <span>review_resource、path_review</span>
                      </div>
                      <div className="student-learning-v2-path-node-resources">
                        {n.resources.map((r) => (
                          <article
                            className={
                              "student-learning-v2-resource-card " +
                              (r.kind.includes("视频") ? "is-previewable" : "")
                            }
                            key={r.title}
                          >
                            <div className="student-learning-v2-resource-card-top">
                              <span className="student-learning-v2-resource-kind">
                                {r.kind}
                              </span>
                              <span className="student-learning-v2-resource-score">
                                {r.score}
                              </span>
                            </div>
                            <h4>{r.title}</h4>
                            <p className="student-learning-v2-resource-reason">
                              {r.reason}
                            </p>
                            <div className="student-learning-v2-resource-actions">
                              {r.kind.includes("视频") ? (
                                <button
                                  type="button"
                                  className="student-learning-v2-resource-watch"
                                  onClick={() =>
                                    window.open(
                                      r.url,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  观看视频
                                </button>
                              ) : (
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  打开原链接
                                </a>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                      <div className="student-learning-v2-path-node-actions">
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            setStatus({ ...status, [n.title]: "学习中" });
                            window.location.assign(
                              "/student/course-content?node=" +
                                encodeURIComponent(n.title),
                            );
                          }}
                        >
                          开始学习
                        </button>
                        <button
                          className="student-learning-v2-resource-watch"
                          onClick={() =>
                            setStatus({ ...status, [n.title]: "已完成" })
                          }
                        >
                          标记完成
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          </div>
          <div className="student-learning-v2-path-supplemental">
            <div className="student-learning-v2-path-nodes-header">
              <strong>补充学习项（4 个）</strong>
            </div>
            <div className="student-learning-v2-supplemental-list">
              {supplemental.map((r) => (
                <article
                  className="student-learning-v2-supplemental-item"
                  key={r.title}
                >
                  <div className="student-learning-v2-supplemental-main">
                    <span className="student-learning-v2-resource-kind">
                      推荐资源
                    </span>
                    <h4>{r.title}</h4>
                    <p>{r.reason}</p>
                  </div>
                  <div className="student-learning-v2-path-node-resources">
                    <article
                      className={
                        "student-learning-v2-resource-card " +
                        (r.video ? "is-previewable" : "")
                      }
                    >
                      <div className="student-learning-v2-resource-card-top">
                        <span className="student-learning-v2-resource-kind">
                          {r.kind}
                        </span>
                        <span className="student-learning-v2-resource-score">
                          {r.score}
                        </span>
                      </div>
                      <h4>{r.title}</h4>
                      <div className="student-learning-v2-resource-actions">
                        {r.video ? (
                          <button
                            type="button"
                            className="student-learning-v2-resource-watch"
                            onClick={() =>
                              window.open(
                                r.url,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            观看视频
                          </button>
                        ) : (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开资源
                          </a>
                        )}
                      </div>
                    </article>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SourcePage>
  );
}
