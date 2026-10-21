"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Lock, Repeat } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatDay, formatNumber, formatRef, formatTime, zoneCity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, Eyebrow, KeyValue } from "@/components/ds/Card";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Menu } from "@/components/ds/Menu";
import { Money, MultiZoneTimes } from "@/components/ds/Time";
import { NoteCard } from "@/components/ds/Panels";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { payrolls, settings } from "../fixtures";
import { useAccess } from "../access";
import { sessionApi, type SessionDetail as Detail } from "../sessions-api";
import { familyApi } from "../family-api";
import type { SessionRequest } from "../types";
import { surahName } from "../quran";
import { CancelSessionDialog, CorrectAttendanceDialog, RescheduleDialog, ReviewSessionDialog, SubstituteDialog } from "../dialogs/SessionDialogs";

const listSeparator = (tag: string) => (tag.startsWith("ar") ? "، " : ", ");

type DialogKey = "reschedule" | "cancel" | "substitute" | "attendance" | "review";

export function SessionDetail({ id }: { id: string }) {
  const { t, tag } = useI18n();
  const d = t.sessionDetail;
  const { can } = useAccess();
  const router = useRouter();
  const now = useNow();
  const { data, error, isLoading, reload } = useResource(() => sessionApi.get(id), [id]);
  const [dialog, setDialog] = useState<DialogKey | null>(null);

  if (isLoading) return <Card className="p-6"><LoadingState rows={10} /></Card>;
  if (error || !data) return <ErrorState title={d.loadError} onRetry={reload} />;

  const { session, student, teacher, series, enrollment } = data;
  const upcoming = session.status === "scheduled" && new Date(session.startsAt).getTime() > now;
  const canEdit = can("manage_schedule");
  const deducted = data.ledger.some((l) => l.delta < 0);
  const paid = data.earnings.some((e) => e.amount > 0);
  const zones = [
    { role: student.isAdult ? t.zones.student : t.zones.family, timeZone: student.timezone },
    { role: t.zones.teacher, timeZone: teacher.timezone },
    { role: t.zones.academy, timeZone: settings.timezone },
  ];
  const seriesText = series ? `${series.weekdays.map((w) => new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + w)))).join(listSeparator(tag))} · ${series.localTime} ${zoneCity(series.timezone, tag)}` : null;

  const primary = session.status === "needs_review" && can("approve_session")
    ? <Button variant="primary" size="sm" className="h-9" onClick={() => setDialog("review")}>{d.review}</Button>
    : session.status === "completed" && canEdit
      ? <Button variant="primary" size="sm" className="h-9" onClick={() => setDialog("attendance")}>{t.dialogs.attendance.title}</Button>
      : upcoming
        ? <Button variant="primary" size="sm" className="h-9" locked={!canEdit} onClick={() => setDialog("reschedule")}>{t.dialogs.reschedule.title}</Button>
        : null;

  return (
    <>
      <Breadcrumbs label={t.common.breadcrumb} items={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.sessions, href: "/manage/sessions" }, { label: `#${formatRef(session.number, tag)}` }]} />
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold leading-tight">{d.title(formatRef(session.number, tag))}</h1>
              <StatusBadge status={session.reportDue ? "report_due" : session.status} />
              {session.conflict && <StatusBadge status="conflict" />}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-secondary">
              <span>{formatDay(session.startsAt, student.timezone, tag)}</span>
              <Link href={`/manage/students/${student.id}`} className="text-brand-700">{student.name}</Link>
              <Link href={`/manage/teachers/${teacher.id}`} className="text-brand-700">{teacher.name}</Link>
              {data.originalTeacher && <span className="text-muted">{d.substituteFor(data.originalTeacher.name)}</span>}
              {enrollment && <span>{enrollment.packageName}</span>}
              {seriesText && <span className="inline-flex items-center gap-1"><Repeat aria-hidden className="size-3.5 text-muted" />{seriesText}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(upcoming || series) && (
              <Menu
                label={t.common.actions}
                items={[
                  ...(upcoming ? [
                    { label: t.dialogs.reschedule.title, disabled: !canEdit, onSelect: () => setDialog("reschedule") },
                    { label: t.dialogs.substitute.title, disabled: !canEdit, onSelect: () => setDialog("substitute") },
                  ] : []),
                  ...(series ? [{ label: d.editSeries, disabled: !canEdit, onSelect: () => router.push(`/manage/schedule/series/${series.id}?from=${session.id}`) }] : []),
                  ...(upcoming ? [{ label: t.dialogs.cancel.title, danger: true, disabled: !canEdit, onSelect: () => setDialog("cancel") }] : []),
                ]}
                trigger={(props) => <Button size="sm" {...props} className="h-9">{t.common.actions} <ChevronDown aria-hidden className="size-3.5" /></Button>}
              />
            )}
            {primary}
          </div>
        </div>

        <MultiZoneTimes iso={session.startsAt} zones={zones} />
        {session.conflict && (
          <p className="flex items-start gap-2 rounded-[10px] bg-st-action-bg px-3 py-2 text-[13px] text-st-action">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />{t.schedule.conflictExplain}
          </p>
        )}

        {data.requests.filter((r) => r.status === "pending").map((request) => (
          <FamilyRequest key={request.id} request={request} data={data} onDone={reload} />
        ))}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <Attendance data={data} onCorrect={() => setDialog("attendance")} canCorrect={canEdit && session.status === "completed"} />
            <LearningRecord data={data} />
          </div>
          <div className="flex flex-col gap-4">
            <FinancialEffects data={data} deducted={deducted} paid={paid} />
            <History data={data} />
          </div>
        </div>
      </Card>

      <RescheduleDialog open={dialog === "reschedule"} onClose={() => setDialog(null)} session={session} onDone={reload} />
      <CancelSessionDialog open={dialog === "cancel"} onClose={() => setDialog(null)} session={session} onDone={reload} />
      <SubstituteDialog open={dialog === "substitute"} onClose={() => setDialog(null)} session={session} onDone={reload} />
      {dialog === "attendance" && <CorrectAttendanceDialog open onClose={() => setDialog(null)} session={session} deducted={deducted} paid={paid} onDone={reload} />}
      {dialog === "review" && <ReviewSessionDialog open onClose={() => setDialog(null)} session={session} onDone={reload} />}
    </>
  );
}

function Section({ title, children, className, action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-line-soft p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Attendance({ data, onCorrect, canCorrect }: { data: Detail; onCorrect: () => void; canCorrect: boolean }) {
  const { t, tag } = useI18n();
  const now = useNow();
  const d = t.sessionDetail;
  const { session } = data;
  return (
    <Section title={d.attendance} action={canCorrect && <Button size="sm" variant="tertiary" onClick={onCorrect}>{d.correct}</Button>}>
      {session.status === "scheduled" && !session.reportDue ? (
        <p className="text-[13px] text-muted">{d.notYet}</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-3">
          <KeyValue label={d.marked} className="flex-col !items-start gap-1 sm:flex-row"><StatusBadge status={session.attendance} size="sm" /></KeyValue>
          <KeyValue label={d.actual}>{session.actualMinutes ? t.recurring.minutes(session.actualMinutes) : "—"}</KeyValue>
          <KeyValue label={d.lateBy}>{session.lateMinutes ? t.recurring.minutes(session.lateMinutes) : "—"}</KeyValue>
        </div>
      )}
      {session.status === "cancelled" && (
        <p className="text-[13px] text-secondary">{d.cancelledBy(t.sessionDetail.parties[session.cancelledBy ?? "academy"], session.cancelReason ?? "")}</p>
      )}
      {session.reportDue && <p className="text-[13px] text-st-review">{d.reportOverdue(data.teacher.name, formatNumber(Math.max(1, Math.round((now - new Date(session.endsAt).getTime()) / 3_600_000)), tag))}</p>}
    </Section>
  );
}

function LearningRecord({ data }: { data: Detail }) {
  const { t, tag, locale } = useI18n();
  const d = t.sessionDetail;
  const { can } = useAccess();
  const { record } = data;
  return (
    <Section title={d.learning}>
      {!record ? (
        <p className="text-[13px] text-muted">{data.session.status === "needs_review" ? d.reviewNoReport : d.noRecord}</p>
      ) : (
        <>
          <p className="text-xs text-muted">{d.reportBy(record.authorName, formatDate(record.submittedAt, tag))}</p>
          {data.progress.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {data.progress.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] bg-page px-3 py-2 text-[13px]">
                  <span className="font-semibold">{surahName(p.surah, locale)} <span className="font-normal text-muted tabular">{formatNumber(p.surah, tag)}:{formatNumber(p.ayahFrom, tag)}–{formatNumber(p.ayahTo, tag)}</span></span>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-xs">{t.quran.activity[p.activity]}</span>
                  <span className="text-xs text-muted" aria-label={t.quran.rating(p.rating)}>{"★".repeat(p.rating)}{"☆".repeat(5 - p.rating)}</span>
                </li>
              ))}
            </ul>
          )}
          <NoteCard visibility="family">{record.familyNotes}</NoteCard>
          {record.homework && <KeyValue label={d.homework}>{record.homework}</KeyValue>}
          {can("view_internal") && record.internalNotes && <NoteCard visibility="internal">{record.internalNotes}</NoteCard>}
        </>
      )}
    </Section>
  );
}

/** Student deduction and teacher earnings are two independent decisions, shown apart. */
function FinancialEffects({ data, deducted, paid }: { data: Detail; deducted: boolean; paid: boolean }) {
  const { t, tag } = useI18n();
  const d = t.sessionDetail;
  const { can } = useAccess();
  const { session, enrollment } = data;
  const settledStatus = session.status === "completed" || session.status === "cancelled";
  const deductionRow = data.ledger.find((l) => l.delta !== 0);
  return (
    <Section title={d.financial}>
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-line-soft p-3">
        <Eyebrow>{d.studentDeduction}</Eyebrow>
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="font-semibold">{deducted ? d.deducted : settledStatus ? d.notDeducted : d.decidedLater}</span>
          {deductionRow && <span className={cn("font-semibold tabular", deductionRow.delta < 0 ? "text-st-review" : "text-success")}>{deductionRow.delta < 0 ? "−" : "+"}{formatNumber(Math.abs(deductionRow.delta), tag)}</span>}
        </div>
        {deductionRow && <p className="text-xs text-muted">{deductionRow.reason} · {formatDate(deductionRow.createdAt, tag)}</p>}
        {enrollment && (
          <Link href={`/manage/students/${session.studentId}?tab=enrollments`} className="text-xs text-brand-700">{d.balanceNow(enrollment.packageName, formatNumber(enrollment.balance, tag))}</Link>
        )}
      </div>
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-line-soft p-3">
        <Eyebrow>{d.teacherEarnings}</Eyebrow>
        {!can("view_finance") ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted"><Lock aria-hidden className="size-3.5" />{t.common.hiddenForRole}</p>
        ) : data.earnings.length === 0 ? (
          <p className="text-[13px] font-semibold">{settledStatus ? d.notPaid : d.decidedLater}</p>
        ) : data.earnings.map((e) => (
          <div key={e.id} className="flex flex-col gap-0.5 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{d.earningKind[e.kind]}</span>
              <Money amount={e.amount} currency={e.currency} className="font-semibold" />
            </div>
            <span className="text-xs text-muted">{e.reason} · {d.payroll(t.status[payrolls.find((p) => p.month === e.payrollMonth)?.status ?? "draft"])}{e.adjustmentOf ? ` · ${d.adjustmentRow}` : ""}</span>
          </div>
        ))}
        {can("view_finance") && paid && <p className="text-xs text-muted">{d.closedNote}</p>}
      </div>
      <p className="text-xs text-muted">{d.separateNote}</p>
    </Section>
  );
}

function History({ data }: { data: Detail }) {
  const { t, tag } = useI18n();
  const d = t.sessionDetail;
  return (
    <Section title={d.history}>
      <ol className="relative flex flex-col gap-3 border-s-2 border-subtle ps-4">
        {data.history.map((h) => (
          <li key={h.id} className="relative flex flex-col gap-0.5 text-[13px]">
            <span aria-hidden className="absolute -start-[23px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-brand-700" />
            <span className="font-medium">{d.actions[h.action]}{h.action === "rescheduled" && h.detail?.includes("T") ? ` · ${d.from(formatTime(h.detail, settings.timezone, tag))}` : h.detail && !h.detail.includes("T") ? ` · ${h.detail === "series" ? d.fromSeries : h.detail === "one-off" ? d.oneOff : h.detail}` : ""}</span>
            <span className="text-xs text-muted tabular">{h.actorName} · {formatDay(h.at, settings.timezone, tag)} {formatTime(h.at, settings.timezone, tag)} {zoneCity(settings.timezone, tag)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** A pending family request, with the policy effect captured when it was submitted. */
function FamilyRequest({ request, data, onDone }: { request: SessionRequest; data: Detail; onDone: () => void }) {
  const { t, tag } = useI18n();
  const d = t.sessionDetail;
  const { can, userName } = useAccess();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await familyApi.reviewRequest(request.id, approve, userName);
    setBusy(false);
    onDone();
  };
  const canDecide = can("approve_session");
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-st-pending-bg bg-st-pending-bg/40 p-4" aria-labelledby={`req-${request.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`req-${request.id}`} className="text-sm font-semibold">{d.request[request.kind]}</h2>
        <span className="text-xs text-muted">{request.requestedBy} · {formatDay(request.createdAt, settings.timezone, tag)} {formatTime(request.createdAt, settings.timezone, tag)} {zoneCity(settings.timezone, tag)}</span>
      </div>
      <p className="text-[13px]">“{request.reason}”</p>
      {request.proposedStart && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-secondary">{d.proposed}</span>
          <MultiZoneTimes iso={request.proposedStart} zones={[{ role: data.student.isAdult ? t.zones.student : t.zones.family, timeZone: data.student.timezone }, { role: t.zones.teacher, timeZone: data.teacher.timezone }]} variant="inline" />
        </div>
      )}
      <p className="text-xs text-secondary">{d.policySnapshot(formatNumber(request.policy.hoursNotice, tag), request.policy.late, request.policy.deducts)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" locked={!canDecide} disabled={busy} onClick={() => decide(true)}>{d.approve}</Button>
        <Button size="sm" locked={!canDecide} disabled={busy} onClick={() => decide(false)}>{d.decline}</Button>
      </div>
    </section>
  );
}
