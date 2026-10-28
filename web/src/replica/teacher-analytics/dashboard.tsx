import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  DataTable,
  Field,
  Link,
  Modal,
  Notice,
  Panel,
  SourcePage,
  Tabs,
  useLocalState,
} from "../ui";
import { chapters, knowledge } from "../demo";
import students from "./students.json";
import content from "./course-content.json";
import { BarChart, DonutChart, RadarChart } from "./charts";

const dimensions = [
  "专业投入",
  "数字资源",
  "教学与学习",
  "评估",
  "赋能学习者",
  "促进学习者数字能力",
];
const scores = [75.22, 83.6, 79.75, 67.02, 89.1, 81.78];
export function Dashboard() {
  const [tab, setTab] = useState("班级概览");
  const [student, setStudent] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const [removed, setRemoved] = useLocalState<string[]>(
    "removed-resources",
    [],
  );
  const [uploads, setUploads] = useLocalState<
    { chapter: string; name: string }[]
  >("uploaded-resources", []);
  return (
    <SourcePage name="page-teacher-dashboard">
      <div className="teacher-shell">
        <section className="hero-panel teacher-hero">
          <div>
            <p className="eyebrow">教师看板</p>
            <h1>风险处置与证据闭环工作台</h1>
            <p className="hero-desc">
              先处理风险学生和证据不足的知识点；AI
              只生成建议草稿，教师确认后再下发给学生。
            </p>
          </div>
        </section>
        <section className="teacher-action-board card-panel">
          <div className="teacher-action-board-head">
            <div>
              <p className="eyebrow">待处理闭环</p>
              <h2>9 名学生需要优先处理</h2>
              <p>
                班级平均掌握度 79.86%，覆盖学生 120
                名。所有建议下发前都需要教师确认。
              </p>
            </div>
            <Button
              onClick={() => navigate("/teacher/intervention?draft=true")}
            >
              生成 AI 建议草稿
            </Button>
          </div>
          <div className="teacher-action-grid">
            {[
              [
                "风险学生",
                "9",
                "优先查看掌握度低于 60% 的学生，确认诊断证据后再生成任务包。",
                "查看学生证据",
                "is-risk",
              ],
              [
                "薄弱知识点",
                "0",
                "按班级平均掌握度识别，需要补讲、补测验或补资源。",
                "查看知识点热度",
                "is-warning",
              ],
              [
                "干预闭环",
                "待生成",
                "从诊断依据生成草稿，教师编辑确认后才推送给学生。",
                "进入任务包",
                "is-action",
              ],
            ].map((x, i) => (
              <article className={`teacher-action-item ${x[4]}`} key={x[0]}>
                <span>{x[0]}</span>
                <strong>{x[1]}</strong>
                <p>{x[2]}</p>
                <Button
                  small
                  onClick={() =>
                    i === 2
                      ? navigate("/teacher/intervention")
                      : setTab(i === 0 ? "学生画像" : "课程热度")
                  }
                >
                  {x[3]}
                </Button>
              </article>
            ))}
          </div>
        </section>
        <Tabs
          items={["班级概览", "学生画像", "课程热度", "教师孪生", "课程资源"]}
          value={tab}
          onChange={setTab}
        />
        {notice && <Notice>{notice}</Notice>}
        {tab === "班级概览" && (
          <section className="teacher-overview">
            <Metrics
              items={[
                "班级平均掌握度",
                "79.86%",
                "学生人数",
                "120",
                "优秀人数",
                "58",
                "待提升人数",
                "9",
              ]}
            />
            <div className="industry-chart-grid two-up">
              <Panel title="掌握度分布" className="industry-chart-card">
                <div className="industry-chart">
                  <DonutChart />
                </div>
              </Panel>
              <Panel
                title="薄弱知识点掌握度"
                extra={
                  <span className="muted">
                    优先展示掌握度较低的知识点，可滚轮缩放查看更多
                  </span>
                }
                className="industry-chart-card teacher-chart-card"
              >
                <div className="industry-chart teacher-bar-chart">
                  <BarChart />
                </div>
              </Panel>
            </div>
          </section>
        )}
        {tab === "学生画像" && (
          <Panel
            title="学生列表"
            extra={<span className="muted">共 120 名学生</span>}
          >
            <input
              className="input analytics-student-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索学生"
              aria-label="搜索学生"
            />
            <DataTable
              headers={["用户名", "综合掌握度", "操作"]}
              rows={students
                .filter((s) => s[0].includes(query))
                .map((s) => [
                  s[0],
                  <span
                    style={{
                      color: parseFloat(s[1]) < 60 ? "#ef4444" : undefined,
                    }}
                  >
                    {s[1]}
                  </span>,
                  <Button small onClick={() => setStudent(s)}>
                    查看详情
                  </Button>,
                ])}
            />
          </Panel>
        )}
        {tab === "课程热度" && (
          <div className="industry-chart-grid two-up">
            <Panel
              title="薄弱知识点 Top 20"
              extra={
                <span className="muted">按班级平均掌握度从低到高排序</span>
              }
            >
              <BarChart />
            </Panel>
            <Panel
              title="学习人数 Top 20"
              extra={<span className="muted">按学习参与人数从高到低排序</span>}
            >
              <BarChart participation />
            </Panel>
          </div>
        )}
        {tab === "教师孪生" && (
          <section className="teacher-twin">
            <Metrics
              items={[
                "教师总分",
                "79.41",
                "覆盖学生数",
                "120",
                "有孪生画像学生数",
                "120",
                "最近更新时间",
                "2026/10/28 14:18:29",
              ]}
            />
            <div className="industry-chart-grid two-up">
              <Panel title="教师数字能力六维雷达">
                <RadarChart />
              </Panel>
              <Panel
                title="六维明细分数"
                extra={<span className="muted">自动根据系统数据更新</span>}
              >
                <Button
                  onClick={() =>
                    setNotice(
                      "六维分数以内部闭环事件优先计算；外部兜底指标单独标记。当前为固定演示数据。",
                    )
                  }
                >
                  算法与子项说明
                </Button>
                <DataTable
                  headers={["展开", "维度", "分数", "子项数量", "状态"]}
                  rows={dimensions.map((d, i) => [
                    <div className="dimension-actions">
                      <Button
                        small
                        onClick={() => setExpanded(expanded === d ? "" : d)}
                      >
                        {expanded === d ? "收起" : "展开"}
                      </Button>
                      <Link
                        className="ghost-btn small"
                        to={`/teacher/teacher-twin/drilldown?dimension=${i}`}
                      >
                        钻取
                      </Link>
                    </div>,
                    <>
                      {d}
                      {expanded === d && (
                        <p className="muted">
                          平台事件 · 资源证据 · 学习反馈
                          <br />
                          已覆盖 3 个子项，查看钻取获取原始证据。
                        </p>
                      )}
                    </>,
                    scores[i],
                    "3 / 3",
                    scores[i] >= 80 ? "优势" : "稳定",
                  ])}
                />
              </Panel>
            </div>
            <Panel title="数据完整度诊断">
              <p>外部指标覆盖率：33.3%</p>
              <p className="muted">
                外部指标覆盖较低，当前雷达分数主要基于基础日志，可能偏低。当前系统已支持内部结构化事件优先计分。
              </p>
            </Panel>
            <div className="industry-chart-grid two-up">
              {["教学策略建议", "干预策略建议"].map((t) => (
                <Panel
                  key={t}
                  title={t}
                  extra={
                    <Button
                      onClick={() =>
                        setNotice(
                          "本地建议草稿：优先补充数据清洗的直接评价证据，教师核查后安排针对练习。未调用 AI。",
                        )
                      }
                    >
                      AI生成建议
                    </Button>
                  }
                >
                  <p className="muted">点击按钮后由 AI 生成建议</p>
                </Panel>
              ))}
            </div>
          </section>
        )}
        {tab === "课程资源" && (
          <Panel
            title="课程资源管理"
            extra={
              <Button onClick={() => setNotice("本地课程资源已刷新")}>
                刷新课程树
              </Button>
            }
          >
            <p className="muted">
              按课程知识结构查看资源，并直接上传或删除节点资料。
            </p>
            <h3>▾ 大数据分析</h3>
            {chapters.map((c) => (
              <div className="analytics-resource-chapter" key={c}>
                <div className="section-head">
                  <details>
                    <summary>{c}</summary>
                    <p className="muted">{knowledge.join(" / ")}</p>
                  </details>
                  <label className="ghost-btn small">
                    上传
                    <input
                      type="file"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setUploads([
                            ...uploads,
                            { chapter: c, name: f.name },
                          ]);
                          setNotice(
                            "文件名已保存到本地演示记录，未上传服务器。",
                          );
                        }
                      }}
                    />
                  </label>
                </div>
                {[
                  ...(
                    content.graph.find((g) => g.title === c)?.resources || []
                  ).map((r) => ({ name: new URL(r.url).host, url: r.url })),
                  ...uploads
                    .filter((x) => x.chapter === c)
                    .map((x) => ({ name: x.name, url: "" })),
                ]
                  .filter((r) => !removed.includes(c + r.name))
                  .map((r) => (
                    <div className="analytics-resource-line" key={r.name}>
                      <span>
                        {r.name} · {r.url ? "外部资源" : "本地文件记录"}
                      </span>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          外链
                        </a>
                      )}
                      <Button
                        small
                        onClick={() => {
                          if (confirm("从本地演示列表删除该资源？"))
                            setRemoved([...removed, c + r.name]);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
              </div>
            ))}
          </Panel>
        )}
        {student && (
          <Modal
            title={`${student[0]} · 学生画像`}
            onClose={() => setStudent(null)}
          >
            <Metrics
              items={[
                "总体掌握度",
                student[1],
                "诊断状态",
                "部分证据",
                "风险等级",
                parseFloat(student[1]) < 60 ? "中等风险" : "低风险",
              ]}
            />
            <h3>薄弱知识点与诊断证据</h3>
            <DataTable
              headers={["知识点", "掌握度", "证据"]}
              rows={["日志数据清洗", "数据采集流程", "数据质量评估"].map(
                (n, i) => [n, `${38 + i * 8}%`, "测验 + 已确认作业 + 资源学习"],
              )}
            />
            <p className="muted">
              画像为参考平台固定演示样例，不代表实时诊断。
            </p>
            <Link to="/teacher/intervention" className="primary-link">
              生成干预任务包
            </Link>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}

export function Metrics({ items }: { items: string[] }) {
  return (
    <div className="metrics-grid-vue teacher-metrics-grid">
      {items
        .filter((_, i) => i % 2 === 0)
        .map((label, i) => (
          <article className="card-panel metric-card-vue" key={label}>
            <span className="metric-label">{label}</span>
            <div className="metric-value">{items[i * 2 + 1]}</div>
          </article>
        ))}
    </div>
  );
}

export function Drilldown() {
  const [params] = useSearchParams();
  const [dimension, setDimension] = useState(
    Number(params.get("dimension") || 0),
  );
  const [window, setWindow] = useState("30");
  const professional = [
    ["平台活跃度", "platform_activity", "周在线小时 3.42 · 周登录次数 13"],
    [
      "教研协作行为",
      "teaching_research_collaboration",
      "教研发帖数 5 · 共享课件数 7 · 集体备课次数 3",
    ],
    ["系统功能探索度", "feature_exploration", "高级功能使用次数 18"],
  ];
  return (
    <SourcePage name="TeacherTwinDrilldownView">
      <div className="drilldown-shell">
        <section className="hero-panel app-hero app-hero--teacher">
          <div className="app-hero-copy">
            <p className="eyebrow">Teacher Twin Drilldown</p>
            <h1>教师六维钻取分析</h1>
            <p className="hero-desc">
              查看维度分数、子项明细与原始证据，区分内部闭环事件与外部兜底数据。
            </p>
          </div>
          <div className="app-hero-actions">
            <Link to="/teacher/dashboard" className="ghost-btn">
              返回教师展板
            </Link>
          </div>
        </section>
        <section className="card-panel filters">
          <div className="two-col">
            <Field label="维度">
              <select
                className="input"
                value={dimension}
                onChange={(e) => setDimension(Number(e.target.value))}
              >
                {dimensions.map((d, i) => (
                  <option value={i} key={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="时间窗口">
              <select
                className="input"
                value={window}
                onChange={(e) => setWindow(e.target.value)}
              >
                {["30", "90", "180"].map((n) => (
                  <option value={n} key={n}>
                    近{n}天
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>
        <Metrics
          items={[
            "维度分数",
            dimension === 0 ? "74.97" : scores[dimension].toFixed(2),
            "证据条数",
            window === "30" ? "1" : "3",
            "覆盖率",
            "100%",
          ]}
        />
        <Panel
          title="子项明细"
          extra={
            <span className="muted">
              当前值按子项内部指标展开，鼠标悬停可查看计算方式
            </span>
          }
        >
          <DrilldownTable
            headers={["子项", "当前值"]}
            rows={(dimension === 0
              ? professional
              : [
                  [
                    "资源与活动记录",
                    "resource_activity",
                    "已确认资源 7 · 内部事件 3",
                  ],
                  [
                    "学习与评价证据",
                    "learning_evidence",
                    "有证据学生 120 · 评价覆盖率 100%",
                  ],
                  ["教学闭环落实", "teaching_loop", "已发布任务与反馈 5"],
                ]
            ).map((r) => [
              <>
                <span className="sub-item-name">{r[0]}</span>
                <span className="sub-item-key">{r[1]}</span>
              </>,
              <span title="固定演示值，未连接教师统计接口">{r[2]}</span>,
            ])}
          />
        </Panel>
        <Panel title="原始证据">
          <DrilldownTable
            headers={["时间", "事件类型", "关联对象", "摘要"]}
            rows={[
              [
                "2026/9/29 02:37:15",
                "shared_courseware",
                "-",
                "shared_courseware: 共享课件：模块1教学资源包",
              ],
            ]}
          />
        </Panel>
      </div>
    </SourcePage>
  );
}

function DrilldownTable({
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
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
