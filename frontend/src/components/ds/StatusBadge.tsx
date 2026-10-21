"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionaries/en";

export type Tone = "scheduled" | "completed" | "review" | "cancelled" | "pending" | "approved" | "action" | "outline";

const tones: Record<Tone, { box: string; dot: string }> = {
  scheduled: { box: "bg-st-scheduled-bg text-st-scheduled", dot: "bg-st-scheduled" },
  completed: { box: "bg-st-completed-bg text-st-completed", dot: "bg-st-completed" },
  review: { box: "bg-st-review-bg text-st-review", dot: "bg-st-review" },
  cancelled: { box: "bg-st-cancelled-bg text-st-cancelled", dot: "bg-st-cancelled" },
  pending: { box: "bg-st-pending-bg text-st-pending", dot: "bg-st-pending" },
  approved: { box: "bg-st-approved-bg text-st-approved", dot: "bg-st-approved" },
  action: { box: "bg-st-action-bg text-st-action", dot: "bg-st-action" },
  outline: { box: "bg-page text-secondary border border-dashed border-line-dashed", dot: "" },
};

export type StatusKey = keyof Dictionary["status"];

/** Every status the platform shows, mapped to its tone. Text always accompanies color. */
const statusTone: Record<StatusKey, Tone> = {
  scheduled: "scheduled",
  completed: "completed",
  needs_review: "review",
  cancelled: "cancelled",
  pending: "pending",
  approved: "approved",
  rejected: "action",
  action_required: "action",
  not_connected: "outline",
  connected: "completed",
  active: "completed",
  paused: "cancelled",
  archived: "outline",
  renewal_due: "review",
  closed: "cancelled",
  unassigned: "review",
  present: "completed",
  late: "pending",
  absent: "action",
  unknown: "outline",
  done: "completed",
  todo: "outline",
  inactive: "cancelled",
  low_balance: "review",
  conflict: "action",
  report_due: "review",
  draft: "outline",
  reviewed: "pending",
  paid: "completed",
  open: "review",
  resolved: "completed",
  queued: "pending",
  sending: "scheduled",
  sent: "completed",
  failed: "action",
};

export function Badge({ tone, children, className, size = "md" }: { tone: Tone; children: React.ReactNode; className?: string; size?: "sm" | "md" }) {
  const style = tones[tone];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-[3px] text-xs",
      style.box,
      className,
    )}>
      {style.dot && <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, size, className }: { status: StatusKey; size?: "sm" | "md"; className?: string }) {
  const { t } = useI18n();
  return <Badge tone={statusTone[status]} size={size} className={className}>{t.status[status]}</Badge>;
}

export function CountBadge({ count, tone = "neutral", className }: { count: number; tone?: "neutral" | "attention" | "on-dark"; className?: string }) {
  return (
    <span className={cn(
      "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular",
      tone === "neutral" && "bg-subtle text-secondary",
      tone === "attention" && "bg-accent-400 text-ink",
      tone === "on-dark" && "bg-brand-100/20 text-brand-100",
      className,
    )}>
      {count}
    </span>
  );
}
