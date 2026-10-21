"use client";

import React, { useState } from "react";
import { CheckCircle2, RefreshCw, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/Button";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Field, Input, Select } from "@/components/ds/Field";
import { Money } from "@/components/ds/Time";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { useFamilyChild } from "@/components/shells/FamilyShell";
import { families } from "../fixtures";
import { financeApi, type FamilyMoney } from "../finance-api";
import { RenewDialog } from "../money/PackagesPage";
import { METHODS } from "../money/PaymentsPage";
import type { Enrollment } from "../types";

export function FamilyPayments() {
  const { t } = useI18n();
  const { familyId, childId, isAdultAccount } = useFamilyChild();
  const { data, error, isLoading, reload } = useResource(() => financeApi.familyMoney(familyId), [familyId]);
  const [sent, setSent] = useState<string | null>(null);
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;
  const shown = childId === "all" ? data.children : data.children.filter((c) => c.student.id === childId);
  const payer = families.find((f) => f.id === familyId)?.contacts[0]?.name ?? "";

  return (
    <>
      <h1 className="text-[22px] font-semibold">{t.familyNav.payments}</h1>
      {sent && <p role="status" className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800"><CheckCircle2 aria-hidden className="size-4 shrink-0" />{sent}</p>}
      {shown.map((child) => (
        <ChildMoney key={child.student.id} child={child} threshold={data.threshold} isAdult={isAdultAccount} showName={childId === "all"} payer={payer} onChanged={(message) => { setSent(message); reload(); }} />
      ))}
      <p className="text-xs text-muted">{t.familyPayments.currencyNote}</p>
    </>
  );
}

function ChildMoney({ child, threshold, isAdult, showName, payer, onChanged }: {
  child: FamilyMoney["children"][number];
  threshold: number;
  isAdult: boolean;
  showName: boolean;
  payer: string;
  onChanged: (message: string) => void;
}) {
  const { t, tag } = useI18n();
  const fp = t.familyPayments;
  const { student, current, pending, payments } = child;
  const [renewing, setRenewing] = useState(false);
  const [uploadFor, setUploadFor] = useState<Enrollment | null>(null);
  const low = current ? current.balance <= threshold : true;
  const first = student.name.split(" ")[0];
  const pendingPaymentFor = (id: string) => payments.find((p) => p.enrollmentId === id && p.status === "pending");

  return (
    <section aria-label={student.name} className="flex flex-col gap-3">
      {showName && <h2 className="pt-1 text-sm font-semibold">{student.name}</h2>}

      <article className={cn("flex flex-col gap-2 rounded-class border p-[18px]", low ? "border-accent-border bg-accent-50" : "border-line-soft bg-surface")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{isAdult ? fp.yourPackage : fp.childPackage(first)}</span>
          {current && <StatusBadge status="active" size="sm" />}
        </div>
        {current ? (
          <>
            <div className="text-lg font-semibold">{current.packageName}</div>
            <div className="text-3xl font-semibold tabular">{formatNumber(current.balance, tag)} <span className="text-sm font-normal text-muted">{fp.of(formatNumber(current.lessonCount, tag))}</span></div>
            <div className="h-2 rounded-full bg-subtle"><div className={cn("h-full rounded-full", low ? "bg-accent-600" : "bg-brand-700")} style={{ width: `${Math.min(100, (current.balance / Math.max(current.lessonCount, 1)) * 100)}%` }} /></div>
            <div className="text-xs text-muted tabular">{fp.validUntil(formatDate(current.expiresOn, tag, "long"))}</div>
            {low && pending.length === 0 && <p className="text-[13px] font-medium text-accent-ink">{isAdult ? fp.lowYou : fp.lowChild(first)}</p>}
          </>
        ) : <p className="text-[13px] text-muted">{fp.noPackage}</p>}
        {pending.length === 0 && (
          <Button variant={low ? "primary" : "secondary"} className="mt-1 h-11 rounded-xl" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => setRenewing(true)}>{fp.renew}</Button>
        )}
      </article>

      {pending.map((e) => {
        const waiting = pendingPaymentFor(e.id);
        return (
          <article key={e.id} className="flex flex-col gap-2 rounded-2xl border border-st-pending-bg bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{e.packageName}</span>
              <StatusBadge status="pending" size="sm" />
            </div>
            <div className="text-[13px]"><Money amount={e.price} currency={e.currency} className="font-semibold" /> · {fp.startsWhen(formatDate(e.startsOn, tag))}</div>
            {waiting ? (
              <p className="text-[13px] text-st-pending">{fp.receiptWaiting(formatDate(waiting.submittedAt, tag))}</p>
            ) : (
              <>
                <p className="text-[13px] text-muted">{fp.payToActivate}</p>
                <Button variant="primary" className="h-11 rounded-xl" icon={<Upload aria-hidden className="size-4" />} onClick={() => setUploadFor(e)}>{fp.uploadReceipt}</Button>
              </>
            )}
          </article>
        );
      })}

      <section aria-label={fp.history} className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">{fp.history}</h3>
        {payments.length === 0 ? <p className="text-[13px] text-muted">{fp.noPayments}</p> : (
          <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <Money amount={p.amount} currency={p.currency} className="font-semibold" />
                  <StatusBadge status={p.status} size="sm" />
                </div>
                <span className="text-xs text-muted tabular">{formatDate(p.submittedAt, tag)} · {p.method ?? p.reference}{p.receiptName ? ` · ${p.receiptName}` : ""}</span>
                {p.status === "rejected" && <span className="text-xs text-st-action">{fp.rejected(p.reviewReason ?? "")}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {renewing && (
        <RenewDialog
          audience="family"
          studentId={student.id}
          studentName={isAdult ? fp.you : student.name}
          current={current}
          onClose={() => setRenewing(false)}
          onDone={() => onChanged(fp.renewalCreated)}
        />
      )}
      {uploadFor && <UploadReceiptDialog enrollment={uploadFor} payer={payer} onClose={() => setUploadFor(null)} onDone={() => onChanged(fp.uploaded)} />}
    </section>
  );
}

function UploadReceiptDialog({ enrollment, payer, onClose, onDone }: { enrollment: Enrollment; payer: string; onClose: () => void; onDone: () => void }) {
  const { t, tag } = useI18n();
  const fp = t.familyPayments;
  const [amount, setAmount] = useState(enrollment.price);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={fp.uploadReceipt}
      context={`${enrollment.packageName} · ${formatMoney(enrollment.price, enrollment.currency, tag)}`}
      confirmLabel={fp.send}
      canConfirm={!!file && amount > 0}
      onConfirm={async () => { await financeApi.uploadReceipt({ enrollmentId: enrollment.id, amount, currency: enrollment.currency, reference: reference.trim(), method, receiptName: file! }, payer); onDone(); }}
      effects={[
        { label: t.payments.amount, value: formatMoney(amount || 0, enrollment.currency, tag), tone: amount < enrollment.price ? "negative" : "plain" },
        { label: fp.next, value: fp.nextValue(formatNumber(enrollment.lessonCount, tag)) },
      ]}
    >
      <Field label={fp.receiptFile} required hint={fp.fileHint}>
        {(f) => <input {...f} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} className="min-h-11 text-[13px] file:me-3 file:h-11 file:rounded-[10px] file:border file:border-line file:bg-surface file:px-3 file:text-[13px] file:font-medium" />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={fp.amountPaid(enrollment.currency)} required error={amount < enrollment.price ? fp.lessThanPrice : undefined}>{(f) => <Input {...f} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-11 tabular" />}</Field>
        <Field label={t.payments.method}>{(f) => (
          <Select {...f} value={method} onChange={(e) => setMethod(e.target.value)} className="[&_select]:h-11">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}</Field>
      </div>
      <Field label={t.payments.reference} optionalLabel={t.common.optional} hint={fp.referenceHint}>{(f) => <Input {...f} value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />}</Field>
    </ConfirmDialog>
  );
}
