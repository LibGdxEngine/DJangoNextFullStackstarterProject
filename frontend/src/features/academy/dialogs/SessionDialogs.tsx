"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { formatMoney, formatNumber, wallTime, zoneCity, zonedParts, zonedTimeToUtc, formatRef } from "@/lib/format";
import { ConfirmDialog, type Effect } from "@/components/ds/Dialog";
import { ChoiceCard, Checkbox, Field, Input, Select } from "@/components/ds/Field";
import { MultiZoneTimes } from "@/components/ds/Time";
import { LockedField } from "@/components/ds/States";
import { rateFor, settings } from "../fixtures";
import { useAccess } from "../access";
import { sessionApi, type CancelInput, type SubstituteOption } from "../sessions-api";
import type { Attendance, Availability, Session, SessionRow } from "../types";

export type DialogSession = Pick<SessionRow, "id" | "number" | "startsAt" | "endsAt" | "studentName" | "teacherName" | "studentTimezone" | "teacherTimezone" | "isAdult" | "attendance" | "status" | "teacherId" | "studentId">;

function useZones(session: DialogSession) {
  const { t } = useI18n();
  return [
    { role: session.isAdult ? t.zones.student : t.zones.family, timeZone: session.studentTimezone },
    { role: t.zones.teacher, timeZone: session.teacherTimezone },
  ];
}

function Context({ session }: { session: DialogSession }) {
  const zones = useZones(session);
  return (
    <span className="flex flex-col gap-0.5">
      <span>{session.studentName} · {session.teacherName}</span>
      <MultiZoneTimes variant="inline" iso={session.startsAt} zones={zones} />
    </span>
  );
}

const notificationValue = (t: ReturnType<typeof useI18n>["t"]) =>
  settings.whatsappStatus === "connected" ? t.sessionDialogs.notifyBoth : t.sessionDialogs.notifyQueued;

/* ── Cancel ─────────────────────────────────────────────────────────── */

export function CancelSessionDialog({ open, onClose, session, onDone }: { open: boolean; onClose: () => void; session: DialogSession; onDone: () => void }) {
  const { t, tag } = useI18n();
  const d = t.sessionDialogs;
  const { userName } = useAccess();
  const now = useNow();
  const [by, setBy] = useState<"family" | "teacher" | "academy">("family");
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const hoursNotice = Math.max(0, (new Date(session.startsAt).getTime() - now) / 3_600_000);
  const late = hoursNotice < settings.cancellationHours;
  const familyLate = by === "family" && late;
  const deduct = familyLate && settings.lateCancelDeduct && !waive;
  const payTeacher = familyLate && settings.lateCancelPayTeacher;
  const pay = sessionPay(session, 0.5);

  const input: CancelInput = { by: by === "family" ? (late ? "family_late" : "family_early") : by, reason: reason.trim(), deduct, payTeacher };

  return (
    <ConfirmDialog
      open={open}
      onClose={() => { setReason(""); setWaive(false); onClose(); }}
      tone="danger"
      title={d.cancelTitle(formatRef(session.number, tag))}
      context={<Context session={session} />}
      confirmLabel={t.dialogs.cancel.confirm}
      cancelLabel={t.dialogs.cancel.keep}
      canConfirm={reason.trim().length > 0 && (!waive || reason.trim().length > 3)}
      onConfirm={async () => { await sessionApi.cancel(session.id, input, userName); onDone(); }}
      effects={[
        { label: d.notice, value: d.noticeValue(formatNumber(Math.floor(hoursNotice), tag), late), tone: late ? "negative" : "plain" },
        { label: t.dialogs.cancel.balance, value: deduct ? d.deductOne : d.noDeduction, tone: deduct ? "negative" : "plain" },
        { label: t.dialogs.cancel.teacherPay, value: payTeacher && pay ? d.halfPay(formatMoney(pay.amount, pay.currency, tag)) : d.noPay },
        { label: t.dialogs.cancel.notification, value: notificationValue(t) },
      ]}
    >
      <Field label={t.dialogs.cancel.initiator}>
        {(p) => (
          <Select {...p} value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
            <option value="family">{session.isAdult ? t.zones.student : t.zones.family}</option>
            <option value="teacher">{t.dialogs.cancel.teacher}</option>
            <option value="academy">{t.dialogs.cancel.academy}</option>
          </Select>
        )}
      </Field>
      <Field label={t.dialogs.cancel.reason} required>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {familyLate && settings.lateCancelDeduct && <Checkbox label={t.dialogs.cancel.waive} checked={waive} onChange={(e) => setWaive(e.target.checked)} />}
      <p className="text-xs text-muted">{d.policyLine(settings.cancellationHours)}</p>
    </ConfirmDialog>
  );
}

/** Preview of what the teacher would earn for this session (rate in force on its date). */
function sessionPay(session: DialogSession, share: number) {
  const rate = rateFor(session.teacherId, session.startsAt.slice(0, 10));
  if (!rate) return null;
  const minutes = (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000;
  const base = rate.basis === "hour" ? (rate.amount * minutes) / 60 : rate.amount;
  return { amount: Math.round(base * share * 100) / 100, currency: rate.currency };
}

/* ── Reschedule (form + confirmation preview; the keyboard alternative to dragging) ── */

export function RescheduleDialog({ open, onClose, session, onDone, initialStart }: {
  open: boolean;
  onClose: () => void;
  session: DialogSession;
  onDone: () => void;
  /** Pre-fill, e.g. from a calendar slot the user picked. */
  initialStart?: string;
}) {
  const { t, tag } = useI18n();
  const d = t.sessionDialogs;
  const { userName } = useAccess();
  const zones = useZones(session);
  const [zoneRole, setZoneRole] = useState<"student" | "teacher" | "academy">("student");
  const zone = zoneRole === "student" ? session.studentTimezone : zoneRole === "teacher" ? session.teacherTimezone : settings.timezone;
  const seed = initialStart ?? session.startsAt;
  const [date, setDate] = useState(() => zonedParts(seed, session.studentTimezone).dateKey);
  const [time, setTime] = useState(() => wallTime(seed, session.studentTimezone));
  const [notify, setNotify] = useState(true);
  const [ctx, setCtx] = useState<{ sessions: Session[]; availability: Availability[] } | null>(null);
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    let active = true;
    sessionApi.calendar().then((data) => active && setCtx({ sessions: data.sessions, availability: data.availability }));
    return () => { active = false; };
  }, [open]);

  // Keep the same instant when the user switches which zone they type in.
  function switchZone(next: typeof zoneRole) {
    const nextZone = next === "student" ? session.studentTimezone : next === "teacher" ? session.teacherTimezone : settings.timezone;
    const instant = zonedTimeToUtc(date, time, zone).toISOString();
    setDate(zonedParts(instant, nextZone).dateKey);
    setTime(wallTime(instant, nextZone));
    setZoneRole(next);
  }

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  const newStart = valid ? zonedTimeToUtc(date, time, zone).toISOString() : session.startsAt;
  const duration = new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime();
  const newEnd = new Date(new Date(newStart).getTime() + duration).toISOString();
  const unchanged = newStart === session.startsAt;
  const inPast = new Date(newStart).getTime() < now;

  const conflict = useMemo(() => ctx?.sessions.find((s) => s.id !== session.id && s.status !== "cancelled" && (s.teacherId === session.teacherId || s.studentId === session.studentId) && s.startsAt < newEnd && newStart < s.endsAt) ?? null, [ctx, session, newStart, newEnd]);
  const outside = useMemo(() => {
    if (!ctx) return false;
    const local = zonedParts(newStart, session.teacherTimezone);
    const windows = ctx.availability.filter((a) => a.teacherId === session.teacherId);
    if (!windows.length) return false;
    return !windows.some((w) => {
      const [sh, sm] = w.startTime.split(":").map(Number);
      const [eh, em] = w.endTime.split(":").map(Number);
      return w.weekday === local.weekday && local.minutes >= sh * 60 + sm && local.minutes + duration / 60_000 <= eh * 60 + em;
    });
  }, [ctx, newStart, session, duration]);

  const effects: Effect[] = [
    { label: t.dialogs.reschedule.from, value: <MultiZoneTimes variant="inline" iso={session.startsAt} zones={zones} /> },
    { label: t.dialogs.reschedule.to, value: <MultiZoneTimes variant="inline" iso={newStart} zones={zones} /> },
    { label: t.dialogs.reschedule.conflicts, value: !ctx ? t.common.loading : conflict ? d.conflictWith(conflict.number) : t.dialogs.reschedule.none, tone: conflict ? "negative" : "positive" },
    { label: d.availability, value: outside ? d.outsideHours : d.withinHours, tone: outside ? "negative" : "plain" },
    { label: t.dialogs.cancel.notification, value: notify ? notificationValue(t) : d.noNotification },
  ];

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={d.rescheduleTitle(formatRef(session.number, tag))}
      context={<Context session={session} />}
      confirmLabel={t.dialogs.reschedule.confirm}
      canConfirm={valid && !unchanged && !inPast && !conflict && !!ctx}
      onConfirm={async () => { await sessionApi.reschedule(session.id, newStart, userName); onDone(); }}
      effects={effects}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-medium text-secondary">{d.enterIn}</legend>
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          {(["student", "teacher", "academy"] as const).map((r) => {
            const z = r === "student" ? session.studentTimezone : r === "teacher" ? session.teacherTimezone : settings.timezone;
            return (
              <button key={r} type="button" role="radio" aria-checked={zoneRole === r} onClick={() => switchZone(r)} className={`h-9 rounded-full border px-3 text-[13px] ${zoneRole === r ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-surface"}`}>
                {(r === "student" ? (session.isAdult ? t.zones.student : t.zones.family) : r === "teacher" ? t.zones.teacher : t.zones.academy)} · {zoneCity(z, tag)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.dialogs.reschedule.newDate}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tabular" />}</Field>
        <Field label={t.dialogs.reschedule.newTime} hint={zoneCity(zone, tag)}>{(p) => <Input {...p} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="tabular" />}</Field>
      </div>
      {conflict && <p role="alert" className="flex items-center gap-1.5 text-danger"><AlertTriangle aria-hidden className="size-3.5" />{t.dialogs.reschedule.blocked}</p>}
      {inPast && <p role="alert" className="text-danger">{d.inPast}</p>}
      <Checkbox label={d.notifyLabel} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
    </ConfirmDialog>
  );
}

/* ── Substitute ─────────────────────────────────────────────────────── */

export function SubstituteDialog({ open, onClose, session, onDone }: { open: boolean; onClose: () => void; session: DialogSession; onDone: () => void }) {
  const { t, tag } = useI18n();
  const d = t.sessionDialogs;
  const { userName, can } = useAccess();
  const [options, setOptions] = useState<SubstituteOption[] | null>(null);
  const [choice, setChoice] = useState("");
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (!open) return;
    let active = true;
    sessionApi.substitutes(session.id).then((list) => {
      if (!active) return;
      setOptions(list);
      setChoice(list.find((o) => !o.busy)?.teacher.id ?? "");
    });
    return () => { active = false; };
  }, [open, session.id]);

  const picked = options?.find((o) => o.teacher.id === choice);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t.dialogs.substitute.title}
      context={<Context session={session} />}
      confirmLabel={t.dialogs.substitute.confirm}
      canConfirm={!!picked && !picked.busy}
      onConfirm={async () => { await sessionApi.assignSubstitute(session.id, choice, notify, userName); onDone(); }}
      effects={picked ? [
        { label: t.dialogs.substitute.who, value: picked.teacher.name },
        { label: d.theirTime, value: `${wallTime(session.startsAt, picked.teacher.timezone)} ${zoneCity(picked.teacher.timezone, tag)}` },
        { label: t.dialogs.substitute.rate, value: can("view_finance") ? (picked.pay ? `${formatMoney(picked.pay.amount, picked.pay.currency, tag)} ${t.dialogs.substitute.forSession}` : "—") : t.common.hiddenForRole },
        { label: d.originalTeacher, value: d.notPaidForThis(session.teacherName) },
        { label: t.dialogs.cancel.notification, value: notify ? t.dialogs.substitute.familyNotified : t.dialogs.substitute.familyNotNotified },
      ] : undefined}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-medium text-secondary">{t.dialogs.substitute.available}</legend>
        {!options ? <p className="text-muted">{t.common.loading}</p> : options.length === 0 ? <p className="text-muted">{d.noSubstitutes}</p> : options.map((o) => (
          <ChoiceCard
            key={o.teacher.id}
            name="substitute"
            value={o.teacher.id}
            checked={choice === o.teacher.id}
            onChange={(v) => !o.busy && setChoice(v)}
            title={<span className={o.busy ? "text-disabled" : undefined}>{o.teacher.name}</span>}
            description={o.busy ? d.busy : o.inWindow ? d.freeInHours(`${wallTime(session.startsAt, o.teacher.timezone)} ${zoneCity(o.teacher.timezone, tag)}`) : d.freeOutside(`${wallTime(session.startsAt, o.teacher.timezone)} ${zoneCity(o.teacher.timezone, tag)}`)}
          />
        ))}
      </fieldset>
      {!can("view_finance") && <LockedField label={t.dialogs.substitute.rate} reason={t.common.hiddenForRole} />}
      <Checkbox label={t.dialogs.substitute.notify} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
    </ConfirmDialog>
  );
}

/* ── Money decisions shared by attendance correction and review ──────── */

function Decision({ name, legend, value, onChange, yes, no }: { name: string; legend: string; value: boolean; onChange: (v: boolean) => void; yes: string; no: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium text-secondary">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        <ChoiceCard name={name} value="yes" checked={value} onChange={() => onChange(true)} title={yes} />
        <ChoiceCard name={name} value="no" checked={!value} onChange={() => onChange(false)} title={no} />
      </div>
    </fieldset>
  );
}

function defaultsFor(attendance: Attendance) {
  if (attendance === "present" || attendance === "late") return { deduct: true, pay: true };
  if (attendance === "absent") return { deduct: settings.lateCancelDeduct, pay: settings.lateCancelPayTeacher };
  return { deduct: false, pay: false };
}

export function CorrectAttendanceDialog({ open, onClose, session, deducted, paid, onDone }: {
  open: boolean;
  onClose: () => void;
  session: DialogSession;
  deducted: boolean;
  paid: boolean;
  onDone: () => void;
}) {
  const { t, tag } = useI18n();
  const d = t.sessionDialogs;
  const { userName } = useAccess();
  const [attendance, setAttendance] = useState<Attendance>(session.attendance === "present" ? "absent" : "present");
  const [deduct, setDeduct] = useState(deducted);
  const [pay, setPay] = useState(paid);
  const [reason, setReason] = useState("");
  const pick = (a: Attendance) => {
    setAttendance(a);
    const next = defaultsFor(a);
    setDeduct(next.deduct);
    setPay(next.pay);
  };
  const full = sessionPay(session, 1);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t.dialogs.attendance.title}
      context={<Context session={session} />}
      confirmLabel={t.dialogs.attendance.confirm}
      canConfirm={attendance !== session.attendance && reason.trim().length > 0}
      onConfirm={async () => { await sessionApi.correctAttendance(session.id, attendance, reason.trim(), { deduct, pay }, userName); onDone(); }}
      effects={[
        { label: t.dialogs.attendance.original, value: t.status[session.attendance] },
        { label: t.dialogs.attendance.corrected, value: t.status[attendance] },
        { label: t.dialogs.attendance.deduction, value: deduct === deducted ? d.unchanged(deducted ? d.deductOne : d.noDeduction) : deduct ? d.newDeduction : d.refundOne, tone: deduct === deducted ? "plain" : deduct ? "negative" : "positive" },
        { label: t.dialogs.attendance.earnings, value: pay === paid ? d.unchanged(paid ? d.paid : d.noPay) : pay && full ? d.addPay(formatMoney(full.amount, full.currency, tag)) : d.payNotReversed, tone: pay === paid ? "plain" : pay ? "positive" : "negative" },
      ]}
    >
      <Field label={t.dialogs.attendance.newValue}>
        {(p) => (
          <Select {...p} value={attendance} onChange={(e) => pick(e.target.value as Attendance)}>
            {(["present", "late", "absent", "unknown"] as Attendance[]).map((a) => <option key={a} value={a} disabled={a === session.attendance}>{t.status[a]}</option>)}
          </Select>
        )}
      </Field>
      <Decision name="deduct" legend={d.studentDecision} value={deduct} onChange={setDeduct} yes={d.deductOne} no={d.noDeduction} />
      <Decision name="pay" legend={d.teacherDecision} value={pay} onChange={setPay} yes={d.payTeacher} no={d.noPay} />
      <Field label={t.dialogs.attendance.reason} required>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <p className="text-xs text-muted">{t.dialogs.attendance.separate}</p>
    </ConfirmDialog>
  );
}

export function ReviewSessionDialog({ open, onClose, session, onDone }: { open: boolean; onClose: () => void; session: DialogSession; onDone: () => void }) {
  const { t, tag } = useI18n();
  const d = t.sessionDialogs;
  const { userName } = useAccess();
  const [attendance, setAttendance] = useState<Attendance>(session.attendance === "unknown" ? "absent" : session.attendance);
  const initial = defaultsFor(attendance);
  const [deduct, setDeduct] = useState(initial.deduct);
  const [pay, setPay] = useState(initial.pay);
  const [note, setNote] = useState("");
  const full = sessionPay(session, 1);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={d.reviewTitle(formatRef(session.number, tag))}
      context={<Context session={session} />}
      confirmLabel={d.reviewConfirm}
      canConfirm={note.trim().length > 0}
      onConfirm={async () => { await sessionApi.review(session.id, { attendance, deduct, pay, note: note.trim() }, userName); onDone(); }}
      effects={[
        { label: d.statusAfter, value: t.status.completed },
        { label: t.dialogs.attendance.deduction, value: deduct ? d.deductOne : d.noDeduction, tone: deduct ? "negative" : "plain" },
        { label: t.dialogs.attendance.earnings, value: pay && full ? d.addPay(formatMoney(full.amount, full.currency, tag)) : d.noPay, tone: pay ? "positive" : "plain" },
      ]}
    >
      <div className="flex items-start gap-2 rounded-[10px] border border-st-review-bg bg-st-review-bg/60 px-3 py-2.5 text-st-review">
        <CalendarClock aria-hidden className="mt-0.5 size-3.5 shrink-0" />{d.reviewWhy}
      </div>
      <Field label={t.dialogs.attendance.newValue}>
        {(p) => (
          <Select {...p} value={attendance} onChange={(e) => { const a = e.target.value as Attendance; setAttendance(a); const x = defaultsFor(a); setDeduct(x.deduct); setPay(x.pay); }}>
            {(["present", "late", "absent"] as Attendance[]).map((a) => <option key={a} value={a}>{t.status[a]}</option>)}
          </Select>
        )}
      </Field>
      <Decision name="r-deduct" legend={d.studentDecision} value={deduct} onChange={setDeduct} yes={d.deductOne} no={d.noDeduction} />
      <Decision name="r-pay" legend={d.teacherDecision} value={pay} onChange={setPay} yes={d.payTeacher} no={d.noPay} />
      <Field label={d.reviewNote} required hint={d.reviewNoteHint}>
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </ConfirmDialog>
  );
}
