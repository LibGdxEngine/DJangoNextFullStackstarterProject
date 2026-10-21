"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Lock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { Select, Field, Input, Textarea } from "@/components/ds/Field";
import { Stepper } from "@/components/ds/Stepper";
import { Avatar } from "@/components/ds/DetailHeader";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { MoneyByCurrency } from "@/components/ds/Time";
import { InfoNote } from "@/components/ds/Panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { useAccess } from "../access";
import { financeApi, NEXT_PAYROLL_STATUS } from "../finance-api";
import type { EarningsIssue, PayrollStatus } from "../types";
import { FinanceGate } from "./FinanceGate";

const STEPS: PayrollStatus[] = ["draft", "reviewed", "approved", "paid"];

export function monthLabel(month: string, tag: string) {
  return new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

export function PayrollPage() {
  const { t, tag } = useI18n();
  const p = t.payroll;
  const { can, userName } = useAccess();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [version, setVersion] = useState(0);
  // Month labels carry the status, so refetch them whenever a transition happens.
  const { data: months } = useResource(() => financeApi.payrollMonths(), [version]);
  const month = params.get("month") ?? months?.find((m) => m.status !== "paid")?.month ?? months?.[0]?.month ?? "";
  const { data, error, isLoading, reload: reloadPayroll } = useResource(() => (month ? financeApi.payroll(month) : Promise.reject(new Error("no month"))), [month]);
  const reload = () => {
    reloadPayroll();
    setVersion((v) => v + 1);
  };
  const [dialog, setDialog] = useState<PayrollStatus | null>(null);
  const [resolving, setResolving] = useState<EarningsIssue | null>(null);
  const [reference, setReference] = useState("");

  const status = data?.payroll.status ?? "draft";
  const next = NEXT_PAYROLL_STATUS[status];
  const closed = status === "approved" || status === "paid";
  const exceptions = data ? data.exceptions.openIssues.length + data.exceptions.unreported + data.exceptions.needsReview : 0;

  return (
    <FinanceGate title={t.nav.payroll}>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.payroll }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.payroll}
        meta={p.meta}
        actions={months && (
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">{p.month}</span>
            <Select value={month} onChange={(e) => router.replace(`${pathname}?month=${e.target.value}`, { scroll: false })} className="w-48">
              {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month, tag)} · {t.status[m.status]}</option>)}
            </Select>
          </label>
        )}
      />
      {isLoading || !month ? <Card><LoadingState rows={8} /></Card> : error || !data ? <ErrorState title={p.loadError} onRetry={reload} /> : (
        <>
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">{monthLabel(month, tag)}</h2>
                <p className="text-[13px] text-muted">{p.statusLine(t.status[status], data.payroll.approvedBy, data.payroll.paymentReference)}</p>
              </div>
              {next && (
                <Button variant={next === "approved" ? "danger-solid" : "primary"} locked={!can("manage_finance")} onClick={() => setDialog(next)} icon={next === "approved" ? <Lock aria-hidden className="size-4" /> : undefined}>
                  {p.actions[next]}
                </Button>
              )}
            </div>
            <Stepper steps={STEPS.map((s) => t.status[s])} current={STEPS.indexOf(status) + (status === "paid" ? 1 : 0)} label={p.workflow} stepOf={t.common.stepOf} />
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-muted">{p.totals}</span>
              <MoneyByCurrency items={data.totals} amount={(x) => x.total} currency={(x) => x.currency} className="font-semibold" />
            </div>
            {closed && <InfoNote>{p.closedNote}</InfoNote>}
          </Card>

          {exceptions > 0 && !closed && (
            <section aria-labelledby="exceptions" className="flex flex-col gap-2 rounded-card border border-accent-border bg-accent-50/60 p-5">
              <h2 id="exceptions" className="flex items-center gap-2 text-sm font-semibold text-accent-ink"><AlertTriangle aria-hidden className="size-4" />{p.exceptions(exceptions)}</h2>
              <ul className="flex flex-col gap-2 text-[13px]">
                {data.exceptions.openIssues.map((issue) => (
                  <li key={issue.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft bg-surface p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.issueFrom(data.teachers.find((x) => x.teacher.id === issue.teacherId)?.teacher.name ?? "")}</span>
                      <span className="text-muted">“{issue.description}”</span>
                    </span>
                    <Button size="sm" locked={!can("manage_finance")} onClick={() => setResolving(issue)}>{p.resolve}</Button>
                  </li>
                ))}
                {data.exceptions.unreported > 0 && <li><Link href="/manage/sessions?status=report_due&range=last30" className="font-medium text-accent-ink underline-offset-2 hover:underline">{p.unreported(data.exceptions.unreported)}</Link></li>}
                {data.exceptions.needsReview > 0 && <li><Link href="/manage/sessions?status=needs_review&range=all" className="font-medium text-accent-ink underline-offset-2 hover:underline">{p.needsReview(data.exceptions.needsReview)}</Link></li>}
              </ul>
            </section>
          )}

          <Card className="overflow-hidden">
            {data.teachers.length === 0 ? <EmptyState icon={<Lock aria-hidden className="size-[22px]" />} title={p.empty} /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{p.teachersCaption}</caption>
                  <thead>
                    <tr className="bg-page text-xs text-secondary">
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.students.colTeacher}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{p.sessions}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{p.adjustments}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{p.earned}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{p.flags}</th>
                      <th scope="col" className="px-4 py-2.5"><span className="sr-only">{p.statement}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teachers.map((row) => (
                      <tr key={row.teacher.id} className="border-t border-subtle">
                        <td className="px-4 py-3"><span className="flex items-center gap-2.5"><Avatar name={row.teacher.name} />{row.teacher.name}</span></td>
                        <td className="px-4 py-3 text-end tabular">{formatNumber(row.sessions, tag)}</td>
                        <td className="px-4 py-3 text-end tabular">{formatNumber(row.adjustments, tag)}</td>
                        <td className="px-4 py-3 text-end font-semibold"><MoneyByCurrency items={row.totals} amount={(x) => x.total} currency={(x) => x.currency} className="justify-end" /></td>
                        <td className="px-4 py-3">
                          <span className="flex flex-wrap gap-1.5">
                            {row.openIssues > 0 && <StatusBadge status="open" size="sm" />}
                            {row.unreported > 0 && <StatusBadge status="report_due" size="sm" />}
                            {row.openIssues + row.unreported === 0 && <span className="text-muted">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Link href={`/manage/payroll/${month}/${row.teacher.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">{p.statement}<ChevronRight aria-hidden className="size-3.5 rtl:-scale-x-100" /></Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-muted">{p.currencyNote}</p>
        </>
      )}

      {data && dialog && (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          tone={dialog === "approved" ? "danger" : "primary"}
          title={p.dialogTitle[dialog as Exclude<PayrollStatus, "draft">](monthLabel(month, tag))}
          confirmLabel={p.actions[dialog]}
          typedConfirmation={dialog === "approved" ? t.dialogs.payroll.word : undefined}
          canConfirm={dialog !== "paid" || reference.trim().length > 0}
          onConfirm={async () => { await financeApi.transitionPayroll(month, dialog, userName, reference.trim() || undefined); setReference(""); reload(); }}
          effects={[
            { label: t.dialogs.payroll.exceptions, value: exceptions ? p.exceptions(exceptions) : t.dialogs.reschedule.none, tone: exceptions ? "negative" : "positive" },
            { label: t.dialogs.payroll.totals, value: <MoneyByCurrency items={data.totals} amount={(x) => x.total} currency={(x) => x.currency} /> },
            { label: t.dialogs.payroll.finality, value: p.finality[dialog as Exclude<PayrollStatus, "draft">] },
          ]}
        >
          {dialog === "paid" && <Field label={p.paymentReference} required hint={p.paymentReferenceHint}>{(f) => <Input {...f} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
        </ConfirmDialog>
      )}
      {resolving && <ResolveIssueDialog issue={resolving} onClose={() => setResolving(null)} onDone={reload} />}
    </FinanceGate>
  );
}

export function ResolveIssueDialog({ issue, onClose, onDone }: { issue: EarningsIssue; onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const p = t.payroll;
  const { userName } = useAccess();
  const { data } = useResource(() => financeApi.teacherEarnings(issue.teacherId), [issue.teacherId]);
  const entry = data?.months.flatMap((m) => m.entries).find((r) => r.entry.id === issue.entryId)?.entry;
  const [resolution, setResolution] = useState("");
  const [amount, setAmount] = useState(0);
  const currency = entry?.currency ?? "USD";
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={p.resolveTitle}
      context={`“${issue.description}”`}
      confirmLabel={p.resolve}
      canConfirm={resolution.trim().length > 0}
      onConfirm={async () => { await financeApi.resolveIssue(issue.id, resolution.trim(), amount ? { amount, currency } : null, userName); onDone(); }}
      effects={[
        { label: p.originalEntry, value: entry ? `${formatMoney(entry.amount, entry.currency, tag)} · ${formatDate(entry.earnedOn, tag)}` : "—" },
        { label: p.adjustmentRow, value: amount ? `${amount > 0 ? "+" : ""}${formatMoney(amount, currency, tag)}` : p.noAdjustment, tone: amount > 0 ? "positive" : amount < 0 ? "negative" : "plain" },
        { label: p.teacherSees, value: p.teacherSeesValue },
      ]}
    >
      <Field label={p.resolution} required>{(f) => <Textarea {...f} rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />}</Field>
      <Field label={p.adjustAmount(currency)} optionalLabel={t.common.optional} hint={p.adjustHint}>{(f) => <Input {...f} type="number" step="0.5" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-32 tabular" />}</Field>
    </ConfirmDialog>
  );
}
