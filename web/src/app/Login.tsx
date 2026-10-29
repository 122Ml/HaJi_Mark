import { useState } from "react";
import { Alert, Button, Input } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useSession } from "../shared/session";

const steps = [
  ["01", "连接课程与学习", "知识目录、课程资料与个人笔记，让学习有迹可循。"],
  ["02", "让每次反馈有据可依", "从原始作答到教师评阅，保留资料来源与正式反馈。"],
  ["03", "把反馈变成下一步", "结合学习路径与老师任务，完成补学、补练和复查。"],
];

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
        <Link className="brand" to="/login"><span className="brand-mark" aria-hidden="true">H</span>HaJi Mark<span className="brand-caption">学习，让成长发生</span></Link>
        <a href="#sign-in">进入工作台 <span aria-hidden="true">↗</span></a>
      </header>
      <main className="welcome-main">
        <section className="welcome-story">
          <span className="eyebrow">LEARNING, CONNECTED</span>
          <h1>让每一步学习，<br />都看得见成长。</h1>
          <p className="welcome-description">连接课程、作答与反馈。<br />为学生找到下一步，为教师看清每一步。</p>
          <div className="learning-visual" aria-label="学习流程：课程学习、作业提交、正式反馈、补学复查">
            <div className="visual-header"><span>一条完整的学习路径</span><span className="visual-pill">师生协同</span></div>
            <div className="visual-path">{["课程学习", "作业提交", "正式反馈", "补学复查"].map((label, i) => <div key={label}><span>{String(i + 1).padStart(2, "0")}</span><strong>{label}</strong></div>)}</div>
            <p>每次投入，都连接到下一次进步。</p>
          </div>
        </section>
        <section className="sign-in-card" id="sign-in" aria-labelledby="sign-in-title">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2 id="sign-in-title">欢迎回来</h2>
          <p className="muted">登录 HaJi Mark，继续今天的教学与学习。</p>
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
            <Input id="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入教师发放的账号" />
            <label htmlFor="password">密码</label>
            <Input.Password id="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
            {error && <Alert type="error" showIcon message={error} role="alert" />}
            <Button type="primary" htmlType="submit" loading={busy} autoInsertSpace={false} block>登录</Button>
          </form>
          <div className="sign-in-help"><strong>一个账号，对应你的工作台</strong><p>登录后自动进入教师或学生空间。如无账号或忘记密码，请联系课程教师。</p></div>
        </section>
      </main>
      <section className="welcome-features" aria-label="平台能力">
        {steps.map(([number, title, description]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{description}</p></article>)}
      </section>
      <footer className="welcome-footer"><strong>HaJi Mark</strong><span>让教与学，形成有回应的连接。</span><span>课程 · 学习 · 反馈 · 成长</span></footer>
    </div>
  );
}
