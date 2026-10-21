"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, CalendarX, Clock, Package as PackageIcon, Repeat } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { addDaysKey, formatDate, formatNumber, wallTime, zoneCity, zoneOffset, zonedParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, Eyebrow } from "@/components/ds/Card";
import { ChoiceCard, Field, Input, Select } from "@/components/ds/Field";
import { Badge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { InfoNote } from "@/components/ds/Panels";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { sessionApi } from "../sessions-api";
import { expandRecurrence, type RecurrencePreview } from "../recurrence";

type Anchor = "student" | "teacher" | "academy";
type Scope = "this" | "future" | "all";

export function RecurringScheduleForm({ seriesId }: { seriesId?: string }) {
  const { t, tag } = useI18n();
  const r = t.recurring;
  const router = useRouter();
  const params = useSearchParams();
  const fromSessionId = params.get("from");
  const { can, userName } = useAccess();
  const now = useNow();
  const { data, error, isLoading, reload } = useResource(() => sessionApi.recurringContext());
  const series = data?.schedules.find((s) => s.id === seriesId) ?? null;
  const todayKey = zonedParts(new Date(now).toISOString(), settings.timezone).dateKey;

  const [studentId, setStudentId] = useState(params.get("student") ?? "");
  const [teacherId, setTeacherId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [localTime, setLocalTime] = useState("16:00");
  const [anchor, setAnchor] = useState<Anchor>("student");
  const [duration, setDuration] = useState(45);
  const [startsOn, setStartsOn] = useState(todayKey);
  const [endsOn, setEndsOn] = useState(addDaysKey(todayKey, 28));
  const [scope, setScope] = useState<Scope>(fromSessionId ? "future" : "all");
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);

  const student = data?.students.find((s) => s.id === studentId) ?? null;
  const teacher = data?.teachers.find((x) => x.id === teacherId) ?? null;
  const enrollment = data?.enrollments.find((e) => e.studentId === studentId) ?? null;

  // Seed the form from the series (edit) or the student's teacher and package (create).
  useEffect(() => {
    if (!data) return;
    if (series) {
      /* eslint-disable react-hooks/set-state-in-effect -- one-time seeding once data arrives. */
      setStudentId(series.studentId);
      setTeacherId(series.teacherId);
      setWeekdays(series.weekdays);
      setLocalTime(series.localTime);
      setDuration(series.durationMinutes);
      setStartsOn(fromSessionId ? zonedParts(data.sessions.find((s) => s.id === fromSessionId)?.startsAt ?? `${todayKey}T12:00:00Z`, series.timezone).dateKey : todayKey > series.startsOn ? todayKey : series.startsOn);
      setEndsOn(series.endsOn);
      const s = data.students.find((x) => x.id === series.studentId);
      const tch = data.teachers.find((x) => x.id === series.teacherId);
      setAnchor(series.timezone === s?.timezone ? "student" : series.timezone === tch?.timezone ? "teacher" : "academy");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [data, series, fromSessionId, todayKey]);

  useEffect(() => {
    if (!data || series || !studentId) return;
    const s = data.students.find((x) => x.id === studentId);
    const e = data.enrollments.find((x) => x.studentId === studentId);
    /* eslint-disable react-hooks/set-state-in-effect -- follow the chosen student's defaults. */
    setTeacherId(s?.teacherId ?? "");
    if (e) {
      setDuration(e.durationMinutes);
      setEndsOn(e.expiresOn > todayKey ? e.expiresOn : addDaysKey(todayKey, 28));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data, series, studentId, todayKey]);

  const anchorZone = anchor === "student" ? student?.timezone : anchor === "teacher" ? teacher?.timezone : settings.timezone;

  const ignore = useMemo(() => {
    if (!data || !series) return new Set<string>();
    const fromIso = fromSessionId ? data.sessions.find((s) => s.id === fromSessionId)?.startsAt ?? "" : new Date(now).toISOString();
    return new Set(data.sessions.filter((s) => s.seriesId === series.id && s.status === "scheduled" && (scope === "this" ? s.id === fromSessionId : s.startsAt >= fromIso)).map((s) => s.id));
  }, [data, series, fromSessionId, scope, now]);

  const preview: RecurrencePreview | null = useMemo(() => {
    if (!data || !student || !teacher || !anchorZone) return null;
    const input = scope === "this" && fromSessionId
      ? { timezone: anchorZone, weekdays: [0, 1, 2, 3, 4, 5, 6], localTime, startsOn, endsOn: startsOn, durationMinutes: duration }
      : { timezone: anchorZone, weekdays, localTime, startsOn, endsOn, durationMinutes: duration };
    return expandRecurrence(input, {
      studentId: student.id,
      teacherId: teacher.id,
      studentTimezone: student.timezone,
      teacherTimezone: teacher.timezone,
      sessions: data.sessions,
      availability: data.availability,
      enrollment,
      ignoreSessionIds: ignore,
    });
  }, [data, student, teacher, anchorZone, weekdays, localTime, startsOn, endsOn, duration, enrollment, ignore, scope, fromSessionId]);

  const errors = {
    student: !studentId ? r.errors.student : undefined,
    teacher: !teacherId ? r.errors.teacher : undefined,
    weekdays: !weekdays.length && scope !== "this" ? r.errors.weekdays : undefined,
    dates: endsOn < startsOn ? r.errors.dates : startsOn < todayKey && !series ? r.errors.past : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const blocking = (preview?.conflicts.length ?? 0) > 0;
  const replacedCount = ignore.size;

  if (!can("manage_schedule")) return <ErrorState title={t.common.lockedForRole} />;

  const weekdayNames = Array.from({ length: 7 }, (_, i) => ({
    short: new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))),
    long: new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))),
  }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors || !preview || preview.occurrences.length === 0) return;
    if (blocking && !ack) return;
    setConfirming(true);
  }

  async function save() {
    if (!anchorZone || !student || !teacher) return;
    const input = { timezone: anchorZone, weekdays, localTime, startsOn, endsOn, durationMinutes: duration };
    if (series) {
      await sessionApi.updateRecurring(series.id, { ...input, teacherId }, scope, fromSessionId, userName);
    } else {
      await sessionApi.createRecurring({ ...input, studentId: student.id, teacherId: teacher.id, enrollmentId: enrollment?.id ?? "" }, userName);
    }
    router.push(`/manage/schedule?student=${student.id}&view=agenda`);
  }

  const title = series ? r.editTitle : r.createTitle;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.schedule, href: "/manage/schedule" }, { label: title }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={title}
        meta={r.meta}
      />
      {isLoading ? <Card><LoadingState rows={10} /></Card> : error || !data ? <ErrorState title={t.common.errorTitle} onRetry={reload} /> : seriesId && !series ? <ErrorState title={r.notFound} /> : (
        <form onSubmit={submit} noValidate className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
          <Card className="flex flex-col gap-5 p-6">
            {series && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-semibold">{r.scopeLegend}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {fromSessionId && <ChoiceCard name="scope" value="this" checked={scope === "this"} onChange={() => setScope("this")} title={r.scope.this} description={r.scope.thisHint} />}
                  <ChoiceCard name="scope" value="future" checked={scope === "future"} onChange={() => setScope("future")} title={r.scope.future} description={r.scope.futureHint} />
                  <ChoiceCard name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} title={r.scope.all} description={r.scope.allHint} />
                </div>
                <p className="text-xs text-muted">{r.scopeImpact(replacedCount)}</p>
              </fieldset>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.students.colStudent} required error={touched ? errors.student : undefined}>
                {(p) => (
                  <Select {...p} value={studentId} disabled={!!series} onChange={(e) => setStudentId(e.target.value)}>
                    <option value="">{t.common.choose}</option>
                    {data.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={t.students.colTeacher} required error={touched ? errors.teacher : undefined} hint={teacher ? `${zoneCity(teacher.timezone, tag)} (${zoneOffset(teacher.timezone)})` : undefined}>
                {(p) => (
                  <Select {...p} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                    <option value="">{t.common.choose}</option>
                    {data.teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                )}
              </Field>
            </div>

            {student && (
              <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border px-3.5 py-2.5 text-[13px]", enrollment?.status === "active" ? "border-line-soft" : "border-st-pending-bg bg-st-pending-bg/50")}>
                <PackageIcon aria-hidden className="size-4 text-muted" />
                {enrollment ? (
                  <>
                    <span className="font-medium">{enrollment.packageName}</span>
                    <span className="tabular">{r.balance(formatNumber(enrollment.balance, tag))}</span>
                    <span className="text-muted tabular">{r.validUntil(formatDate(enrollment.expiresOn, tag, "long"))}</span>
                    {enrollment.status !== "active" && <Badge tone="pending" size="sm">{r.pendingPayment}</Badge>}
                  </>
                ) : <span className="text-st-review">{r.noEnrollment}</span>}
              </div>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium text-secondary">{r.days} <span aria-hidden className="text-danger">*</span></legend>
              <div className="flex flex-wrap gap-1.5">
                {weekdayNames.map((name, i) => {
                  const on = weekdays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      aria-label={name.long}
                      disabled={scope === "this"}
                      onClick={() => setWeekdays(on ? weekdays.filter((d) => d !== i) : [...weekdays, i].sort())}
                      className={cn("h-10 min-w-12 rounded-[10px] border px-3 text-[13px] font-medium disabled:opacity-50", on ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-surface")}
                    >
                      {name.short}
                    </button>
                  );
                })}
              </div>
              {touched && errors.weekdays && <p role="alert" className="text-xs text-danger">{errors.weekdays}</p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={r.time} required hint={anchorZone ? zoneCity(anchorZone, tag) : undefined}>
                {(p) => <Input {...p} type="time" step={300} value={localTime} onChange={(e) => setLocalTime(e.target.value)} className="tabular" />}
              </Field>
              <Field label={r.duration}>
                {(p) => (
                  <Select {...p} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{r.minutes(m)}</option>)}
                  </Select>
                )}
              </Field>
              <div />
              <Field label={scope === "this" ? r.date : r.startsOn} required error={touched ? errors.dates : undefined}>
                {(p) => <Input {...p} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="tabular" />}
              </Field>
              {scope !== "this" && (
                <Field label={r.endsOn} required hint={enrollment ? r.endsHint : undefined}>
                  {(p) => <Input {...p} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="tabular" />}
                </Field>
              )}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium text-secondary">{r.keepFixedIn}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["student", "teacher", "academy"] as Anchor[]).map((a) => {
                  const z = a === "student" ? student?.timezone : a === "teacher" ? teacher?.timezone : settings.timezone;
                  const role = a === "student" ? (student?.isAdult ? t.zones.student : t.zones.family) : a === "teacher" ? t.zones.teacher : t.zones.academy;
                  return (
                    <ChoiceCard
                      key={a}
                      name="anchor"
                      value={a}
                      checked={anchor === a}
                      onChange={() => setAnchor(a)}
                      icon={<Clock aria-hidden className="size-4" />}
                      title={`${role}${z ? ` · ${zoneCity(z, tag)}` : ""}`}
                      description={z ? `${zoneOffset(z)}` : "—"}
                    />
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-muted">{r.keepFixedHint}</p>
            </fieldset>

            {blocking && (
              <label className="flex items-start gap-2 rounded-[10px] border border-danger-border bg-danger-bg px-3.5 py-3 text-[13px] text-danger">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-brand-800" />
                {r.ackConflicts(preview!.conflicts.length)}
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
              <Button onClick={() => router.back()}>{t.common.cancel}</Button>
              <Button type="submit" variant="primary" disabled={(blocking && !ack) || !preview?.occurrences.length} icon={<Repeat aria-hidden className="size-4" />}>{series ? r.saveChanges : r.create}</Button>
            </div>
          </Card>

          <Preview preview={preview} studentTz={student?.timezone} teacherTz={teacher?.timezone} isAdult={!!student?.isAdult} />

          <ConfirmDialog
            open={confirming}
            onClose={() => setConfirming(false)}
            onConfirm={save}
            title={series ? r.confirmEditTitle : r.confirmCreateTitle}
            context={student && teacher ? `${student.name} · ${teacher.name}` : undefined}
            confirmLabel={series ? r.saveChanges : r.create}
            effects={[
              ...(series ? [{ label: r.replaced, value: scope === "this" ? r.oneMoved : r.sessionsCount(replacedCount), tone: "negative" as const }] : []),
              { label: scope === "this" ? r.newTime : r.created, value: scope === "this" ? `${preview?.occurrences[0] ? wallTime(preview.occurrences[0].start, student?.timezone ?? settings.timezone) : "—"} ${zoneCity(student?.timezone ?? settings.timezone, tag)}` : r.sessionsCount(preview?.occurrences.length ?? 0), tone: "positive" as const },
              { label: r.history, value: r.historyUnchanged },
              { label: r.warnings, value: r.warningSummary(preview?.conflicts.length ?? 0, preview?.unavailable.length ?? 0, preview?.dstShifts.length ?? 0), tone: (preview?.conflicts.length || preview?.unavailable.length) ? "negative" as const : "plain" as const },
              { label: t.dialogs.cancel.notification, value: settings.whatsappStatus === "connected" ? r.notify : r.notifyQueued },
            ]}
          />
        </form>
      )}
    </>
  );
}

/** Live preview: warnings first, then every date in both zones. */
function Preview({ preview, studentTz, teacherTz, isAdult }: { preview: RecurrencePreview | null; studentTz?: string; teacherTz?: string; isAdult: boolean }) {
  const { t, tag } = useI18n();
  const r = t.recurring;
  if (!preview || !studentTz || !teacherTz) {
    return <Card className="p-6"><p className="text-[13px] text-muted">{r.previewEmpty}</p></Card>;
  }
  const warnings = [
    preview.conflicts.length > 0 && { key: "c", icon: AlertTriangle, tone: "danger", text: r.warnConflicts(preview.conflicts.length) },
    preview.unavailable.length > 0 && { key: "a", icon: CalendarX, tone: "attention", text: r.warnAvailability(preview.unavailable.length) },
    preview.beyondValidity.length > 0 && { key: "v", icon: PackageIcon, tone: "attention", text: r.warnValidity(preview.beyondValidity.length) },
    preview.beyondBalance.length > 0 && { key: "b", icon: PackageIcon, tone: "attention", text: r.warnBalance(preview.beyondBalance.length) },
    ...preview.dstShifts.map((s, i) => ({ key: `d${i}`, icon: CalendarClock, tone: "info", text: r.warnDst(s.party === "student" ? (isAdult ? t.zones.student : t.zones.family) : t.zones.teacher, zoneCity(s.timeZone, tag), formatDate(s.fromDate, tag), s.before, s.after) })),
  ].filter(Boolean) as { key: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone: string; text: string }[];

  return (
    <Card as="aside" className="flex flex-col gap-4 p-5 xl:sticky xl:top-24" aria-labelledby="preview-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="preview-title" className="text-sm font-semibold">{r.previewTitle}</h2>
        <span className="text-xs text-muted tabular">{r.sessionsCount(preview.occurrences.length)}{preview.truncated ? "+" : ""}</span>
      </div>
      <div className="flex flex-col gap-2" aria-live="polite">
        <Eyebrow>{r.beforeSaving}</Eyebrow>
        {warnings.length === 0 ? (
          <p className="text-[13px] text-success">{r.noWarnings}</p>
        ) : warnings.map((w) => {
          const Icon = w.icon;
          return (
            <p key={w.key} className={cn("flex items-start gap-2 rounded-[10px] px-3 py-2 text-[13px]",
              w.tone === "danger" && "bg-st-action-bg text-st-action",
              w.tone === "attention" && "bg-st-review-bg text-st-review",
              w.tone === "info" && "bg-st-scheduled-bg text-st-scheduled")}>
              <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />{w.text}
            </p>
          );
        })}
      </div>
      {preview.occurrences.length > 0 && (
        <div className="max-h-[480px] overflow-y-auto rounded-xl border border-line-soft">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">{r.previewTitle}</caption>
            <thead className="sticky top-0 bg-page">
              <tr className="text-xs text-secondary">
                <th scope="col" className="px-3 py-2 text-start font-semibold">{r.date}</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{isAdult ? t.zones.student : t.zones.family} · {zoneCity(studentTz, tag)}</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{t.zones.teacher} · {zoneCity(teacherTz, tag)}</th>
              </tr>
            </thead>
            <tbody>
              {preview.occurrences.map((o) => (
                <tr key={o.start} className={cn("border-t border-subtle align-top tabular", o.conflictWith && "bg-st-action-bg/50")}>
                  <td className="px-3 py-2">
                    <span className="block font-medium">{new Intl.DateTimeFormat(tag, { timeZone: studentTz, weekday: "short", day: "numeric", month: "short" }).format(new Date(o.start))}</span>
                    <span className="flex flex-wrap gap-1 pt-1">
                      {o.conflictWith && <Badge tone="action" size="sm">{t.status.conflict}</Badge>}
                      {o.outsideAvailability && <Badge tone="review" size="sm">{r.flagHours}</Badge>}
                      {o.beyondValidity && <Badge tone="pending" size="sm">{r.flagExpiry}</Badge>}
                      {o.beyondBalance && !o.beyondValidity && <Badge tone="pending" size="sm">{r.flagBalance}</Badge>}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2", o.studentShift && "font-semibold text-st-scheduled")}>{o.studentTime}{o.studentShift && <span className="sr-only"> {r.shifted}</span>}</td>
                  <td className={cn("px-3 py-2", o.teacherShift && "font-semibold text-st-scheduled")}>
                    {o.teacherTime}
                    {o.teacherDateKey !== o.dateKey && <span className="ms-1 text-xs text-muted">({new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short" }).format(new Date(`${o.teacherDateKey}T12:00:00Z`))})</span>}
                    {o.teacherShift && <span className="sr-only"> {r.shifted}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InfoNote>{r.legend}</InfoNote>
    </Card>
  );
}
