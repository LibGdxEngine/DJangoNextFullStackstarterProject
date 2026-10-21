"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BellOff, BellRing, Plus, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { ageFrom, formatDate, formatNumber, zoneCity, zoneOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ds/PageHeader";
import { ButtonLink } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { DetailHeader, TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { Money, MoneyByCurrency, ZoneTime } from "@/components/ds/Time";
import { EmptyState, ErrorState, LoadingState, PermissionDenied } from "@/components/ds/States";
import { useAccess } from "../access";
import { academyApi, type FamilyDetail as Detail } from "../api";

type Tab = "students" | "contacts" | "payments";

export function FamilyDetail({ id }: { id: string }) {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const { data, error, isLoading, reload } = useResource(() => academyApi.getFamily(id), [id]);
  const [tab, setTab] = useState<Tab>("students");

  if (isLoading) return <Card className="p-6"><LoadingState rows={8} /></Card>;
  if (error || !data) return <ErrorState title={t.families.loadError} onRetry={reload} />;

  const { family, students, payments } = data;
  const isAdult = family.contacts[0]?.relationship === "self";

  return (
    <>
      <Breadcrumbs label={t.common.breadcrumb} items={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.families, href: "/manage/families" }, { label: family.name }]} />
      <Card className="flex flex-col gap-5 p-6">
        <DetailHeader
          name={family.name}
          badge={(
            <span className="flex gap-1.5">
              <StatusBadge status={family.isActive ? "active" : "inactive"} />
              {isAdult && <Badge tone="outline">{t.students.selfAdult}</Badge>}
            </span>
          )}
          facts={[
            t.families.studentsCount(students.filter((s) => s.status !== "archived").length),
            t.families.contactsCount(family.contacts.length),
            `${zoneCity(family.timezone, tag)} (${zoneOffset(family.timezone)})`,
            `${t.families.messages}: ${t.languages[family.language]}`,
          ]}
          actions={can("manage_people") && (
            <ButtonLink href="/manage/students/new" variant="primary" size="sm" className="h-9 px-3.5" icon={<Plus aria-hidden className="size-4" />}>{t.families.addStudent}</ButtonLink>
          )}
        />
        <Tabs
          idBase="family"
          label={t.families.sections}
          value={tab}
          onChange={setTab}
          items={[
            { key: "students", label: isAdult ? t.families.learner : t.families.children, count: students.length },
            { key: "contacts", label: t.families.contacts, count: family.contacts.length },
            { key: "payments", label: t.studentProfile.tabs.payments, locked: !can("view_finance") },
          ]}
        />
        <TabPanel idBase="family" tab={tab}>
          {tab === "students" && <StudentsTab students={students} />}
          {tab === "contacts" && <ContactsTab family={family} />}
          {tab === "payments" && <PaymentsTab payments={payments} students={students} />}
        </TabPanel>
      </Card>
    </>
  );
}

function StudentsTab({ students }: { students: Detail["students"] }) {
  const { t, tag } = useI18n();
  if (students.length === 0) {
    return <EmptyState icon={<UserPlus aria-hidden className="size-[22px]" />} title={t.families.noStudents} actions={<ButtonLink href="/manage/students/new" variant="primary" size="sm">{t.families.addStudent}</ButtonLink>} />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {students.map((s) => {
        const age = ageFrom(s.birthDate);
        return (
          <Link key={s.id} href={`/manage/students/${s.id}`} className="flex flex-col gap-2 rounded-xl border border-line-soft p-4 hover:border-brand-300">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{s.name}</span>
              <StatusBadge status={s.renewalDue ? "renewal_due" : s.status} size="sm" />
            </div>
            <div className="text-xs text-muted">{s.isAdult ? t.students.adult : age !== null ? t.students.age(formatNumber(age, tag)) : "—"} · {t.programs[s.program]} · {s.teacherName ?? t.status.unassigned}</div>
            <div className="flex flex-wrap justify-between gap-2 text-[13px]">
              <span>{t.studentProfile.nextClass}: {s.nextSession ? <ZoneTime iso={s.nextSession.startsAt} timeZone={s.timezone} withWeekday /> : <span className="text-muted">—</span>}</span>
              <span className={cn("tabular", s.renewalDue && "font-semibold text-st-review")}>{t.studentProfile.balance(formatNumber(s.lessonsLeft, tag))}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ContactsTab({ family }: { family: Detail["family"] }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
      {family.contacts.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
          <span className="min-w-40 font-semibold">{c.name}</span>
          <span className="text-muted">{t.families.relationship[c.relationship]}</span>
          <span dir="ltr" className="tabular">{c.phone}</span>
          {c.email && <span className="text-muted">{c.email}</span>}
          <span className="ms-auto inline-flex items-center gap-1.5 text-xs">
            {c.receivesNotifications ? <BellRing aria-hidden className="size-3.5 text-success" /> : <BellOff aria-hidden className="size-3.5 text-muted" />}
            {c.receivesNotifications ? t.families.getsWhatsapp : t.families.noWhatsapp}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PaymentsTab({ payments, students }: { payments: Detail["payments"]; students: Detail["students"] }) {
  const { t, tag } = useI18n();
  const { can, role } = useAccess();
  if (!can("view_finance")) return <PermissionDenied title={t.studentProfile.paymentsRestricted} description={t.common.roleCannot(t.roles[role])} onRequestAccess={() => undefined} />;
  if (payments.length === 0) return <EmptyState icon={<Plus aria-hidden className="size-[22px]" />} title={t.studentProfile.noPayments} />;
  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        <span><span className="text-muted">{t.studentProfile.approvedTotal}</span> <MoneyByCurrency items={payments.filter((p) => p.status === "approved")} amount={(p) => p.amount} currency={(p) => p.currency} className="font-semibold" /></span>
        <span><span className="text-muted">{t.families.awaitingReview}</span> <MoneyByCurrency items={payments.filter((p) => p.status === "pending")} amount={(p) => p.amount} currency={(p) => p.currency} className="font-semibold" /></span>
      </div>
      <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
            <span className="w-24 text-muted tabular">{formatDate(p.submittedAt, tag)}</span>
            <span className="min-w-32 font-medium">{nameOf(p.studentId)}</span>
            <Money amount={p.amount} currency={p.currency} className="font-semibold" />
            <span className="text-muted">{p.reference}</span>
            <span className="ms-auto"><StatusBadge status={p.status} size="sm" /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
