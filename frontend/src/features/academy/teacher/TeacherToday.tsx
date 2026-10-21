"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, FileText, Video } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { useResource } from "@/hooks/useResource";
import { formatDay, formatNumber, formatTime, zoneCity, zonedParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ds/Button";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { MultiZoneTimes } from "@/components/ds/Time";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { teacherApi } from "../teacher-api";
import type { SessionRow } from "../types";

const JOIN_OPENS_MIN = 10;

export function TeacherToday() {
  const { t, tag } = useI18n();
  const tt = t.teacherToday;
  const now = useNow(15_000);
  const { data, error, isLoading, reload } = useResource(() => teacherApi.today());
  const reported = useSearchParams().get("reported");

  if (isLoading) return <LoadingState rows={6} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;

  const { teacher, sessions } = data;
  const zone = teacher.timezone;
  const todayKey = zonedParts(new Date(now).toISOString(), zone).dateKey;
  const today = sessions.filter((s) => zonedParts(s.startsAt, zone).dateKey === todayKey && s.status !== "cancelled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const due = sessions.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  // The class that just ended without a report takes over the card: one action, "Complete lesson report".
  const justEnded = due.find((s) => now - new Date(s.endsAt).getTime() < 3 * 3_600_000) ?? null;
  const next = sessions.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{t.teacherNav.today}</h1>
        <div className="text-[13px] text-muted">{formatDay(new Date(now).toISOString(), zone, tag)} · {tt.classes(today.length)}</div>
      </div>

      {reported && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />{tt.reportSaved(reported)}
        </p>
      )}

      {justEnded ? (
        <ReportCard session={justEnded} zone={zone} />
      ) : next ? (
        <NextClassCard session={next} zone={zone} now={now} meetingUrl={teacher.meetingUrl} />
      ) : (
        <div className="rounded-2xl border border-line-soft bg-surface p-4 text-[13px] text-muted">{tt.noMore}</div>
      )}

      {due.filter((s) => s.id !== justEnded?.id).length > 0 && (
        <section aria-labelledby="due" className="flex flex-col gap-2">
          <h2 id="due" className="text-sm font-semibold">{tt.reportsDue(due.length - (justEnded ? 1 : 0))}</h2>
          <ul className="flex flex-col gap-2">
            {due.filter((s) => s.id !== justEnded?.id).map((s) => (
              <li key={s.id}>
                <Link href={`/teacher/report/${s.id}`} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line-soft bg-surface px-4 py-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-st-review-bg text-st-review"><FileText aria-hidden className="size-[18px]" /></span>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-sm font-semibold">{s.studentName}</span>
                    <span className="block truncate text-xs text-muted tabular">{formatDay(s.startsAt, zone, tag)} · {formatTime(s.startsAt, zone, tag)} {zoneCity(zone, tag)}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-muted rtl:-scale-x-100" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="agenda" className="flex flex-col gap-2">
        <h2 id="agenda" className="text-sm font-semibold">{tt.agenda}</h2>
        {today.length === 0 ? <p className="text-[13px] text-muted">{tt.noClasses}</p> : (
          <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
            {today.map((s) => {
              const ended = new Date(s.endsAt).getTime() < now;
              const reportDue = s.status === "scheduled" && ended;
              return (
                <li key={s.id}>
                  <Link href={reportDue ? `/teacher/report/${s.id}` : `/teacher/students/${s.studentId}`} className="flex min-h-[52px] items-center gap-3 px-4 py-3 text-[13px] tabular">
                    <span className="w-12 font-semibold">{formatTime(s.startsAt, zone, tag)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.studentName}</span>
                      {s.studentTimezone !== zone && <span className="block text-xs text-muted">{formatTime(s.startsAt, s.studentTimezone, tag)} {zoneCity(s.studentTimezone, tag)}</span>}
                    </span>
                    <StatusBadge status={reportDue ? "report_due" : s.status} size="sm" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function NextClassCard({ session, zone, now, meetingUrl }: { session: SessionRow; zone: string; now: number; meetingUrl?: string }) {
  const { t, tag } = useI18n();
  const tt = t.teacherToday;
  const startMs = new Date(session.startsAt).getTime();
  const minutes = Math.round((startMs - now) / 60_000);
  const inProgress = minutes <= 0;
  const canJoin = minutes <= JOIN_OPENS_MIN;
  const isToday = zonedParts(session.startsAt, zone).dateKey === zonedParts(new Date(now).toISOString(), zone).dateKey;
  const countdown = inProgress
    ? tt.inProgress
    : minutes < 60
      ? tt.inMinutes(formatNumber(minutes, tag))
      : minutes < 24 * 60
        ? tt.inHours(formatNumber(Math.floor(minutes / 60), tag), formatNumber(minutes % 60, tag))
        : formatDay(session.startsAt, zone, tag);
  const opensAt = formatTime(new Date(startMs - JOIN_OPENS_MIN * 60_000).toISOString(), zone, tag);

  return (
    <article className="flex flex-col gap-3 rounded-class bg-brand-800 p-[18px] text-white" aria-labelledby="next-title">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-brand-100">{isToday ? tt.nextClass : tt.nextClassLater}</span>
        <span className="text-[13px] font-semibold text-brand-100 tabular" aria-live="polite" aria-atomic="true">{countdown}</span>
      </div>
      <div id="next-title" className="text-xl font-semibold leading-tight">{session.studentName}</div>
      <div className="text-[13px] text-brand-300">{t.teacherToday.minutes(formatNumber(Math.round((new Date(session.endsAt).getTime() - startMs) / 60_000), tag))}{session.isAdult ? ` · ${t.students.adult}` : ""}</div>
      <MultiZoneTimes variant="on-dark" iso={session.startsAt} zones={[{ role: t.zones.you, timeZone: zone }, { role: session.isAdult ? t.zones.student : t.zones.family, timeZone: session.studentTimezone }]} />
      <Button
        variant="on-dark"
        size="lg"
        disabled={!canJoin || !meetingUrl}
        aria-describedby="join-hint"
        icon={<Video aria-hidden className="size-[18px]" />}
        onClick={() => meetingUrl && window.open(meetingUrl, "_blank", "noopener")}
        className="disabled:bg-white/20 disabled:text-brand-100 disabled:border-transparent"
      >
        {tt.join}
      </Button>
      <p id="join-hint" className={cn("text-center text-xs text-brand-300", canJoin && "sr-only")}>{tt.joinOpens(opensAt)}</p>
    </article>
  );
}

function ReportCard({ session, zone }: { session: SessionRow; zone: string }) {
  const { t, tag } = useI18n();
  const tt = t.teacherToday;
  return (
    <article className="flex flex-col gap-3 rounded-class border-2 border-st-review-bg bg-surface p-[18px]" aria-labelledby="report-title">
      <span className="self-start rounded-full bg-st-review-bg px-2.5 py-1 text-xs font-medium text-st-review">{tt.classEnded}</span>
      <div id="report-title" className="text-xl font-semibold leading-tight">{session.studentName}</div>
      <div className="text-[13px] text-muted tabular">{formatTime(session.startsAt, zone, tag)}–{formatTime(session.endsAt, zone, tag)} {zoneCity(zone, tag)}</div>
      <ButtonLink href={`/teacher/report/${session.id}`} variant="primary" size="lg" icon={<FileText aria-hidden className="size-[18px]" />}>{tt.completeReport}</ButtonLink>
      <p className="text-center text-xs text-muted">{tt.reportWhy}</p>
    </article>
  );
}
