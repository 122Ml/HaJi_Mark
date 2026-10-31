import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return (
    <header className="live-heading">
      <div>
        {eyebrow && <p className="live-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="live-heading-actions">{actions}</div>}
    </header>
  );
}

const icons = {
  empty: "M4 7h16v12H4z M4 7l3-3h10l3 3 M9 12h6",
  error: "M12 4l9 16H3z M12 10v4 M12 17h.01",
};

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state-block">
      <span className="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={icons.empty} /></svg>
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block is-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={icons.error} /></svg>
      </span>
      <strong>加载失败</strong>
      <p>{message}</p>
      {onRetry && <button className="ghost-btn" onClick={onRetry}>重试</button>}
    </div>
  );
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <span className="state-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

const tones: Record<string, string> = {
  published: "success",
  released: "success",
  reviewed: "success",
  confirmed: "active",
  assigned: "active",
  submitted: "active",
  draft: "warning",
  closed: "neutral",
};

export function StatusTag({ status, label }: { status: string; label: string }) {
  return <span className={`status-tag tone-${tones[status] || "neutral"}`}>{label}</span>;
}
