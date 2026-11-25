import { Alert, Button, Empty, Spin, Tag } from "antd";
import { Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { APIError } from "./api";

export function isFeatureDisabledError(err: unknown): boolean {
  return err instanceof APIError && err.status === 503;
}

export function FeatureNotice({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="feature-notice" role="status">
      <div className="feature-notice-body">
        <Sparkles className="feature-notice-icon" size={18} aria-hidden="true" />
        <div className="feature-notice-text">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode; heading?: boolean }) {
  return <Empty className="state-block" image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{title}</strong>{children && <div>{children}</div>}</>}>{action}</Empty>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Alert type="error" showIcon message="加载失败" description={message} role="alert" action={onRetry && <Button onClick={onRetry}>重试</Button>} />;
}
export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return <div className="state-block" role="status"><Spin /><span>{label}</span></div>;
}
const tones: Record<string, string> = {
  published: "success", released: "success", reviewed: "success", confirmed: "success",
  succeeded: "success", ready: "success", completed: "success", approved: "success",
  assigned: "processing", submitted: "processing", running: "processing", parsing: "processing", active: "processing", in_progress: "processing",
  draft: "warning", pending: "warning", queued: "warning", needs_review: "warning", partial: "warning", waiting_job: "warning", waiting_approval: "warning", stale: "warning",
  failed: "error", rejected: "error", withdrawn: "error",
  closed: "default", archived: "default", canceled: "default", cancelled: "default", superseded: "default",
};
export function StatusTag({ status, label }: { status: string; label: string }) {
  return <Tag className="ui-status-tag" color={tones[status] || "default"}>{label}</Tag>;
}
export function MetaTag({ children }: { children: ReactNode }) {
  return <Tag className="ui-meta-tag">{children}</Tag>;
}
export function MetaTags({ children }: { children: ReactNode }) {
  return <div className="ui-meta-tags">{children}</div>;
}

export function ActionToolbar({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="ui-action-toolbar">
      <div className="ui-action-toolbar-left">{left}</div>
      {right && <div className="ui-action-toolbar-right">{right}</div>}
    </div>
  );
}

export function SectionSummaryBar({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="ui-summary-bar">
      <div className="ui-summary-bar-left">{left}</div>
      {right && <div className="ui-summary-bar-right">{right}</div>}
    </div>
  );
}

export function CollapsibleProse({
  text,
  maxChars = 220,
  className = "live-prose",
}: {
  text: string;
  maxChars?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const long = trimmed.length > maxChars;
  const visible =
    long && !expanded ? `${trimmed.slice(0, maxChars).trimEnd()}…` : text;
  return (
    <div className="ui-collapsible-prose">
      <p className={className} style={{ margin: 0 }}>
        {visible}
      </p>
      {long && (
        <Button
          type="link"
          size="small"
          htmlType="button"
          style={{ paddingInline: 0, height: "auto" }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起全文" : "展开全文"}
        </Button>
      )}
    </div>
  );
}
