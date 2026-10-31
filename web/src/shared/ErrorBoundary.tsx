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
      <div className="page-container">
        <div className="state-block is-error" role="alert">
          <span className="state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 4l9 16H3z M12 10v4 M12 17h.01" /></svg>
          </span>
          <strong>页面加载失败</strong>
          <p>已保存到服务器的数据不会受影响，请刷新后重试。</p>
          <button className="ghost-btn" onClick={() => location.reload()}>刷新页面</button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}

