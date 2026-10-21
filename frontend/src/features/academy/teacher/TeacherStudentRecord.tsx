"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronLeft, FileText, Star } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { useResource } from "@/hooks/useResource";
import { ageFrom, formatDate, formatDay, formatNumber, formatRef, formatTime, zoneCity, zoneOffset } from "@/lib/format";
import { Avatar, TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { MultiZoneTimes } from "@/components/ds/Time";
import { NoteCard } from "@/components/ds/Panels";
import { ButtonLink } from "@/components/ds/Button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { teachers } from "../fixtures";
import { CURRENT_TEACHER_ID, teacherApi } from "../teacher-api";
import { ProgressTimeline } from "../progress/ProgressTimeline";

type Tab = "progress" | "lessons" | "notes";

export function TeacherStudentRecord({ id }: { id: string }) {
  const { t, tag } = useI18n();
  const tr = t.teacherStudents;
  const now = useNow(60_000);
  const { data, error, isLoading, reload } = useResource(() => teacherApi.student(id), [id]);
  const [tab, setTab] = useState<Tab>("progress");
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.studentProfile.loadError} onRetry={reload} />;

  const { student } = data;
  const teacherZone = teachers.find((x) => x.id === CURRENT_TEACHER_ID)!.timezone;
  const next = data.sessions.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const due = data.sessions.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() < now);
  const past = data.sessions.filter((s) => new Date(s.startsAt).getTime() < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const age = ageFrom(student.birthDate);

  return (
    <>
      <Link href="/teacher/students" className="inline-flex h-11 items-center gap-1 self-start text-[13px] font-medium text-brand-700">
        <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />{t.teacherNav.students}
      </Link>
      <div className="flex items-center gap-3">
        <Avatar name={student.name} size="lg" />
        <div className="min-w-0 leading-snug">
          <h1 className="text-[22px] font-semibold">{student.name}</h1>
          <p className="text-[13px] text-muted">{t.programs[student.program]} · {student.isAdult ? t.students.adult : age !== null ? t.students.age(formatNumber(age, tag)) : data.familyName}</p>
          <p className="text-xs text-muted tabular">{zoneCity(student.timezone, tag)} ({zoneOffset(student.timezone)}) · {tr.lessonsLeft(formatNumber(data.enrollment?.balance ?? 0, tag))}</p>
        </div>
      </div>

      {due.map((s) => (
        <ButtonLink key={s.id} href={`/teacher/report/${s.id}`} variant="primary" size="lg" icon={<FileText aria-hidden className="size-[18px]" />}>
          {tr.completeFor(formatDay(s.startsAt, teacherZone, tag))}
        </ButtonLink>
      ))}

      {next && (
        <section aria-labelledby="t-next" className="flex flex-col gap-2 rounded-2xl border border-line-soft bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="t-next" className="text-sm font-semibold">{t.studentProfile.nextClass}</h2>
            <span className="text-xs text-muted">{formatDay(next.startsAt, teacherZone, tag)}</span>
          </div>
          <MultiZoneTimes iso={next.startsAt} zones={[{ role: t.zones.you, timeZone: teacherZone }, { role: student.isAdult ? t.zones.student : t.zones.family, timeZone: student.timezone }]} />
        </section>
      )}

      <Tabs
        idBase="tstudent"
        label={t.studentProfile.sections}
        value={tab}
        onChange={setTab}
        items={[
          { key: "progress", label: t.studentProfile.tabs.progress, count: data.progress.length },
          { key: "lessons", label: tr.lessons },
          { key: "notes", label: t.studentProfile.tabs.notes, count: data.notes.length },
        ]}
      />
      <TabPanel idBase="tstudent" tab={tab}>
        {tab === "progress" && (data.progress.length ? <ProgressTimeline entries={data.progress} showSession /> : <EmptyState icon={<Star aria-hidden className="size-[22px]" />} title={t.studentProfile.noProgress} description={t.studentProfile.noProgressBody} />)}
        {tab === "lessons" && (
          <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
            {past.slice(0, 12).map((s) => {
              const record = data.records.find((r) => r.sessionId === s.id);
              const reportDue = s.status === "scheduled";
              return (
                <li key={s.id}>
                  <LessonRow href={reportDue || record ? `/teacher/report/${s.id}` : null}>
                    <span className="flex items-center justify-between gap-2 tabular">
                      <span className="font-medium">{formatDay(s.startsAt, teacherZone, tag)} · {formatTime(s.startsAt, teacherZone, tag)} <span className="text-xs text-muted">#{formatRef(s.number, tag)}</span></span>
                      <StatusBadge status={reportDue ? "report_due" : s.status} size="sm" />
                    </span>
                    {record?.familyNotes && <span className="line-clamp-2 text-xs text-muted">{record.familyNotes}</span>}
                  </LessonRow>
                </li>
              );
            })}
          </ul>
        )}
        {tab === "notes" && (
          <div className="flex flex-col gap-2.5">
            {data.notes.length === 0 ? <EmptyState icon={<Star aria-hidden className="size-[22px]" />} title={t.notes.empty} /> : data.notes.map((n) => (
              <NoteCard key={n.id} visibility={n.visibility} meta={`${n.authorName} · ${formatDate(n.createdAt, tag)}`}>{n.text}</NoteCard>
            ))}
          </div>
        )}
      </TabPanel>
    </>
  );
}

function LessonRow({ href, children }: { href: string | null; children: React.ReactNode }) {
  const className = "flex flex-col gap-1 px-4 py-3 text-[13px]";
  return href ? <Link href={href} className={className}>{children}</Link> : <div className={className}>{children}</div>;
}
