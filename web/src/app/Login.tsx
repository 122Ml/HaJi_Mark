import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { Moon, Sun } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { preloadWorkspace } from "./route-preload";
import { homeFor, useSession } from "../shared/session";
import { useThemeMode } from "./theme-mode";

export function Login() {
  const { login, session, loading } = useSession();
  const { mode, toggleMode } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prefetchedWorkspace = useRef(false);
  const prefetchWorkspace = useCallback(() => {
    if (prefetchedWorkspace.current) return;
    prefetchedWorkspace.current = true;
    void preloadWorkspace();
  }, []);

  useEffect(() => {
    document.title = "登录 · HaJi Mark";
  }, []);

  useEffect(() => {
    if (!loading && session) {
      prefetchWorkspace();
    }
  }, [loading, session, prefetchWorkspace]);

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
          <div className="welcome-nav-actions">
            <Button
              htmlType="button"
              size="small"
              className="lab-mode-btn"
              icon={mode === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              aria-pressed={mode === "dark"}
              onClick={toggleMode}
            >
              {mode === "dark" ? "浅色" : "深色"}
            </Button>
            {!loading && session ? (
              <Link className="welcome-jump" to={homeFor(session.user)}>
                返回我的工作台
              </Link>
            ) : (
              <a className="welcome-jump" href="#sign-in">
                登录
              </a>
            )}
          </div>
        </header>
        <main className="welcome-main">
          <section className="welcome-story">
            <h1>让每一步学习，都看得见成长</h1>
            <p className="welcome-sub">课程资料 · 作业批阅 · 知识图谱 · 课程助理</p>
          </section>
          <section className="card-panel sign-in-card" id="sign-in">
            <div className="sign-in-head">
              <span className="sign-in-title">登录</span>
              <kbd aria-hidden="true">Enter ↵</kbd>
            </div>
            {!loading && session && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={`已登录：${session.user.display_name}`}
                action={
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => navigate(homeFor(session.user))}
                  >
                    进入工作台
                  </Button>
                }
              />
            )}
            <Form
              className="sign-in-form"
              onFocus={prefetchWorkspace}
              onFinish={async () => {
                prefetchWorkspace();
                setBusy(true);
                setError("");
                try {
                  const user = await login(username.trim(), password);
                  setPassword("");
                  const from = (location.state as { from?: string } | null)?.from;
                  const rolePrefix = `/${user.role}/`;
                  const target =
                    from && from.startsWith(rolePrefix) && !from.startsWith("//")
                      ? from
                      : homeFor(user);
                  navigate(target, { replace: true });
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
          </section>
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
