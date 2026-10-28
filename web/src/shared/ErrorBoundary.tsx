import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="page-container">
        <h1>页面暂时无法显示</h1>
        <p>已保存到服务器的数据不会受影响，请刷新后重试。</p>
        <button className="ghost-btn" onClick={() => location.reload()}>
          刷新页面
        </button>
        <a href="/login">返回登录</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
