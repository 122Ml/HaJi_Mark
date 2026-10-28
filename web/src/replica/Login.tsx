import { useState } from "react";
import { useNavigate } from "react-router-dom";

const loop = [
  [
    "课程底座",
    "课程图谱底座",
    "发布课程知识图谱，统一知识点、作业、资源和职业能力映射。",
  ],
  [
    "学习证据",
    "学生画像",
    "汇聚测验、作业、5E 互动和资源学习行为，形成可追踪画像。",
  ],
  [
    "智能推荐",
    "个性化路径",
    "按整体学习情况推荐知识点顺序，并匹配 B站、YouTube、CSDN 与教师资源。",
  ],
  [
    "教师决策",
    "干预与课程优化",
    "面向风险学生、薄弱知识点和课程运行效果生成教师可确认的建议。",
  ],
];
export function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState("student");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login-shell">
      <div className="login-locale">
        <select aria-label="语言" defaultValue="zh">
          <option value="zh">简体中文</option>
        </select>
      </div>
      <section className="login-product" aria-label="AI-Education 平台入口">
        <div className="login-brand-block">
          <span className="login-mark">AE</span>
          <div>
            <strong>AI-Education</strong>
            <span>智能教学决策平台</span>
          </div>
        </div>
        <div className="login-product-copy">
          <p className="eyebrow">Digital Twin &amp; Agent Platform</p>
          <h1>
            <span>以课程图谱为底座</span>
            <span>闭环刻画学生成长</span>
          </h1>
          <p>
            将课程知识图谱、学习资源、测验作业和互动证据接入同一条教学链路，持续生成学生画像、个性化学习路径与教师干预建议。
          </p>
        </div>
        <div className="login-academic-panel" aria-label="平台能力闭环">
          <div className="login-loop-panel">
            <div className="login-loop-head">
              <span>平台创新闭环</span>
              <strong>从课程结构到教学决策，数据不再停在记录层</strong>
            </div>
            <ol className="login-loop-list">
              {loop.map(([code, title, desc]) => (
                <li key={code}>
                  <span className="login-loop-code">{code}</span>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="academic-overview">
            <strong>核心能力</strong>
            <div>
              {[
                "课程图谱发布",
                "资源证据回流",
                "学生画像诊断",
                "学习路径推荐",
                "教师干预闭环",
                "职业能力映射",
              ].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="login-card">
        <p className="eyebrow">统一身份认证</p>
        <h2>进入系统</h2>
        <p className="login-desc">请使用平台账号登录对应工作台。</p>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim() || !password) {
              setError("请输入用户名和密码");
              return;
            }
            sessionStorage.setItem("haji-demo:role", role);
            navigate(
              role === "teacher" ? "/teacher/dashboard" : "/student/home",
            );
          }}
        >
          <label>
            <span>用户名</span>
            <div className="el-input">
              <div className="el-input__wrapper">
                <input
                  className="el-input__inner"
                  aria-label="用户名"
                  placeholder="请输入用户名"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="el-input">
              <div className="el-input__wrapper">
                <input
                  className="el-input__inner"
                  type="password"
                  aria-label="密码"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          </label>
          <label>
            <span>用户类型</span>
            <select
              aria-label="用户类型"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="student">学生</option>
              <option value="teacher">教师</option>
            </select>
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="el-button el-button--primary el-button--large full-width"
          >
            <span>登录</span>
          </button>
        </form>
        <p className="login-demo-hint">
          本地前端演示 · 任意非空账号进入所选角色，不连接参考站账号。
        </p>
      </section>
    </div>
  );
}
