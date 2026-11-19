import { Button, Result, Space } from "antd";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI ErrorBoundary caught:", error, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <div className="page-container" role="alert">
        <Result
          status="error"
          title="页面加载失败"
          subTitle="当前视图出现未预期异常，可以尝试重新加载该区域或刷新整个页面。"
          extra={
            <Space>
              <Button type="primary" onClick={() => this.setState({ failed: false })}>
                重新加载
              </Button>
              <Button onClick={() => location.reload()}>刷新页面</Button>
            </Space>
          }
        />
      </div>
    ) : (
      this.props.children
    );
  }
}
