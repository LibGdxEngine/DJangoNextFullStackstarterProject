"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CreditCard, FileImage, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatNumber, formatTime, zoneCity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Tabs } from "@/components/ds/DetailHeader";
import { DataTable, TableToolbar, type Column } from "@/components/ds/DataTable";
import { Checkbox, Field, Input, SearchInput, Select } from "@/components/ds/Field";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog, Dialog, EffectsPreview } from "@/components/ds/Dialog";
import { Money, MoneyByCurrency } from "@/components/ds/Time";
import { EmptyState } from "@/components/ds/States";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { duplicateOf, financeApi, type PaymentRow } from "../finance-api";
import { FinanceGate } from "./FinanceGate";

type StatusTab = "pending" | "approved" | "rejected" | "all";
export const METHODS = ["InstaPay", "Vodafone Cash", "Bank transfer", "Card", "Cash", "Zelle", "STC Pay", "Other"];

export function PaymentsPage() {
  const { t, tag } = useI18n();
  const p = t.payments;
  const { can } = useAccess();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => financeApi.payments());
  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);
  const tab: StatusTab = (["pending", "approved", "rejected", "all"] as const).find((x) => x === params.get("status")) ?? "pending";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<PaymentRow | null>(null);
  const [recording, setRecording] = useState(false);

  const setTab = (next: StatusTab) => {
    setPage(1);
    router.replace(`${pathname}?status=${next}`, { scroll: false });
  };
  const filtered = rows.filter((r) => (tab === "all" || r.payment.status === tab) && (!query || [r.studentName, r.familyName, r.payment.reference].some((v) => v.toLowerCase().includes(query.toLowerCase()))));
  const count = (s: StatusTab) => rows.filter((r) => s === "all" || r.payment.status === s).length;

  const columns: Column<PaymentRow>[] = [
    { key: "date", header: p.date, cell: (r) => <span className="tabular">{formatDate(r.payment.submittedAt, tag)}<span className="block text-xs text-muted">{formatTime(r.payment.submittedAt, settings.timezone, tag)} {zoneCity(settings.timezone, tag)}</span></span> },
    {
      key: "who",
      header: p.payer,
      cell: (r) => (
        <div>
          <Link href={`/manage/students/${r.payment.studentId}?tab=payments`} className="font-medium text-ink hover:text-brand-700">{r.studentName}</Link>
          <div className="text-xs text-muted">{r.familyName}</div>
        </div>
      ),
    },
    { key: "amount", header: p.amount, align: "end", cell: (r) => <Money amount={r.payment.amount} currency={r.payment.currency} className="font-semibold" /> },
    { key: "for", header: p.forPackage, hideBelow: "md", cell: (r) => r.enrollment ? <span>{r.enrollment.packageName}<span className="block text-xs text-muted">{t.status[r.enrollment.status]}</span></span> : "—" },
    { key: "ref", header: p.reference, hideBelow: "lg", cell: (r) => <span>{r.payment.method ?? "—"}<span className="block text-xs text-muted">{r.payment.reference}</span></span> },
    { key: "source", header: p.source, hideBelow: "lg", cell: (r) => <span className="text-xs">{p.sources[r.payment.source]}<span className="block text-muted">{r.payment.submittedBy}</span></span> },
    {
      key: "status",
      header: t.students.colStatus,
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge status={r.payment.status} size="sm" />
          {r.duplicate && <Badge tone="action" size="sm">{p.possibleDuplicate}</Badge>}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t.common.actions}</span>,
      align: "end",
      cell: (r) => (r.payment.status === "pending"
        ? <Button size="sm" variant="primary" locked={!can("manage_finance")} onClick={() => setReviewing(r)}>{p.review}</Button>
        : <Button size="sm" variant="tertiary" onClick={() => setReviewing(r)}>{t.common.view}</Button>),
    },
  ];

  return (
    <FinanceGate title={t.nav.payments}>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.payments }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.payments}
        meta={p.meta}
        actions={<Button variant="primary" locked={!can("manage_finance")} icon={<Plus aria-hidden className="size-4" />} onClick={() => setRecording(true)}>{p.record}</Button>}
      />
      <Tabs idBase="pay" label={t.nav.payments} value={tab} onChange={setTab} items={[
        { key: "pending", label: p.tabs.pending, count: count("pending") },
        { key: "approved", label: p.tabs.approved, count: count("approved") },
        { key: "rejected", label: p.tabs.rejected, count: count("rejected") },
        { key: "all", label: t.common.all, count: count("all") },
      ]} />
      <TableToolbar summary={!isLoading && filtered.length > 0 ? <span className="flex flex-wrap items-center gap-2">{p.total} <MoneyByCurrency items={filtered} amount={(r) => r.payment.amount} currency={(r) => r.payment.currency} className="font-semibold text-ink" /></span> : undefined}>
        <SearchInput label={p.search} placeholder={p.search} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="w-full sm:w-72" />
      </TableToolbar>
      <DataTable
        caption={t.nav.payments}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.payment.id}
        rowLabel={(r) => `${r.studentName} ${formatMoney(r.payment.amount, r.payment.currency, tag)}`}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        errorTitle={p.loadError}
        empty={<EmptyState icon={<CreditCard aria-hidden className="size-[22px]" />} title={tab === "pending" ? p.nothingToReview : p.emptyTitle} description={tab === "pending" ? p.nothingToReviewBody : p.emptyBody} />}
      />
      <p className="text-xs text-muted">{p.currencyNote(formatNumber(count("pending"), tag))}</p>

      {reviewing && <ReviewPaymentDialog row={reviewing} onClose={() => setReviewing(null)} onDone={reload} />}
      {recording && <RecordPaymentDialog onClose={() => setRecording(false)} onDone={reload} />}
    </FinanceGate>
  );
}

/** Receipt review: receipt, amount, currency, package and activation effect, with a duplicate check. */
function ReviewPaymentDialog({ row, onClose, onDone }: { row: PaymentRow; onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const p = t.payments;
  const { can, userName } = useAccess();
  const { payment, enrollment, duplicate } = row;
  const [mode, setMode] = useState<"review" | "reject">("review");
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = payment.status === "pending";
  const currencyMismatch = enrollment && enrollment.currency !== payment.currency;
  const amountShort = enrollment && !currencyMismatch && payment.amount < enrollment.price;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    await action();
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={pending ? p.reviewTitle : p.paymentTitle}
      context={`${row.studentName} · ${row.familyName} · ${formatDate(payment.submittedAt, tag, "long")}`}
      footer={pending && can("manage_finance") ? (
        mode === "review" ? (
          <>
            <Button variant="danger" onClick={() => setMode("reject")}>{p.reject}</Button>
            <Button variant="primary" disabled={busy || (!!duplicate && !checked)} onClick={() => run(() => financeApi.approvePayment(payment.id, userName))}>{busy ? t.common.working : p.approve}</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setMode("review")}>{t.common.back}</Button>
            <Button variant="danger-solid" disabled={busy || !reason.trim()} onClick={() => run(() => financeApi.rejectPayment(payment.id, reason.trim(), userName))}>{p.confirmReject}</Button>
          </>
        )
      ) : <Button onClick={onClose}>{t.common.close}</Button>}
    >
      <div className="flex items-center gap-3 rounded-[10px] border border-line-soft p-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted"><FileImage aria-hidden className="size-7" /></span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{payment.receiptName ?? p.noReceipt}</span>
          <span className="text-xs text-muted">{p.sources[payment.source]} · {payment.submittedBy}</span>
          {payment.receiptName && <button type="button" className="self-start text-xs font-medium text-brand-700">{p.openReceipt}</button>}
        </span>
      </div>

      {duplicate && pending && (
        <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-danger-border bg-danger-bg px-3.5 py-3 text-danger">
          <p className="flex items-start gap-2 font-medium"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{p.duplicateTitle}</p>
          <p className="text-[13px] text-secondary">{p.duplicateBody(formatMoney(duplicate.amount, duplicate.currency, tag), duplicate.reference || "—", formatDate(duplicate.submittedAt, tag, "long"), t.status[duplicate.status])}</p>
          <Checkbox label={p.duplicateCheck} checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        </div>
      )}

      {mode === "reject" ? (
        <Field label={p.rejectReason} required hint={p.rejectHint}>
          {(f) => <Input {...f} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      ) : (
        <EffectsPreview
          title={pending ? undefined : p.details}
          effects={[
            { label: p.amount, value: <Money amount={payment.amount} currency={payment.currency} /> },
            { label: p.method, value: `${payment.method ?? "—"} · ${payment.reference || "—"}` },
            { label: p.forPackage, value: enrollment ? `${enrollment.packageName} · ${formatMoney(enrollment.price, enrollment.currency, tag)}` : "—" },
            ...(currencyMismatch ? [{ label: p.check, value: p.currencyMismatch(enrollment!.currency), tone: "negative" as const }] : []),
            ...(amountShort ? [{ label: p.check, value: p.amountShort(formatMoney(enrollment!.price - payment.amount, payment.currency, tag)), tone: "negative" as const }] : []),
            pending
              ? { label: p.onApproval, value: enrollment?.status === "pending" ? p.activates(enrollment.packageName, formatNumber(enrollment.lessonCount, tag)) : p.noActivation, tone: enrollment?.status === "pending" ? "positive" as const : "plain" as const }
              : { label: t.students.colStatus, value: `${t.status[payment.status]} · ${payment.reviewedBy ?? ""}${payment.reviewReason ? ` — “${payment.reviewReason}”` : ""}` },
            ...(pending ? [{ label: t.dialogs.cancel.notification, value: p.familyNotified }] : []),
          ]}
        />
      )}
    </Dialog>
  );
}

function RecordPaymentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const p = t.payments;
  const { userName } = useAccess();
  const { data } = useResource(() => financeApi.payable());
  const [enrollmentId, setEnrollmentId] = useState("");
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState("EGP");
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [receiptName, setReceiptName] = useState<string | undefined>(undefined);
  const [approveNow, setApproveNow] = useState(true);
  const picked = data?.find((x) => x.enrollment.id === enrollmentId) ?? null;

  function pick(id: string) {
    setEnrollmentId(id);
    const e = data?.find((x) => x.enrollment.id === id)?.enrollment;
    if (e) {
      setAmount(e.price);
      setCurrency(e.currency);
    }
  }

  const draft = picked ? { id: "draft", enrollmentId, studentId: picked.enrollment.studentId, familyId: picked.familyId, amount, currency, reference, status: "pending" as const, submittedAt: new Date().toISOString(), source: "staff_record" as const, submittedBy: userName } : null;
  const duplicate = draft ? duplicateOf(draft) : null;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={p.record}
      confirmLabel={approveNow ? p.recordApprove : p.recordPending}
      canConfirm={!!picked && amount > 0}
      onConfirm={async () => { await financeApi.recordPayment({ enrollmentId, amount, currency, reference: reference.trim(), method, receiptName, approveNow }, userName); onDone(); }}
      effects={picked ? [
        { label: p.amount, value: formatMoney(amount || 0, currency, tag) },
        { label: p.onApproval, value: approveNow ? (picked.enrollment.status === "pending" ? p.activates(picked.enrollment.packageName, formatNumber(picked.enrollment.lessonCount, tag)) : p.noActivation) : p.waitsForReview, tone: approveNow && picked.enrollment.status === "pending" ? "positive" : "plain" },
        ...(duplicate ? [{ label: p.check, value: p.duplicateShort(formatDate(duplicate.submittedAt, tag)), tone: "negative" as const }] : []),
      ] : undefined}
    >
      <Field label={p.forPackage} required>
        {(f) => (
          <Select {...f} value={enrollmentId} onChange={(e) => pick(e.target.value)}>
            <option value="">{t.common.choose}</option>
            {(data ?? []).map((x) => <option key={x.enrollment.id} value={x.enrollment.id}>{x.studentName} · {x.enrollment.packageName} · {t.status[x.enrollment.status]}</option>)}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={p.amount} required>{(f) => <Input {...f} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="tabular" />}</Field>
        <Field label={p.currency} hint={picked && currency !== picked.enrollment.currency ? p.currencyMismatch(picked.enrollment.currency) : undefined}>{(f) => (
          <Select {...f} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["EGP", "USD", "SAR", "GBP", "AED", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}</Field>
        <Field label={p.method}>{(f) => (
          <Select {...f} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}</Field>
        <Field label={p.reference} optionalLabel={t.common.optional}>{(f) => <Input {...f} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      </div>
      <Field label={p.receipt} optionalLabel={t.common.optional}>
        {(f) => <input {...f} type="file" accept="image/*,application/pdf" onChange={(e) => setReceiptName(e.target.files?.[0]?.name)} className={cn("text-[13px] file:me-3 file:h-9 file:rounded-[10px] file:border file:border-line file:bg-surface file:px-3 file:text-[13px] file:font-medium")} />}
      </Field>
      <Checkbox label={p.approveNow} checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} />
    </ConfirmDialog>
  );
}
