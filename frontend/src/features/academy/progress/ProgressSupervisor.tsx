"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatNumber, formatRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { FilterSelect, TableToolbar } from "@/components/ds/DataTable";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { academyApi } from "../api";
import { Rating, SurahRef } from "./ProgressTimeline";

type Range = "7" | "30" | "all";
type Activity = "any" | "memorization" | "revision" | "recitation";

/** Supervisor view: every surah/ayah entry across the academy, newest first. */
export function ProgressSupervisor() {
  const { t, tag } = useI18n();
  const p = t.progressView;
  const params = useSearchParams();
  const demo = useDemoState();
  const now = useNow();
  const { data, error, isLoading, reload } = useResource(() => academyApi.progressFeed());
  const all = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);
  const [student, setStudent] = useState(params.get("student") ?? "any");
  const [teacher, setTeacher] = useState("any");
  const [activity, setActivity] = useState<Activity>("any");
  const [range, setRange] = useState<Range>("30");

  const students = useMemo(() => [...new Map(all.map((e) => [e.studentId, e.studentName])).entries()], [all]);
  const teachers = useMemo(() => [...new Map(all.filter((e) => e.teacherId).map((e) => [e.teacherId!, e.teacherName!])).entries()], [all]);
  const since = range === "all" ? "" : new Date(now - Number(range) * 86_400_000).toISOString().slice(0, 10);
  const feed = all.filter((e) =>
    (student === "any" || e.studentId === student) &&
    (teacher === "any" || e.teacherId === teacher) &&
    (activity === "any" || e.activity === activity) &&
    (!since || e.date >= since));

  // Latest position per student, from the filtered feed.
  const latest = [...new Map(feed.map((e) => [e.studentId, e])).values()];
  const days = [...new Set(feed.map((e) => e.date))];
  const hasFilters = student !== "any" || teacher !== "any" || activity !== "any" || range !== "30";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.progress }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={p.title}
        meta={p.meta}
      />
      <TableToolbar summary={!isLoading ? p.entries(feed.length) : undefined}>
        <FilterSelect label={t.schedule.student} value={student} onChange={setStudent} options={[{ value: "any", label: t.common.any }, ...students.map(([value, label]) => ({ value, label }))]} />
        <FilterSelect label={t.students.filterTeacher} value={teacher} onChange={setTeacher} options={[{ value: "any", label: t.common.any }, ...teachers.map(([value, label]) => ({ value, label }))]} />
        <FilterSelect<Activity> label={p.activity} value={activity} onChange={setActivity} options={[{ value: "any", label: t.common.any }, ...(["memorization", "revision", "recitation"] as const).map((a) => ({ value: a, label: t.quran.activity[a] }))]} />
        <FilterSelect<Range> label={t.sessions.range} value={range} onChange={setRange} options={[{ value: "7", label: t.sessions.ranges.last7 }, { value: "30", label: t.sessions.ranges.last30 }, { value: "all", label: t.sessions.ranges.all }]} />
        {hasFilters && <Button variant="tertiary" onClick={() => { setStudent("any"); setTeacher("any"); setActivity("any"); setRange("30"); }}>{t.common.clear}</Button>}
      </TableToolbar>

      {isLoading ? <Card><LoadingState rows={8} /></Card> : error ? <ErrorState title={p.loadError} onRetry={reload} /> : feed.length === 0 ? (
        <Card><EmptyState icon={<BookOpen aria-hidden className="size-[22px]" />} title={all.length === 0 ? p.emptyTitle : t.students.noMatchTitle} description={all.length === 0 ? p.emptyBody : t.students.noMatchBody} /></Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-labelledby="feed" className="flex flex-col gap-4">
            <h2 id="feed" className="sr-only">{p.feed}</h2>
            {days.map((day) => (
              <div key={day} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">{new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`))}</h3>
                <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft bg-surface">
                  {feed.filter((e) => e.date === day).map((e) => (
                    <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link href={`/manage/students/${e.studentId}?tab=progress`} className="min-w-32 font-medium text-ink hover:text-brand-700">{e.studentName}</Link>
                        <SurahRef entry={e} />
                        <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-secondary">{t.quran.activity[e.activity]}</span>
                        <Rating value={e.rating} />
                        <span className="ms-auto text-xs text-muted">
                          {e.teacherName}
                          {e.sessionId && <> · <Link href={`/manage/sessions/${e.sessionId}`} className="text-brand-700 tabular">#{formatRef(e.sessionNumber, tag)}</Link></>}
                        </span>
                      </div>
                      {e.note && <p className="text-secondary">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <Card as="aside" className="flex flex-col gap-3 p-4 xl:sticky xl:top-24" aria-labelledby="positions">
            <h2 id="positions" className="text-sm font-semibold">{p.positions}</h2>
            <p className="text-xs text-muted">{p.positionsHint}</p>
            <ul className="flex flex-col divide-y divide-subtle">
              {latest.map((e) => {
                const mine = feed.filter((x) => x.studentId === e.studentId);
                const avg = mine.reduce((sum, x) => sum + x.rating, 0) / mine.length;
                return (
                  <li key={e.studentId}>
                    <button type="button" onClick={() => setStudent(e.studentId)} aria-pressed={student === e.studentId} className={cn("flex w-full flex-col gap-0.5 py-2.5 text-start text-[13px]", student === e.studentId && "text-brand-800")}>
                      <span className="flex justify-between gap-2"><span className="font-medium">{e.studentName}</span><span className="text-xs text-muted">{formatDate(e.date, tag)}</span></span>
                      <span className="flex flex-wrap items-center justify-between gap-2"><SurahRef entry={e} /><span className="text-xs text-muted tabular">{p.avg(formatNumber(Math.round(avg * 10) / 10, tag), mine.length)}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
