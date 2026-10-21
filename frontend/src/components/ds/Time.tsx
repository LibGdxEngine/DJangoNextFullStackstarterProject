"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { formatMoney, formatTime, formatWeekdayTime, totalsByCurrency, zoneCity } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";

/** A time always travels with its zone label: "16:00 Cairo". */
export function ZoneTime({ iso, timeZone, withWeekday, className }: { iso: string; timeZone: string; withWeekday?: boolean; className?: string }) {
  const { tag } = useI18n();
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {withWeekday ? formatWeekdayTime(iso, timeZone, tag) : formatTime(iso, timeZone, tag)}{" "}
      <span className="text-xs text-muted">{zoneCity(timeZone, tag)}</span>
    </span>
  );
}

export interface ZoneRole {
  role: string;
  timeZone: string;
}

/**
 * Same instant in several zones (family / teacher / academy). Zones that
 * resolve to the same wall time are still listed by role so nobody guesses.
 */
export function MultiZoneTimes({ iso, zones, variant = "panel" }: { iso: string; zones: ZoneRole[]; variant?: "panel" | "inline" | "on-dark" }) {
  const { tag } = useI18n();
  if (variant === "panel") {
    return (
      <div className="grid gap-2 rounded-[10px] bg-page px-3 py-2.5 tabular" style={{ gridTemplateColumns: `repeat(${zones.length}, minmax(0, 1fr))` }}>
        {zones.map((z) => (
          <div key={z.role}>
            <div className="text-[11px] text-muted">{z.role} · {zoneCity(z.timeZone, tag)}</div>
            <div className="font-semibold">{formatTime(iso, z.timeZone, tag)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular">
      {zones.map((z) => (
        <span key={z.role}>
          <span className={variant === "on-dark" ? "text-brand-300" : "text-muted"}>{z.role}</span>{" "}
          {formatTime(iso, z.timeZone, tag)} {zoneCity(z.timeZone, tag)}
        </span>
      ))}
    </div>
  );
}

/** Amounts grouped per currency. Never a combined total across currencies. */
export function MoneyByCurrency<T>({ items, amount, currency, className }: { items: T[]; amount: (item: T) => number; currency: (item: T) => string; className?: string }) {
  const { tag } = useI18n();
  const totals = totalsByCurrency(items, amount, currency);
  if (totals.length === 0) return <span className={cn("text-muted", className)}>—</span>;
  return (
    <span className={cn("inline-flex flex-wrap gap-x-2 gap-y-1 tabular", className)}>
      {totals.map((t, i) => (
        <React.Fragment key={t.currency}>
          {i > 0 && <span aria-hidden className="text-muted">·</span>}
          <span className="whitespace-nowrap">{formatMoney(t.total, t.currency, tag)}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

export function Money({ amount, currency, className }: { amount: number; currency: string; className?: string }) {
  const { tag } = useI18n();
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatMoney(amount, currency, tag)}</span>;
}
