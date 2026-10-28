import { useState } from "react";
import {
  Button,
  Field,
  Link,
  Modal,
  Notice,
  SourcePage,
  useLocalState,
} from "../ui";
import content from "./course-content.json";

interface Course {
  id: string;
  name: string;
  status: string;
}
interface Node {
  title: string;
  depth: number;
  description?: string;
  resources: { title: string; url: string }[];
}
interface Mapping {
  ability: string;
  node: string;
  status: string;
  reason: string;
}
const initialCourses: Course[] = [
  { id: "course_big_data", name: "大数据分析", status: "published" },
  {
    id: "course_demo_20261008_resources",
    name: "数据工程入门（演示草稿）",
    status: "draft",
  },
];
export const initialMappings: Mapping[] = [
  "数据采集与接入实现",
  "数据清洗与质量评估",
  "批处理指标开发",
  "业务报表解读与表达",
  "数据处理",
]
  .flatMap((ability, i) => [
    {
      ability,
      node: [
        "Kafka 数据接入",
        "日志数据清洗",
        "数据质量评估",
        "大数据生命周期",
        "数据采集流程",
      ][i],
      status: "confirmed",
      reason: "课程底座已发布，教师确认该叶子知识点支撑岗位能力达成。",
    },
    {
      ability,
      node: [
        "数据采集流程",
        "缺失值处理",
        "MapReduce计算模型",
        "数据可视化",
        "数据集成",
      ][i],
      status: "confirmed",
      reason: "教师审核确认课程支撑关系。",
    },
  ])
  .concat([
    {
      ability: "数据处理",
      node: "大数据驱动因素",
      status: "pending",
      reason: "系统候选，等待教师核查。",
    },
  ]);
export function CourseTwin() {
  const [courses, setCourses] = useLocalState("courses", initialCourses);
  const [selected, setSelected] = useState(courses[0].id);
  const course = courses.find((c) => c.id === selected) || courses[0];
  const [nodes, setNodes] = useLocalState<Node[]>(
    "course-nodes",
    content.graph,
  );
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [disabled, setDisabled] = useLocalState<number[]>(
    "disabled-resources",
    [],
  );
  const [filter, setFilter] = useState("全部");
  const [notice, setNotice] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState("");
  const [resourceURL, setResourceURL] = useState("");
  const [resourceNode, setResourceNode] = useState("大数据生命周期");
  const [manual, setManual] = useLocalState<
    {
      node: string;
      url: string;
      title: string;
      meta: string[];
      enabled: boolean;
    }[]
  >("manual-resources", []);
  const [quizNode, setQuizNode] = useState("大数据生命周期");
  const [quizTitle, setQuizTitle] = useState("大数据生命周期 小测");
  const [questions, setQuestions] = useLocalState("course-quiz-questions", [
    {
      text: "题干与选项，例如：\n以下关于 Kafka Topic 的说法正确的是？\nA. 只能有一个分区\nB. 可以按分区并行消费\nC. 不支持持久化消息\nD. 必须单机部署",
      answer: "A",
    },
  ]);
  const [quizStatus, setQuizStatus] = useLocalState(
    "course-quiz-status",
    "published",
  );
  const [mappings, setMappings] = useLocalState(
    "ability-mappings",
    initialMappings,
  );
  const [ability, setAbility] = useState("");
  const [mappingNode, setMappingNode] = useState("大数据生命周期");
  const [reason, setReason] = useState("");
  const [position, setPosition] = useState("大数据工程师");
  const [importText, setImportText] = useState("");
  const enabled = content.resources.length - disabled.length + manual.length;
  const resources = [...content.resources, ...manual];
  const numbering: number[] = [];
  const nodeNumbers = nodes.map((n) => {
    numbering[n.depth] = (numbering[n.depth] || 0) + 1;
    numbering.length = n.depth + 1;
    return numbering.join(".");
  });
  const saveCourse = (field: "id" | "name", value: string) =>
    setCourses(
      courses.map((c) => (c.id === selected ? { ...c, [field]: value } : c)),
    );
  const childrenHidden = (i: number) =>
    collapsed.some(
      (parent) =>
        parent < i &&
        nodes[parent].depth < nodes[i].depth &&
        !nodes.slice(parent + 1, i).some((n) => n.depth <= nodes[parent].depth),
    );
  const updateNode = (i: number, title: string) =>
    setNodes(nodes.map((n, j) => (i === j ? { ...n, title } : n)));
  const addNode = (i: number) => {
    const next = [...nodes];
    next.splice(i + 1, 0, {
      title: "新知识点",
      depth: Math.min(nodes[i].depth + 1, 2),
      resources: [],
    });
    setNodes(next);
  };
  return (
    <SourcePage name="TeacherCourseTwinView">
      <div className="teacher-course-twin-shell">
        <section className="hero-panel app-hero app-hero--teacher">
          <div className="app-hero-copy">
            <p className="eyebrow">课程数字孪生</p>
            <h1>课程底座建设台</h1>
            <p className="hero-desc">
              教师录入课程大纲后生成初始知识图谱，系统按叶子知识点绑定资源候选，审核通过后发布给学生端和诊断链路使用。
            </p>
            <label className="current-course-picker">
              <span>当前课程</span>
              <select
                className="input"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.status === "published" ? "已发布" : "草稿"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="app-hero-actions course-twin-hero-actions">
            <Button onClick={() => setNewOpen(true)}>新建课程</Button>
            <Button onClick={() => setNotice("本地课程状态已刷新")}>
              刷新
            </Button>
            <button
              className="primary-btn"
              onClick={() => {
                setCourses(
                  courses.map((c) =>
                    c.id === selected ? { ...c, status: "published" } : c,
                  ),
                );
                setNotice(
                  "课程底座已在本地演示中发布；未写入参考站或业务后端。",
                );
              }}
            >
              发布课程底座
            </button>
          </div>
        </section>
        {notice && <Notice>{notice}</Notice>}
        <section className="course-publish-flow card-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Publish Boundary</p>
              <h3>课程底座发布前检查</h3>
            </div>
            <span className="status-pill">
              {course.status === "published"
                ? "已发布，学生端可用"
                : "草稿，学生端不可见"}
            </span>
          </div>
          <div className="course-publish-steps">
            {[
              ["课程结构", `${nodes.length + 3} 个节点，159 个叶子知识点`],
              ["资源候选", `${enabled} 个资源已启用，可支撑学习中心`],
              ["测验定义", "140 个节点测验已发布"],
              [
                "能力映射",
                `${mappings.filter((m) => m.status === "confirmed").length} 条能力映射已确认`,
              ],
              [
                "教师审核",
                `${mappings.filter((m) => m.status === "pending").length} 条能力映射仍待审核`,
              ],
              [
                "发布生效",
                course.status === "published"
                  ? "已进入学生端、诊断链路和个性化路径"
                  : "保存并审核后发布",
              ],
            ].map((s, i) => (
              <article
                key={s[0]}
                className={`course-publish-step ${i === 4 ? "is-pending" : "is-done"}`}
              >
                <span>0{i + 1}</span>
                <div>
                  <strong>{s[0]}</strong>
                  <p>{s[1]}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="course-publish-boundary">
            <strong>生效边界</strong>
            <span>
              新建课程先保存草稿，再审核资源，最后发布。待审核和已禁用资源学生不可见；已发布课程的启用/禁用操作立即影响学生端。
            </span>
          </div>
        </section>
        <section className="course-twin-grid">
          <article className="card-panel course-twin-builder">
            <SectionHead
              eyebrow="Initial Graph"
              title="教师生成初始知识图谱"
              extra={<span className="status-pill">已保存课程</span>}
            />
            <div className="form-grid">
              <Field label="课程 ID">
                <input className="input" value={course.id} readOnly />
              </Field>
              <Field label="课程名称">
                <input
                  className="input"
                  value={course.name}
                  onChange={(e) => saveCourse("name", e.target.value)}
                />
              </Field>
            </div>
            <div className="tree-editor">
              <div className="tree-editor-head">
                <div>
                  <span className="field-label">课程结构</span>
                  <p>
                    按章节、小节、知识点维护课程树；资源候选只会绑定到叶子知识点。
                  </p>
                </div>
                <button
                  className="tree-add-root"
                  onClick={() =>
                    setNodes([
                      ...nodes,
                      { title: "新章节", depth: 0, resources: [] },
                    ])
                  }
                >
                  ＋ 添加章节
                </button>
              </div>
              <div className="course-tree-form">
                {nodes.map((n, i) =>
                  childrenHidden(i) ? null : (
                    <div
                      className={`tree-node ${n.depth === 0 ? "tree-node--chapter" : n.depth === 1 ? "tree-node--section" : ""}`}
                      key={i}
                      style={{ marginLeft: Math.min(n.depth, 2) * 52 }}
                    >
                      <div
                        className={
                          n.depth >= 2
                            ? "tree-node--leaf"
                            : `tree-row tree-row--${n.depth === 0 ? "chapter" : "section"}`
                        }
                      >
                        {n.depth >= 2 ? (
                          <span className="tree-leaf-rail" />
                        ) : (
                          <button
                            className="tree-toggle"
                            aria-label={`展开或收起${n.title}`}
                            onClick={() =>
                              setCollapsed(
                                collapsed.includes(i)
                                  ? collapsed.filter((x) => x !== i)
                                  : [...collapsed, i],
                              )
                            }
                          >
                            {collapsed.includes(i) ? "›" : "⌄"}
                          </button>
                        )}
                        <span
                          className={`tree-type tree-type--${n.depth === 0 ? "chapter" : n.depth === 1 ? "section" : "point"}`}
                        >
                          {n.depth === 0 ? "章" : n.depth === 1 ? "节" : "点"}
                        </span>
                        <span className="tree-index">
                          {n.depth === 0
                            ? `第 ${nodes.slice(0, i + 1).filter((x) => x.depth === 0).length} 章`
                            : n.depth === 1
                              ? nodeNumbers[i]
                              : nodeNumbers[i]}
                        </span>
                        <input
                          aria-label={`编辑节点 ${n.title}`}
                          className="tree-input"
                          value={n.title}
                          onChange={(e) => updateNode(i, e.target.value)}
                        />
                        <div className="tree-actions">
                          {n.depth < 2 && (
                            <button
                              className="tree-icon-btn"
                              aria-label={`添加${n.title}的子节点`}
                              onClick={() => addNode(i)}
                            >
                              ＋
                            </button>
                          )}
                          <button
                            className="tree-icon-btn danger"
                            aria-label={`删除${n.title}`}
                            onClick={() => {
                              if (confirm("删除此本地课程节点？")) {
                                const next = nodes.findIndex(
                                  (x, j) => j > i && x.depth <= n.depth,
                                );
                                setNodes(
                                  nodes.filter(
                                    (_, j) =>
                                      j < i ||
                                      j >= (next < 0 ? nodes.length : next),
                                  ),
                                );
                              }
                            }}
                          >
                            ♧
                          </button>
                        </div>
                        {n.depth >= 2 && (
                          <input
                            aria-label={`${n.title}说明`}
                            className="tree-input point-description"
                            placeholder="学习目标或知识点说明"
                            value={n.description ?? "学习目标和知识点说明"}
                            onChange={(e) =>
                              setNodes(
                                nodes.map((x, j) =>
                                  j === i
                                    ? { ...x, description: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="builder-options">
              <label className="checkbox-row">
                <input type="checkbox" defaultChecked />
                生成后同时绑定资源候选
              </label>
              <label className="compact-field">
                每个叶子知识点
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="10"
                  defaultValue="2"
                />
              </label>
            </div>
            <div className="action-row">
              <button
                className="primary-btn"
                onClick={() => setNotice("课程结构已保存在当前浏览器。")}
              >
                保存课程结构
              </button>
              <Button
                onClick={() =>
                  setNotice("本地样例资源候选已绑定；未执行网络搜索。")
                }
              >
                绑定资源候选
              </Button>
            </div>
            <p className="muted">
              当前操作对象：{course.name}
              。保存会更新当前课程；已发布课程立即生效。创建另一门课程请点击“新建课程”。
            </p>
          </article>
          <article className="card-panel course-twin-side">
            <SectionHead eyebrow="Course Base" title="课程状态" />
            <div className="course-list">
              {courses.map((c) => (
                <button
                  className={`course-row ${selected === c.id ? "active" : ""}`}
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.id}</small>
                  </span>
                  <em>{c.status}</em>
                </button>
              ))}
            </div>
            <div className="summary-grid">
              {[
                ["节点", nodes.length + 3],
                ["叶子", 159],
                ["资源", resources.length],
                ["启用", enabled],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <strong>{x[1]}</strong>
                </div>
              ))}
            </div>
          </article>
        </section>
        <section className="course-twin-grid lower">
          <article className="card-panel">
            <SectionHead eyebrow="Graph Preview" title="知识图谱预览" />
            <div className="graph-tree">
              {nodes.map((n, i) => (
                <div
                  key={i}
                  className="graph-node-line"
                  style={{ marginLeft: n.depth * 14 }}
                >
                  <strong>{n.title}</strong>
                  <details className="graph-node-resources">
                    <summary>
                      {n.resources.length || 4} 个绑定资源（点击查看）
                    </summary>
                    {n.resources.map((r) => (
                      <div className="graph-resource-item" key={r.url}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                        <span>已启用</span>
                        <small>{r.url}</small>
                      </div>
                    ))}
                  </details>
                </div>
              ))}
            </div>
          </article>
          <article className="card-panel">
            <SectionHead
              eyebrow="Resource Review"
              title="资源绑定审核"
              extra={
                <Button small onClick={() => setNotice("本地资源已刷新")}>
                  刷新资源
                </Button>
              }
            />
            <div className="resource-review-toolbar">
              <div className="resource-filter-tabs">
                {["待审核", "已启用", "已禁用", "全部"].map((f) => (
                  <button
                    key={f}
                    className={`resource-filter-tab ${f === filter ? "active" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f}{" "}
                    {f === "待审核"
                      ? 0
                      : f === "已禁用"
                        ? disabled.length
                        : enabled}
                  </button>
                ))}
              </div>
              <Button
                small
                onClick={() => {
                  setDisabled([]);
                  setNotice("本地资源已批量启用");
                }}
              >
                批量审核通过并启用
              </Button>
            </div>
            <p className="muted">
              待审核、已禁用资源学生不可见。为打开当前的外链，浏览器可能要求登录。
            </p>
            <form
              className="manual-resource-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !resourceURL.startsWith("https://") &&
                  !resourceURL.startsWith("http://")
                ) {
                  setNotice("请输入 http 或 https 资源链接");
                  return;
                }
                setManual([
                  ...manual,
                  {
                    node: resourceNode,
                    url: resourceURL,
                    title: new URL(resourceURL).host,
                    meta: ["教师资源"],
                    enabled: true,
                  },
                ]);
                setResourceURL("");
                setNotice("资源已加入本地资源列表");
              }}
            >
              <label>
                手动补充资源 · 叶子知识点
                <select
                  className="input"
                  value={resourceNode}
                  onChange={(e) => setResourceNode(e.target.value)}
                >
                  {nodes
                    .filter((n) => n.depth >= 2)
                    .map((n, i) => (
                      <option key={i}>{n.title}</option>
                    ))}
                </select>
              </label>
              <label>
                具体视频、文章、文档链接或已上传资料路径
                <input
                  className="input"
                  placeholder="https://... 或 data/Book/1.PDF"
                  value={resourceURL}
                  onChange={(e) => setResourceURL(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={!resourceURL}>
                添加到审核列表
              </Button>
            </form>
            <div className="resource-review-list">
              {resources.map((r, i) =>
                filter === "待审核" ||
                (filter === "已禁用" && !disabled.includes(i)) ||
                (filter === "已启用" && disabled.includes(i)) ? null : (
                  <div className="resource-review-row" key={i}>
                    <div>
                      <strong>{r.node}</strong>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        <span>{r.title}</span>
                      )}
                      <small>{r.url}</small>
                      <span>
                        外部资源 · {disabled.includes(i) ? "已禁用" : "已启用"}{" "}
                        · 质量通过
                      </span>
                    </div>
                    <div className="resource-actions">
                      <Button
                        small
                        disabled={!disabled.includes(i)}
                        onClick={() =>
                          setDisabled(disabled.filter((x) => x !== i))
                        }
                      >
                        启用
                      </Button>
                      <Button
                        small
                        className="danger"
                        disabled={disabled.includes(i)}
                        onClick={() => setDisabled([...disabled, i])}
                      >
                        禁用
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </article>
        </section>
        <section className="course-quiz-panel card-panel">
          <SectionHead
            eyebrow="Quiz Definition"
            title="节点测验定义"
            extra={
              <Button small onClick={() => setNotice("节点测验定义已刷新")}>
                刷新测验
              </Button>
            }
          />
          <div className="quiz-definition-layout">
            <div className="quiz-definition-editor">
              <div className="form-grid">
                <Field label="课程节点">
                  <select
                    className="input"
                    value={quizNode}
                    onChange={(e) => {
                      setQuizNode(e.target.value);
                      setQuizTitle(e.target.value + " 小测");
                    }}
                  >
                    {nodes
                      .filter((n) => n.depth >= 2)
                      .map((n, i) => (
                        <option key={i}>{n.title}</option>
                      ))}
                  </select>
                </Field>
                <Field label="测验标题">
                  <input
                    className="input"
                    value={quizTitle}
                    onChange={(e) => setQuizTitle(e.target.value)}
                  />
                </Field>
              </div>
              <div className="quiz-question-list">
                {questions.map((q, i) => (
                  <div className="quiz-question-row" key={i}>
                    <div className="quiz-question-head">
                      <strong>题目 {i + 1}</strong>
                      <Button
                        small
                        className="danger"
                        onClick={() =>
                          setQuestions(questions.filter((_, j) => i !== j))
                        }
                      >
                        删除
                      </Button>
                    </div>
                    <textarea
                      className="input quiz-question-textarea"
                      value={q.text}
                      onChange={(e) =>
                        setQuestions(
                          questions.map((x, j) =>
                            i === j ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <div className="quiz-answer-row">
                      <label>
                        正确答案
                        <select
                          className="input"
                          value={q.answer}
                          onChange={(e) =>
                            setQuestions(
                              questions.map((x, j) =>
                                i === j ? { ...x, answer: e.target.value } : x,
                              ),
                            )
                          }
                        >
                          {["A", "B", "C", "D"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="action-row">
                <Button
                  small
                  onClick={() =>
                    setQuestions([...questions, { text: "", answer: "A" }])
                  }
                >
                  添加题目
                </Button>
                <button
                  className="primary-btn small"
                  onClick={() => {
                    setQuizStatus("draft");
                    setNotice("节点测验草稿已保存（本地）");
                  }}
                >
                  保存草稿
                </button>
                <button
                  className="primary-btn small"
                  onClick={() => {
                    if (
                      questions.length === 0 ||
                      questions.some((q) => !q.text.trim())
                    ) {
                      setNotice("请先填写至少一道完整题目");
                      return;
                    }
                    setQuizStatus("published");
                    setNotice("节点测验已在本地发布");
                  }}
                >
                  保存并发布
                </button>
              </div>
            </div>
            <div className="quiz-definition-list">
              <article className="quiz-definition-card">
                <div>
                  <strong>{quizTitle}</strong>
                  <span>
                    {quizStatus === "published" ? "已发布" : "草稿"} · 0.1 · v1
                  </span>
                  <small>发布于 2026-10-28T15:05:33</small>
                </div>
                <Button small onClick={() => setNotice("可在左侧编辑当前测验")}>
                  编辑
                </Button>
                <Button
                  small
                  onClick={() => {
                    setQuizStatus("draft");
                    setNotice("已复制为本地草稿");
                  }}
                >
                  复制
                </Button>
              </article>
            </div>
          </div>
        </section>
        <section className="course-runtime-panel card-panel">
          <SectionHead
            eyebrow="Runtime Evaluation"
            title="课程运行评估"
            extra={
              <div className="action-row">
                <Link className="ghost-btn small" to="/teacher/homework">
                  管理章节作业
                </Link>
                <Button
                  small
                  onClick={() =>
                    setNotice("已刷新本地演示评估，未运行后台算法")
                  }
                >
                  刷新评估
                </Button>
              </div>
            }
          />
          <p className="muted">
            评估依据课程结构与学习证据。指标没有足够实践测验或没有确认映射时为
            0，不等同于学生能力为 0。
          </p>
          <div className="runtime-layout">
            <div className="runtime-health">
              <span>课程健康度</span>
              <strong>86.5</strong>
              <em>运行健康</em>
              <small>窗口 30 天 · 最低有效样本阈值 10</small>
            </div>
            <div className="runtime-score-grid">
              {[
                ["结构完整", "88.0", "结构层级与知识点完整度"],
                ["资源支撑", "100.0", "资源覆盖与学习有效性"],
                ["测评证据", "100.0", "小测、章节作业与练习证据"],
                ["掌握表现", "79.7", "学生画像与运行中的表现"],
                ["能力支撑", "60.0", "职业能力映射与支撑达成"],
                ["资源覆盖", "100%", "有效资源覆盖率"],
                ["测评覆盖", "100%", "小测与章节作业证据覆盖"],
                ["能力支撑", "60%", "已确认能力映射支撑率"],
              ].map((x, i) => (
                <div className="runtime-score-card" key={i}>
                  <span>{x[0]}</span>
                  <strong>{x[1]}</strong>
                  <small>{x[2]}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="runtime-columns">
            <div className="runtime-block">
              <h4>教师行动项</h4>
              {[
                ["补齐课程结构信息或拆分过粗知识点", "19", "编辑结构"],
                ["补充、替换或审核知识点资源", "486", "处理资源"],
                ["补充知识点小测或章节测评/代码题证据", "8", "补测评"],
                ["复核职业能力支撑关系或补充候选知识点草稿", "2", "处理能力"],
              ].map((x) => (
                <div className="runtime-row" key={x[0]}>
                  <strong>{x[0]}</strong>
                  <span>优先级 高 · 共 {x[1]} 项</span>
                  <Button
                    small
                    onClick={() =>
                      setNotice(`请使用本页对应的${x[2]}区域完成本地编辑。`)
                    }
                  >
                    {x[2]}
                  </Button>
                </div>
              ))}
            </div>
            <div className="runtime-block">
              <h4>资源与测评缺口</h4>
              <span className="muted">暂无直接资源或测评缺口</span>
            </div>
            <div className="runtime-block">
              <h4>运行风险</h4>
              <span className="muted">暂无高风险知识点或章节</span>
            </div>
            <div className="runtime-block">
              <h4>职业能力支撑</h4>
              {[
                "大数据开发工程师 / 业务报表解读与表达",
                "大数据工程师 / 数据处理",
              ].map((x) => (
                <div className="runtime-row" key={x}>
                  <strong>{x}</strong>
                  <span>
                    A_sup -- · 该职业能力没有经教师确认的叶子知识点支撑关系
                  </span>
                  <Button
                    small
                    onClick={() =>
                      setNotice("请在下方职业能力映射区补充并审核映射。")
                    }
                  >
                    补映射
                  </Button>
                  <Button
                    small
                    onClick={() => {
                      setNodes([
                        ...nodes,
                        {
                          title: "能力补充知识点草稿",
                          depth: 2,
                          resources: [],
                        },
                      ]);
                      setNotice("已添加本地知识点草稿，仍需审核与保存");
                    }}
                  >
                    补草稿知识点
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="runtime-evidence-note">
            <strong>数据不足提示</strong>
            重复访问率与学习路径证据：当前数据库未稳定沉淀重复访问次数和路径停留，不能直接计算学习综合达成分数。
          </div>
        </section>
        <section className="course-twin-grid lower">
          <article className="card-panel">
            <SectionHead
              eyebrow="Ability Mapping"
              title="职业能力映射审核"
              extra={
                <div className="action-row">
                  <Button small onClick={() => setNotice("本地映射已刷新")}>
                    刷新映射
                  </Button>
                  <Button
                    small
                    onClick={() => {
                      setMappings([
                        ...mappings,
                        {
                          ability: "数据处理",
                          node: resourceNode,
                          status: "pending",
                          reason: "本地演示候选，待人工核查。",
                        },
                      ]);
                      setNotice("已生成本地固定映射候选；未调用 AI。");
                    }}
                  >
                    生成映射候选
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      setMappings(
                        mappings.map((m) => ({ ...m, status: "confirmed" })),
                      )
                    }
                  >
                    批量确认待审核
                  </Button>
                </div>
              }
            />
            <div className="summary-grid ability-summary-grid">
              {[
                ["岗位方向", 3],
                ["能力候选", 5],
                ["映射关系", mappings.length],
                [
                  "待审核",
                  mappings.filter((m) => m.status === "pending").length,
                ],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <strong>{x[1]}</strong>
                </div>
              ))}
            </div>
            <p className="ability-review-note">
              教师确认后的能力映射才会进入正式课程底座。学生端只读取已确认映射并展示能力达成等级，不展示来源证据和审核过程。
            </p>
            <div className="ability-config-card ability-mapping-create-card">
              <strong>补充能力映射</strong>
              <div className="form-grid ability-form-grid">
                <Field label="职业能力">
                  <select
                    className="input"
                    value={ability}
                    onChange={(e) => setAbility(e.target.value)}
                  >
                    <option value="">选择能力</option>
                    {[
                      "数据采集与接入实现",
                      "数据清洗与质量评估",
                      "批处理指标开发",
                      "业务报表解读与表达",
                      "数据处理",
                    ].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </Field>
                <Field label="叶子知识点">
                  <select
                    className="input"
                    value={mappingNode}
                    onChange={(e) => setMappingNode(e.target.value)}
                  >
                    {nodes
                      .filter((n) => n.depth >= 2)
                      .map((n, i) => (
                        <option key={i}>{n.title}</option>
                      ))}
                  </select>
                </Field>
                <Field label="支撑强度">
                  <select className="input">
                    <option>中支撑</option>
                    <option>强支撑</option>
                    <option>弱支撑</option>
                  </select>
                </Field>
                <Field label="审核状态">
                  <select className="input">
                    <option>保存为草稿</option>
                    <option>待审核</option>
                  </select>
                </Field>
              </div>
              <textarea
                className="input ability-mapping-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="填写匹配依据、知识点能力要求、课程目标或来源证据"
              />
              <Button
                disabled={!ability}
                onClick={() => {
                  setMappings([
                    ...mappings,
                    {
                      ability,
                      node: mappingNode,
                      status: "pending",
                      reason: reason || "教师补充映射，等待核查",
                    },
                  ]);
                  setNotice("能力映射草稿已保存");
                }}
              >
                保存映射草稿
              </Button>
            </div>
            <div className="ability-mapping-list">
              {mappings.map((m, i) => (
                <div className="ability-mapping-row" key={i}>
                  <div className="ability-mapping-main">
                    <div className="ability-mapping-title-row">
                      <strong>{m.ability}</strong>
                      <span
                        className={`ability-status-pill status-${m.status}`}
                      >
                        {m.status === "confirmed"
                          ? "已确认"
                          : m.status === "rejected"
                            ? "已驳回"
                            : "待审核"}
                      </span>
                    </div>
                    <div className="ability-mapping-meta-grid">
                      <div>
                        <span>岗位方向</span>
                        <strong>大数据开发工程师</strong>
                      </div>
                      <div>
                        <span>叶子知识点</span>
                        <strong>{m.node}</strong>
                      </div>
                      <div>
                        <span>支撑强度</span>
                        <strong>强支撑</strong>
                      </div>
                    </div>
                    <p className="ability-evidence-line">{m.reason}</p>
                  </div>
                  <div className="resource-actions">
                    <Button
                      small
                      disabled={m.status === "confirmed"}
                      onClick={() =>
                        setMappings(
                          mappings.map((x, j) =>
                            i === j ? { ...x, status: "confirmed" } : x,
                          ),
                        )
                      }
                    >
                      确认
                    </Button>
                    <Button
                      small
                      className="danger"
                      disabled={m.status === "rejected"}
                      onClick={() =>
                        setMappings(
                          mappings.map((x, j) =>
                            i === j ? { ...x, status: "rejected" } : x,
                          ),
                        )
                      }
                    >
                      驳回
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="card-panel">
            <SectionHead eyebrow="Positions" title="岗位与能力候选" />
            <div className="ability-config-grid">
              <div className="ability-config-card">
                <strong>配置目标岗位</strong>
                <Field label="岗位名称">
                  <input
                    className="input"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                  />
                </Field>
                <Field label="方向类型">
                  <select className="input">
                    <option>主要目标岗位</option>
                    <option>补充岗位</option>
                  </select>
                </Field>
                <Field label="排序">
                  <input className="input" type="number" defaultValue="0" />
                </Field>
                <Button
                  onClick={() => setNotice(`已保存本地目标岗位：${position}`)}
                >
                  保存目标岗位
                </Button>
              </div>
              <div className="ability-config-card">
                <strong>导入能力候选</strong>
                <Field label="目标岗位">
                  <select className="input">
                    <option>{position}</option>
                  </select>
                </Field>
                <Field label="导入类别">
                  <select className="input">
                    <option>技能要求</option>
                    <option>知识要求</option>
                  </select>
                </Field>
                <textarea
                  className="input ability-import-textarea"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="每行一个能力；也可以粘贴 JSON 数组"
                />
                <Button
                  onClick={() => {
                    if (importText.trim()) {
                      setMappings([
                        ...mappings,
                        ...importText
                          .split("\n")
                          .filter(Boolean)
                          .map((a) => ({
                            ability: a,
                            node: mappingNode,
                            status: "pending",
                            reason: "手动导入，待审核",
                          })),
                      ]);
                      setImportText("");
                      setNotice("能力候选已作为本地待审核草稿导入");
                    }
                  }}
                >
                  导入能力候选
                </Button>
              </div>
            </div>
            {["大数据开发工程师", "大数据工程师2", "大数据工程师"].map((x) => (
              <div className="course-row readonly-row" key={x}>
                <span>
                  <strong>{x}</strong>
                  <small>primary</small>
                </span>
                <em>↑</em>
              </div>
            ))}
          </article>
        </section>
        {newOpen && (
          <Modal
            title="新建课程"
            onClose={() => setNewOpen(false)}
            footer={
              <>
                <Button onClick={() => setNewOpen(false)}>取消</Button>
                <Button
                  primary
                  disabled={!newName.trim() || !newId.trim()}
                  onClick={() => {
                    if (courses.some((c) => c.id === newId)) {
                      setNotice("课程 ID 已存在");
                      return;
                    }
                    setCourses([
                      ...courses,
                      { id: newId, name: newName, status: "draft" },
                    ]);
                    setSelected(newId);
                    setNewOpen(false);
                    setNotice("新课程已保存为本地草稿。");
                  }}
                >
                  保存草稿
                </Button>
              </>
            }
          >
            <div className="form-grid">
              <Field label="课程 ID">
                <input
                  className="input"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                />
              </Field>
              <Field label="课程名称">
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </Field>
            </div>
            <p className="muted">
              当前演示共用课程结构，真实服务端课程隔离尚未接入。
            </p>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}
function SectionHead({
  eyebrow,
  title,
  extra,
}: {
  eyebrow: string;
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {extra}
    </div>
  );
}
