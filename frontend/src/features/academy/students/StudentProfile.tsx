"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronDown, Star } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { ageFrom, formatDate, formatDay, formatNumber, formatTime, zoneCity, zoneOffset, zonedParts, formatRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { Card, CardHeader, Eyebrow, KeyValue, StatTile } from "@/components/ds/Card";
import { DetailHeader, TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Menu } from "@/components/ds/Menu";
import { MoneyByCurrency, Money, MultiZoneTimes } from "@/components/ds/Time";
import { WeekGrid, type CalendarDay } from "@/components/ds/Calendar";
import { Ledger } from "@/components/ds/Ledger";
import { NoteCard } from "@/components/ds/Panels";
import { EmptyState, ErrorState, LoadingState, PermissionDenied } from "@/components/ds/States";
import { ChoiceCard, Field, Textarea } from "@/components/ds/Field";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { academyApi, type StudentDetail } from "../api";
import { surahName } from "../quran";
import { ArchiveStudentDialog } from "../dialogs/ArchiveStudentDialog";
import { AdjustBalanceDialog } from "../dialogs/AdjustBalanceDialog";

const TABS = ["overview", "schedule", "progress", "enrollments", "payments", "notes"] as const;
type Tab = (typeof TABS)[number];

export function StudentProfile({ id }: { id: string }) {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const { data, error, isLoading, reload } = useResource(() => academyApi.getStudent(id), [id]);
  const [dialog, setDialog] = useState<"archive" | "adjust" | null>(null);
  const now = useNow();

  function setTab(next: Tab) {
    const search = new URLSearchParams(params.toString());
    if (next === "overview") search.delete("tab");
    else search.set("tab", next);
    router.replace(`${pathname}${search.size ? `?${search}` : ""}`, { scroll: false });
  }

  if (isLoading) return <Card className="p-6"><LoadingState rows={8} /></Card>;
  if (error || !data) return <ErrorState title={t.studentProfile.loadError} description={error?.message.includes("not found") ? t.studentProfile.notFound : undefined} onRetry={reload} />;

  const { student, family, teacher, enrollments } = data;
  const active = enrollments.find((e) => e.status !== "closed") ?? null;
  const visibleNotes = can("view_internal") ? data.notes : data.notes.filter((n) => n.visibility === "family");
  const futureSessions = data.sessions.filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > now).length;

  return (
    <>
      <Breadcrumbs label={t.common.breadcrumb} items={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.students, href: "/manage/students" }, { label: student.name }]} />
      <Card className="flex flex-col gap-5 p-6">
        <DetailHeader
          name={student.name}
          badge={<StatusBadge status={student.renewalDue ? "renewal_due" : student.status} />}
          facts={[
            student.isAdult ? t.students.selfAdult : <>{family.name} · <Link href={`/manage/families/${family.id}`} className="text-brand-700 hover:text-brand-800">{t.common.open}</Link></>,
            <>{t.studentProfile.teacher}: {teacher?.name ?? <span className="font-medium text-st-review">{t.status.unassigned}</span>}</>,
            t.studentProfile.balance(formatNumber(student.lessonsLeft, tag)),
            `${t.studentProfile.zone}: ${zoneCity(student.timezone, tag)} (${zoneOffset(student.timezone)})`,
          ]}
          actions={(
            <>
              <Menu
                label={t.common.actions}
                items={[
                  { label: student.status === "paused" ? t.studentProfile.resume : t.studentProfile.pause, disabled: !can("manage_people") || student.status === "archived", onSelect: async () => { await academyApi.setStudentStatus(student.id, student.status === "paused" ? "active" : "paused"); reload(); } },
                  { label: t.dialogs.adjust.title, disabled: !can("manage_finance") || !active, hint: !can("manage_finance") ? t.common.notAllowed : undefined, onSelect: () => setDialog("adjust") },
                  { label: t.students.archive, danger: true, disabled: !can("manage_people") || student.status === "archived", onSelect: () => setDialog("archive") },
                ]}
                trigger={(props) => <Button size="sm" {...props} className="h-9">{t.common.actions} <ChevronDown aria-hidden className="size-3.5" /></Button>}
              />
              <ButtonLink href={`/manage/schedule?student=${student.id}&view=week`} variant="primary" size="sm" className="h-9 px-3.5">{t.studentProfile.schedule}</ButtonLink>
            </>
          )}
        />
        <Tabs
          idBase="student"
          label={t.studentProfile.sections}
          value={tab}
          onChange={setTab}
          items={[
            { key: "overview", label: t.studentProfile.tabs.overview },
            { key: "schedule", label: t.studentProfile.tabs.schedule },
            { key: "progress", label: t.studentProfile.tabs.progress },
            { key: "enrollments", label: t.studentProfile.tabs.enrollments },
            { key: "payments", label: t.studentProfile.tabs.payments, locked: !can("view_finance") },
            { key: "notes", label: t.studentProfile.tabs.notes, count: visibleNotes.length },
          ]}
        />
        <TabPanel idBase="student" tab={tab}>
          {tab === "overview" && <OverviewTab data={data} notes={visibleNotes} onTab={setTab} />}
          {tab === "schedule" && <ScheduleTab data={data} />}
          {tab === "progress" && <ProgressTab data={data} />}
          {tab === "enrollments" && <EnrollmentsTab data={data} onAdjust={() => setDialog("adjust")} />}
          {tab === "payments" && <PaymentsTab data={data} />}
          {tab === "notes" && <NotesTab data={data} notes={visibleNotes} onAdded={reload} />}
        </TabPanel>
      </Card>

      <ArchiveStudentDialog
        open={dialog === "archive"}
        onClose={() => setDialog(null)}
        student={student}
        futureSessions={futureSessions}
        remainingBalance={student.lessonsLeft}
        onArchived={reload}
      />
      {active && (
        <AdjustBalanceDialog
          open={dialog === "adjust"}
          onClose={() => setDialog(null)}
          enrollment={active}
          studentName={student.name}
          onAdjusted={reload}
        />
      )}
    </>
  );
}

function OverviewTab({ data, notes, onTab }: { data: StudentDetail; notes: StudentDetail["notes"]; onTab: (tab: Tab) => void }) {
  const { t, tag, locale } = useI18n();
  const { student, teacher, family } = data;
  const active = data.enrollments.find((e) => e.status !== "closed");
  const next = student.nextSession;
  const latest = data.progress[0];
  const internal = notes.find((n) => n.visibility === "internal");
  const familyNote = notes.find((n) => n.visibility === "family");
  const age = ageFrom(student.birthDate);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-xl border border-line-soft p-4" aria-labelledby="next-class">
          <div className="flex items-center justify-between">
            <h2 id="next-class" className="text-sm font-semibold">{t.studentProfile.nextClass}</h2>
            {next && <StatusBadge status="scheduled" />}
          </div>
          {next ? (
            <>
              <div className="text-[15px] font-semibold">{formatDay(next.startsAt, student.timezone, tag)} · {teacher?.name}</div>
              <MultiZoneTimes
                iso={next.startsAt}
                zones={[
                  { role: student.isAdult ? t.zones.student : t.zones.family, timeZone: student.timezone },
                  ...(teacher ? [{ role: t.zones.teacher, timeZone: teacher.timezone }] : []),
                  { role: t.zones.academy, timeZone: settings.timezone },
                ]}
              />
            </>
          ) : (
            <p className="text-[13px] text-muted">{student.teacherId ? t.studentProfile.noUpcoming : t.studentProfile.needsTeacher}</p>
          )}
        </section>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t.studentProfile.lessonsLeft} value={formatNumber(student.lessonsLeft, tag)} hint={active ? t.studentProfile.ofPackage(formatNumber(active.lessonCount, tag), active.packageName) : undefined} tone={student.renewalDue ? "attention" : "plain"} />
          <StatTile label={t.studentProfile.validUntil} value={active ? formatDate(active.expiresOn, tag) : "—"} hint={active ? <StatusBadge status={active.status} size="sm" /> : undefined} />
          <StatTile label={t.studentProfile.latestProgress} value={latest ? surahName(latest.surah, locale) : "—"} hint={latest ? `${t.quran.ayahs(formatNumber(latest.ayahFrom, tag), formatNumber(latest.ayahTo, tag))} · ${formatDate(latest.date, tag)}` : undefined} tone="brand" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {internal && <NoteCard visibility="internal" meta={`${internal.authorName} · ${formatDate(internal.createdAt, tag)}`}>{internal.text}</NoteCard>}
          {familyNote && <NoteCard visibility="family" meta={`${familyNote.authorName} · ${formatDate(familyNote.createdAt, tag)}`}>{familyNote.text}</NoteCard>}
        </div>
        {notes.length > 2 && <Button variant="tertiary" className="self-start" onClick={() => onTab("notes")}>{t.studentProfile.allNotes(notes.length)}</Button>}
      </div>
      <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft p-4" aria-labelledby="details">
        <h2 id="details" className="text-sm font-semibold">{t.studentProfile.details}</h2>
        <KeyValue label={t.studentProfile.program}>{t.programs[student.program]}</KeyValue>
        <KeyValue label={t.studentProfile.age}>{student.isAdult ? t.students.adult : age !== null ? formatNumber(age, tag) : "—"}</KeyValue>
        <KeyValue label={t.studentProfile.language}>{t.languages[student.language]}</KeyValue>
        <KeyValue label={t.studentProfile.zone}>{zoneCity(student.timezone, tag)} ({zoneOffset(student.timezone)})</KeyValue>
        <KeyValue label={student.isAdult ? t.studentProfile.contact : t.studentProfile.guardian}>
          <span dir="ltr" className="tabular">{family.contacts[0]?.phone ?? "—"}</span>
        </KeyValue>
        <KeyValue label={t.studentProfile.since}>{formatDate(student.createdAt, tag, "long")}</KeyValue>
      </section>
    </div>
  );
}

function weekDays(now: number, timeZone: string, tag: string, availability: { weekday: number; start: number; end: number }[] = []): CalendarDay[] {
  const todayKey = zonedParts(new Date(now).toISOString(), timeZone).dateKey;
  const base = new Date(`${todayKey}T12:00:00Z`);
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() + (i - mondayOffset) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return {
      dateKey: key,
      label: new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "short", day: "numeric" }).format(d),
      isToday: key === todayKey,
      available: availability.length ? availability.filter((a) => a.weekday === i).map(({ start, end }) => ({ start, end })) : undefined,
    };
  });
}

function ScheduleTab({ data }: { data: StudentDetail }) {
  const { t, tag } = useI18n();
  const { student, teacher } = data;
  const [view, setView] = useState<"week" | "list">("week");
  const now = useNow();
  const days = useMemo(() => weekDays(now, student.timezone, tag), [now, student.timezone, tag]);
  const upcoming = data.sessions.filter((s) => new Date(s.endsAt).getTime() > now).slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t.calendar.view} className="inline-flex h-10 overflow-hidden rounded-[10px] border border-line">
          {(["week", "list"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("px-3 text-[13px] font-medium", view === v ? "bg-brand-800 text-white" : "bg-surface text-ink")}>
              {v === "week" ? t.calendar.week : t.calendar.agenda}
            </button>
          ))}
        </div>
        <ButtonLink href={`/manage/schedule/new?student=${student.id}`} icon={<CalendarPlus aria-hidden className="size-4" />}>{t.studentProfile.recurring}</ButtonLink>
      </div>
      {view === "week" ? (
        <WeekGrid
          days={days}
          timeZone={student.timezone}
          startHour={7}
          endHour={23}
          events={data.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, title: teacher?.name.replace("Ust. ", "") ?? "" }))}
        />
      ) : upcoming.length === 0 ? (
        <EmptyState icon={<CalendarPlus aria-hidden className="size-[22px]" />} title={t.studentProfile.noUpcoming} />
      ) : (
        <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
          {upcoming.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] tabular">
              <span className="w-28 font-medium">{formatDay(s.startsAt, student.timezone, tag)}</span>
              <span>{formatTime(s.startsAt, student.timezone, tag)} <span className="text-muted">{zoneCity(student.timezone, tag)}</span></span>
              {teacher && teacher.timezone !== student.timezone && <span className="text-muted">{formatTime(s.startsAt, teacher.timezone, tag)} {zoneCity(teacher.timezone, tag)}</span>}
              <span className="ms-auto"><StatusBadge status={s.status} size="sm" /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressTab({ data }: { data: StudentDetail }) {
  const { t, tag, locale } = useI18n();
  if (data.progress.length === 0) {
    return <EmptyState icon={<Star aria-hidden className="size-[22px]" />} title={t.studentProfile.noProgress} description={t.studentProfile.noProgressBody} />;
  }
  return (
    <ol className="relative flex flex-col gap-3 border-s-2 border-brand-100 ps-5">
      {data.progress.map((p) => (
        <li key={p.id} className="relative flex flex-col gap-1 rounded-xl border border-line-soft p-3.5">
          <span aria-hidden className="absolute -start-[27px] top-4 size-3 rounded-full border-2 border-surface bg-brand-700" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-semibold">{surahName(p.surah, locale)} <span className="font-normal text-muted tabular">{formatNumber(p.surah, tag)}:{formatNumber(p.ayahFrom, tag)}–{formatNumber(p.ayahTo, tag)}</span></span>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-secondary">{t.quran.activity[p.activity]}</span>
            <span className="text-xs text-muted tabular" aria-label={t.quran.rating(p.rating)}>{"★".repeat(p.rating)}{"☆".repeat(5 - p.rating)}</span>
            <span className="ms-auto text-xs text-muted tabular">{formatDate(p.date, tag)} · {t.studentProfile.session(formatRef(p.sessionNumber, tag))}</span>
          </div>
          {p.note && <p className="text-[13px] text-secondary">{p.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function EnrollmentsTab({ data, onAdjust }: { data: StudentDetail; onAdjust: () => void }) {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const [selected, setSelected] = useState(data.enrollments.find((e) => e.status !== "closed")?.id ?? data.enrollments[0]?.id);
  const enrollment = data.enrollments.find((e) => e.id === selected);
  const ledger = data.ledger.filter((l) => l.enrollmentId === selected);

  if (!enrollment) return <EmptyState icon={<CalendarPlus aria-hidden className="size-[22px]" />} title={t.studentProfile.noEnrollments} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t.studentProfile.tabs.enrollments}>
        {data.enrollments.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={e.id === selected}
            onClick={() => setSelected(e.id)}
            className={cn("flex flex-col gap-1 rounded-xl border p-3.5 text-start", e.id === selected ? "border-brand-800 bg-brand-50" : "border-line-soft bg-surface hover:bg-page")}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{e.packageName}</span>
              <StatusBadge status={e.status} size="sm" />
            </span>
            <span className="text-xs text-muted tabular">{formatDate(e.startsOn, tag)} – {formatDate(e.expiresOn, tag)}</span>
            <span className="text-[13px] tabular">{t.studentProfile.leftOf(formatNumber(e.balance, tag), formatNumber(e.lessonCount, tag))}</span>
            <span className="text-xs text-muted">{can("view_finance") ? <Money amount={e.price} currency={e.currency} /> : t.common.hiddenForRole}</span>
          </button>
        ))}
        <p className="text-xs text-muted">{t.studentProfile.enrollmentNote}</p>
      </div>
      <div className="flex flex-col gap-3">
        <CardHeader
          title={t.studentProfile.ledgerTitle}
          description={t.studentProfile.ledgerHint}
          action={enrollment.status !== "closed" && (
            can("manage_finance")
              ? <Button size="sm" onClick={onAdjust}>{t.dialogs.adjust.title}</Button>
              : <Button size="sm" locked title={t.common.lockedForRole}>{t.dialogs.adjust.title}</Button>
          )}
        />
        <Ledger
          caption={t.studentProfile.ledgerTitle}
          items={ledger.map((l) => ({
            id: l.id,
            date: formatDate(l.createdAt, tag),
            change: l.delta,
            balance: l.balanceAfter,
            entry: (
              <span>
                {t.ledger.kinds[l.kind]}
                {l.sessionNumber && <> · <span className="text-brand-700">{t.studentProfile.session(formatRef(l.sessionNumber, tag))}</span></>}
                {l.kind !== "lesson" && <> · <span className="text-muted">“{l.reason}”</span></>}
                {l.actorName && l.kind === "adjustment" && <span className="text-muted"> · {t.ledger.by(l.actorName)}</span>}
              </span>
            ),
          }))}
        />
      </div>
    </div>
  );
}

function PaymentsTab({ data }: { data: StudentDetail }) {
  const { t, tag } = useI18n();
  const { can, role } = useAccess();
  if (!can("view_finance")) {
    return <PermissionDenied title={t.studentProfile.paymentsRestricted} description={t.common.roleCannot(t.roles[role])} onRequestAccess={() => undefined} />;
  }
  if (data.payments.length === 0) return <EmptyState icon={<CalendarPlus aria-hidden className="size-[22px]" />} title={t.studentProfile.noPayments} />;
  const approved = data.payments.filter((p) => p.status === "approved");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">{t.studentProfile.approvedTotal}</span>
        <MoneyByCurrency items={approved} amount={(p) => p.amount} currency={(p) => p.currency} className="font-semibold" />
      </div>
      <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
        {data.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
            <span className="w-24 text-muted tabular">{formatDate(p.submittedAt, tag)}</span>
            <Money amount={p.amount} currency={p.currency} className="font-semibold" />
            <span className="text-muted">{p.reference}</span>
            {p.receiptName && <span className="text-xs text-brand-700">{p.receiptName}</span>}
            <span className="ms-auto"><StatusBadge status={p.status} size="sm" /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesTab({ data, notes, onAdded }: { data: StudentDetail; notes: StudentDetail["notes"]; onAdded: () => void }) {
  const { t, tag } = useI18n();
  const { can, userName } = useAccess();
  const [visibility, setVisibility] = useState<"internal" | "family">("internal");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const canInternal = can("view_internal");
  const audience = data.student.isAdult ? t.notes.visibleToStudent : t.notes.visibleToParent;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-3">
        {notes.length === 0 ? (
          <EmptyState icon={<Star aria-hidden className="size-[22px]" />} title={t.notes.empty} />
        ) : notes.map((n) => (
          <NoteCard key={n.id} visibility={n.visibility} meta={`${n.authorName} · ${formatDate(n.createdAt, tag, "long")}`}>{n.text}</NoteCard>
        ))}
      </div>
      <form
        className="flex flex-col gap-3 self-start rounded-xl border border-line-soft p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setSaving(true);
          await academyApi.addNote(data.student.id, canInternal ? visibility : "family", text.trim(), userName);
          setText("");
          setSaving(false);
          onAdded();
        }}
      >
        <Eyebrow>{t.notes.add}</Eyebrow>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t.notes.visibility}</legend>
          {canInternal && <ChoiceCard name="visibility" value="internal" checked={visibility === "internal"} onChange={() => setVisibility("internal")} title={t.notes.internal} description={t.notes.internalHint} />}
          <ChoiceCard name="visibility" value="family" checked={visibility === "family" || !canInternal} onChange={() => setVisibility("family")} title={audience} description={t.notes.familyHint} />
        </fieldset>
        <Field label={t.notes.text} required>
          {(props) => <Textarea {...props} rows={3} value={text} onChange={(e) => setText(e.target.value)} className={visibility === "family" ? "border-brand-300 bg-brand-50/50" : undefined} />}
        </Field>
        <Button type="submit" variant="primary" disabled={!text.trim() || saving}>{saving ? t.common.working : t.notes.save}</Button>
      </form>
    </div>
  );
}
