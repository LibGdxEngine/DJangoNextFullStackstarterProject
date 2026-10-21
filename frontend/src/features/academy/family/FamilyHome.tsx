"use client";

import React from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { useResource } from "@/hooks/useResource";
import { ageFrom, formatDate, formatDay, formatNumber, formatTime, zoneCity, zonedParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ds/Button";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { useFamilyChild } from "@/components/shells/FamilyShell";
import { familyApi, type FamilyHome as Home } from "../family-api";
import { SurahRef } from "../progress/ProgressTimeline";

export function FamilyHome() {
  const { t, tag } = useI18n();
  const f = t.familyHome;
  const { familyId, childId, isAdultAccount, setAccount } = useFamilyChild();
  const { data, error, isLoading, reload } = useResource(() => familyApi.home(familyId), [familyId]);
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;

  const shown = childId === "all" ? data.children : data.children.filter((c) => c.student.id === childId);
  const single = shown.length === 1 ? shown[0] : null;
  const age = single ? ageFrom(single.student.birthDate) : null;

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{t.familyNav.home}</h1>
        {single && !isAdultAccount && <div className="text-[13px] text-muted">{single.student.name.split(" ")[0]}{age !== null ? ` · ${t.students.age(formatNumber(age, tag))}` : ""}</div>}
      </div>

      {shown.map((child) => (
        <ChildSection key={child.student.id} child={child} isAdult={isAdultAccount} showName={childId === "all"} threshold={data.lowBalanceThreshold} familyTz={data.family.timezone} />
      ))}

      <p className="text-xs text-muted">{isAdultAccount ? f.adultNote : f.parentNote}</p>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-dashed px-3 py-2 text-xs text-muted">
        <span>{f.reviewSwitch}</span>
        <Button size="sm" variant="tertiary" onClick={() => setAccount(isAdultAccount ? "parent" : "adult")}>{isAdultAccount ? f.viewParent : f.viewAdult}</Button>
      </div>
    </>
  );
}

function ChildSection({ child, isAdult, showName, threshold, familyTz }: { child: Home["children"][number]; isAdult: boolean; showName: boolean; threshold: number; familyTz: string }) {
  const { t, tag } = useI18n();
  const f = t.familyHome;
  const now = useNow(30_000);
  const { student, teacher, next, week, enrollment, latest, messages } = child;
  const first = student.name.split(" ")[0];
  const zone = student.timezone || familyTz;
  const isToday = next ? zonedParts(next.startsAt, zone).dateKey === zonedParts(new Date(now).toISOString(), zone).dateKey : false;
  const minutesToStart = next ? Math.round((new Date(next.startsAt).getTime() - now) / 60_000) : 0;
  const canJoin = next ? minutesToStart <= 10 : false;
  const low = enrollment ? enrollment.balance <= threshold : false;

  return (
    <section aria-label={student.name} className="flex flex-col gap-3">
      {showName && <h2 className="pt-1 text-sm font-semibold">{student.name}</h2>}

      <article className="flex flex-col gap-2.5 rounded-class border border-line-soft bg-surface p-[18px]">
        <div className="flex items-center justify-between">
          {next ? <StatusBadge status="scheduled" /> : <span />}
          <span className="text-xs text-muted">{isAdult ? f.yourNextClass : f.childNextClass(first)}</span>
        </div>
        {next ? (
          <>
            <div className="text-lg font-semibold leading-tight tabular">
              {isToday ? f.today : formatDay(next.startsAt, zone, tag)}{tag.startsWith("ar") ? "، " : ", "}{formatTime(next.startsAt, zone, tag)} {zoneCity(zone, tag)}
            </div>
            <div className="text-[13px] text-secondary">{t.programs[student.program]} · {f.withTeacher(teacher?.name ?? "")} · {t.teacherToday.minutes(formatNumber(Math.round((new Date(next.endsAt).getTime() - new Date(next.startsAt).getTime()) / 60_000), tag))}</div>
            {teacher && teacher.timezone !== zone && <div className="text-xs text-muted tabular">{f.teacherTime(formatTime(next.startsAt, teacher.timezone, tag), zoneCity(teacher.timezone, tag))}</div>}
            <div className="mt-1 flex gap-2">
              <Button variant="primary" className="h-11 flex-1 rounded-xl font-semibold" disabled={!canJoin} aria-describedby={`join-${student.id}`}>{t.teacherToday.join}</Button>
              <ButtonLink href={`/family/schedule?session=${next.id}`} className="h-11 rounded-xl">{f.change}</ButtonLink>
            </div>
            {!canJoin && <p id={`join-${student.id}`} className="text-center text-xs text-muted">{t.teacherToday.joinOpens(formatTime(new Date(new Date(next.startsAt).getTime() - 600_000).toISOString(), zone, tag))}</p>}
          </>
        ) : <p className="text-[13px] text-muted">{student.teacherId ? t.studentProfile.noUpcoming : f.noTeacherYet}</p>}
      </article>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/family/payments" className={cn("flex flex-col gap-1 rounded-2xl border p-3.5", low ? "border-accent-border bg-accent-50" : "border-line-soft bg-surface")}>
          <span className={cn("text-xs", low ? "text-accent-ink" : "text-muted")}>{t.studentProfile.lessonsLeft}</span>
          <span className="text-2xl font-semibold tabular">{formatNumber(enrollment?.balance ?? 0, tag)} <span className="text-[13px] font-normal text-muted">{f.of(formatNumber(enrollment?.lessonCount ?? 0, tag))}</span></span>
          <span className="h-1.5 rounded-full bg-subtle"><span className={cn("block h-full rounded-full", low ? "bg-accent-600" : "bg-brand-700")} style={{ width: `${Math.min(100, ((enrollment?.balance ?? 0) / Math.max(enrollment?.lessonCount ?? 1, 1)) * 100)}%` }} /></span>
          {low && <span className="text-xs font-medium text-accent-ink">{f.renewSoon}</span>}
          {enrollment && !low && <span className="text-xs text-muted">{f.validUntil(formatDate(enrollment.expiresOn, tag))}</span>}
        </Link>
        <Link href="/family/progress" className="flex flex-col gap-1 rounded-2xl border border-brand-100 bg-brand-50 p-3.5">
          <span className="text-xs text-brand-700">{t.studentProfile.latestProgress}</span>
          <span className="text-[15px] leading-tight text-brand-800">{latest ? <SurahRef entry={latest} /> : "—"}</span>
          {latest && <span className="text-xs text-brand-700">{t.quran.activity[latest.activity]} · {formatDate(latest.date, tag)}</span>}
        </Link>
      </div>

      {week.length > 1 && (
        <section aria-label={f.thisWeek} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{f.thisWeek}</h3>
          <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
            {week.slice(1).map((s) => (
              <li key={s.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13px] tabular">
                <span className="font-medium">{formatDay(s.startsAt, zone, tag)}</span>
                <span>{formatTime(s.startsAt, zone, tag)} <span className="text-xs text-muted">{zoneCity(zone, tag)}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {messages.length > 0 && (
        <section aria-label={f.messages} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{f.messages}</h3>
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-1 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
              <span className="flex items-center gap-1.5 text-xs text-brand-700"><Eye aria-hidden className="size-3" />{m.authorName} · {formatDate(m.createdAt, tag)}</span>
              <p className="text-[13px] leading-normal text-brand-800">{m.text}</p>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
