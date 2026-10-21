"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";

export interface LedgerItem {
  id: string;
  date: string;
  entry: React.ReactNode;
  change: number;
  balance: number;
}

/** Append-only ledger: every change is a row with its reason; nothing is edited silently. */
export function Ledger({ items, caption }: { items: LedgerItem[]; caption: string }) {
  const { t, tag } = useI18n();
  const signed = (n: number) => (n > 0 ? `+${formatNumber(n, tag)}` : n < 0 ? `−${formatNumber(Math.abs(n), tag)}` : formatNumber(0, tag));
  return (
    <div className="overflow-x-auto rounded-xl border border-line-soft">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-page text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            <th scope="col" className="w-28 px-3.5 py-2.5 text-start">{t.ledger.date}</th>
            <th scope="col" className="px-3.5 py-2.5 text-start">{t.ledger.entry}</th>
            <th scope="col" className="px-3.5 py-2.5 text-end">{t.ledger.change}</th>
            <th scope="col" className="px-3.5 py-2.5 text-end">{t.ledger.balance}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-subtle tabular">
              <td className="px-3.5 py-2.5 text-muted">{item.date}</td>
              <td className="px-3.5 py-2.5">{item.entry}</td>
              <td className={cn("px-3.5 py-2.5 text-end font-medium", item.change < 0 ? "text-st-review" : "text-success")}>{signed(item.change)}</td>
              <td className="px-3.5 py-2.5 text-end font-semibold">{formatNumber(item.balance, tag)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
