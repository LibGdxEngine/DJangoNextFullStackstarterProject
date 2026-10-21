"use client";

import React from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { useResource } from "@/hooks/useResource";
import { addDaysKey, formatTime, zoneCity, zonedParts } from "@/lib/format";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { teacherApi } from "../teacher-api";

/** Two-week agenda in the teacher's zone, with the family's time where it differs. */
export function TeacherSchedule() {
  const { t, tag } = useI18n();
  const now = useNow(60_000);
  const { data, error, isLoading, reload } = useResource(() => teacherApi.today());
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;

  const zone = data.teacher.timezone;
  const todayKey = zonedParts(new Date(now).toISOString(), zone).dateKey;
  const days = Array.from({ length: 14 }, (_, i) => addDaysKey(todayKey, i));
  const rows = data.sessions.filter((s) => s.status !== "cancelled");

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{t.teacherNav.schedule}</h1>
        <span className="text-[13px] text-muted">{t.teacherSchedule.timesIn(zoneCity(zone, tag))}</span>
      </div>
      {rows.length === 0 ? <EmptyState icon={<CalendarDays aria-hidden className="size-[22px]" />} title={t.teacherToday.noClasses} /> : days.map((key) => {
        const dayRows = rows.filter((s) => zonedParts(s.startsAt, zone).dateKey === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        if (!dayRows.length) return null;
        return (
          <section key={key} aria-labelledby={`d-${key}`} className="flex flex-col gap-1.5">
            <h2 id={`d-${key}`} className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">
              {key === todayKey ? t.calendar.today : ""}{key === todayKey ? " · " : ""}{new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${key}T12:00:00Z`))}
            </h2>
            <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
              {dayRows.map((s) => {
                const reportDue = s.status === "scheduled" && new Date(s.endsAt).getTime() < now;
                return (
                  <li key={s.id}>
                    <Link href={reportDue ? `/teacher/report/${s.id}` : `/teacher/students/${s.studentId}`} className="flex min-h-[52px] items-center gap-3 px-4 py-3 text-[13px] tabular">
                      <span className="w-12 font-semibold">{formatTime(s.startsAt, zone, tag)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.studentName}</span>
                        {s.studentTimezone !== zone && <span className="block text-xs text-muted">{s.isAdult ? t.zones.student : t.zones.family} {formatTime(s.startsAt, s.studentTimezone, tag)} {zoneCity(s.studentTimezone, tag)}</span>}
                      </span>
                      {(reportDue || s.status !== "scheduled" || s.conflict) && <StatusBadge status={s.conflict ? "conflict" : reportDue ? "report_due" : s.status} size="sm" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="text-xs text-muted">{t.teacherSchedule.changesHint}</p>
    </>
  );
}
