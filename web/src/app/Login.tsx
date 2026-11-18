import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Form } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useSession } from "../shared/session";

export function Login() {
  const { login, session, loading } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "登录 · HaJi Mark";
  }, []);
  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <header className="welcome-nav">
          <Link className="brand" to="/login">
            <span className="brand-mark" aria-hidden="true">
              H
            </span>
            HaJi Mark
          </Link>
          {!loading && session ? (
            <Link className="welcome-jump" to={homeFor(session.user)}>
              返回我的工作台
            </Link>
          ) : (
            <a className="welcome-jump" href="#sign-in">
              登录
            </a>
          )}
        </header>
        <main className="welcome-main">
          <section className="welcome-story">
            <h1>让每一步学习，都看得见成长</h1>
          </section>
          <Card className="sign-in-card" id="sign-in" title="登录">
            <Form
              className="sign-in-form"
              onFinish={async () => {
                setBusy(true);
                setError("");
                try {
                  const user = await login(username.trim(), password);
                  setPassword("");
                  navigate(homeFor(user), { replace: true });
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "登录失败，请重试",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              layout="vertical"
            >
              <Form.Item label="用户名" htmlFor="username">
                <Input
                  id="username"
                  size="large"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Form.Item>
              <Form.Item label="密码" htmlFor="password">
                <Input.Password
                  id="password"
                  size="large"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Form.Item>
              {error && (
                <Alert type="error" showIcon message={error} role="alert" />
              )}
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                loading={busy}
                autoInsertSpace={false}
                block
              >
                登录
              </Button>
            </Form>
            <p className="sign-in-help">忘记密码请联系课程教师。</p>
          </Card>
        </main>
      </div>
      <footer className="welcome-footer">
        <div>
          <strong>HaJi Mark</strong>
          <span>智能软件工程课程项目 · 第6组</span>
        </div>
      </footer>
    </div>
  );
}
