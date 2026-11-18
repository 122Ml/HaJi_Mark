import { Button, Result } from "antd";
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
      <div className="page-container" role="alert">
        <Result status="error" title="页面加载失败" extra={<Button onClick={() => location.reload()}>刷新页面</Button>} />
      </div>
    ) : (
      this.props.children
    );
  }
}
