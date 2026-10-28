import {
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import scopes from "./styles/scopes.json";

export function SourcePage({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div data-source-scope={(scopes as Record<string, string>)[name] || ""}>
      {children}
    </div>
  );
}
export function Button({
  children,
  primary,
  small,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${primary ? "primary-link button-like" : "ghost-btn"} ${small ? "small" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="hero-panel">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="hero-desc">{description}</p>}
      </div>
      {children && <div className="hero-actions">{children}</div>}
    </section>
  );
}
export function Panel({
  title,
  extra,
  children,
  className = "",
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-panel ${className}`}>
      {title && (
        <div className="section-head">
          <h3>{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}
export function Tag({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`replica-tag ${tone}`}>{children}</span>;
}
export function Tabs({
  items,
  value,
  onChange,
  className = "",
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`teacher-tabbar ${className}`} role="tablist">
      {items.map((item) => (
        <button
          type="button"
          key={item}
          role="tab"
          aria-selected={item === value}
          className={`teacher-tab ${value === item ? "active" : ""}`}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function DataTable({
  headers,
  rows,
  empty = "暂无数据",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="table-wrap industry-table-wrap">
      <table className="data-table industry-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="empty-cell">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="replica-empty">{children}</div>;
}
export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div className="replica-modal-backdrop" onClick={onClose}>
      <section
        className="replica-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="replica-modal-content">{children}</div>
        <footer>{footer || <Button onClick={onClose}>关闭</Button>}</footer>
      </section>
    </div>
  );
}
export function useLocalState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const saved = localStorage.getItem(`haji-demo:${key}`);
    return saved ? (JSON.parse(saved) as T) : initial;
  });
  const update = (value: T | ((prev: T) => T)) =>
    setState((prev) => {
      const next =
        typeof value === "function" ? (value as (p: T) => T)(prev) : value;
      localStorage.setItem(`haji-demo:${key}`, JSON.stringify(next));
      return next;
    });
  return [state, update];
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="replica-notice" role="status">
      {children}
    </div>
  );
}
export { Link };
