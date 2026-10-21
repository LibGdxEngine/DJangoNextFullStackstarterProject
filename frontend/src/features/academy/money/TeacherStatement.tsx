"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CornerDownRight, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Field, Input, Select } from "@/components/ds/Field";
import { Money, MoneyByCurrency } from "@/components/ds/Time";
import { InfoNote } from "@/components/ds/Panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { payrolls } from "../fixtures";
import { useAccess } from "../access";
import { financeApi, type EntryRow, type StatementData } from "../finance-api";
import type { EarningsIssue } from "../types";
import { FinanceGate } from "./FinanceGate";
import { monthLabel, ResolveIssueDialog } from "./PayrollPage";

/** Per-teacher statement for one payroll month. Adjustment rows link to what they correct. */
export function TeacherStatement({ month, teacherId }: { month: string; teacherId: string }) {
  const { t, tag } = useI18n();
  const p = t.payroll;
  const { can } = useAccess();
  const { data, error, isLoading, reload } = useResource(() => financeApi.statement(month, teacherId), [month, teacherId]);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<EarningsIssue | null>(null);

  return (
    <FinanceGate title={t.nav.payroll}>
      {isLoading ? <Card><LoadingState rows={8} /></Card> : error || !data ? <ErrorState title={p.loadError} onRetry={reload} /> : (
        <>
          <PageHeader
            breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.payroll, href: `/manage/payroll?month=${month}` }, { label: data.teacher.name }]}
            breadcrumbLabel={t.common.breadcrumb}
            title={p.statementTitle(data.teacher.name)}
            meta={<span className="flex flex-wrap items-center gap-2">{monthLabel(month, tag)} <StatusBadge status={data.payroll.status} size="sm" /></span>}
            actions={<Button variant="primary" locked={!can("manage_finance")} icon={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>{p.addAdjustment}</Button>}
          />
          <Card className="flex flex-wrap items-center gap-2 p-4 text-[13px]">
            <span className="text-muted">{p.totalFor(monthLabel(month, tag))}</span>
            <MoneyByCurrency items={data.totals} amount={(x) => x.total} currency={(x) => x.currency} className="text-base font-semibold" />
          </Card>
          {(data.payroll.status === "approved" || data.payroll.status === "paid") && <InfoNote>{p.closedNote}</InfoNote>}

          <Card className="overflow-hidden">
            {data.entries.length === 0 ? <EmptyState icon={<Plus aria-hidden className="size-[22px]" />} title={p.noEntries} /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">{p.statementTitle(data.teacher.name)}</caption>
                  <thead>
                    <tr className="bg-page text-xs text-secondary">
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.ledger.date}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.ledger.entry}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.students.colStudent}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{p.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((row) => <EntryLine key={row.entry.id} row={row} data={data} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {data.issues.length > 0 && (
            <section aria-labelledby="issues" className="flex flex-col gap-2">
              <h2 id="issues" className="text-sm font-semibold">{p.issues}</h2>
              <ul className="flex flex-col gap-2">
                {data.issues.map((issue) => (
                  <li key={issue.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line-soft bg-surface p-3.5 text-[13px]">
                    <StatusBadge status={issue.status} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block">“{issue.description}”</span>
                      <span className="text-xs text-muted">{formatDate(issue.createdAt, tag)}{issue.resolution ? ` · ${p.resolvedWith(issue.resolution)}` : ""}</span>
                    </span>
                    {issue.status === "open" && <Button size="sm" locked={!can("manage_finance")} onClick={() => setResolving(issue)}>{p.resolve}</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {adding && <AdjustmentDialog data={data} onClose={() => setAdding(false)} onDone={reload} />}
          {resolving && <ResolveIssueDialog issue={resolving} onClose={() => setResolving(null)} onDone={reload} />}
        </>
      )}
    </FinanceGate>
  );
}

function EntryLine({ row, data }: { row: EntryRow; data: StatementData }) {
  const { t, tag } = useI18n();
  const p = t.payroll;
  const { entry } = row;
  const original = entry.adjustmentOf ? data.originals.find((o) => o.entry.id === entry.adjustmentOf) : null;
  const originalMonth = original?.entry.payrollMonth;
  return (
    <tr className={cn("border-t border-subtle align-top", entry.kind === "adjustment" && "bg-st-pending-bg/30")}>
      <td className="px-4 py-3 tabular">{formatDate(entry.earnedOn, tag)}</td>
      <td className="px-4 py-3">
        <span className="block font-medium">{t.sessionDetail.earningKind[entry.kind]}{row.sessionNumber && <> · <Link href={`/manage/sessions/${entry.sessionId}`} className="text-brand-700 tabular">#{formatRef(row.sessionNumber, tag)}</Link></>}</span>
        <span className="text-xs text-muted">{entry.reason}{entry.createdBy ? ` · ${t.ledger.by(entry.createdBy)}` : ""}</span>
        {original && originalMonth && (
          <span className="mt-1 flex items-center gap-1 text-xs text-st-pending">
            <CornerDownRight aria-hidden className="size-3 rtl:-scale-x-100" />
            {p.adjusts(formatMoney(original.entry.amount, original.entry.currency, tag), monthLabel(originalMonth, tag), t.status[payrolls.find((x) => x.month === originalMonth)?.status ?? "draft"])}
          </span>
        )}
      </td>
      <td className="px-4 py-3">{row.studentName ?? "—"}</td>
      <td className={cn("px-4 py-3 text-end font-semibold", entry.amount < 0 && "text-st-review")}><Money amount={entry.amount} currency={entry.currency} /></td>
    </tr>
  );
}

function AdjustmentDialog({ data, onClose, onDone }: { data: StatementData; onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const p = t.payroll;
  const { userName } = useAccess();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [adjusts, setAdjusts] = useState("");
  const currencies = [...new Set(data.entries.map((r) => r.entry.currency))];
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const target = data.payroll.status === "approved" || data.payroll.status === "paid"
    ? payrolls.filter((x) => x.month > data.payroll.month && (x.status === "draft" || x.status === "reviewed")).sort((a, b) => a.month.localeCompare(b.month))[0]?.month
    : data.payroll.month;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={p.addAdjustment}
      context={data.teacher.name}
      confirmLabel={p.addAdjustment}
      canConfirm={amount !== 0 && reason.trim().length > 0}
      onConfirm={async () => { await financeApi.addAdjustment({ teacherId: data.teacher.id, amount, currency, reason: reason.trim(), adjustmentOf: adjusts || undefined }, userName); onDone(); }}
      effects={[
        { label: p.adjustmentRow, value: amount ? `${amount > 0 ? "+" : ""}${formatMoney(amount, currency, tag)}` : "—", tone: amount > 0 ? "positive" : amount < 0 ? "negative" : "plain" },
        { label: p.landsIn, value: target ? monthLabel(target, tag) : p.nextOpen },
        { label: p.originalRows, value: p.untouched },
      ]}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={p.amount} required hint={p.signHint}>{(f) => <Input {...f} type="number" step="0.5" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="tabular" />}</Field>
        <Field label={t.payments.currency}>{(f) => (
          <Select {...f} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(currencies.length ? currencies : ["USD"]).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}</Field>
      </div>
      <Field label={p.correcting} optionalLabel={t.common.optional}>{(f) => (
        <Select {...f} value={adjusts} onChange={(e) => setAdjusts(e.target.value)}>
          <option value="">{p.standalone}</option>
          {data.entries.filter((r) => r.entry.kind !== "adjustment").map((r) => <option key={r.entry.id} value={r.entry.id}>{formatDate(r.entry.earnedOn, tag)} · {r.studentName ?? ""} · {formatMoney(r.entry.amount, r.entry.currency, tag)}</option>)}
        </Select>
      )}</Field>
      <Field label={t.dialogs.adjust.reason} required>{(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}
