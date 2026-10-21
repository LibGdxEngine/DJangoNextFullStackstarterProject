"use client";

import React from "react";
import { Eye, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

/** Summary side panel (elevation 1) for previewing a record without leaving the list or calendar. */
export function SidePanel({ title, onClose, children, footer, className }: {
  title: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <aside className={cn("flex flex-col rounded-xl border border-line-soft bg-surface shadow-popover", className)}>
      <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {onClose && (
          <button type="button" aria-label={t.common.closePanel} onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-page">
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3 text-[13px]">{children}</div>
      {footer && <div className="flex flex-wrap gap-2 border-t border-subtle px-4 py-3">{footer}</div>}
    </aside>
  );
}

/**
 * Internal staff notes and family-visible notes must never look alike:
 * internal = neutral with a lock, family = green tint with an eye.
 */
export function NoteCard({ visibility, children, meta, className }: {
  visibility: "internal" | "family";
  children: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const internal = visibility === "internal";
  return (
    <div className={cn(
      "flex flex-col gap-1.5 rounded-[10px] border px-3.5 py-3",
      internal ? "border-line-soft bg-surface" : "border-brand-100 bg-brand-50",
      className,
    )}>
      <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em]", internal ? "text-muted" : "text-brand-700")}>
        {internal ? <Lock aria-hidden className="size-3" /> : <Eye aria-hidden className="size-3" />}
        {internal ? t.notes.internal : t.notes.familyVisible}
      </div>
      <div className={cn("text-[13px] leading-normal", internal ? "text-secondary" : "text-brand-800")}>{children}</div>
      {meta && <div className="text-xs text-muted">{meta}</div>}
    </div>
  );
}

/** Full-width banner slot under the top bar (e.g. WhatsApp disconnected). */
export function Banner({ tone = "danger", icon, children, action }: { tone?: "danger" | "attention" | "info"; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="status" className={cn(
      "flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-[13px] md:px-8",
      tone === "danger" && "border-danger-border bg-st-action-bg text-st-action",
      tone === "attention" && "border-accent-border bg-accent-50 text-accent-ink",
      tone === "info" && "border-brand-100 bg-brand-50 text-brand-800",
    )}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function InfoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[10px] border border-brand-100 bg-brand-50 px-3.5 py-3 text-xs leading-relaxed text-brand-800", className)}>{children}</div>;
}
