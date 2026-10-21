"use client";

import React, { useState } from "react";
import { AlertTriangle, FileImage } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMoney } from "@/lib/format";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Checkbox, ChoiceCard, Field, Input, Select } from "@/components/ds/Field";
import { MultiZoneTimes, MoneyByCurrency } from "@/components/ds/Time";
import { Button } from "@/components/ds/Button";
import { LockedField } from "@/components/ds/States";
import { useAccess } from "../access";
import { ArchiveStudentDialog } from "./ArchiveStudentDialog";
import { AdjustBalanceDialog } from "./AdjustBalanceDialog";

type Variant = "cancel" | "reschedule" | "substitute" | "adjust" | "attendance" | "payment" | "payroll" | "archive";

/** Demo instant: next Tuesday 13:00 UTC (16:00 Cairo / 16:00 Istanbul). */
function demoIso(hourUtc: number, dayOffset = 2) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

/** All eight confirmation dialogs on one reusable frame, with sample data. */
export function DialogVariants() {
  const { t, tag } = useI18n();
  const d = t.dialogs;
  const { can } = useAccess();
  const [open, setOpen] = useState<Variant | null>(null);
  const close = () => setOpen(null);
  const done = () => undefined;

  const [initiator, setInitiator] = useState<"family_late" | "family_early" | "teacher" | "academy">("family_late");
  const [waive, setWaive] = useState(false);
  const [newTime, setNewTime] = useState("17:00");
  const [substitute, setSubstitute] = useState("t-huda");
  const [notifyFamily, setNotifyFamily] = useState(true);
  const [attendance, setAttendance] = useState<"present" | "late">("present");

  const iso = demoIso(13);
  const zones = [
    { role: t.zones.family, timeZone: "Africa/Cairo" },
    { role: t.zones.teacher, timeZone: "Europe/Istanbul" },
  ];
  const lateFamily = initiator === "family_late";
  const [h, m] = newTime.split(":").map(Number);
  const newIso = demoIso(h - 3 + m / 60, 3);
  const conflict = newTime === "16:00";

  const variants: { key: Variant; label: string }[] = [
    { key: "cancel", label: d.cancel.title },
    { key: "reschedule", label: d.reschedule.title },
    { key: "substitute", label: d.substitute.title },
    { key: "adjust", label: d.adjust.title },
    { key: "attendance", label: d.attendance.title },
    { key: "payment", label: d.payment.title },
    { key: "payroll", label: d.payroll.title },
    { key: "archive", label: d.archive.title("Faris Zayed") },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => <Button key={v.key} size="sm" onClick={() => setOpen(v.key)}>{v.label}</Button>)}
      </div>

      <ConfirmDialog
        open={open === "cancel"}
        onClose={close}
        onConfirm={done}
        tone="danger"
        title={d.cancel.title}
        context={<>Yusuf Ahmed · <MultiZoneTimes variant="inline" iso={iso} zones={zones} /></>}
        confirmLabel={d.cancel.confirm}
        cancelLabel={d.cancel.keep}
        effects={[
          { label: d.cancel.balance, value: lateFamily && !waive ? d.cancel.minusOne : d.cancel.noChange, tone: lateFamily && !waive ? "negative" : "plain" },
          { label: d.cancel.teacherPay, value: lateFamily ? `${d.cancel.paidHalf} · ${formatMoney(4.5, "USD", tag)}` : d.cancel.notPaid },
          { label: d.cancel.notification, value: d.cancel.whatsappBoth },
        ]}
      >
        <Field label={d.cancel.initiator}>
          {(p) => (
            <Select {...p} value={initiator} onChange={(e) => setInitiator(e.target.value as typeof initiator)}>
              <option value="family_late">{d.cancel.familyLate}</option>
              <option value="family_early">{d.cancel.familyEarly}</option>
              <option value="teacher">{d.cancel.teacher}</option>
              <option value="academy">{d.cancel.academy}</option>
            </Select>
          )}
        </Field>
        <Field label={d.cancel.reason}>{(p) => <Input {...p} defaultValue={d.cancel.reasonSample} />}</Field>
        {lateFamily && <Checkbox label={d.cancel.waive} checked={waive} onChange={(e) => setWaive(e.target.checked)} />}
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "reschedule"}
        onClose={close}
        onConfirm={done}
        title={d.reschedule.title}
        context="Yusuf Ahmed · Ust. Kareem Said"
        confirmLabel={d.reschedule.confirm}
        canConfirm={!conflict}
        effects={[
          { label: d.reschedule.from, value: <MultiZoneTimes variant="inline" iso={iso} zones={zones} /> },
          { label: d.reschedule.to, value: <MultiZoneTimes variant="inline" iso={newIso} zones={zones} /> },
          { label: d.reschedule.conflicts, value: conflict ? d.reschedule.conflictWith : d.reschedule.none, tone: conflict ? "negative" : "positive" },
          { label: d.cancel.notification, value: d.cancel.whatsappBoth },
        ]}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.reschedule.newDate}>{(p) => <Input {...p} type="date" defaultValue={newIso.slice(0, 10)} className="tabular" />}</Field>
          <Field label={d.reschedule.newTime} hint={d.reschedule.inZone}>{(p) => (
            <Select {...p} value={newTime} onChange={(e) => setNewTime(e.target.value)}>
              {["15:00", "16:00", "17:00", "18:30"].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          )}</Field>
        </div>
        {conflict && <p role="alert" className="flex items-center gap-1.5 text-danger"><AlertTriangle aria-hidden className="size-3.5" />{d.reschedule.blocked}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "substitute"}
        onClose={close}
        onConfirm={done}
        title={d.substitute.title}
        context={<>Yusuf Ahmed · <MultiZoneTimes variant="inline" iso={iso} zones={zones} /></>}
        confirmLabel={d.substitute.confirm}
        effects={[
          { label: d.substitute.who, value: substitute === "t-huda" ? "Ust. Huda Rahman" : "Ust. Bilal Okafor" },
          { label: d.substitute.rate, value: can("view_finance") ? (substitute === "t-huda" ? `${formatMoney(30, "SAR", tag)} ${d.substitute.forSession}` : `${formatMoney(7, "GBP", tag)} ${d.substitute.forSession}`) : t.common.hiddenForRole },
          { label: d.cancel.notification, value: notifyFamily ? d.substitute.familyNotified : d.substitute.familyNotNotified },
        ]}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 font-medium text-secondary">{d.substitute.available}</legend>
          <ChoiceCard name="sub" value="t-huda" checked={substitute === "t-huda"} onChange={setSubstitute} title="Ust. Huda Rahman" description={d.substitute.freeAt("17:00 Riyadh")} />
          <ChoiceCard name="sub" value="t-bilal" checked={substitute === "t-bilal"} onChange={setSubstitute} title="Ust. Bilal Okafor" description={d.substitute.freeAt("14:00 London")} />
        </fieldset>
        {!can("view_finance") && <LockedField label={d.substitute.rate} reason={t.common.hiddenForRole} />}
        <Checkbox label={d.substitute.notify} checked={notifyFamily} onChange={(e) => setNotifyFamily(e.target.checked)} />
      </ConfirmDialog>

      <AdjustBalanceDialog open={open === "adjust"} onClose={close} enrollment={{ id: "e-yusuf", packageName: "Recitation 12", balance: 7 }} studentName="Yusuf Ahmed" onAdjusted={done} />

      <ConfirmDialog
        open={open === "attendance"}
        onClose={close}
        onConfirm={done}
        title={d.attendance.title}
        context={<>Maryam Saleh · <MultiZoneTimes variant="inline" iso={demoIso(15, -1)} zones={[{ role: t.zones.family, timeZone: "Asia/Riyadh" }, { role: t.zones.teacher, timeZone: "Asia/Riyadh" }]} /></>}
        confirmLabel={d.attendance.confirm}
        effects={[
          { label: d.attendance.original, value: t.status.absent },
          { label: d.attendance.corrected, value: t.status[attendance] },
          { label: d.attendance.deduction, value: d.attendance.deductionValue, tone: "negative" },
          { label: d.attendance.earnings, value: d.attendance.earningsValue(formatMoney(36, "SAR", tag)), tone: "positive" },
        ]}
      >
        <Field label={d.attendance.newValue}>{(p) => (
          <Select {...p} value={attendance} onChange={(e) => setAttendance(e.target.value as typeof attendance)}>
            <option value="present">{t.status.present}</option>
            <option value="late">{t.status.late}</option>
          </Select>
        )}</Field>
        <Field label={d.attendance.reason} required>{(p) => <Input {...p} defaultValue={d.attendance.reasonSample} />}</Field>
        <p className="text-xs text-muted">{d.attendance.separate}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "payment"}
        onClose={close}
        onConfirm={done}
        title={d.payment.title}
        context="Omar Khalil · Zelle"
        confirmLabel={d.payment.confirm}
        effects={[
          { label: d.payment.amount, value: formatMoney(40, "USD", tag) },
          { label: d.payment.package, value: "Memorization 8" },
          { label: d.payment.activation, value: d.payment.activationValue, tone: "positive" },
        ]}
      >
        <div className="flex items-center gap-3 rounded-[10px] border border-line-soft p-3">
          <span className="flex size-14 items-center justify-center rounded-lg bg-subtle text-muted"><FileImage aria-hidden className="size-6" /></span>
          <span className="flex flex-col"><span className="font-medium">zelle.png</span><span className="text-xs text-muted">{d.payment.uploaded}</span></span>
        </div>
        <div className="flex items-start gap-2 rounded-[10px] border border-st-pending-bg bg-st-pending-bg/60 px-3 py-2.5 text-st-pending">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />{d.payment.duplicate}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "payroll"}
        onClose={close}
        onConfirm={done}
        tone="danger"
        title={d.payroll.title}
        context={d.payroll.context}
        confirmLabel={d.payroll.confirm}
        typedConfirmation={d.payroll.word}
        effects={[
          { label: d.payroll.exceptions, value: d.payroll.exceptionsValue, tone: "negative" },
          { label: d.payroll.totals, value: <MoneyByCurrency items={[{ a: 412, c: "USD" }, { a: 1240, c: "SAR" }, { a: 96, c: "GBP" }]} amount={(x) => x.a} currency={(x) => x.c} /> },
          { label: d.payroll.finality, value: d.payroll.finalityValue },
        ]}
      />

      <ArchiveStudentDialog open={open === "archive"} onClose={close} student={{ id: "s-faris", name: "Faris Zayed" }} futureSessions={6} remainingBalance={7} onArchived={done} />
    </>
  );
}
