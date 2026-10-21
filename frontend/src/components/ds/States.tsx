"use client";

import React from "react";
import { AlertCircle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-3 animate-pulse rounded-md bg-subtle", className)} />;
}

/** Skeleton rows, no spinner — headers and filters stay live around it. */
export function LoadingState({ rows = 5, label, className }: { rows?: number; label?: string; className?: string }) {
  const { t } = useI18n();
  const widths = ["w-3/5", "w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-4/5"];
  return (
    <div role="status" aria-busy="true" aria-label={label ?? t.common.loading} className={cn("flex flex-col gap-3 p-4", className)}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={widths[i % widths.length]} />)}
    </div>
  );
}

function StateFrame({ icon, iconClass, title, description, children, className }: {
  icon: React.ReactNode;
  iconClass: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}>
      <div className={cn("flex size-12 items-center justify-center rounded-[14px]", iconClass)}>{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      {description && <div className="max-w-sm text-xs leading-normal text-muted">{description}</div>}
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Empty state always offers the next action (e.g. Add student / Import Excel). */
export function EmptyState({ icon, title, description, actions, className }: { icon: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return <StateFrame icon={icon} iconClass="bg-brand-100 text-brand-800" title={title} description={description} className={className}>{actions}</StateFrame>;
}

export function ErrorState({ title, description, onRetry, className }: { title: React.ReactNode; description?: React.ReactNode; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className={cn("rounded-xl border border-danger-border bg-[#fffbfb]", className)}>
      <StateFrame icon={<AlertCircle aria-hidden className="size-5" />} iconClass="bg-st-action-bg text-st-action" title={title} description={description ?? t.common.errorDescription}>
        {onRetry && <Button size="sm" onClick={onRetry}>{t.common.tryAgain}</Button>}
      </StateFrame>
    </div>
  );
}

export function PermissionDenied({ title, description, onRequestAccess, className }: { title: React.ReactNode; description: React.ReactNode; onRequestAccess?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <StateFrame icon={<Lock aria-hidden className="size-5" />} iconClass="bg-subtle text-secondary" title={title} description={description} className={className}>
      {onRequestAccess && <Button size="sm" variant="tertiary" onClick={onRequestAccess}>{t.common.requestAccess}</Button>}
    </StateFrame>
  );
}

/** A field the current role cannot see: stays visible, masked, with the reason. */
export function LockedField({ label, reason }: { label: React.ReactNode; reason: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
        {label}
        <Lock aria-hidden className="size-3 text-muted" />
      </label>
      <input id={id} disabled value="••••" aria-describedby={`${id}-why`} className="h-10 rounded-[10px] border border-line-soft bg-page px-3 text-sm text-muted" readOnly />
      <div id={`${id}-why`} className="text-xs text-muted">{reason}</div>
    </div>
  );
}
