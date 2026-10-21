"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { ageFrom, formatNumber, zoneCity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ds/Field";
import { Avatar } from "@/components/ds/DetailHeader";
import { Badge } from "@/components/ds/StatusBadge";
import { ZoneTime } from "@/components/ds/Time";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { settings } from "../fixtures";
import { SurahRef } from "../progress/ProgressTimeline";
import { teacherApi } from "../teacher-api";

export function TeacherStudents() {
  const { t, tag } = useI18n();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => teacherApi.students());
  const [query, setQuery] = useState("");
  const list = (demo === "empty" ? [] : data ?? []).filter((c) => !query || c.student.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{t.teacherNav.students}</h1>
        {data && <span className="text-[13px] text-muted">{t.families.studentsCount(data.length)}</span>}
      </div>
      <SearchInput label={t.students.searchLabel} placeholder={t.teacherStudents.search} value={query} onChange={(e) => setQuery(e.target.value)} className="[&_input]:h-11" />
      {isLoading ? <LoadingState rows={6} /> : error ? <ErrorState title={t.students.loadError} onRetry={reload} /> : list.length === 0 ? (
        <EmptyState icon={<Users aria-hidden className="size-[22px]" />} title={query ? t.students.noMatchTitle : t.teacherStudents.emptyTitle} description={query ? t.students.noMatchBody : t.teacherStudents.emptyBody} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map(({ student, familyName, nextSession, lastProgress, lessonsLeft, reportsDue }) => {
            const age = ageFrom(student.birthDate);
            const low = lessonsLeft <= settings.lowBalanceThreshold;
            return (
              <li key={student.id}>
                <Link href={`/teacher/students/${student.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-line-soft bg-surface p-4 hover:border-brand-300">
                  <div className="flex items-center gap-3">
                    <Avatar name={student.name} size="md" />
                    <div className="min-w-0 flex-1 leading-snug">
                      <div className="truncate text-[15px] font-semibold">{student.name}</div>
                      <div className="truncate text-xs text-muted">{t.programs[student.program]} · {student.isAdult ? t.students.adult : age !== null ? t.students.age(formatNumber(age, tag)) : familyName} · {zoneCity(student.timezone, tag)}</div>
                    </div>
                    {reportsDue > 0 && <Badge tone="review" size="sm">{t.status.report_due}</Badge>}
                    <ChevronRight aria-hidden className="size-4 text-muted rtl:-scale-x-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex flex-col gap-0.5 rounded-[10px] bg-page px-3 py-2">
                      <span className="text-muted">{t.studentProfile.nextClass}</span>
                      <span className="font-medium">{nextSession ? <ZoneTime iso={nextSession.startsAt} timeZone={student.timezone} withWeekday /> : "—"}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-[10px] bg-page px-3 py-2">
                      <span className="text-muted">{t.teacherStudents.lastLesson}</span>
                      <span className="truncate">{lastProgress ? <SurahRef entry={lastProgress} /> : "—"}</span>
                    </div>
                  </div>
                  <div className={cn("text-xs tabular", low ? "font-semibold text-st-review" : "text-muted")}>{t.teacherStudents.lessonsLeft(formatNumber(lessonsLeft, tag))}{low ? ` · ${t.status.renewal_due}` : ""}</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
