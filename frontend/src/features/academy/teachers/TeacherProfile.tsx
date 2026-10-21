"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Video } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatDay, formatNumber, formatTime, zoneCity, zoneOffset, zonedParts } from "@/lib/format";
import { Breadcrumbs } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, CardHeader, KeyValue } from "@/components/ds/Card";
import { DetailHeader, TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Money } from "@/components/ds/Time";
import { WeekGrid, type CalendarDay } from "@/components/ds/Calendar";
import { EmptyState, ErrorState, LoadingState, LockedField, PermissionDenied } from "@/components/ds/States";
import { InfoNote } from "@/components/ds/Panels";
import { useAccess } from "../access";
import { academyApi, type TeacherDetail } from "../api";

type Tab = "overview" | "availability" | "students" | "rates";

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function TeacherProfile({ id }: { id: string }) {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const { data, error, isLoading, reload } = useResource(() => academyApi.getTeacher(id), [id]);
  const [tab, setTab] = useState<Tab>("overview");
  const now = useNow();

  if (isLoading) return <Card className="p-6"><LoadingState rows={8} /></Card>;
  if (error || !data) return <ErrorState title={t.teachers.loadError} onRetry={reload} />;
  const { teacher } = data;
  const upcoming = data.sessions.filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <>
      <Breadcrumbs label={t.common.breadcrumb} items={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.teachers, href: "/manage/teachers" }, { label: teacher.name }]} />
      <Card className="flex flex-col gap-5 p-6">
        <DetailHeader
          name={teacher.name}
          badge={<StatusBadge status={teacher.isActive ? "active" : "inactive"} />}
          facts={[
            t.families.studentsCount(data.students.filter((s) => s.status === "active").length),
            t.teachers.weekClasses(upcoming.filter((s) => new Date(s.startsAt).getTime() < now + 7 * 86_400_000).length),
            `${zoneCity(teacher.timezone, tag)} (${zoneOffset(teacher.timezone)})`,
            <span key="p" dir="ltr">{teacher.phone}</span>,
          ]}
          actions={<Button variant="primary" size="sm" className="h-9" locked={!can("manage_schedule")}>{t.teachers.assignStudent}</Button>}
        />
        <Tabs
          idBase="teacher"
          label={t.teachers.sections}
          value={tab}
          onChange={setTab}
          items={[
            { key: "overview", label: t.studentProfile.tabs.overview },
            { key: "availability", label: t.teachers.availability },
            { key: "students", label: t.nav.students, count: data.students.length },
            { key: "rates", label: t.teachers.rates, locked: !can("view_finance") },
          ]}
        />
        <TabPanel idBase="teacher" tab={tab}>
          {tab === "overview" && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section className="flex flex-col gap-2" aria-labelledby="t-upcoming">
                <h2 id="t-upcoming" className="text-sm font-semibold">{t.teachers.upcoming}</h2>
                {upcoming.length === 0 ? <p className="text-[13px] text-muted">{t.studentProfile.noUpcoming}</p> : (
                  <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
                    {upcoming.slice(0, 6).map((s) => {
                      const student = data.students.find((x) => x.id === s.studentId);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] tabular">
                          <span className="w-28 font-medium">{formatDay(s.startsAt, teacher.timezone, tag)}</span>
                          <span>{formatTime(s.startsAt, teacher.timezone, tag)} <span className="text-muted">{zoneCity(teacher.timezone, tag)}</span></span>
                          {student && <span className="text-muted">{formatTime(s.startsAt, student.timezone, tag)} {zoneCity(student.timezone, tag)}</span>}
                          <Link href={`/manage/students/${s.studentId}`} className="ms-auto font-medium text-brand-700">{student?.name}</Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft p-4" aria-labelledby="t-details">
                <h2 id="t-details" className="text-sm font-semibold">{t.studentProfile.details}</h2>
                <KeyValue label={t.teachers.specialties}>{teacher.specialties.map((s) => t.programs[s]).join(", ")}</KeyValue>
                <KeyValue label={t.studentProfile.language}>{t.languages[teacher.language]}</KeyValue>
                <KeyValue label={t.studentProfile.zone}>{zoneCity(teacher.timezone, tag)} ({zoneOffset(teacher.timezone)})</KeyValue>
                <KeyValue label={t.teachers.meeting}>
                  {teacher.meetingUrl ? <a href={teacher.meetingUrl} className="inline-flex items-center gap-1 text-brand-700"><Video aria-hidden className="size-3.5" />{t.teachers.meetingLink}</a> : <span className="text-st-review">{t.teachers.noMeeting}</span>}
                </KeyValue>
                <KeyValue label={t.studentProfile.since}>{formatDate(teacher.createdAt, tag, "long")}</KeyValue>
                {can("view_finance") ? null : <LockedField label={t.teachers.currentRate} reason={t.common.hiddenForRole} />}
              </section>
            </div>
          )}
          {tab === "availability" && <AvailabilityTab data={data} />}
          {tab === "students" && (
            data.students.length === 0 ? <EmptyState icon={<Plus aria-hidden className="size-[22px]" />} title={t.teachers.noStudents} /> : (
              <ul className="grid gap-2 md:grid-cols-2">
                {data.students.map((s) => (
                  <li key={s.id}>
                    <Link href={`/manage/students/${s.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line-soft p-3.5 hover:border-brand-300">
                      <span>
                        <span className="block font-medium">{s.name}</span>
                        <span className="text-xs text-muted">{t.programs[s.program]} · {zoneCity(s.timezone, tag)}</span>
                      </span>
                      <StatusBadge status={s.renewalDue ? "renewal_due" : s.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
          {tab === "rates" && <RatesTab data={data} />}
        </TabPanel>
      </Card>
    </>
  );
}

function AvailabilityTab({ data }: { data: TeacherDetail }) {
  const { t, tag } = useI18n();
  const { teacher } = data;
  const now = useNow();
  const days = useMemo<CalendarDay[]>(() => {
    const todayKey = zonedParts(new Date(now).toISOString(), teacher.timezone).dateKey;
    const base = new Date(`${todayKey}T12:00:00Z`);
    const mondayOffset = (base.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getTime() + (i - mondayOffset) * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      return {
        dateKey: key,
        label: new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short", day: "numeric" }).format(d),
        isToday: key === todayKey,
        available: data.availability.filter((a) => a.weekday === i).map((a) => ({ start: toMinutes(a.startTime), end: toMinutes(a.endTime) })),
      };
    });
  }, [now, data.availability, teacher.timezone, tag]);
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <WeekGrid
        days={days}
        timeZone={teacher.timezone}
        startHour={8}
        endHour={22}
        events={data.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, title: data.students.find((x) => x.id === s.studentId)?.name.split(" ")[0] ?? "" }))}
      />
      <section className="flex flex-col gap-2" aria-labelledby="windows">
        <CardHeader title={<span id="windows" className="text-sm">{t.teachers.weeklyWindows}</span>} description={t.teachers.windowsIn(zoneCity(teacher.timezone, tag))} />
        <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft text-[13px]">
          {weekdayNames.map((name, i) => {
            const windows = data.availability.filter((a) => a.weekday === i);
            return (
              <li key={name} className="flex justify-between gap-3 px-3.5 py-2.5 tabular">
                <span className="font-medium">{name}</span>
                <span className={windows.length ? "" : "text-muted"}>{windows.length ? windows.map((w) => `${w.startTime}–${w.endTime}`).join(", ") : t.teachers.unavailable}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function RatesTab({ data }: { data: TeacherDetail }) {
  const { t, tag } = useI18n();
  const { can, role } = useAccess();
  if (!can("view_finance")) {
    return <PermissionDenied title={t.teachers.ratesRestricted} description={t.teachers.ratesRestrictedBody(t.roles[role])} onRequestAccess={() => undefined} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <CardHeader
        title={t.teachers.rateHistory}
        description={t.teachers.rateHint}
        action={<Button size="sm" locked={!can("manage_finance")} icon={<Plus aria-hidden className="size-4" />}>{t.teachers.newRate}</Button>}
      />
      <div className="overflow-x-auto rounded-xl border border-line-soft">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{t.teachers.rateHistory}</caption>
          <thead>
            <tr className="bg-page text-xs text-secondary">
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.teachers.effectiveFrom}</th>
              <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t.teachers.amount}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.teachers.basisLabel}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.students.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {data.rates.map((r, i) => (
              <tr key={r.id} className="border-t border-subtle tabular">
                <td className="px-4 py-3">{formatDate(r.effectiveFrom, tag, "long")}</td>
                <td className="px-4 py-3 text-end font-semibold"><Money amount={r.amount} currency={r.currency} /></td>
                <td className="px-4 py-3">{t.teachers.basis[r.basis]}</td>
                <td className="px-4 py-3">{i === 0 ? <StatusBadge status="active" size="sm" /> : <StatusBadge status="closed" size="sm" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InfoNote>{t.teachers.rateTrace(formatNumber(data.rates.length, tag))}</InfoNote>
    </div>
  );
}
