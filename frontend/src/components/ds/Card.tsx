import React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children, as: Tag = "section", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "aside" }) {
  return (
    <Tag className={cn("rounded-card border border-line-soft bg-surface", className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-lg font-semibold leading-snug">{title}</h2>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase label used above groups of fields and summary rows. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.05em] text-muted", className)}>{children}</div>;
}

export function KeyValue({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 text-[13px]", className)}>
      <span className="text-muted">{label}</span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}

export function StatTile({ label, value, hint, tone = "plain" }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: "plain" | "brand" | "attention" }) {
  return (
    <div className={cn(
      "flex flex-col gap-1 rounded-2xl border p-3.5",
      tone === "plain" && "border-line-soft bg-surface",
      tone === "brand" && "border-brand-100 bg-brand-50 text-brand-800",
      tone === "attention" && "border-accent-border bg-accent-50 text-accent-ink",
    )}>
      <div className={cn("text-xs", tone === "plain" ? "text-muted" : "opacity-80")}>{label}</div>
      <div className="text-2xl font-semibold tabular">{value}</div>
      {hint && <div className={cn("text-xs", tone === "plain" ? "text-muted" : "opacity-80")}>{hint}</div>}
    </div>
  );
}
