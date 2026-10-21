"use client";

import React from "react";
import { BookOpen } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatDay, formatNumber, zoneCity } from "@/lib/format";
import { NoteCard } from "@/components/ds/Panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { useFamilyChild } from "@/components/shells/FamilyShell";
import { familyApi } from "../family-api";
import { ProgressTimeline, SurahRef } from "../progress/ProgressTimeline";

/** Family-visible progress only: surah/ayah record, teacher notes to the family, homework. */
export function FamilyProgress() {
  const { t, tag } = useI18n();
  const fp = t.familyProgress;
  const { familyId, childId, isAdultAccount } = useFamilyChild();
  const { data, error, isLoading, reload } = useResource(() => familyApi.progress(familyId), [familyId]);
  const now = useNow();
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;
  const shown = childId === "all" ? data.children : data.children.filter((c) => c.student.id === childId);
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <h1 className="text-[22px] font-semibold">{t.familyNav.progress}</h1>
      {shown.map(({ student, teacher, progress, lessons }) => {
        const latest = progress[0];
        const memorized = progress.filter((p) => p.activity === "memorization" && p.date >= monthAgo).reduce((n, p) => n + (p.ayahTo - p.ayahFrom + 1), 0);
        const first = student.name.split(" ")[0];
        return (
          <section key={student.id} aria-label={student.name} className="flex flex-col gap-3">
            {childId === "all" && <h2 className="pt-1 text-sm font-semibold">{student.name}</h2>}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-2xl border border-brand-100 bg-brand-50 p-3.5">
                <span className="text-xs text-brand-700">{isAdultAccount ? fp.youAreOn : fp.childIsOn(first)}</span>
                <span className="text-[15px] leading-tight text-brand-800">{latest ? <SurahRef entry={latest} /> : "—"}</span>
                {latest && <span className="text-xs text-brand-700">{t.quran.activity[latest.activity]}</span>}
              </div>
              <div className="flex flex-col gap-1 rounded-2xl border border-line-soft bg-surface p-3.5">
                <span className="text-xs text-muted">{fp.last30}</span>
                <span className="text-2xl font-semibold tabular">{formatNumber(memorized, tag)}</span>
                <span className="text-xs text-muted">{fp.ayahsMemorized}</span>
              </div>
            </div>
            {progress.length === 0 ? (
              <EmptyState icon={<BookOpen aria-hidden className="size-[22px]" />} title={t.studentProfile.noProgress} description={fp.emptyBody(teacher?.name ?? "")} />
            ) : (
              <ProgressTimeline
                entries={progress}
                extra={(entry) => {
                  const lesson = lessons.find((l) => l.sessionNumber === entry.sessionNumber);
                  return lesson?.homework ? <p className="text-xs text-muted"><span className="font-medium text-secondary">{t.report.homework}:</span> {lesson.homework}</p> : null;
                }}
              />
            )}
            {lessons[0]?.familyNotes && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold">{fp.lastNote}</h3>
                <NoteCard visibility="family" meta={`${teacher?.name ?? ""} · ${formatDay(lessons[0].startsAt, student.timezone, tag)} ${zoneCity(student.timezone, tag)}`}>{lessons[0].familyNotes}</NoteCard>
              </div>
            )}
            <p className="text-xs text-muted">{fp.footnote(formatDate(new Date(now).toISOString(), tag))}</p>
          </section>
        );
      })}
    </>
  );
}
