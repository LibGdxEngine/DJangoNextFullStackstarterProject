"use client";

import React, { useState } from "react";
import { CornerDownRight, MessageSquareWarning, Wallet } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/Button";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Field, Select, Textarea } from "@/components/ds/Field";
import { Money, MoneyByCurrency } from "@/components/ds/Time";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { CURRENT_TEACHER_ID } from "../teacher-api";
import { financeApi, type EntryRow } from "../finance-api";
import { monthLabel } from "../money/PayrollPage";

export function TeacherEarnings() {
  const { t, tag } = useI18n();
  const e = t.earnings;
  const { data, error, isLoading, reload } = useResource(() => financeApi.teacherEarnings(CURRENT_TEACHER_ID));
  const [month, setMonth] = useState<string | null>(null);
  const [reporting, setReporting] = useState<EntryRow | "general" | null>(null);
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;

  const current = data.months.find((m) => m.month === month) ?? data.months[0];
  if (!current) return <EmptyState icon={<Wallet aria-hidden className="size-[22px]" />} title={e.empty} />;
  const status = current.payroll.status;

  return (
    <>
      <h1 className="text-[22px] font-semibold">{t.teacherNav.earnings}</h1>
      <div role="radiogroup" aria-label={e.month} className="flex gap-2 overflow-x-auto">
        {data.months.map((m) => (
          <button key={m.month} type="button" role="radio" aria-checked={m.month === current.month} onClick={() => setMonth(m.month)} className={cn("h-11 shrink-0 rounded-full border px-4 text-[13px] font-medium", m.month === current.month ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-surface")}>
            {monthLabel(m.month, tag)}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2 rounded-class bg-brand-800 p-[18px] text-white" aria-labelledby="month-total">
        <div className="flex items-center justify-between gap-2">
          <span id="month-total" className="text-xs text-brand-300">{e.total(monthLabel(current.month, tag))}</span>
          <StatusBadge status={status} size="sm" />
        </div>
        {current.totals.length ? <MoneyByCurrency items={current.totals} amount={(x) => x.total} currency={(x) => x.currency} className="text-2xl font-semibold" /> : <span className="text-2xl font-semibold">—</span>}
        <p className="text-xs text-brand-100">{e.statusExplain[status](current.payroll.paidAt ? formatDate(current.payroll.paidAt, tag) : "", current.payroll.paymentReference ?? "")}</p>
        <p className="text-xs text-brand-300">{e.ratesNote}</p>
      </section>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{e.entries}</h2>
        <Button size="sm" icon={<MessageSquareWarning aria-hidden className="size-4" />} onClick={() => setReporting("general")} className="h-10">{e.reportIssue}</Button>
      </div>
      {current.entries.length === 0 ? <p className="text-[13px] text-muted">{e.noEntries}</p> : (
        <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
          {current.entries.map((row) => (
            <li key={row.entry.id} className={cn("flex flex-col gap-1 px-4 py-3 text-[13px]", row.entry.kind === "adjustment" && "bg-st-pending-bg/30")}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{row.studentName ?? t.sessionDetail.earningKind[row.entry.kind]}{row.sessionNumber && <span className="text-xs font-normal text-muted tabular"> · #{formatRef(row.sessionNumber, tag)}</span>}</span>
                  <span className="text-xs text-muted">{formatDate(row.entry.earnedOn, tag)} · {t.sessionDetail.earningKind[row.entry.kind]}</span>
                </span>
                <Money amount={row.entry.amount} currency={row.entry.currency} className={cn("shrink-0 font-semibold", row.entry.amount < 0 && "text-st-review")} />
              </div>
              {row.entry.adjustmentOf && <span className="flex items-center gap-1 text-xs text-st-pending"><CornerDownRight aria-hidden className="size-3 rtl:-scale-x-100" />{e.correction(row.entry.reason)}</span>}
              {status !== "paid" && (
                <button type="button" onClick={() => setReporting(row)} className="min-h-9 self-start text-xs font-medium text-brand-700">{e.questionThis}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.issues.length > 0 && (
        <section aria-labelledby="my-issues" className="flex flex-col gap-2">
          <h2 id="my-issues" className="text-sm font-semibold">{e.yourIssues}</h2>
          <ul className="flex flex-col gap-2">
            {data.issues.map((issue) => (
              <li key={issue.id} className="flex flex-col gap-1 rounded-2xl border border-line-soft bg-surface p-3.5 text-[13px]">
                <span className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{formatDate(issue.createdAt, tag)}</span><StatusBadge status={issue.status} size="sm" /></span>
                <span>“{issue.description}”</span>
                {issue.resolution && <span className="text-xs text-success">{e.answer(issue.resolution)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reporting && (
        <ReportIssueDialog
          entries={current.entries}
          initial={reporting === "general" ? null : reporting}
          onClose={() => setReporting(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

function ReportIssueDialog({ entries, initial, onClose, onDone }: { entries: EntryRow[]; initial: EntryRow | null; onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const e = t.earnings;
  const [entryId, setEntryId] = useState(initial?.entry.id ?? "");
  const [description, setDescription] = useState("");
  const row = entries.find((r) => r.entry.id === entryId);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={e.reportIssue}
      confirmLabel={e.send}
      canConfirm={!!row && description.trim().length > 5}
      onConfirm={async () => { await financeApi.reportIssue(CURRENT_TEACHER_ID, { entryId: row!.entry.id, sessionId: row!.entry.sessionId, description: description.trim() }); onDone(); }}
      effects={row ? [
        { label: e.about, value: `${row.studentName ?? t.sessionDetail.earningKind[row.entry.kind]} · ${formatDate(row.entry.earnedOn, tag)} · ${formatMoney(row.entry.amount, row.entry.currency, tag)}` },
        { label: e.next, value: e.nextValue },
      ] : undefined}
    >
      <Field label={e.whichEntry} required hint={e.whichHint}>
        {(f) => (
          <Select {...f} value={entryId} onChange={(ev) => setEntryId(ev.target.value)}>
            <option value="">{t.common.choose}</option>
            {entries.map((r) => <option key={r.entry.id} value={r.entry.id}>{formatDate(r.entry.earnedOn, tag)} · {r.studentName ?? t.sessionDetail.earningKind[r.entry.kind]} · {formatMoney(r.entry.amount, r.entry.currency, tag)}</option>)}
          </Select>
        )}
      </Field>
      <Field label={e.whatsWrong} required>{(f) => <Textarea {...f} rows={3} value={description} onChange={(ev) => setDescription(ev.target.value)} />}</Field>
    </ConfirmDialog>
  );
}
