import { useState } from "react";
import {
  Button,
  Field,
  Link,
  Modal,
  Notice,
  Panel,
  SourcePage,
  useLocalState,
} from "../ui";
import jobs from "./jobs.json";
import jobSkills from "./job-skills.json";
import { initialMappings } from "./course";

const skills = [
  "SQL",
  "Python",
  "Pandas",
  "Hadoop",
  "Spark",
  "Power BI",
  "数据可视化工具",
  "CI/CD",
  "Kubernetes",
  "PyTorch",
  "Docker",
  "NumPy",
  "AWS",
  "GCP",
  "Java",
  "测试技能",
  "运筹优化",
  "博弈论",
  "因果推断",
  "数据建模",
  "AI平台",
  "深度学习",
  "产品运营",
  "搜索推荐",
  "项目管理",
  "数据治理",
  "统计分析",
  "NLP",
  "机器学习",
  "数据挖掘",
];
export function Industry() {
  const [keyword, setKeyword] = useState("数据分析师");
  const [country, setCountry] = useState("中国");
  const [city, setCity] = useState("全国");
  const [combined, setCombined] = useState(false);
  const [count, setCount] = useState(10);
  const [strength, setStrength] = useState(3);
  const [sources, setSources] = useState(["indeed"]);
  const [skillCount, setSkillCount] = useState(30);
  const [jobCount, setJobCount] = useState(15);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<string[] | null>(null);
  const [position, setPosition] = useState("商业数据分析师_DC");
  const [importCount, setImportCount] = useState(12);
  const [mapping, setMapping] = useState(true);
  const [imported, setImported] = useLocalState<
    { ability: string; node: string; status: string; reason: string }[]
  >("industry-imports", []);
  const [result, setResult] = useState("数据分析师");
  const [mappings, setMappings] = useLocalState(
    "ability-mappings",
    initialMappings,
  );
  const shownJobs = jobs
    .filter((j) => Number(j[2]) >= strength)
    .slice(0, count);
  return (
    <SourcePage name="TeacherIndustryIntelligenceView">
      <div className="industry-page">
        <div className="student-industry-v2-header">
          <div>
            <h1>行业资讯</h1>
            <p className="student-industry-v2-desc">职位搜索与行业趋势分析</p>
          </div>
        </div>
        <div className="industry-shell">
          <aside className="industry-sidebar">
            <form
              className="student-industry-v2-form-card"
              onSubmit={(e) => {
                e.preventDefault();
                setResult(keyword || "数据分析师");
                setNotice("已载入本地固定职位样例；未访问招聘网站或调用模型。");
              }}
            >
              <div className="student-industry-v2-form-header">
                <h2>分析参数</h2>
                <span className="muted">配置分析参数</span>
              </div>
              <Field label="搜索关键字">
                <input
                  className="input"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="例如：大数据分析、商业分析、AI 产品经理"
                />
              </Field>
              <div className="field-grid two-col">
                <Field label="国家 / 地区">
                  <select
                    className="input"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    {["中国", "美国", "新加坡"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="城市">
                  <select
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  >
                    {["全国", "上海市", "北京市", "深圳市", "重庆市"].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </Field>
              </div>
              <div className="field toggle-field">
                <span>组合抓取</span>
                <label className="toggle-inline">
                  <Switch
                    checked={combined}
                    onChange={setCombined}
                    label="组合抓取"
                  />
                  <span>国内 + 海外并行提取</span>
                </label>
                <small>
                  开启后会同时抓取中国、美国、新加坡，并统一进入后续分析。
                </small>
              </div>
              <Field label="每个数据源职位数">
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="50"
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Number(e.target.value)))
                  }
                />
              </Field>
              <Field label={`相关性过滤强度 ${strength}`}>
                <Range
                  min={0}
                  max={12}
                  value={strength}
                  onChange={setStrength}
                  label="相关性过滤强度"
                />
              </Field>
              <div className="field">
                <span>数据源</span>
                <div className="industry-source-list">
                  {["linkedin", "indeed"].map((s) => (
                    <label
                      className={`industry-source-item ${sources.includes(s) ? "is-checked" : ""}`}
                      key={s}
                    >
                      <input
                        type="checkbox"
                        checked={sources.includes(s)}
                        onChange={(e) =>
                          setSources(
                            e.target.checked
                              ? [...sources, s]
                              : sources.filter((x) => x !== s),
                          )
                        }
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div className="industry-actions">
                <Button
                  primary
                  type="submit"
                  className="full-width analytics-collect"
                  disabled={!sources.length}
                >
                  采集并分析
                </Button>
                <Button className="full-width danger analytics-stop" disabled>
                  终止任务
                </Button>
                <Button
                  className="full-width"
                  onClick={() =>
                    setNotice(
                      "已从本地职位样例重新展示固定技能列表；未调用模型。",
                    )
                  }
                >
                  重新提取技能
                </Button>
              </div>
            </form>
          </aside>
          <section className="industry-main">
            {notice && <Notice>{notice}</Notice>}
            <section className="industry-results">
              <div className="info-banner">
                <strong>本次实际使用的搜索词：</strong>
                {[
                  result,
                  "数据分析工程师",
                  "数据科学家",
                  "商业分析师",
                  "数据挖掘工程师",
                  "大数据分析师",
                ].map((x) => (
                  <span className="skill-chip" key={x}>
                    {x}
                  </span>
                ))}
              </div>
              <div className="info-banner">
                当前已按严格相关性阈值 {strength} 筛选，在 {country}-{city}{" "}
                共抓取 2 轮、最终抓取上限扩展到 40 条，并保留 {shownJobs.length}
                /10 条高相关职位，搜索词：{result} | 数据分析工程师 | 数据科学家
                | 商业分析师 | 数据挖掘工程师 | 大数据分析师。
              </div>
              <Panel title="热力图控制" className="industry-control-card">
                <div className="field-grid two-col">
                  <Field label={`显示技能数 ${skillCount}`}>
                    <Range
                      min={5}
                      max={30}
                      value={skillCount}
                      onChange={setSkillCount}
                      label="显示技能数"
                    />
                  </Field>
                  <Field label={`显示岗位数 ${jobCount}`}>
                    <Range
                      min={3}
                      max={15}
                      value={jobCount}
                      onChange={setJobCount}
                      label="显示岗位数"
                    />
                  </Field>
                </div>
              </Panel>
              <Panel title="技能热力图" className="industry-chart-card wide">
                <div className="industry-chart heatmap">
                  <Heatmap
                    columns={skillCount}
                    rows={Math.min(jobCount, shownJobs.length)}
                  />
                </div>
              </Panel>
              <div className="industry-chart-grid two-up">
                <Panel title="技能排行" className="industry-chart-card">
                  <div className="industry-chart">
                    <SkillBars />
                  </div>
                </Panel>
                <Panel title="岗位分布" className="industry-chart-card">
                  <div className="industry-chart">
                    <JobDonut />
                  </div>
                </Panel>
              </div>
              <div className="industry-chart-grid two-up">
                <Panel title="经验要求" className="industry-chart-card">
                  <div className="industry-chart small">
                    <SimpleBars
                      labels={["不限", "1-3年", "3-5年"]}
                      values={[5, 3, 2]}
                    />
                  </div>
                </Panel>
                <Panel title="学历要求" className="industry-chart-card">
                  <div className="industry-chart small">
                    <SimpleBars
                      labels={["不限", "本科及以上", "硕士及以上"]}
                      values={[5, 4, 1]}
                    />
                  </div>
                </Panel>
              </div>
              <Panel
                title="职位明细"
                className="industry-table-card"
                extra={<span className="muted">{shownJobs.length} 条</span>}
              >
                <JobsTable jobs={shownJobs} onDetail={setDetail} />
              </Panel>
            </section>
            <section className="industry-course-import-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Course Twin Import</p>
                  <h3>导入课程数字孪生</h3>
                </div>
                <Link className="ghost-btn" to="/teacher/course-twin">
                  去课程孪生审核
                </Link>
              </div>
              <div className="industry-course-import-grid">
                <Field label="目标课程">
                  <select className="input">
                    <option>大数据分析（published）</option>
                    <option>数据工程入门（draft）</option>
                  </select>
                </Field>
                <Field label="岗位方向">
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
                <Field label="导入数量">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="30"
                    value={importCount}
                    onChange={(e) => setImportCount(Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="映射候选">
                <label className="toggle-inline">
                  <Switch
                    checked={mapping}
                    onChange={setMapping}
                    label="生成映射候选"
                  />
                  导入后生成能力-叶子知识点草稿候选
                </label>
              </Field>
              <p className="muted">
                仅生成待审核候选，不自动发布或影响学生端。
              </p>
              <div className="industry-course-skill-preview">
                {skills.slice(0, importCount).map((s) => (
                  <span className="skill-chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>
              <div className="industry-course-import-actions">
                <Button
                  primary
                  onClick={() => {
                    const candidates = skills
                      .slice(0, importCount)
                      .map((s) => ({
                        ability: `${position} / ${s}`,
                        node: "待映射",
                        status: "pending",
                        reason: "行业能力本地导入，需教师审核",
                      }));
                    setImported([...imported, ...candidates]);
                    if (mapping) setMappings([...mappings, ...candidates]);
                    setNotice(
                      `已导入 ${Math.min(importCount, skills.length)} 条本地能力候选，尚未确认发布。`,
                    );
                  }}
                >
                  导入岗位与能力候选
                </Button>
                {imported.length > 0 && (
                  <span className="course-import-notice">
                    已保存 {imported.length} 条本地待审核候选
                  </span>
                )}
              </div>
            </section>
          </section>
        </div>
        {detail && (
          <Modal title="职位详情" onClose={() => setDetail(null)}>
            <h2>{detail[0]}</h2>
            <p>
              {detail[1]} · {detail[6]} · {detail[3]}
            </p>
            <p>
              经验：{detail[4]}　学历：{detail[5]}
            </p>
            <h3>技能要求</h3>
            <p>{detail[8]}</p>
            <Notice>固定职位样例，原招聘状态与招聘链接未接入。</Notice>
            <Button
              onClick={() => {
                setPosition(detail[0]);
                setDetail(null);
                setNotice("已将该职位带入下方课程导入表单。");
              }}
            >
              设为目标岗位
            </Button>
          </Modal>
        )}
      </div>
    </SourcePage>
  );
}
function Heatmap({ columns, rows }: { columns: number; rows: number }) {
  return (
    <svg
      className="analytics-svg analytics-heatmap"
      viewBox="0 0 1000 620"
      role="img"
      aria-label="职位技能热力图"
    >
      <g transform="translate(160,28)">
        {Array.from({ length: rows }, (_, i) =>
          Array.from({ length: columns }, (_, j) => {
            const active = [
              [],
              [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13],
              [0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 13],
              [0],
              [0, 1, 5, 6],
              [0],
              [0, 1, 3, 4],
              [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
              [0, 1, 6, 7, 18, 19],
              [0, 1, 2, 5, 14, 15, 16, 17],
            ][i]?.includes(j);
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={j * (760 / columns)}
                  y={i * 50}
                  width={760 / columns}
                  height="50"
                  fill={
                    active ? "#ca5004" : (i + j) % 2 ? "#f0f3f9" : "#f8f9fc"
                  }
                />
                {active && (
                  <text
                    x={j * (760 / columns) + 760 / columns / 2}
                    y={i * 50 + 29}
                    fill="#793006"
                    fontSize="9"
                    textAnchor="middle"
                  >
                    1
                  </text>
                )}
              </g>
            );
          }),
        )}
        {skills.slice(0, columns).map((s, j) => (
          <text
            key={s}
            transform={`translate(${j * (760 / columns) + 10},${rows * 50 + 8}) rotate(-45)`}
            textAnchor="end"
            fill="#64748b"
            fontSize="10"
          >
            {s}
          </text>
        ))}
      </g>
      {jobs
        .slice(0, rows)
        .reverse()
        .map((j, i) => (
          <text
            x="153"
            y={57 + i * 50}
            key={i}
            textAnchor="end"
            fill="#64748b"
            fontSize="10"
          >
            {j[0].slice(0, 14)}...
          </text>
        ))}
    </svg>
  );
}
function SkillBars() {
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 500 420"
      role="img"
      aria-label="技能排行"
    >
      {skills.slice(0, 15).map((s, i) => (
        <g key={s} transform={`translate(0,${20 + i * 24})`}>
          <text x="123" y="13" fill="#64748b" fontSize="10" textAnchor="end">
            {s}
          </text>
          <rect
            x="130"
            y="0"
            height="17"
            rx="7"
            width={
              (i === 0 ? 8 : i === 1 ? 6 : i < 5 ? 3 : i < 14 ? 2 : 1) * 39
            }
            fill="#5279ff"
          />
          <text
            x={
              135 +
              (i === 0 ? 8 : i === 1 ? 6 : i < 5 ? 3 : i < 14 ? 2 : 1) * 39
            }
            y="13"
            fill="#64748b"
            fontSize="10"
          >
            {i === 0 ? 8 : i === 1 ? 6 : i < 5 ? 3 : i < 14 ? 2 : 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
function SimpleBars({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}) {
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 500 390"
      role="img"
      aria-label={labels.join("、")}
    >
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <g key={n}>
          <path d={`M${110 + n * 65} 20v320`} stroke="#e2e8f0" />
          <text x={110 + n * 65} y="363" fill="#64748b" fontSize="11">
            {n}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <g key={l}>
          <text
            x="100"
            y={74 + i * 105}
            fill="#64748b"
            fontSize="11"
            textAnchor="end"
          >
            {l}
          </text>
          <rect
            x="110"
            y={40 + i * 105}
            height="70"
            width={values[i] * 65}
            rx="8"
            fill="#14b8a6"
          />
          <text
            x={116 + values[i] * 65}
            y={79 + i * 105}
            fill="#64748b"
            fontSize="11"
          >
            {values[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}
function JobDonut() {
  const colors = [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
    "#ea7ccc",
    "#5470c6",
  ];
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 500 420"
      role="img"
      aria-label="岗位分布"
    >
      <g transform="translate(250,205) rotate(-90)">
        {jobs.slice(0, 10).map((_, i) => (
          <circle
            key={i}
            r="120"
            fill="none"
            stroke={colors[i]}
            strokeWidth="70"
            pathLength="100"
            strokeDasharray="10 90"
            strokeDashoffset={(-i * 100) / 10}
          />
        ))}
      </g>
      {jobs.slice(0, 10).map((j, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        const x = 250 + Math.cos(angle) * 178,
          y = 205 + Math.sin(angle) * 178;
        return (
          <text
            key={i}
            x={x}
            y={y}
            fill="#64748b"
            fontSize="9"
            textAnchor="middle"
          >
            {j[0].slice(0, 10)}...
          </text>
        );
      })}
    </svg>
  );
}

function Range({
  min,
  max,
  value,
  onChange,
  label,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <span className="analytics-range-wrap">
      <input
        className="analytics-range"
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right,#4f46e5 0%,#4f46e5 ${percentage}%,#e4e7ed ${percentage}%,#e4e7ed 100%)`,
        }}
      />
    </span>
  );
}
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <span className="analytics-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
    </span>
  );
}

function JobsTable({
  jobs: rows,
  onDetail,
}: {
  jobs: string[][];
  onDetail: (job: string[]) => void;
}) {
  const widths = [176, 128, 88, 104, 88, 88, 108, 88, 154, 86];
  return (
    <div className="industry-table-wrap">
      <table className="analytics-jobs-table">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {[
              "职位",
              "公司",
              "相关性",
              "薪资",
              "经验",
              "学历",
              "地点",
              "来源",
              "技能",
              "详情",
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((j, i) => (
            <tr key={j[0]}>
              {j.slice(0, 8).map((cell, k) => (
                <td key={k}>
                  {k === 2 ? (
                    <span className="relevance-pill">{cell}</span>
                  ) : (
                    <span className="analytics-job-cell" title={cell}>
                      {cell}
                    </span>
                  )}
                </td>
              ))}
              <td>
                <div className="industry-skill-list">
                  {(
                    jobSkills[
                      jobs.findIndex((original) => original[0] === j[0])
                    ] || [j[8]]
                  ).map((s, k) => (
                    <span
                      className={`skill-chip ${s.startsWith("+") ? "muted-chip" : ""}`}
                      key={k}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <button
                  type="button"
                  className="el-button el-button--small is-plain"
                  onClick={() => onDetail(j)}
                >
                  查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
