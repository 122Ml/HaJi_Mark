import { useState } from "react";
import { Alert, Button, Input } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useSession } from "../shared/session";

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="welcome-page">
      <header className="welcome-nav">
        <Link className="brand" to="/login"><span className="brand-mark" aria-hidden="true">H</span>HaJi Mark</Link>
        <a href="#sign-in">进入工作台 <span aria-hidden="true">↗</span></a>
      </header>
      <main className="welcome-main">
        <section className="welcome-story">
          <h1>让每一步学习，<br />都看得见成长。</h1>
          <div className="learning-visual" aria-label="学习流程：课程学习、作业提交、正式反馈、补学复查">
            <div className="visual-header"><span>学习路径</span><span className="visual-pill">师生协同</span></div>
            <div className="visual-path">{["课程学习", "作业提交", "正式反馈", "补学复查"].map((label, i) => <div key={label}><span>{String(i + 1).padStart(2, "0")}</span><strong>{label}</strong></div>)}</div>
          </div>
        </section>
        <section className="sign-in-card" id="sign-in" aria-labelledby="sign-in-title">
          <h2 id="sign-in-title">欢迎回来</h2>
          <form className="sign-in-form" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true); setError("");
            try {
              const user = await login(username.trim(), password);
              setPassword(""); navigate(homeFor(user), { replace: true });
            } catch (err) { setError(err instanceof Error ? err.message : "登录失败，请重试"); }
            finally { setBusy(false); }
          }}>
            <label htmlFor="username">用户名</label>
            <Input id="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
            <label htmlFor="password">密码</label>
            <Input.Password id="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
            {error && <Alert type="error" showIcon message={error} role="alert" />}
            <Button type="primary" htmlType="submit" loading={busy} autoInsertSpace={false} block>登录</Button>
          </form>
          <p className="sign-in-help">账号或密码问题，请联系课程教师。</p>
        </section>
      </main>
      <footer className="welcome-footer"><strong>HaJi Mark</strong><span>课程 · 学习 · 反馈 · 成长</span></footer>
    </div>
  );
}
