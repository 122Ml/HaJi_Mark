import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SourcePage, Link, Button, Notice, useLocalState, Modal } from "../ui";
import { assignments, chapters, knowledge } from "../demo";

import tree from "./course-tree.json";
export function CoursePage() {
  const [query] = useSearchParams();
  const [selected, setSelected] = useState(
    query.get("node") || query.get("title") || "",
  );
  const [chapter, setChapter] = useState(0);
  const [section, setSection] = useState(0);
  const [resource, setResource] = useState("慕课");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>(
    [],
  );
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState("");
  const [favorites, setFavorites] = useLocalState<string[]>("favorites", []);
  const [notes, setNotes] = useLocalState<Record<string, string>>(
    "learningNotes",
    {},
  );
  const [, setVisited] = useLocalState<string[]>("resources", []);
  const navigate = useNavigate();
  return (
    <SourcePage name="page-course-content">
      <div className="course-shell">
        <div className="student-learning-v2-header">
          <div>
            <h1>📚 学习中心</h1>
            <p className="student-learning-v2-desc">
              按知识点查看教师绑定的 B站、YouTube、CSDN 与课程资料
            </p>
          </div>
        </div>
        <section className="student-learning-v2-course-context">
          <div className="student-learning-v2-course-copy">
            <span className="course-context-label">当前课程</span>
            <h2>大数据分析</h2>
            <p>ai_education_showcase_20260629 演示课程节点补充。</p>
          </div>
          <div className="student-learning-v2-course-actions">
            <label
              className="course-select-label"
              htmlFor="student-course-select"
            >
              课程
            </label>
            <select
              id="student-course-select"
              className="student-learning-v2-course-select"
            >
              <option>大数据分析</option>
            </select>
            <div className="course-context-stats">
              <span>知识点 243</span>
              <span>资源 1228</span>
            </div>
          </div>
        </section>
        {notice && <Notice>{notice}</Notice>}
        <section className="student-learning-v2-layout">
          <aside className="student-learning-v2-left-panel">
            <div className="student-learning-v2-toc-header">
              <h2>课程目录</h2>
              <span className="muted">按章节浏览知识点</span>
            </div>
            <ul className="toc-root">
              {chapters.map((title, i) => (
                <li className="toc-chapter" key={title}>
                  <button
                    type="button"
                    className="toc-chapter-btn"
                    onClick={() => setChapter(chapter === i ? -1 : i)}
                  >
                    <span className="toc-arrow">
                      {chapter === i ? "▾" : "▸"}
                    </span>
                    <span>{title}</span>
                  </button>
                  {chapter === i && (
                    <ul className="toc-section-list">
                      {tree[i].map((s, j) => (
                        <li className="toc-section" key={s.title}>
                          <button
                            type="button"
                            className="toc-item group"
                            onClick={() => {
                              setSection(section === j ? -1 : j);
                              if (!s.points.length) setSelected(s.title);
                            }}
                          >
                            <span className="toc-arrow">
                              {section === j ? "▾" : "▸"}
                            </span>
                            <span className="toc-item-text">{s.title}</span>
                            <span className="toc-resource-badge muted">
                              {s.badge}
                            </span>
                          </button>
                          {section === j && (
                            <ul className="toc-knowledge-list">
                              {s.points.map((k) => (
                                <li key={k}>
                                  <button
                                    type="button"
                                    className={`toc-subitem ${selected === k ? "active" : ""}`}
                                    onClick={() => setSelected(k)}
                                  >
                                    <span className="toc-item-text">{k}</span>
                                    <span className="toc-resource-badge">
                                      慕课 / B站 / YouTube / 文档 / CSDN
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </aside>
          <section className="student-learning-v2-center-panel">
            {!selected ? (
              <div className="student-learning-v2-welcome">
                <div className="student-learning-v2-welcome-icon">📖</div>
                <h2>选择一个章节开始学习</h2>
                <p>
                  左侧目录用于浏览课程知识点，中间区域展示资源，右侧可以直接和
                  AI 助教对话。
                </p>
                <div className="student-learning-v2-homework-section">
                  <div className="student-learning-v2-section-title">
                    <strong>本课程作业</strong>
                    <Button small onClick={() => navigate("/student/homework")}>
                      查看全部
                    </Button>
                  </div>
                  <ul className="student-learning-v2-homework-list">
                    {[...assignments].reverse().map((a) => (
                      <li
                        className="student-learning-v2-homework-item"
                        key={a.id}
                      >
                        <div>
                          <strong>{a.title}</strong>
                          <div className="muted">
                            mixed · 章节 {a.chapter} · 截止 {a.deadline}
                          </div>
                        </div>
                        <Button
                          small
                          onClick={() => navigate("/student/homework/" + a.id)}
                        >
                          去提交
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div>
                <div className="student-learning-v2-content-header">
                  <div className="student-learning-v2-breadcrumb">
                    <span>大数据分析</span>
                    <span className="sep">›</span>
                    <span>
                      {chapters[Math.max(chapter, 0)]} /{" "}
                      {tree[Math.max(chapter, 0)][Math.max(section, 0)]?.title}
                    </span>
                    <span className="sep">›</span>
                    <span className="current">{selected}</span>
                  </div>
                  <div className="student-learning-v2-content-tools">
                    <button
                      className="student-learning-v2-tool-btn"
                      title="上一个知识点"
                      disabled={knowledge.indexOf(selected) <= 0}
                      onClick={() =>
                        setSelected(
                          knowledge[
                            Math.max(0, knowledge.indexOf(selected) - 1)
                          ],
                        )
                      }
                    >
                      ◀
                    </button>
                    <button
                      className="student-learning-v2-tool-btn"
                      title="下一个知识点"
                      onClick={() =>
                        setSelected(
                          knowledge[
                            (knowledge.indexOf(selected) + 1) % knowledge.length
                          ],
                        )
                      }
                    >
                      ▶
                    </button>
                    <button
                      className="student-learning-v2-tool-btn"
                      title="收藏当前知识点"
                      onClick={() =>
                        setFavorites((prev) =>
                          prev.includes(selected)
                            ? prev.filter((k) => k !== selected)
                            : [...prev, selected],
                        )
                      }
                    >
                      {favorites.includes(selected) ? "★" : "☆"}
                    </button>
                    <button
                      className="student-learning-v2-tool-btn"
                      title="学习笔记"
                      onClick={() => setPreview("学习笔记")}
                    >
                      📝
                    </button>
                  </div>
                </div>
                <div className="student-learning-v2-viewer-tabs">
                  {[
                    "慕课",
                    "B站",
                    "YouTube",
                    "文档",
                    "CSDN",
                    "📝 在线测验",
                    "📋 知识总结",
                  ].map((r) => (
                    <button
                      className={
                        "student-learning-v2-viewer-tab " +
                        (resource === r ? "active" : "")
                      }
                      key={r}
                      onClick={() => setResource(r)}
                    >
                      {r}
                      {!r.includes(" ") && (
                        <span className="student-learning-v2-viewer-tab-count">
                          {r === "CSDN" ? 2 : 1}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="student-learning-v2-viewer-panel">
                  <div className="student-learning-v2-resource-category-panel">
                    {resource.includes("测验") ? (
                      <article className="student-learning-v2-resource-display-card">
                        <h3>{selected} · 在线测验</h3>
                        <p>通过练习验证理解，为后续诊断补充直接证据。</p>
                        <Link
                          className="primary-link"
                          to={
                            "/student/quiz?topic=" +
                            encodeURIComponent(selected)
                          }
                        >
                          开始测验
                        </Link>
                      </article>
                    ) : resource.includes("总结") ? (
                      <article className="student-learning-v2-resource-display-card">
                        <h3>{selected} · 知识总结</h3>
                        <p>
                          本地示例：围绕定义、关键步骤、实际应用与注意事项梳理当前知识点。此总结未调用模型，不代替课程原始资料。
                        </p>
                        <Button onClick={() => setPreview("学习笔记")}>
                          记录我的总结
                        </Button>
                      </article>
                    ) : (
                      <article className="student-learning-v2-resource-display-card embedded">
                        <div className="student-learning-v2-resource-display-head">
                          <div>
                            <span className="student-learning-v2-bound-provider">
                              {resource}
                            </span>
                            <h3>
                              {resource}：{selected}
                            </h3>
                          </div>
                          <span className="student-learning-v2-bound-kind">
                            {["慕课", "B站", "YouTube"].includes(resource)
                              ? "内嵌"
                              : "资料"}
                          </span>
                        </div>
                        {["慕课", "B站", "YouTube"].includes(resource) ? (
                          <div className="tracked-resource-frame">
                            <div className="tracked-resource-frame__stage student-learning-v2-video-embed">
                              <video
                                className="tracked-resource-frame__video"
                                controls
                                playsInline
                                preload="none"
                                title={resource + "：" + selected}
                              />
                            </div>
                            <div className="tracked-resource-frame__evidence">
                              <span>
                                {resource}
                                ：远站媒体尚未离线保存，可打开原站资源。
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="list-card" style={{ minHeight: 320 }}>
                            <h3>{selected}</h3>
                            <p>当前知识点的课程资料与补充阅读。</p>
                            <p>
                              学习时请记录定义、流程与案例之间的关系，并在测验或作业中验证理解。
                            </p>
                            <p className="muted">
                              本地内容预览为演示摘要，完整内容请打开资源原站。
                            </p>
                          </div>
                        )}
                        <div className="student-learning-v2-bound-actions">
                          <a
                            href={
                              resource === "B站"
                                ? "https://search.bilibili.com/all?keyword=" +
                                  encodeURIComponent(selected)
                                : resource === "YouTube"
                                  ? "https://www.youtube.com/results?search_query=" +
                                    encodeURIComponent(selected)
                                  : resource === "CSDN"
                                    ? "https://so.csdn.net/so/search?q=" +
                                      encodeURIComponent(selected)
                                    : "https://www.icourse163.org/"
                            }
                            rel="noopener noreferrer"
                            target="_blank"
                            onClick={() =>
                              setVisited((prev) =>
                                prev.includes(selected)
                                  ? prev
                                  : [...prev, selected],
                              )
                            }
                          >
                            打开资源
                          </a>
                        </div>
                      </article>
                    )}
                  </div>
                </div>
                <div className="student-learning-v2-content-footer">
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const blob = new Blob(
                        [notes[selected] || "尚无学习笔记"],
                        { type: "text/markdown;charset=utf-8" },
                      );
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = selected + "-学习笔记.md";
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    📤 导出笔记
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setVisited((prev) =>
                        prev.includes(selected) ? prev : [...prev, selected],
                      );
                      setNotice(
                        "本地演示：已记录学习完成，学习状态不等于掌握度或正式成绩。",
                      );
                    }}
                  >
                    ✅ 标记完成
                  </button>
                </div>
              </div>
            )}
          </section>
          <aside className="student-learning-v2-right-panel">
            <div className="fivee-chat">
              <div className="fivee-chat-head">
                <div>
                  <strong>{selected || "5E AI 助教"}</strong>
                  <p>
                    {selected
                      ? "围绕当前知识点进行 5E 学习引导"
                      : "正在获取当前学生信息..."}
                  </p>
                </div>
              </div>
              <div className="fivee-chat-scroll">
                <article className="fivee-chat-bubble assistant">
                  <div className="fivee-chat-role">5E 助教</div>
                  <div className="fivee-chat-text">
                    <p>
                      {selected
                        ? "本地演示助教。可记录问题并展示课程资料引导，尚未接入真实 AI。"
                        : "登录并选择课程后即可使用 5E AI 助教。"}
                    </p>
                  </div>
                </article>
                {messages.map((m, i) => (
                  <article key={i} className={"fivee-chat-bubble " + m.role}>
                    <div className="fivee-chat-role">
                      {m.role === "assistant" ? "5E 助教" : "我"}
                    </div>
                    <div className="fivee-chat-text">
                      <p>{m.text}</p>
                    </div>
                  </article>
                ))}
              </div>
              <footer className="fivee-chat-footer">
                <textarea
                  rows={3}
                  placeholder="输入你的问题..."
                  disabled={!selected}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button
                  className="fivee-send-btn"
                  disabled={!selected || !question.trim()}
                  onClick={() => {
                    setMessages([
                      ...messages,
                      { role: "user", text: question },
                      {
                        role: "assistant",
                        text:
                          "本地演示：请先阅读“" +
                          selected +
                          "”的课程资料，再结合定义、关键步骤和应用示例组织答案。此内容不是模型生成的正式解答。",
                      },
                    ]);
                    setQuestion("");
                  }}
                >
                  发送
                </button>
              </footer>
            </div>
          </aside>
        </section>
      </div>
      {preview && (
        <Modal title={preview} onClose={() => setPreview("")}>
          <label>
            <span>{selected} · 学习思路与疑问</span>
            <textarea
              rows={12}
              value={notes[selected] || ""}
              onChange={(e) =>
                setNotes({ ...notes, [selected]: e.target.value })
              }
              placeholder="记录定义、关键步骤、应用案例或尚未理解的问题"
            />
          </label>
          <p className="muted">
            笔记自动保存在本机浏览器，可使用“导出笔记”下载。
          </p>
        </Modal>
      )}
    </SourcePage>
  );
}
