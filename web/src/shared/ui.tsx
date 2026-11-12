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
const tones: Record<string, string> = { published: "success", released: "success", reviewed: "success", confirmed: "processing", assigned: "processing", submitted: "processing", draft: "warning", closed: "default" };
export function StatusTag({ status, label }: { status: string; label: string }) {
  return <Tag color={tones[status] || "default"}>{label}</Tag>;
}
