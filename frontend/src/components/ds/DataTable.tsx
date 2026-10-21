"use client";

import React, { useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { LoadingState, ErrorState } from "./States";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
  /** Hide below this breakpoint to keep narrow layouts readable. */
  hideBelow?: "md" | "lg";
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  rowLabel,
  selectable,
  selected,
  onSelectedChange,
  bulkActions,
  page,
  pageSize = 10,
  onPageChange,
  totalCount,
  isLoading,
  error,
  onRetry,
  errorTitle,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  rowLabel: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  bulkActions?: (ids: string[]) => React.ReactNode;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  totalCount?: number;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  errorTitle?: React.ReactNode;
  empty?: React.ReactNode;
  caption: string;
}) {
  const { t } = useI18n();
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = useMemo(() => rows.slice((current - 1) * pageSize, current * pageSize), [rows, current, pageSize]);
  const selection = selected ?? new Set<string>();
  const visibleIds = visible.map(getRowId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));

  function toggle(id: string) {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.(next);
  }

  function toggleAll() {
    const next = new Set(selection);
    for (const id of visibleIds) {
      if (allVisibleSelected) next.delete(id);
      else next.add(id);
    }
    onSelectedChange?.(next);
  }

  const hideClass = (c: Column<T>) => (c.hideBelow === "md" ? "hidden md:table-cell" : c.hideBelow === "lg" ? "hidden lg:table-cell" : "");

  if (error) return <ErrorState title={errorTitle ?? t.common.errorTitle} onRetry={onRetry} />;

  return (
    <div className="overflow-hidden rounded-xl border border-line-soft bg-surface">
      {isLoading ? (
        <LoadingState rows={6} />
      ) : rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr className="bg-page text-start text-xs text-secondary">
                  {selectable && (
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input type="checkbox" aria-label={t.common.selectAll} checked={allVisibleSelected} onChange={toggleAll} className="size-4 accent-brand-800" />
                    </th>
                  )}
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-semibold", c.align === "end" ? "text-end" : "text-start", hideClass(c))}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const id = getRowId(row);
                  const isSelected = selection.has(id);
                  return (
                    <tr key={id} className={cn("border-t border-subtle", isSelected && "bg-brand-50")}>
                      {selectable && (
                        <td className="px-4 py-3">
                          <input type="checkbox" aria-label={t.common.selectRow(rowLabel(row))} checked={isSelected} onChange={() => toggle(id)} className="size-4 accent-brand-800" />
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "end" && "text-end", hideClass(c), c.className)}>{c.cell(row)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-4 py-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-2.5 text-secondary">
              {selection.size > 0 && (
                <>
                  <span className="font-medium">{t.common.selected(selection.size)}</span>
                  {bulkActions?.([...selection])}
                </>
              )}
              {selection.size === 0 && <span className="text-muted">{t.common.showing((current - 1) * pageSize + 1, Math.min(current * pageSize, rows.length), totalCount ?? rows.length)}</span>}
            </div>
            <Pagination page={current} pageCount={pageCount} onPageChange={onPageChange} />
          </div>
        </>
      )}
    </div>
  );
}

export function Pagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  const { t } = useI18n();
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  const btn = "inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-medium text-ink disabled:text-disabled";
  return (
    <nav aria-label={t.common.pagination} className="flex items-center gap-1">
      <button type="button" aria-label={t.common.previousPage} className={btn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft aria-hidden className="size-3.5 rtl:-scale-x-100" />
      </button>
      {pages.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && p - pages[i - 1] > 1 && <span className="px-1.5 text-muted">…</span>}
          <button
            type="button"
            aria-current={p === page ? "page" : undefined}
            className={cn(btn, "tabular", p === page && "border-transparent bg-brand-800 text-white")}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        </React.Fragment>
      ))}
      <button type="button" aria-label={t.common.nextPage} className={btn} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        <ChevronRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
      </button>
    </nav>
  );
}

/** Filter control rendered as "Label: Value ▾" on a native select (keyboard + screen-reader friendly). */
export function FilterSelect<V extends string>({ label, value, options, onChange }: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <label className="relative inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info">
      <span aria-hidden>{label}: {current}</span>
      <ChevronDown aria-hidden className="size-3.5" />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function TableToolbar({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {children}
      {summary && <span className="ms-auto text-[13px] text-muted">{summary}</span>}
    </div>
  );
}
