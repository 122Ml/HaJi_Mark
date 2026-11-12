import { Alert, Button, Empty, Spin, Tag } from "antd";
import type { ReactNode } from "react";

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
  assigned: "processing", submitted: "processing", running: "processing", parsing: "processing", active: "processing",
  draft: "warning", pending: "warning", queued: "warning", needs_review: "warning", partial: "warning",
  failed: "error", rejected: "error", withdrawn: "error",
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
