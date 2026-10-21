import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, label }: { items: Crumb[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5 text-xs text-muted">
      {items.map((item, i) => (
        <React.Fragment key={`${item.label}-${i}`}>
          {i > 0 && <span aria-hidden>/</span>}
          {item.href ? (
            <Link href={item.href} className="text-brand-700 hover:text-brand-800">{item.label}</Link>
          ) : (
            <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/**
 * Page header with breadcrumbs, title, meta line and actions. Keep exactly one
 * primary action; secondary actions sit before it.
 */
export function PageHeader({ breadcrumbs, breadcrumbLabel = "Breadcrumb", title, meta, actions, className }: {
  breadcrumbs?: Crumb[];
  breadcrumbLabel?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} label={breadcrumbLabel} />}
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {meta && <div className="text-[13px] text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
