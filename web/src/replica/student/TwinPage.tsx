import { useState } from "react";
import { SourcePage, Notice } from "../ui";
import { KnowledgeGraph, StudentChart } from "./charts";
export function TwinPage() {
  const [selected, setSelected] = useState("大数据生命周期");
  const [notice, setNotice] = useState("");
  return (
    <SourcePage name="page-student-twin">
      {notice && <Notice>{notice}</Notice>}
      <div className="student-twin-shell">
        <div className="student-diagnosis-v2-header">
          <div className="student-diagnosis-v2-header-content">
            <div className="student-diagnosis-v2-eyebrow">学生画像</div>
            <h1 className="student-diagnosis-v2-title">🔍 学生画像</h1>
            <p className="student-diagnosis-v2-desc">
              基于数字孪生数据生成学习能力画像、薄弱知识点和风险预警
            </p>
          </div>
          <div className="student-diagnosis-v2-header-actions">
            <button
              aria-disabled="false"
              type="button"
              className="el-button el-button--primary el-button--large is-round"
              onClick={() =>
                setNotice("本地演示：已刷新画像，示例诊断不代表真实评价结果。")
              }
            >
              <span className="">重新生成诊断</span>
            </button>
          </div>
        </div>
        <div className="student-diagnosis-v2-meta-bar">
          <div className="student-diagnosis-v2-meta-item">
            <span className="student-diagnosis-v2-meta-label">生成时间:</span>
            <span className="student-diagnosis-v2-meta-value">
              2026/10/21 15:57
            </span>
          </div>
          <div className="student-diagnosis-v2-meta-item">
            <span className="student-diagnosis-v2-meta-label">风险等级:</span>
            <span className="student-diagnosis-v2-risk-badge student-diagnosis-v2-risk-medium">
              中等风险
            </span>
          </div>
          <div className="student-diagnosis-v2-meta-item">
            <span className="student-diagnosis-v2-meta-label">薄弱知识点:</span>
            <span className="student-diagnosis-v2-meta-value">169个</span>
          </div>
          <div className="student-diagnosis-v2-meta-item">
            <span className="student-diagnosis-v2-meta-label">优势知识点:</span>
            <span className="student-diagnosis-v2-meta-value">0个</span>
          </div>
        </div>
        <section className="chart-grid">
          <article className="card-panel">
            <div className="section-head">
              <h2>📊 能力画像</h2>
              <span className="muted">五维能力雷达图</span>
            </div>
            <StudentChart kind="radar" />
            <div
              className="student-diagnosis-v2-metric-chips"
              aria-label="画像指标证据下钻"
            >
              <button
                className="student-diagnosis-v2-metric-chip"
                type="button"
                onClick={() =>
                  setNotice(
                    "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                  )
                }
              >
                <span>知识掌握</span>
                <strong>54.5</strong>
              </button>
              <button
                className="student-diagnosis-v2-metric-chip"
                type="button"
                onClick={() =>
                  setNotice(
                    "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                  )
                }
              >
                <span>学习投入</span>
                <strong>69.3</strong>
              </button>
              <button
                className="student-diagnosis-v2-metric-chip"
                type="button"
                onClick={() =>
                  setNotice(
                    "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                  )
                }
              >
                <span>实践能力</span>
                <strong>64.0</strong>
              </button>
              <button
                className="student-diagnosis-v2-metric-chip"
                type="button"
                onClick={() =>
                  setNotice(
                    "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                  )
                }
              >
                <span>学习稳定性</span>
                <strong>86.1</strong>
              </button>
              <button
                className="student-diagnosis-v2-metric-chip"
                type="button"
                onClick={() =>
                  setNotice(
                    "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                  )
                }
              >
                <span>测验表现</span>
                <strong>48.4</strong>
              </button>
            </div>
          </article>
          <article className="card-panel">
            <div className="section-head">
              <h2>📈 学习趋势</h2>
              <span className="muted">演示数据 · 近 30 天掌握度变化</span>
            </div>
            <StudentChart kind="trend" />
          </article>
        </section>
        <section className="card-panel student-diagnosis-v2-attribution-panel">
          <div className="section-head">
            <h2>趋势异常归因</h2>
            <span className="muted">基于画像快照与当天学习证据</span>
          </div>
          <div className="student-diagnosis-v2-attribution-grid">
            <article
              className="student-diagnosis-v2-attribution-card"
              role="button"
              tabIndex={0}
            >
              <div className="list-title">
                <span>2026-09-30</span>
                <span className="student-diagnosis-v2-drop-pill">
                  下降 7.5 分
                </span>
              </div>
              <div className="list-meta">2026-09-29：52.8% → 45.4% </div>
              <div className="student-diagnosis-v2-snapshot-grid">
                <span>依据不足，不能强行归因</span>
                <span>依据不足</span>
                <span>快照 52.8% -&gt; 45.4%，变化 -7.5 分</span>
              </div>
              <p>
                2026-09-30 掌握度较前一快照下降 7.5
                分，但当天缺少可直接关联的测验、作业或资源学习证据，暂不能强行归因。
              </p>
              <div className="student-diagnosis-v2-attribution-summary">
                <div>
                  <strong>依据不足</strong>
                  <span>0 条</span>
                  <em>当天没有可直接关联的测验、作业或资源学习记录。</em>
                </div>
              </div>
              <div className="student-diagnosis-v2-attribution-evidence">
                <div className="list-meta">
                  依据不足：当天缺少可直接关联证据
                </div>
              </div>
              <div className="student-diagnosis-v2-action-row">
                <span>补充当天测验、作业或学习记录</span>
                <span>完成一次针对薄弱知识点的小测</span>
              </div>
            </article>
          </div>
        </section>
        <section className="detail-grid">
          <article className="card-panel">
            <div className="section-head">
              <h2>⚠️ 学习风险预警</h2>
            </div>
            <div className="stack-list">
              <div className="list-card student-diagnosis-v2-risk-item student-diagnosis-v2-risk-medium">
                <div className="list-title">
                  <span className="student-diagnosis-v2-risk-icon">⚠️</span>{" "}
                  知识薄弱风险
                </div>
                <div className="list-meta">
                  {" "}
                  风险等级：
                  <span className="student-diagnosis-v2-risk-level-text student-diagnosis-v2-level-medium">
                    中风险
                  </span>
                </div>
                <div>部分关键知识点掌握不足，需要持续巩固。</div>
              </div>
              <div className="list-card student-diagnosis-v2-risk-item student-diagnosis-v2-risk-medium">
                <div className="list-title">
                  <span className="student-diagnosis-v2-risk-icon">⚠️</span>{" "}
                  进度滞后风险
                </div>
                <div className="list-meta">
                  {" "}
                  风险等级：
                  <span className="student-diagnosis-v2-risk-level-text student-diagnosis-v2-level-medium">
                    中风险
                  </span>
                </div>
                <div>学习进度仍有提升空间，建议保持稳定推进。</div>
              </div>
              <div className="list-card student-diagnosis-v2-risk-item student-diagnosis-v2-risk-medium">
                <div className="list-title">
                  <span className="student-diagnosis-v2-risk-icon">⚠️</span>{" "}
                  薄弱点集中风险
                </div>
                <div className="list-meta">
                  {" "}
                  风险等级：
                  <span className="student-diagnosis-v2-risk-level-text student-diagnosis-v2-level-medium">
                    中风险
                  </span>
                </div>
                <div>当前存在多个薄弱知识点，建议按优先级逐步突破。</div>
              </div>
            </div>
          </article>
          <article className="card-panel">
            <div className="section-head">
              <h2>📉 薄弱知识节点</h2>
              <span className="muted">共 169 个需要加强</span>
            </div>
            <div className="stack-list">
              <div
                className="list-card student-diagnosis-v2-weak-node-item"
                role="button"
                tabIndex={0}
              >
                <div className="list-title">数据流图</div>
                <div className="student-diagnosis-v2-weak-node-stats">
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      掌握度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      33.7%
                    </span>
                    <div className="student-diagnosis-v2-mini-progress">
                      <div
                        className="student-diagnosis-v2-mini-progress-fill"
                        style={{ width: "33.7%" }}
                      ></div>
                    </div>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      学习进度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      21.3%
                    </span>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      测验分数:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      23.3分
                    </span>
                  </div>
                </div>
                <div className="student-diagnosis-v2-node-path">
                  大数据平台与工具 &gt; TensorFlow &gt; 数据流图
                </div>
              </div>
              <div
                className="list-card student-diagnosis-v2-weak-node-item"
                role="button"
                tabIndex={0}
              >
                <div className="list-title">欧几里得距离</div>
                <div className="student-diagnosis-v2-weak-node-stats">
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      掌握度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      33.8%
                    </span>
                    <div className="student-diagnosis-v2-mini-progress">
                      <div
                        className="student-diagnosis-v2-mini-progress-fill"
                        style={{ width: "33.8%" }}
                      ></div>
                    </div>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      学习进度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      35.6%
                    </span>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      测验分数:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      27.7分
                    </span>
                  </div>
                </div>
                <div className="student-diagnosis-v2-node-path">
                  数据处理系统 &gt; 数据挖掘与分析 &gt; 数据挖掘算法 &gt;
                  机器学习基础 &gt; 聚类分析 &gt; K均值聚类算法 &gt;
                  欧几里得距离
                </div>
              </div>
              <div
                className="list-card student-diagnosis-v2-weak-node-item"
                role="button"
                tabIndex={0}
              >
                <div className="list-title">Volume</div>
                <div className="student-diagnosis-v2-weak-node-stats">
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      掌握度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      35.7%
                    </span>
                    <div className="student-diagnosis-v2-mini-progress">
                      <div
                        className="student-diagnosis-v2-mini-progress-fill"
                        style={{ width: "35.7%" }}
                      ></div>
                    </div>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      学习进度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      37.3%
                    </span>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      测验分数:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      31.3分
                    </span>
                  </div>
                </div>
                <div className="student-diagnosis-v2-node-path">
                  大数据基础概念 &gt; 大数据特征与类型 &gt; 大数据特征 &gt;
                  大数据的五大特征 &gt; Volume
                </div>
              </div>
              <div
                className="list-card student-diagnosis-v2-weak-node-item"
                role="button"
                tabIndex={0}
              >
                <div className="list-title">
                  数据处理系统 / 批处理 / MapReduce计算模型
                </div>
                <div className="student-diagnosis-v2-weak-node-stats">
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      掌握度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      36.6%
                    </span>
                    <div className="student-diagnosis-v2-mini-progress">
                      <div
                        className="student-diagnosis-v2-mini-progress-fill"
                        style={{ width: "36.6%" }}
                      ></div>
                    </div>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      学习进度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      34.3%
                    </span>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      测验分数:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      35.8分
                    </span>
                  </div>
                </div>
                <div className="student-diagnosis-v2-node-path">
                  数据处理系统 &gt; 批处理 &gt; MapReduce计算模型
                </div>
              </div>
              <div
                className="list-card student-diagnosis-v2-weak-node-item"
                role="button"
                tabIndex={0}
              >
                <div className="list-title">传统数据库与大数据的区别</div>
                <div className="student-diagnosis-v2-weak-node-stats">
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      掌握度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      37.7%
                    </span>
                    <div className="student-diagnosis-v2-mini-progress">
                      <div
                        className="student-diagnosis-v2-mini-progress-fill"
                        style={{ width: "37.7%" }}
                      ></div>
                    </div>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      学习进度:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      35.8%
                    </span>
                  </div>
                  <div className="student-diagnosis-v2-stat-row">
                    <span className="student-diagnosis-v2-stat-label">
                      测验分数:
                    </span>
                    <span className="student-diagnosis-v2-stat-value">
                      37.4分
                    </span>
                  </div>
                </div>
                <div className="student-diagnosis-v2-node-path">
                  大数据基础概念 &gt; 大数据基本概念 &gt;
                  传统数据库与大数据的区别
                </div>
              </div>
            </div>
            <div className="pagination pagination--element">
              <div className="el-pagination el-pagination--small">
                <button
                  type="button"
                  className="btn-prev is-first"
                  disabled={true}
                  aria-label="上一页"
                  aria-disabled="true"
                  onClick={() =>
                    setNotice(
                      "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                    )
                  }
                >
                  <i className="el-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 1024 1024"
                    >
                      <path
                        fill="currentColor"
                        d="M609.408 149.376 277.76 489.6a32 32 0 0 0 0 44.672l331.648 340.352a29.12 29.12 0 0 0 41.728 0 30.59 30.59 0 0 0 0-42.752L339.264 511.936l311.872-319.872a30.59 30.59 0 0 0 0-42.688 29.12 29.12 0 0 0-41.728 0"
                      ></path>
                    </svg>
                  </i>
                </button>
                <ul className="el-pager">
                  <li
                    className="is-active number"
                    aria-current="true"
                    aria-label="第 1 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    {" "}
                    1{" "}
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 2 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    2
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 3 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    3
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 4 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    4
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 5 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    5
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 6 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    6
                  </li>
                  <li
                    className="more btn-quicknext el-icon"
                    tabIndex={0}
                    aria-label="向后 5 页"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 1024 1024"
                    >
                      <path
                        fill="currentColor"
                        d="M176 416a112 112 0 1 1 0 224 112 112 0 0 1 0-224m336 0a112 112 0 1 1 0 224 112 112 0 0 1 0-224m336 0a112 112 0 1 1 0 224 112 112 0 0 1 0-224"
                      ></path>
                    </svg>
                  </li>
                  <li
                    className="number"
                    aria-current="false"
                    aria-label="第 34 页"
                    tabIndex={0}
                    onClick={() =>
                      setNotice("本地演示仅提供已观察到的 5 条薄弱知识点样例。")
                    }
                  >
                    34
                  </li>
                </ul>
                <button
                  type="button"
                  className="btn-next is-last"
                  aria-label="下一页"
                  aria-disabled="false"
                  onClick={() =>
                    setNotice(
                      "本地演示：已刷新画像，示例诊断不代表真实评价结果。",
                    )
                  }
                >
                  <i className="el-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 1024 1024"
                    >
                      <path
                        fill="currentColor"
                        d="M340.864 149.312a30.59 30.59 0 0 0 0 42.752L652.736 512 340.864 831.872a30.59 30.59 0 0 0 0 42.752 29.12 29.12 0 0 0 41.728 0L714.24 534.336a32 32 0 0 0 0-44.672L382.592 149.376a29.12 29.12 0 0 0-41.728 0z"
                      ></path>
                    </svg>
                  </i>
                </button>
              </div>
            </div>
          </article>
        </section>
        <section className="detail-grid">
          <article className="card-panel">
            <div className="section-head">
              <h2>章节综合实践能力</h2>
              <span className="muted">基本达成，平均 64.0%</span>
            </div>
            <div className="stack-list">
              <div className="list-card student-diagnosis-v2-practice-item">
                <div className="list-title">
                  <span>大数据课程演示章节</span>
                  <span className="student-diagnosis-v2-level-text">
                    基本达成
                  </span>
                </div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    实践得分:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">64.0%</span>
                  <div className="student-diagnosis-v2-mini-progress">
                    <div
                      className="student-diagnosis-v2-mini-progress-fill"
                      style={{ width: "64%" }}
                    ></div>
                  </div>
                </div>
                <div className="list-meta">
                  1 条证据，代码题 0 条，主观题 1 条{" "}
                </div>
                <div className="list-meta">最近证据：06/30 16:35</div>
              </div>
            </div>
          </article>
          <article className="card-panel">
            <div className="section-head">
              <h2>职业能力达成</h2>
              <span className="muted">3 项能力待提升，优先补齐缺口知识点</span>
            </div>
            <div className="student-diagnosis-v2-career-overview">
              <div className="student-diagnosis-v2-career-score">
                <strong>54.6</strong>
                <span>综合达成度</span>
              </div>
              <div className="student-diagnosis-v2-career-levels">
                <div className="student-diagnosis-v2-career-level student-diagnosis-v2-career-level-need">
                  <span>待提升</span>
                  <strong>3</strong>
                </div>
                <div className="student-diagnosis-v2-career-level student-diagnosis-v2-career-level-basic">
                  <span>基本达成</span>
                  <strong>0</strong>
                </div>
                <div className="student-diagnosis-v2-career-level student-diagnosis-v2-career-level-strong">
                  <span>较好达成</span>
                  <strong>0</strong>
                </div>
              </div>
            </div>
            <div className="stack-list student-diagnosis-v2-career-list">
              <div className="list-card student-diagnosis-v2-career-item student-diagnosis-v2-career-need">
                <div className="student-diagnosis-v2-career-main">
                  <div>
                    <div className="list-title">数据采集与接入实现</div>
                    <div className="list-meta">大数据开发工程师</div>
                  </div>
                  <span className="student-diagnosis-v2-career-badge">
                    待提升
                  </span>
                </div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    达成度:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">52.8%</span>
                  <div className="student-diagnosis-v2-mini-progress">
                    <div
                      className="student-diagnosis-v2-mini-progress-fill"
                      style={{ width: "52.8%" }}
                    ></div>
                  </div>
                </div>
                <div className="student-diagnosis-v2-gap-list">
                  <span className="student-diagnosis-v2-gap-chip">
                    Kafka 数据接入 <em>41.8%</em>
                  </span>
                  <span className="student-diagnosis-v2-gap-chip">
                    数据源选择与数据收集 <em>53.7%</em>
                  </span>
                  <span className="student-diagnosis-v2-gap-chip">
                    数据采集流程 <em>54.2%</em>
                  </span>
                </div>
                <div className="student-diagnosis-v2-career-action">
                  建议把这些缺口知识点加入个性化学习路径优先补强。
                </div>
              </div>
              <div className="list-card student-diagnosis-v2-career-item student-diagnosis-v2-career-need">
                <div className="student-diagnosis-v2-career-main">
                  <div>
                    <div className="list-title">数据清洗与质量评估</div>
                    <div className="list-meta">大数据开发工程师</div>
                  </div>
                  <span className="student-diagnosis-v2-career-badge">
                    待提升
                  </span>
                </div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    达成度:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">55.4%</span>
                  <div className="student-diagnosis-v2-mini-progress">
                    <div
                      className="student-diagnosis-v2-mini-progress-fill"
                      style={{ width: "55.4%" }}
                    ></div>
                  </div>
                </div>
                <div className="student-diagnosis-v2-gap-list">
                  <span className="student-diagnosis-v2-gap-chip">
                    日志数据清洗 <em>49.6%</em>
                  </span>
                </div>
                <div className="student-diagnosis-v2-career-action">
                  建议把这些缺口知识点加入个性化学习路径优先补强。
                </div>
              </div>
              <div className="list-card student-diagnosis-v2-career-item student-diagnosis-v2-career-need">
                <div className="student-diagnosis-v2-career-main">
                  <div>
                    <div className="list-title">批处理指标开发</div>
                    <div className="list-meta">大数据开发工程师</div>
                  </div>
                  <span className="student-diagnosis-v2-career-badge">
                    待提升
                  </span>
                </div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    达成度:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">55.5%</span>
                  <div className="student-diagnosis-v2-mini-progress">
                    <div
                      className="student-diagnosis-v2-mini-progress-fill"
                      style={{ width: "55.5%" }}
                    ></div>
                  </div>
                </div>
                <div className="student-diagnosis-v2-gap-list">
                  <span className="student-diagnosis-v2-gap-chip">
                    SparkMLlib <em>41.4%</em>
                  </span>
                  <span className="student-diagnosis-v2-gap-chip">
                    MapReduce工作流程 <em>53.8%</em>
                  </span>
                </div>
                <div className="student-diagnosis-v2-career-action">
                  建议把这些缺口知识点加入个性化学习路径优先补强。
                </div>
              </div>
            </div>
          </article>
        </section>
        <section className="detail-grid">
          <article className="card-panel">
            <div className="section-head">
              <h2>作业覆盖知识点证据</h2>
              <span className="muted">教师确认后才作为叶子知识点辅助证据</span>
            </div>
            <div className="stack-list">
              <div className="list-card student-diagnosis-v2-practice-item">
                <div className="list-title">Kafka 数据接入</div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    作业辅助分:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">72.0%</span>
                </div>
                <div className="list-meta">
                  1 条确认覆盖证据，掌握度参考修正 +3.0
                </div>
                <div className="list-meta">最近证据：06/30 16:35</div>
              </div>
              <div className="list-card student-diagnosis-v2-practice-item">
                <div className="list-title">数据采集流程</div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    作业辅助分:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">64.0%</span>
                </div>
                <div className="list-meta">
                  1 条确认覆盖证据，掌握度参考修正 +1.0
                </div>
                <div className="list-meta">最近证据：06/30 16:35</div>
              </div>
              <div className="list-card student-diagnosis-v2-practice-item">
                <div className="list-title">日志数据清洗</div>
                <div className="student-diagnosis-v2-stat-row">
                  <span className="student-diagnosis-v2-stat-label">
                    作业辅助分:
                  </span>
                  <span className="student-diagnosis-v2-stat-value">68.0%</span>
                </div>
                <div className="list-meta">
                  1 条确认覆盖证据，掌握度参考修正 +2.0
                </div>
                <div className="list-meta">最近证据：06/30 16:35</div>
              </div>
            </div>
          </article>
        </section>
        <section className="card-panel student-diagnosis-v2-evidence-panel">
          <div className="section-head">
            <h2>证据时间线</h2>
            <span className="muted">最近 8 / 12 条学习证据</span>
          </div>
          <div className="stack-list">
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据驱动因素</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>知识点：大数据驱动因素；资源：B站视频；学习进度：0%</div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据驱动因素</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>
                知识点：大数据驱动因素；资源：PDF
                文档；已打开，仅记录访问，不代表已学完
              </div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据驱动因素</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>
                知识点：大数据驱动因素；资源：B站视频；已打开，仅记录访问，不代表已学完；合并
                2 次连续记录
              </div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据驱动因素</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>知识点：大数据驱动因素；资源：学习资源；学习进度：0%</div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据驱动因素</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>
                知识点：大数据驱动因素；资源：学习资源；已打开，仅记录访问，不代表已学完；合并
                2 次连续记录
              </div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据生命周期</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>知识点：大数据生命周期；资源：学习资源；学习进度：0%</div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据生命周期</span>
              </div>
              <div className="list-meta">10/25 19:34</div>
              <div>
                知识点：大数据生命周期；资源：学习资源；已打开，仅记录访问，不代表已学完；合并
                2 次连续记录
              </div>
            </div>
            <div className="list-card student-diagnosis-v2-evidence-item student-diagnosis-v2-evidence-resource_learning">
              <div className="list-title">
                <span className="student-diagnosis-v2-evidence-type">
                  资源学习
                </span>
                <span>大数据特征</span>
              </div>
              <div className="list-meta">10/22 13:38</div>
              <div>知识点：大数据特征；资源：B站视频；学习进度：0%</div>
            </div>
          </div>
        </section>
      </div>
    </SourcePage>
  );
}
