import { useState } from "react";
import { SourcePage, Notice } from "../ui";
import { KnowledgeGraph, StudentChart } from "./charts";
export function HomePage() {
  const [selected, setSelected] = useState("大数据生命周期");
  const [notice, setNotice] = useState("");
  return (
    <SourcePage name="HomeView">
      {notice && <Notice>{notice}</Notice>}
      <div className="home-shell">
        <div className="student-home-v2-hero">
          <div className="student-home-v2-hero-content">
            <h1 className="student-home-v2-hero-title">你好，曾懿涵</h1>
            <p className="student-home-v2-hero-subtitle">
              当前有 3 项真实待办，先处理最靠前的一项。
            </p>
          </div>
          <div className="student-home-v2-hero-stats">
            <div className="student-home-v2-stat-item">
              <div className="student-home-v2-stat-icon">%</div>
              <div className="student-home-v2-stat-info">
                <div className="student-home-v2-stat-number">55%</div>
                <div className="student-home-v2-stat-text">总体掌握度</div>
              </div>
            </div>
            <div className="student-home-v2-stat-item">
              <div className="student-home-v2-stat-icon">KP</div>
              <div className="student-home-v2-stat-info">
                <div className="student-home-v2-stat-number">0</div>
                <div className="student-home-v2-stat-text">已完成知识点</div>
              </div>
            </div>
            <div className="student-home-v2-stat-item">
              <div className="student-home-v2-stat-icon">HW</div>
              <div className="student-home-v2-stat-info">
                <div className="student-home-v2-stat-number">0</div>
                <div className="student-home-v2-stat-text">待完成作业</div>
              </div>
            </div>
            <div className="student-home-v2-stat-item">
              <div className="student-home-v2-stat-icon">D</div>
              <div className="student-home-v2-stat-info">
                <div className="student-home-v2-stat-number">8天</div>
                <div className="student-home-v2-stat-text">连续学习</div>
              </div>
            </div>
          </div>
        </div>
        <section className="student-home-workbench">
          <article className="card-panel student-home-priority-card">
            <div className="student-home-priority-copy">
              <p className="eyebrow">今日优先任务</p>
              <h2>学习路径：数据质量评估</h2>
              <p>
                系统已按路径节点、老师任务和作业顺序整理 3
                项待办。完成后会作为学习证据回流到诊断和路径。
              </p>
            </div>
            <div className="student-home-priority-actions">
              <a
                href="/student/course-content?node=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&title=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&continue=true"
                className="primary-link"
              >
                继续学习
              </a>
              <a href="/student/student-twin" className="ghost-btn">
                {" "}
                查看学生画像{" "}
              </a>
            </div>
          </article>
          <article className="card-panel student-home-evidence-card">
            <div className="section-head">
              <h2>证据状态</h2>
              <span className="student-home-evidence-state is-action">
                需要处理
              </span>
            </div>
            <div className="student-home-evidence-grid">
              <div>
                <span>诊断依据</span>
                <strong>169 个薄弱点 / 3 条风险提示</strong>
              </div>
              <div>
                <span>个性化路径</span>
                <strong>4 个正式路径节点</strong>
              </div>
              <div>
                <span>老师任务</span>
                <strong>1 个待处理</strong>
              </div>
            </div>
            <p>
              薄弱知识点会优先进入个性化路径；证据不足的知识点不会被强行计入正式路径。
            </p>
          </article>
        </section>
        <div className="student-home-v2-alert-banner student-home-v2-alert-warning">
          <div className="student-home-v2-alert-icon">TASK</div>
          <div className="student-home-v2-alert-content">
            <strong>教师干预任务：</strong>围绕 数据采集流程
            安排资源复习、测验和一道练习，请按任务包完成学习与练习
          </div>
          <a
            href="/student/intervention/showcase_pkg_zyh"
            className="student-home-v2-alert-btn"
          >
            立即查看
          </a>
        </div>
        <div className="student-home-v2-three-column-layout">
          <aside className="student-home-v2-left-column">
            <article className="card-panel student-home-v2-plan-card">
              <div className="section-head">
                <h2>📅 今日计划</h2>
                <span className="student-home-v2-badge-progress">0/3</span>
              </div>
              <div className="student-home-v2-plan-list">
                <div className="student-home-v2-plan-task">
                  <div className="student-home-v2-task-check">○</div>
                  <a
                    href="/student/course-content?node=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&title=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&continue=true"
                    className="student-home-v2-task-text"
                  >
                    学习路径：数据质量评估
                  </a>
                </div>
                <div className="student-home-v2-plan-task">
                  <div className="student-home-v2-task-check">○</div>
                  <a
                    href="/student/course-content?node=%E6%97%A5%E5%BF%97%E6%95%B0%E6%8D%AE%E6%B8%85%E6%B4%97&title=%E6%97%A5%E5%BF%97%E6%95%B0%E6%8D%AE%E6%B8%85%E6%B4%97&continue=true"
                    className="student-home-v2-task-text"
                  >
                    学习路径：日志数据清洗
                  </a>
                </div>
                <div className="student-home-v2-plan-task">
                  <div className="student-home-v2-task-check">○</div>
                  <a
                    href="/student/course-content?node=%E6%95%B0%E6%8D%AE%E9%87%87%E9%9B%86%E6%B5%81%E7%A8%8B&title=%E6%95%B0%E6%8D%AE%E9%87%87%E9%9B%86%E6%B5%81%E7%A8%8B&continue=true"
                    className="student-home-v2-task-text"
                  >
                    学习路径：数据采集流程
                  </a>
                </div>
              </div>
              <a
                href="/student/course-content?node=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&title=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&continue=true"
                className="student-home-v2-card-action-btn"
              >
                <span>继续学习</span>
                <span>→</span>
              </a>
            </article>
            <article className="card-panel student-home-v2-weak-card">
              <div className="section-head">
                <h2>需要加强</h2>
                <span className="student-home-v2-badge-count">3个</span>
              </div>
              <div className="student-home-v2-weak-list">
                <div className="student-home-v2-weak-item">
                  <div className="student-home-v2-weak-header">
                    <span className="student-home-v2-weak-name">数据流图</span>
                    <span className="student-home-v2-weak-score student-home-v2-level-danger">
                      34%
                    </span>
                  </div>
                  <div className="student-home-v2-progress-bar-mini">
                    <div
                      className="student-home-v2-progress-fill-mini student-home-v2-level-danger"
                      style={{ width: "34%" }}
                    ></div>
                  </div>
                </div>
                <div className="student-home-v2-weak-item">
                  <div className="student-home-v2-weak-header">
                    <span className="student-home-v2-weak-name">
                      欧几里得距离
                    </span>
                    <span className="student-home-v2-weak-score student-home-v2-level-danger">
                      34%
                    </span>
                  </div>
                  <div className="student-home-v2-progress-bar-mini">
                    <div
                      className="student-home-v2-progress-fill-mini student-home-v2-level-danger"
                      style={{ width: "34%" }}
                    ></div>
                  </div>
                </div>
                <div className="student-home-v2-weak-item">
                  <div className="student-home-v2-weak-header">
                    <span className="student-home-v2-weak-name">Volume</span>
                    <span className="student-home-v2-weak-score student-home-v2-level-danger">
                      36%
                    </span>
                  </div>
                  <div className="student-home-v2-progress-bar-mini">
                    <div
                      className="student-home-v2-progress-fill-mini student-home-v2-level-danger"
                      style={{ width: "36%" }}
                    ></div>
                  </div>
                </div>
              </div>
            </article>
            <article className="card-panel student-home-v2-notification-card">
              <div className="section-head">
                <h2>最近通知</h2>
              </div>
              <div className="student-home-v2-notification-list">
                <a
                  href="/student/homework"
                  className="student-home-v2-notification-item"
                >
                  <div className="student-home-v2-notif-icon">📝</div>
                  <div className="student-home-v2-notif-content">
                    <div className="student-home-v2-notif-title">
                      作业已提交：日志字段统计代码题
                    </div>
                    <div className="student-home-v2-notif-time">6天前</div>
                  </div>
                </a>
              </div>
            </article>
          </aside>
          <article className="card-panel student-home-v2-center-column">
            <div className="section-head home-head">
              <div>
                <h2>知识图谱</h2>
                <span className="muted">
                  点击图谱节点后，下方会同步定位到对应章节、小节或知识点。
                </span>
              </div>
              <div className="home-head-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setSelected("大数据生命周期")}
                >
                  定位当前节点
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setSelected("大数据基础概念")}
                >
                  回到总览
                </button>
              </div>
            </div>
            <div className="home-root-card">
              <div>
                <div className="home-root-kicker">知识点</div>
                <h3>{selected}</h3>
                <p>点击图谱或下方节点，可查看该知识点的说明和学习状态。</p>
              </div>
            </div>
            <div className="home-visual-block">
              <div className="home-level-head">
                <div>
                  <h3>图谱视图</h3>
                  <span className="muted">
                    先看章节，点击章节展开小节，点击小节继续展开知识点。
                  </span>
                </div>
                <div className="home-head-actions">
                  <div
                    className="home-graph-legend"
                    aria-label="知识图谱层级图例"
                  >
                    <span>
                      <i className="chapter"></i>章节
                    </span>
                    <span>
                      <i className="section"></i>小节
                    </span>
                    <span>
                      <i className="point"></i>知识点
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setSelected("大数据基础概念")}
                  >
                    收起到课程
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setSelected("大数据基础概念")}
                  >
                    收起到章节
                  </button>
                </div>
              </div>
              <div className="home-graph-breadcrumb">
                <button
                  type="button"
                  className="home-crumb"
                  onClick={() => setSelected("大数据基础概念")}
                >
                  课程总览
                </button>
                <span className="home-crumb-separator">›</span>
                <button
                  type="button"
                  className="home-crumb"
                  onClick={() => setSelected("大数据基础概念")}
                >
                  大数据基础概念
                </button>
                <span className="home-crumb-separator">›</span>
                <span className="home-crumb home-crumb--static">
                  大数据生命周期与应用
                </span>
              </div>
              <KnowledgeGraph selected={selected} onSelect={setSelected} />
            </div>
            <div className="home-level-block">
              <div className="home-level-head">
                <h3>章节</h3>
                <span className="muted">7 个章节</span>
              </div>
              <div className="home-chip-grid home-chip-grid--chapter">
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter active current"
                  onClick={() => setSelected("大数据基础概念")}
                >
                  <span className="home-node-title">大数据基础概念</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("数据获取")}
                >
                  <span className="home-node-title">数据获取</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("数据质量与预处理")}
                >
                  <span className="home-node-title">数据质量与预处理</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("数据存储系统")}
                >
                  <span className="home-node-title">数据存储系统</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("数据处理系统")}
                >
                  <span className="home-node-title">数据处理系统</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("大数据平台与工具")}
                >
                  <span className="home-node-title">大数据平台与工具</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip home-node-chip--chapter"
                  onClick={() => setSelected("大数据应用与挑战")}
                >
                  <span className="home-node-title">大数据应用与挑战</span>
                  <span className="home-node-meta">章节 · 待继续</span>
                </button>
              </div>
            </div>
            <div className="home-level-block">
              <div className="home-level-head">
                <h3>小节</h3>
                <span className="muted">4 个小节</span>
              </div>
              <div className="home-chip-grid">
                <button
                  type="button"
                  className="home-node-chip active current"
                  onClick={() => setSelected("大数据生命周期与应用")}
                >
                  <span className="home-node-title">大数据生命周期与应用</span>
                  <span className="home-node-meta">小节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip"
                  onClick={() => setSelected("大数据基本概念")}
                >
                  <span className="home-node-title">大数据基本概念</span>
                  <span className="home-node-meta">小节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip"
                  onClick={() => setSelected("大数据特征与类型")}
                >
                  <span className="home-node-title">大数据特征与类型</span>
                  <span className="home-node-meta">小节 · 待继续</span>
                </button>
                <button
                  type="button"
                  className="home-node-chip"
                  onClick={() => setSelected("大数据技术与模型")}
                >
                  <span className="home-node-title">大数据技术与模型</span>
                  <span className="home-node-meta">小节 · 待继续</span>
                </button>
              </div>
            </div>
            <div className="home-level-block">
              <div className="home-level-head">
                <h3>知识点</h3>
                <span className="muted">4 个知识点</span>
              </div>
              <div className="home-point-list">
                <button
                  type="button"
                  className={
                    "home-point-card " +
                    (selected === "大数据生命周期" ? "active current" : "")
                  }
                  onClick={() => setSelected("大数据生命周期")}
                >
                  <div>
                    <div className="home-node-title">大数据生命周期</div>
                    <div className="home-node-meta">知识点 · 待继续</div>
                  </div>
                  <span className="pill mastery-mid">进行中</span>
                </button>
                <button
                  type="button"
                  className={
                    "home-point-card " +
                    (selected === "大数据驱动因素" ? "active current" : "")
                  }
                  onClick={() => setSelected("大数据驱动因素")}
                >
                  <div>
                    <div className="home-node-title">大数据驱动因素</div>
                    <div className="home-node-meta">知识点 · 待继续</div>
                  </div>
                  <span className="pill mastery-mid">进行中</span>
                </button>
                <button
                  type="button"
                  className={
                    "home-point-card " +
                    (selected === "DIKW金字塔模型" ? "active current" : "")
                  }
                  onClick={() => setSelected("DIKW金字塔模型")}
                >
                  <div>
                    <div className="home-node-title">DIKW金字塔模型</div>
                    <div className="home-node-meta">知识点 · 待继续</div>
                  </div>
                  <span className="pill mastery-mid">进行中</span>
                </button>
                <button
                  type="button"
                  className={
                    "home-point-card " +
                    (selected === "商务智能的发展过程" ? "active current" : "")
                  }
                  onClick={() => setSelected("商务智能的发展过程")}
                >
                  <div>
                    <div className="home-node-title">商务智能的发展过程</div>
                    <div className="home-node-meta">知识点 · 待继续</div>
                  </div>
                  <span className="pill mastery-mid">进行中</span>
                </button>
              </div>
            </div>
          </article>
          <aside className="student-home-v2-right-column">
            <article className="card-panel student-home-v2-diagnosis-card">
              <div className="section-head">
                <h2>🔍 最新画像摘要</h2>
                <span className="student-home-v2-diagnosis-badge-new">NEW</span>
              </div>
              <div className="student-home-v2-diagnosis-summary">
                <div className="student-home-v2-diagnosis-date">
                  2026/10/21 15:57
                </div>
                <div className="student-home-v2-diagnosis-risk-level student-home-v2-diagnosis-risk-medium">
                  <span className="student-home-v2-diagnosis-risk-icon">
                    ⚠️
                  </span>
                  <span className="student-home-v2-diagnosis-risk-text">
                    中等风险
                  </span>
                </div>
                <div className="student-home-v2-diagnosis-highlights">
                  <div className="student-home-v2-diagnosis-highlight-item">
                    <span className="student-home-v2-diagnosis-highlight-label">
                      薄弱知识点：
                    </span>
                    <span className="student-home-v2-diagnosis-highlight-value">
                      169个
                    </span>
                  </div>
                  <div className="student-home-v2-diagnosis-highlight-item">
                    <span className="student-home-v2-diagnosis-highlight-label">
                      优势知识点：
                    </span>
                    <span className="student-home-v2-diagnosis-highlight-value">
                      0个
                    </span>
                  </div>
                  <div className="student-home-v2-diagnosis-highlight-item">
                    <span className="student-home-v2-diagnosis-highlight-label">
                      学习趋势：
                    </span>
                    <span className="student-home-v2-diagnosis-highlight-value">
                      上升
                    </span>
                  </div>
                </div>
                <a
                  href="/student/student-twin"
                  className="student-home-v2-diagnosis-btn-view"
                >
                  {" "}
                  查看完整报告 →{" "}
                </a>
              </div>
            </article>
            <article className="card-panel home-progress-card">
              <div className="section-head">
                <h2>当前学习定位</h2>
                <span className="muted">自动根据未完成节点定位</span>
              </div>
              <div className="home-progress-stack">
                <div className="home-progress-item">
                  <div className="home-progress-top">
                    <strong>当前章节</strong>
                    <span>大数据基础概念</span>
                  </div>
                  <div className="progress-line">
                    <span style={{ width: "0%" }}></span>
                  </div>
                  <small>章节 1/7 · 已完成 0 个</small>
                </div>
                <div className="home-progress-item">
                  <div className="home-progress-top">
                    <strong>当前小节</strong>
                    <span>大数据生命周期与应用</span>
                  </div>
                  <div className="progress-line">
                    <span style={{ width: "0%" }}></span>
                  </div>
                  <small>小节 1/4 · 已完成 0 个</small>
                </div>
                <div className="home-progress-item">
                  <div className="home-progress-top">
                    <strong>当前知识点</strong>
                    <span>大数据生命周期</span>
                  </div>
                  <div className="progress-line">
                    <span style={{ width: "0%" }}></span>
                  </div>
                  <small>知识点 1/4 · 已完成 0 个</small>
                </div>
              </div>
            </article>
            <article className="card-panel student-home-v2-path-card">
              <div className="section-head">
                <h2>当前学习路径</h2>
                <span className="muted">4 个正式路径节点</span>
              </div>
              <div className="student-home-v2-path-summary">
                <div className="student-home-v2-path-meta">
                  <span>v1</span>
                  <span>诊断生成</span>
                  <span>当前生效</span>
                </div>
                <div className="student-home-v2-path-stats">
                  <div>
                    <strong>4</strong>
                    <span>待学习</span>
                  </div>
                  <div>
                    <strong>0</strong>
                    <span>学习中</span>
                  </div>
                  <div>
                    <strong>0</strong>
                    <span>已完成</span>
                  </div>
                </div>
                <div className="list-card student-home-v2-path-next">
                  <div className="list-title">数据质量评估</div>
                  <div className="list-meta">待学习 · 掌握度 38.0%</div>
                  <a
                    href="/student/course-content?node=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&title=%E6%95%B0%E6%8D%AE%E8%B4%A8%E9%87%8F%E8%AF%84%E4%BC%B0&continue=true"
                    className="primary-link home-action-link"
                  >
                    继续路径学习
                  </a>
                </div>
              </div>
            </article>
            <article className="card-panel home-detail-card">
              <div className="section-head">
                <h2></h2>
                <span className="muted">知识点</span>
              </div>
              <div className="home-detail-body">
                <h3>{selected}</h3>
                <p>暂无</p>
                <div className="home-detail-meta">
                  <span className="meta-chip">学习状态：进行中</span>
                  <span className="meta-chip">平均掌握度：0%</span>
                  <span className="meta-chip">平均完成度：0%</span>
                  <span className="meta-chip">平均学习时长：0 分钟</span>
                </div>
              </div>
            </article>
            <article className="card-panel home-action-card">
              <div className="section-head">
                <h2>下一步建议</h2>
              </div>
              <div className="stack-list">
                <div className="list-card">
                  <div className="list-title">优先进入当前知识点</div>
                  <div className="list-meta">大数据生命周期</div>
                  <a
                    href="/student/course-content?node=%E5%A4%A7%E6%95%B0%E6%8D%AE%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F&continue=true"
                    className="primary-link home-action-link"
                  >
                    进入课程内容
                  </a>
                </div>
                <div className="list-card">
                  <div className="list-title">查看学习计划</div>
                  <div className="list-meta">
                    结合个性化路径和学习任务安排下一阶段学习。
                  </div>
                  <a
                    href="/student/learning"
                    className="ghost-btn home-action-link"
                  >
                    打开我的学习
                  </a>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </div>
    </SourcePage>
  );
}
