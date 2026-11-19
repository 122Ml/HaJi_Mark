import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "../live/context";

export function PageHeader({
  title,
  subtitle,
  meta,
  backTo,
  backLabel = "返回",
  extra,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  backTo?: string;
  backLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {backTo && (
          <Link className="page-header-back" to={backTo}>
            <ChevronLeft size={14} aria-hidden="true" />
            <span>{backLabel}</span>
          </Link>
        )}
        <div className="page-header-title-row">
          <h1 className="page-header-title">{title}</h1>
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      {extra && <div className="page-header-actions">{extra}</div>}
    </header>
  );
}
