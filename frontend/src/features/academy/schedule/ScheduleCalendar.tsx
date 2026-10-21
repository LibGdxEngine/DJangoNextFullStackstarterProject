"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { addDaysKey, formatNumber, formatTime, startOfWeekKey, TIME_ZONES, zoneCity, zoneOffset, zonedParts, formatRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { Card, KeyValue } from "@/components/ds/Card";
import { FilterSelect } from "@/components/ds/DataTable";
import { Select } from "@/components/ds/Field";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { SidePanel } from "@/components/ds/Panels";
import { MultiZoneTimes } from "@/components/ds/Time";
import { WeekGrid, type CalendarDay } from "@/components/ds/Calendar";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { settings, enrollments } from "../fixtures";
import { useAccess } from "../access";
import { sessionApi } from "../sessions-api";
import { availabilityInZone } from "../recurrence";
import type { SessionRow } from "../types";
import { CancelSessionDialog, RescheduleDialog, SubstituteDialog } from "../dialogs/SessionDialogs";

type View = "day" | "week" | "agenda";

export function ScheduleCalendar() {
  const { t, tag } = useI18n();
  const c = t.schedule;
  const { can } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const { data, error, isLoading, reload } = useResource(() => sessionApi.calendar());

  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [zone, setZone] = useState(settings.timezone);
  const [view, setView] = useState<View>(() => (params.get("view") as View) ?? "week");
  const [anchor, setAnchor] = useState(() => zonedParts(new Date(now).toISOString(), settings.timezone).dateKey);
  const [teacher, setTeacher] = useState(params.get("teacher") ?? "any");
  const [student, setStudent] = useState(params.get("student") ?? "any");
  const [conflictsOnly, setConflictsOnly] = useState(params.get("conflicts") === "1");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("session"));
  const [dialog, setDialog] = useState<"reschedule" | "cancel" | "substitute" | null>(null);

  // Default: week on desktop, agenda on mobile — unless the URL asked for a view.
  useEffect(() => {
    if (params.get("view")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick the default view once the viewport is known.
    if (window.matchMedia("(max-width: 767px)").matches) setView("agenda");
  }, [params]);

  function changeView(next: View) {
    setView(next);
    const search = new URLSearchParams(params.toString());
    search.set("view", next);
    router.replace(`${pathname}?${search}`, { scroll: false });
  }

  const step = view === "day" ? 1 : 7;
  const startKey = view === "week" ? startOfWeekKey(anchor) : anchor;
  const dayKeys = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDaysKey(startKey, i));
  const todayKey = zonedParts(new Date(now).toISOString(), zone).dateKey;

  const rows = useMemo(() => (data?.sessions ?? []).filter((s) =>
    (teacher === "any" || s.teacherId === teacher) &&
    (student === "any" || s.studentId === student) &&
    (!conflictsOnly || s.conflict)), [data, teacher, student, conflictsOnly]);
  const visible = rows.filter((s) => dayKeys.includes(zonedParts(s.startsAt, zone).dateKey));
  const conflicts = useMemo(() => new Set(rows.filter((r) => r.conflict).map((r) => r.id)), [rows]);
  const selected = data?.sessions.find((s) => s.id === selectedId) ?? null;

  const overlay = useMemo(() => {
    if (!data || teacher === "any") return null;
    return availabilityInZone(data.availability.filter((a) => a.teacherId === teacher), dayKeys, zone);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayKeys is derived from startKey and view.
  }, [data, teacher, zone, startKey, view]);

  const days: CalendarDay[] = dayKeys.map((key) => ({
    dateKey: key,
    label: new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short", day: "numeric", month: view === "day" ? "long" : undefined }).format(new Date(`${key}T12:00:00Z`)),
    isToday: key === todayKey,
    available: overlay?.[key],
  }));

  const rangeLabel = view === "day"
    ? new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${dayKeys[0]}T12:00:00Z`))
    : `${new Intl.DateTimeFormat(tag, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${dayKeys[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat(tag, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${dayKeys[6]}T12:00:00Z`))}`;

  const zoneOptions = [...new Set([settings.timezone, browserZone, ...(data?.teachers.map((x) => x.timezone) ?? []), ...TIME_ZONES])];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2.5">
      <div role="group" aria-label={c.view} className="inline-flex h-10 overflow-hidden rounded-[10px] border border-line">
        {(["day", "week", "agenda"] as View[]).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => changeView(v)} className={cn("px-3 text-[13px] font-medium", view === v ? "bg-brand-800 text-white" : "bg-surface text-ink")}>{c.views[v]}</button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={c.previous} onClick={() => setAnchor(addDaysKey(anchor, -step))} className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface"><ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" /></button>
        <Button onClick={() => setAnchor(todayKey)}>{c.today}</Button>
        <button type="button" aria-label={c.next} onClick={() => setAnchor(addDaysKey(anchor, step))} className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface"><ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" /></button>
      </div>
      <h2 className="text-sm font-semibold tabular" aria-live="polite">{rangeLabel}</h2>
      <label className="ms-auto flex items-center gap-2 text-[13px]">
        <span className="text-muted">{c.showTimesIn}</span>
        <Select value={zone} onChange={(e) => setZone(e.target.value)} className="w-56">
          {zoneOptions.map((z) => <option key={z} value={z}>{zoneCity(z, tag)} ({zoneOffset(z)}){z === settings.timezone ? ` · ${t.zones.academy}` : z === browserZone ? ` · ${c.yourDevice}` : ""}</option>)}
        </Select>
      </label>
    </div>
  );

  const filters = data && (
    <div className="flex flex-wrap items-center gap-2.5">
      <FilterSelect label={t.students.filterTeacher} value={teacher} onChange={setTeacher} options={[{ value: "any", label: t.common.any }, ...data.teachers.map((x) => ({ value: x.id, label: x.name }))]} />
      <FilterSelect label={c.student} value={student} onChange={setStudent} options={[{ value: "any", label: t.common.any }, ...data.students.map((x) => ({ value: x.id, label: x.name }))]} />
      <button type="button" aria-pressed={conflictsOnly} onClick={() => setConflictsOnly((v) => !v)} className={cn("inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium", conflictsOnly ? "border-st-action bg-st-action-bg text-st-action" : "border-line bg-surface")}>
        <AlertTriangle aria-hidden className="size-3.5" />{c.conflictsOnly(formatNumber(conflicts.size, tag))}
      </button>
      {teacher === "any" ? <span className="text-xs text-muted">{c.pickTeacherHint}</span> : <span className="text-xs text-muted">{c.overlayHint}</span>}
    </div>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.schedule }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.schedule}
        meta={c.meta}
        actions={can("manage_schedule")
          ? <ButtonLink href={`/manage/schedule/new${student !== "any" ? `?student=${student}` : ""}`} variant="primary" icon={<CalendarPlus aria-hidden className="size-4" />}>{c.newRecurring}</ButtonLink>
          : <Button locked title={t.common.lockedForRole}>{c.newRecurring}</Button>}
      />
      {toolbar}
      {filters}
      {isLoading ? <Card><LoadingState rows={10} /></Card> : error || !data ? <ErrorState title={c.loadError} onRetry={reload} /> : (
        <div className={cn("grid items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
          <div className="min-w-0">
            {view === "agenda" ? (
              <Agenda days={dayKeys} rows={visible} zone={zone} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <WeekGrid
                days={days}
                events={visible.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, title: view === "day" ? `${s.studentName} · ${s.teacherName.replace(/^Ust\. /, "")}` : s.studentName.split(" ")[0] }))}
                timeZone={zone}
                startHour={6}
                endHour={23}
                conflicts={conflicts}
                selectedId={selectedId ?? undefined}
                onSelect={(e) => setSelectedId(e.id)}
                minWidth={view === "day" ? 320 : 720}
              />
            )}
          </div>
          {selected && (
            <div className="order-first xl:order-none xl:sticky xl:top-24">
              <SessionSummary
                session={selected}
                onClose={() => setSelectedId(null)}
                onAction={(a) => setDialog(a)}
              />
            </div>
          )}
        </div>
      )}

      {selected && (
        <>
          <RescheduleDialog open={dialog === "reschedule"} onClose={() => setDialog(null)} session={selected} onDone={reload} />
          <CancelSessionDialog open={dialog === "cancel"} onClose={() => setDialog(null)} session={selected} onDone={reload} />
          <SubstituteDialog open={dialog === "substitute"} onClose={() => setDialog(null)} session={selected} onDone={reload} />
        </>
      )}
    </>
  );
}

function Agenda({ days, rows, zone, selectedId, onSelect }: { days: string[]; rows: SessionRow[]; zone: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t, tag } = useI18n();
  if (rows.length === 0) return <Card><EmptyState icon={<CalendarPlus aria-hidden className="size-[22px]" />} title={t.schedule.emptyRange} description={t.schedule.emptyRangeBody} /></Card>;
  return (
    <div className="flex flex-col gap-4">
      {days.map((key) => {
        const dayRows = rows.filter((r) => zonedParts(r.startsAt, zone).dateKey === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        if (!dayRows.length) return null;
        return (
          <section key={key} aria-labelledby={`ag-${key}`} className="flex flex-col gap-1.5">
            <h3 id={`ag-${key}`} className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">{new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${key}T12:00:00Z`))}</h3>
            <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft bg-surface">
              {dayRows.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-pressed={selectedId === r.id} onClick={() => onSelect(r.id)} className={cn("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-start text-[13px] hover:bg-page", selectedId === r.id && "bg-brand-50")}>
                    <span className="w-24 font-semibold tabular">{formatTime(r.startsAt, zone, tag)}–{formatTime(r.endsAt, zone, tag)}</span>
                    <span className="min-w-40 flex-1">
                      <span className="block font-medium">{r.studentName}</span>
                      <span className="text-xs text-muted">{r.teacherName}</span>
                    </span>
                    <span className="text-xs text-muted tabular">
                      {(r.isAdult ? t.zones.student : t.zones.family)} {formatTime(r.startsAt, r.studentTimezone, tag)} {zoneCity(r.studentTimezone, tag)} · {t.zones.teacher} {formatTime(r.startsAt, r.teacherTimezone, tag)} {zoneCity(r.teacherTimezone, tag)}
                    </span>
                    <span className="flex gap-1.5">
                      {r.conflict && <StatusBadge status="conflict" size="sm" />}
                      <StatusBadge status={r.reportDue ? "report_due" : r.status} size="sm" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Class summary panel: three zones, package balance and the short actions. */
function SessionSummary({ session, onClose, onAction }: { session: SessionRow; onClose: () => void; onAction: (a: "reschedule" | "cancel" | "substitute") => void }) {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const now = useNow();
  const enrollment = enrollments.find((e) => e.id === session.enrollmentId);
  const upcoming = session.status === "scheduled" && new Date(session.startsAt).getTime() > now;
  const canEdit = can("manage_schedule");
  return (
    <SidePanel
      title={`${t.schedule.session(formatRef(session.number, tag))} · ${new Intl.DateTimeFormat(tag, { timeZone: session.studentTimezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(session.startsAt))}`}
      onClose={onClose}
      footer={(
        <>
          <ButtonLink href={`/manage/sessions/${session.id}`} size="sm" variant="primary">{t.schedule.openDetails}</ButtonLink>
          {upcoming && (
            <>
              <Button size="sm" locked={!canEdit} onClick={() => onAction("reschedule")}>{t.dialogs.reschedule.title}</Button>
              <Button size="sm" locked={!canEdit} onClick={() => onAction("substitute")}>{t.schedule.substitute}</Button>
              <Button size="sm" variant="danger" locked={!canEdit} onClick={() => onAction("cancel")}>{t.common.cancel}</Button>
            </>
          )}
        </>
      )}
    >
      <KeyValue label={t.students.colStatus}>
        <span className="flex flex-wrap justify-end gap-1.5">
          {session.conflict && <StatusBadge status="conflict" size="sm" />}
          <StatusBadge status={session.reportDue ? "report_due" : session.status} size="sm" />
        </span>
      </KeyValue>
      {session.conflict && <p className="flex items-start gap-1.5 text-xs text-st-action"><AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />{t.schedule.conflictExplain}</p>}
      <KeyValue label={t.students.colStudent}><Link href={`/manage/students/${session.studentId}`} className="text-brand-700">{session.studentName}</Link></KeyValue>
      <KeyValue label={t.students.colTeacher}><Link href={`/manage/teachers/${session.teacherId}`} className="text-brand-700">{session.teacherName}</Link></KeyValue>
      <MultiZoneTimes
        iso={session.startsAt}
        zones={[
          { role: session.isAdult ? t.zones.student : t.zones.family, timeZone: session.studentTimezone },
          { role: t.zones.teacher, timeZone: session.teacherTimezone },
          { role: t.zones.academy, timeZone: settings.timezone },
        ]}
      />
      {enrollment && <KeyValue label={t.schedule.package}>{enrollment.packageName} · <span className="tabular">{t.schedule.left(formatNumber(enrollment.balance, tag))}</span></KeyValue>}
      {!upcoming && session.status === "scheduled" && <p className="text-xs text-st-review">{t.schedule.reportOverdue}</p>}
    </SidePanel>
  );
}
