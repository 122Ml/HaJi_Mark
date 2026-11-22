import { Button, Space } from "antd";
import { AlertCircle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

const CHUNK_RELOAD_KEY = "haji:chunk-reloaded-path";

function isChunkLoadError(error?: Error | null): boolean {
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS for|Importing a module script failed/i.test(
    error?.message || "",
  );
}

export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; inline?: boolean },
  { failed: boolean; chunkError: boolean }
> {
  state = { failed: false, chunkError: false };
  static getDerivedStateFromError(error: Error) {
    return { failed: true, chunkError: isChunkLoadError(error) };
  }
  componentDidMount() {
    if (this.state.failed) return;
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  }
  componentDidUpdate(prevProps: { children: ReactNode; resetKey?: string; inline?: boolean }) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, chunkError: false });
    }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI ErrorBoundary caught:", error, info.componentStack);
    if (isChunkLoadError(error)) {
      try {
        const path = window.location.pathname;
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== path) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, path);
          window.location.reload();
        }
      } catch {
        // Ignore storage restrictions; fallback UI still offers manual reload.
      }
    }
  }
  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    const fallback = (
      <section
        className="card-panel state-block"
        role={this.props.inline ? "alert" : undefined}
      >
        <AlertCircle
          size={28}
          aria-hidden="true"
          className="state-icon is-danger"
        />
        <div className="state-title" role="heading" aria-level={2}>
          {this.state.chunkError ? "页面资源已更新" : "页面加载失败"}
        </div>
        <p>
          {this.state.chunkError
            ? "系统版本更新后部分静态资源需要刷新获取，请点击“刷新页面”。"
            : "当前视图出现未预期异常，可以尝试重新加载该区域或刷新整个页面。"}
        </p>
        <Space>
          {!this.state.chunkError && (
            <Button
              type="primary"
              onClick={() => this.setState({ failed: false, chunkError: false })}
            >
              重新加载
            </Button>
          )}
          <Button
            type={this.state.chunkError ? "primary" : "default"}
            onClick={() => window.location.reload()}
          >
            刷新页面
          </Button>
        </Space>
      </section>
    );
    return this.props.inline ? (
      fallback
    ) : (
      <div className="page-container" role="alert">
        {fallback}
      </div>
    );
  }
}
