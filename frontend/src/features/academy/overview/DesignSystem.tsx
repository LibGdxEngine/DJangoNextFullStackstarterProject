"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Upload, UserPlus } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, Eyebrow, KeyValue } from "@/components/ds/Card";
import { StatusBadge, type StatusKey } from "@/components/ds/StatusBadge";
import { Field, Input, PhoneInput, Select, Textarea } from "@/components/ds/Field";
import { Stepper } from "@/components/ds/Stepper";
import { DetailHeader, Tabs } from "@/components/ds/DetailHeader";
import { NoteCard, SidePanel } from "@/components/ds/Panels";
import { ClassCard, WeekGrid } from "@/components/ds/Calendar";
import { Ledger } from "@/components/ds/Ledger";
import { EmptyState, ErrorState, LoadingState, LockedField, PermissionDenied } from "@/components/ds/States";
import { MultiZoneTimes, MoneyByCurrency } from "@/components/ds/Time";
import { DialogVariants } from "../dialogs/DialogVariants";

const swatches: { group: string; items: [string, string][] }[] = [
  { group: "brand", items: [["brand-950", "#2A1408"], ["brand-900", "#3F1D0C"], ["brand-800", "#5B2A12"], ["brand-700", "#7A3F1D"], ["brand-300", "#D9B48C"], ["brand-100", "#F3E4CF"], ["brand-50", "#FBF5EC"]] },
  { group: "neutral", items: [["page", "#FBF7F1"], ["subtle", "#F3ECE1"], ["line", "#E6D9C6"], ["muted", "#7D6A5B"], ["secondary", "#4E3D31"], ["ink", "#2B1B12"]] },
  { group: "accent", items: [["accent-600", "#A0582A"], ["accent-400", "#C4844A"], ["accent-50", "#FBEFE2"], ["danger", "#B91C1C"], ["info", "#1D4ED8"], ["success", "#166534"]] },
];

const statuses: StatusKey[] = ["scheduled", "completed", "needs_review", "cancelled", "pending", "approved", "action_required", "not_connected", "connected", "renewal_due", "paused", "archived"];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`flex flex-col gap-4 p-6 ${className ?? ""}`}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-secondary">{title}</h2>
      {children}
    </Card>
  );
}

function demoDays(now: number, tag: string) {
  const base = new Date(now);
  return [0, 1].map((i) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i));
    return { dateKey: d.toISOString().slice(0, 10), label: new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(d), isToday: i === 0, available: i === 0 ? [{ start: 15 * 60, end: 19 * 60 }] : undefined };
  });
}

export function DesignSystem() {
  const { t, tag } = useI18n();
  const g = t.ds;
  const [tab, setTab] = useState<"overview" | "schedule" | "notes">("overview");
  const [cc, setCc] = useState("+20");
  const [phone, setPhone] = useState("10 2345");
  const now = useNow();
  const days = demoDays(now, tag);
  const at = (dayKey: string, h: number, min = 0) => new Date(`${dayKey}T${String(h - 3).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`).toISOString();
  const soon = new Date(now + 25 * 60_000).toISOString();

  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.home.designSystem }]} breadcrumbLabel={t.common.breadcrumb} title={t.home.designSystem} meta={g.meta} />

      <div className="grid gap-5 xl:grid-cols-3">
        <Section title={g.color}>
          {swatches.map((s) => (
            <div key={s.group} className="flex flex-col gap-1.5">
              <Eyebrow>{g.groups[s.group as keyof typeof g.groups]}</Eyebrow>
              <div className="grid grid-cols-3 gap-1.5">
                {s.items.map(([name, hex]) => (
                  <div key={name} className="overflow-hidden rounded-lg border border-line-soft text-[11px]">
                    <div className="h-8" style={{ background: hex }} />
                    <div className="px-1.5 py-1"><div className="font-medium">{name}</div><div className="text-muted tabular">{hex}</div></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">{statuses.map((s) => <StatusBadge key={s} status={s} />)}</div>
        </Section>

        <Section title={g.type}>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3 border-b border-subtle pb-2"><span className="text-[32px] font-semibold leading-tight">Display 32</span><span lang="ar" dir="rtl" className="font-arabic text-[32px] font-semibold">لوحة الأكاديمية</span></div>
            <div className="flex items-baseline justify-between gap-3 border-b border-subtle pb-2"><span className="text-2xl font-semibold">Page title 24</span><span lang="ar" dir="rtl" className="font-arabic text-2xl font-semibold">الطلاب</span></div>
            <div className="flex items-baseline justify-between gap-3 border-b border-subtle pb-2"><span className="text-lg font-semibold">Section 18</span><span lang="ar" dir="rtl" className="font-arabic text-lg font-semibold">يحتاج إلى متابعة</span></div>
            <div className="flex items-baseline justify-between gap-3 border-b border-subtle pb-2"><span className="text-sm">Body 14 — tables, forms</span><span lang="ar" dir="rtl" className="font-arabic text-[15px]">النص الأساسي للجداول</span></div>
            <div className="flex items-baseline justify-between gap-3"><span className="text-[13px] font-medium tabular">09:30 · 1,250.00</span><span lang="ar" dir="rtl" className="font-arabic text-[13px] font-medium tabular">٠٩:٣٠ · ١٬٢٥٠٫٠٠</span></div>
          </div>
          <MultiZoneTimes iso={soon} zones={[{ role: t.zones.family, timeZone: "Africa/Cairo" }, { role: t.zones.teacher, timeZone: "America/New_York" }]} />
          <div className="text-[13px]"><span className="text-muted">{g.currency}</span> <MoneyByCurrency items={[{ a: 1200, c: "EGP" }, { a: 40, c: "USD" }]} amount={(x) => x.a} currency={(x) => x.c} className="font-semibold" /></div>
        </Section>

        <Section title={g.buttons}>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary">{g.primary}</Button>
            <Button>{g.secondary}</Button>
            <Button variant="tertiary">{g.tertiary}</Button>
            <Button variant="danger">{g.danger}</Button>
            <Button locked>{g.locked}</Button>
          </div>
          <p className="text-xs leading-relaxed text-muted">{g.focusNote}</p>
          <LockedField label={g.hourlyRate} reason={t.common.hiddenForRole} />
        </Section>
      </div>

      <Section title={g.headerTable}>
        <PageHeader
          breadcrumbs={[{ label: t.common.academy }, { label: t.nav.students }]}
          title={t.nav.students}
          meta={t.students.meta("124", "9", "3")}
          actions={<><Button icon={<Upload aria-hidden className="size-4" />}>{t.students.importExcel}</Button><Button variant="primary" icon={<Plus aria-hidden className="size-4" />}>{t.students.add}</Button></>}
        />
        <p className="text-[13px] text-muted">{g.tableNote} <Link className="font-medium text-brand-700" href="/manage/students">{t.nav.students} →</Link></p>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title={g.detail}>
          <DetailHeader name="Yusuf Ahmed" badge={<StatusBadge status="active" />} facts={["Ahmed family", `${t.studentProfile.teacher}: Ust. Kareem`, t.studentProfile.balance("7"), "Cairo (UTC+3)"]} actions={<Button variant="primary" size="sm">{t.studentProfile.schedule}</Button>} />
          <Tabs idBase="ds" label={g.detail} value={tab} onChange={setTab} items={[{ key: "overview", label: t.studentProfile.tabs.overview }, { key: "schedule", label: t.studentProfile.tabs.schedule }, { key: "notes", label: t.studentProfile.tabs.notes, count: 3 }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <NoteCard visibility="internal">{g.internalSample}</NoteCard>
            <NoteCard visibility="family">{g.familySample}</NoteCard>
          </div>
        </Section>

        <Section title={g.form}>
          <Stepper steps={[t.addStudent.steps.family, t.addStudent.steps.details, t.addStudent.steps.program, t.addStudent.steps.review]} current={1} label={g.form} stepOf={t.common.stepOf} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.addStudent.fullName} required>{(p) => <Input {...p} defaultValue="Yusuf Ahmed" />}</Field>
            <Field label={t.addStudent.birthDate} hint={g.dobHint}>{(p) => <Input {...p} type="date" defaultValue="2017-03-14" />}</Field>
            <Field label={t.addStudent.guardianPhone} required error={t.addStudent.errors.phone(10)}>
              {(p) => <PhoneInput countryCode={cc} onCountryCodeChange={setCc} value={phone} onChange={setPhone} countryLabel={t.addStudent.countryCode} fieldProps={p} />}
            </Field>
            <Field label={t.addStudent.timezone} required success={t.addStudent.inherited("Ahmed family")}>{(p) => <Select {...p}><option>Africa/Cairo (UTC+3)</option></Select>}</Field>
            <Field label={t.addStudent.internalNote} optionalLabel={t.notes.staffOnly} className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} defaultValue={g.noteSample} />}</Field>
          </div>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Section title={g.calendar}>
          <WeekGrid
            days={days}
            timeZone="Africa/Cairo"
            startHour={15}
            endHour={18}
            events={[
              { id: "a", startsAt: at(days[1].dateKey, 15), endsAt: at(days[1].dateKey, 15, 45), title: "Maryam S.", status: "scheduled" },
              { id: "b", startsAt: at(days[0].dateKey, 16), endsAt: at(days[0].dateKey, 16, 45), title: "Yusuf A.", status: "completed" },
              { id: "c", startsAt: at(days[1].dateKey, 16), endsAt: at(days[1].dateKey, 16, 45), title: "Hamza I.", status: "scheduled" },
              { id: "d", startsAt: at(days[1].dateKey, 16, 15), endsAt: at(days[1].dateKey, 17), title: "Ziad M.", status: "scheduled" },
            ]}
          />
          <ClassCard
            statusLabel={g.inMinutes}
            meta={g.classMeta}
            title="Yusuf Ahmed"
            withWhom={g.withKareem}
            iso={soon}
            zones={[{ role: t.zones.family, timeZone: "Africa/Cairo" }, { role: t.zones.teacher, timeZone: "Europe/Istanbul" }, { role: t.zones.academy, timeZone: "Africa/Cairo" }]}
            joinLabel={t.teacherToday.join}
            secondary={<Button variant="on-dark-outline">{g.details}</Button>}
          />
        </Section>

        <Section title={g.panelLedger}>
          <SidePanel
            title={g.panelTitle}
            onClose={() => undefined}
            footer={<><Button size="sm">{t.dialogs.reschedule.title}</Button><Button size="sm">{t.dialogs.substitute.title}</Button><Button size="sm" variant="danger">{t.common.cancel}</Button></>}
          >
            <KeyValue label={t.students.colStatus}><StatusBadge status="scheduled" size="sm" /></KeyValue>
            <KeyValue label={t.students.colStudent}>Yusuf Ahmed</KeyValue>
            <MultiZoneTimes iso={soon} zones={[{ role: t.zones.family, timeZone: "Africa/Cairo" }, { role: t.zones.teacher, timeZone: "Europe/Istanbul" }, { role: t.zones.academy, timeZone: "Africa/Cairo" }]} />
          </SidePanel>
          <Ledger caption={t.studentProfile.ledgerTitle} items={[
            { id: "1", date: "14 Oct", entry: `${t.ledger.kinds.lesson} · #4821`, change: -1, balance: 7 },
            { id: "2", date: "12 Oct", entry: `${t.ledger.kinds.adjustment} · “Teacher no-show”`, change: 1, balance: 8 },
            { id: "3", date: "1 Oct", entry: `${t.ledger.kinds.activation} · Recitation 12`, change: 12, balance: 12 },
          ]} />
        </Section>

        <Section title={g.dialogs}>
          <p className="text-[13px] leading-relaxed text-muted">{g.dialogNote}</p>
          <DialogVariants />
        </Section>
      </div>

      <Section title={g.states}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-line-soft"><Eyebrow className="px-4 pt-4">{g.loading}</Eyebrow><LoadingState rows={4} /></div>
          <div className="rounded-xl border border-line-soft"><EmptyState icon={<UserPlus aria-hidden className="size-[22px]" />} title={t.students.emptyTitle} description={t.students.emptyBody} actions={<><Button variant="primary" size="sm">{t.students.add}</Button><Button size="sm">{t.students.importExcel}</Button></>} /></div>
          <ErrorState title={t.students.loadError} onRetry={() => undefined} />
          <div className="rounded-xl border border-line-soft"><PermissionDenied title={t.teachers.ratesRestricted} description={t.teachers.ratesRestrictedBody(t.roles.coordinator)} onRequestAccess={() => undefined} /></div>
        </div>
        <p className="text-xs text-muted">{g.demoStates}</p>
      </Section>
    </>
  );
}
