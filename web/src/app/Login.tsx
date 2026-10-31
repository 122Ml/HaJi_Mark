import { useEffect, useState } from "react";
import { Alert, Button, Input } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useSession } from "../shared/session";

const flow = [
  ["课程学习", "阅读已审核的资料并记录笔记"],
  ["作业提交", "保存草稿，正式提交保留原文"],
  ["正式反馈", "教师确认评分后发布结果"],
  ["补学复查", "按证据下发任务并复查"],
];

export function Login() {
  const { login, session, loading } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { document.title = "登录 · HaJi Mark"; }, []);
  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <header className="welcome-nav">
          <Link className="brand" to="/login"><span className="brand-mark" aria-hidden="true">H</span>HaJi Mark</Link>
          {!loading && session
            ? <Link className="welcome-jump" to={homeFor(session.user)}>返回我的工作台</Link>
            : <a className="welcome-jump" href="#sign-in">登录</a>}
        </header>
        <main className="welcome-main">
          <section className="welcome-story">
            <span className="eyebrow">课堂学习平台</span>
            <h1>让每一步学习，都看得见成长</h1>
            <p>课程资料、作业作答、教师评分与补学任务在同一处完成，每条反馈都能追溯到原始提交。</p>
          </section>
          <section className="sign-in-card" id="sign-in" aria-labelledby="sign-in-title">
            <h2 id="sign-in-title">登录</h2>
            <p>使用教师或学生账号进入工作台。</p>
            <form className="sign-in-form" onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                const user = await login(username.trim(), password);
                setPassword("");
                navigate(homeFor(user), { replace: true });
              } catch (err) {
                setError(err instanceof Error ? err.message : "登录失败，请重试");
              } finally {
                setBusy(false);
              }
            }}>
              <label htmlFor="username">用户名</label>
              <Input id="username" size="large" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
              <label htmlFor="password">密码</label>
              <Input.Password id="password" size="large" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
              {error && <Alert type="error" showIcon message={error} role="alert" />}
              <Button type="primary" size="large" htmlType="submit" loading={busy} autoInsertSpace={false} block>登录</Button>
            </form>
            <p className="sign-in-help">账号由课程教师开通。忘记密码请联系课程教师重置。</p>
          </section>
        </main>
      </div>
      <section className="welcome-flow" aria-labelledby="flow-title">
        <header>
          <span className="eyebrow">学习闭环</span>
          <h2 id="flow-title">从资料到复查，一条线走完</h2>
        </header>
        <ol className="flow-cards">
          {flow.map(([title, text], i) => (
            <li className="flow-card" key={title}>
              <div><h3>{title}</h3><p>{text}</p></div>
              <div className="flow-art" aria-hidden="true"><span>{i + 1}</span></div>
            </li>
          ))}
        </ol>
      </section>
      <footer className="welcome-footer">
        <div><strong>HaJi Mark</strong><span>智能软件工程课程项目 · 第6组</span></div>
      </footer>
    </div>
  );
}
