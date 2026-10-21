"use client";

import React, { useRef } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";

export function Avatar({ name, size = "md", tone = "brand", className }: { name: string; size?: "sm" | "md" | "lg"; tone?: "brand" | "accent"; className?: string }) {
  return (
    <span aria-hidden className={cn(
      "inline-flex shrink-0 items-center justify-center font-semibold",
      size === "sm" && "size-7 rounded-full text-[11px]",
      size === "md" && "size-8 rounded-lg text-xs",
      size === "lg" && "size-14 rounded-2xl text-xl",
      tone === "brand" ? "bg-brand-100 text-brand-800" : "bg-accent-50 text-accent-ink",
      className,
    )}>
      {initials(name)}
    </span>
  );
}

/** Summary header for a single record: identity, status, key facts, actions. */
export function DetailHeader({ name, badge, facts, actions }: {
  name: string;
  badge?: React.ReactNode;
  facts: React.ReactNode[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Avatar name={name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold leading-tight">{name}</h1>
          {badge}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-secondary">
          {facts.map((fact, i) => <span key={i} className="tabular">{fact}</span>)}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: React.ReactNode;
  count?: number;
  locked?: boolean;
}

/**
 * WAI-ARIA tabs with roving focus. Arrow keys follow reading direction, so
 * they mirror automatically in RTL.
 */
export function Tabs<K extends string>({ items, value, onChange, label, idBase }: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  idBase: string;
}) {
  const { dir } = useI18n();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (event.key === forward) next = (index + 1) % items.length;
    else if (event.key === backward) next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const key = items[next].key;
    onChange(key);
    refs.current[key]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line-soft">
      {items.map((item, i) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            ref={(node) => { refs.current[item.key] = node; }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${item.key}`}
            aria-selected={active}
            aria-controls={`${idBase}-panel-${item.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm",
              active ? "border-brand-800 font-semibold text-brand-800" : "border-transparent font-medium text-secondary hover:text-ink",
            )}
          >
            {item.label}
            {item.locked && <Lock aria-hidden className="size-3 text-muted" />}
            {item.count !== undefined && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-secondary tabular">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel<K extends string>({ idBase, tab, children, className }: { idBase: string; tab: K; children: React.ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tab}`} aria-labelledby={`${idBase}-tab-${tab}`} tabIndex={0} className={cn("focus-visible:outline-offset-4", className)}>
      {children}
    </div>
  );
}
