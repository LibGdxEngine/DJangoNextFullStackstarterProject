"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, CreditCard, FileClock, MessageCircleWarning, UserX, Wallet } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { ButtonLink } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { MultiZoneTimes } from "@/components/ds/Time";
import { AcademyClock } from "@/components/shells/ShellParts";
import { setupSteps, settings } from "../fixtures";
import { sessionApi } from "../sessions-api";
import { useAccess } from "../access";

interface AttentionItem {
  key: string;
  count: number;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "attention";
}

export function ManageHome() {
  const { t, tag } = useI18n();
  const o = t.overview;
  const { can } = useAccess();
  const { data, error, isLoading, reload } = useResource(() => sessionApi.overview());

  const header = (
    <PageHeader
      title={t.nav.overview}
      meta={<AcademyClock />}
      actions={can("manage_schedule") && <ButtonLink href="/manage/schedule/new" variant="primary" icon={<CalendarPlus aria-hidden className="size-4" />}>{o.scheduleClass}</ButtonLink>}
    />
  );
  if (isLoading) return <>{header}<Card><LoadingState rows={8} /></Card></>;
  if (error || !data) return <>{header}<ErrorState title={t.common.errorTitle} onRetry={reload} /></>;

  const a = data.attention;
  const items: AttentionItem[] = [
    { key: "whatsapp", count: a.whatsapp === "action_required" ? Math.max(a.queuedReminders, 1) : 0, icon: MessageCircleWarning, title: o.whatsapp, detail: o.whatsappDetail(a.queuedReminders), href: "/manage/whatsapp", tone: "danger" as const },
    { key: "conflicts", count: a.conflicts.length, icon: AlertTriangle, title: o.conflicts(a.conflicts.length), detail: o.conflictsDetail, href: "/manage/schedule?view=agenda&conflicts=1", tone: "danger" as const },
    { key: "requests", count: a.requests.length, icon: CalendarClock, title: o.requests(a.requests.length), detail: o.requestsDetail, href: a.requests[0] ? `/manage/sessions/${a.requests[0].sessionId}` : "/manage/sessions", tone: "attention" as const },
    { key: "review", count: a.needsReview.length, icon: ClipboardList, title: o.needsReview(a.needsReview.length), detail: o.needsReviewDetail, href: "/manage/sessions?status=needs_review", tone: "attention" as const },
    { key: "reports", count: a.reportsDue.length, icon: FileClock, title: o.reportsDue(a.reportsDue.length), detail: o.reportsDueDetail([...new Set(a.reportsDue.map((s) => s.teacherName))].join(", ")), href: "/manage/sessions?status=report_due", tone: "attention" as const },
    { key: "unassigned", count: a.unassigned.length, icon: UserX, title: o.unassigned(a.unassigned.length), detail: a.unassigned.map((s) => s.name).join(", "), href: "/manage/students?teacher=unassigned&status=active", tone: "attention" as const },
    { key: "renewals", count: a.renewals.length, icon: Wallet, title: o.renewals(a.renewals.length), detail: o.renewalsDetail(settings.lowBalanceThreshold), href: "/manage/students?balance=low&status=active", tone: "attention" as const },
    { key: "payments", count: a.pendingPayments.length, icon: CreditCard, title: o.payments(a.pendingPayments.length), detail: o.paymentsDetail, href: "/manage/payments?status=pending", tone: "attention" as const },
  ].filter((i) => i.count > 0);

  const s = data.stats;
  const stats = [
    { label: o.statToday, value: formatNumber(s.today, tag), hint: o.statTodayHint(formatNumber(s.todayDone, tag)), href: "/manage/sessions?range=today" },
    { label: o.statWeek, value: formatNumber(s.week, tag), hint: o.statWeekHint, href: "/manage/sessions?range=next7" },
    { label: o.statStudents, value: formatNumber(s.activeStudents, tag), hint: o.statStudentsHint, href: "/manage/students?status=active" },
    { label: o.statAttendance, value: new Intl.NumberFormat(tag, { style: "percent" }).format(s.attendanceRate / 100), hint: o.statAttendanceHint(formatNumber(s.completed30, tag)), href: "/manage/sessions?range=last30&status=completed" },
    { label: o.statCancellations, value: formatNumber(s.cancellations30, tag), hint: o.statCancellationsHint, href: "/manage/sessions?range=last30&status=cancelled" },
  ];
  const setupDone = setupSteps.filter((x) => x.done).length;

  return (
    <>
      {header}

      <section aria-labelledby="attention" className="flex flex-col gap-3 rounded-card border border-accent-border bg-accent-50/60 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention" className="text-lg font-semibold text-accent-ink">{o.attention}</h2>
          <span className="text-xs text-accent-ink/80">{o.attentionHint}</span>
        </div>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 aria-hidden className="size-4" />{o.allClear}</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <Link href={item.href} className="group flex items-center gap-3 rounded-xl border border-line-soft bg-surface p-3.5 hover:border-accent-400">
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", item.tone === "danger" ? "bg-st-action-bg text-st-action" : "bg-st-review-bg text-st-review")}>
                      <Icon aria-hidden className="size-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-semibold">{item.title}</span>
                      <span className="truncate text-xs text-muted">{item.detail}</span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-accent-600 rtl:-scale-x-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="stats" className="flex flex-col gap-3">
        <h2 id="stats" className="text-lg font-semibold">{o.statistics}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map((stat) => (
            <Link key={stat.label} href={stat.href} className="flex flex-col gap-1 rounded-2xl border border-line-soft bg-surface p-4 hover:border-brand-300">
              <span className="text-xs text-muted">{stat.label}</span>
              <span className="text-2xl font-semibold tabular">{stat.value}</span>
              <span className="text-xs text-muted">{stat.hint}</span>
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted">{o.definitions}</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{o.stillToday}</h2>
            <Link href="/manage/schedule?view=day" className="text-[13px] font-medium text-brand-700">{o.openCalendar}</Link>
          </div>
          {data.upcomingToday.length === 0 ? <p className="text-[13px] text-muted">{o.nothingLeft}</p> : (
            <ul className="flex flex-col divide-y divide-subtle">
              {data.upcomingToday.map((session) => (
                <li key={session.id}>
                  <Link href={`/manage/sessions/${session.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[13px] hover:text-brand-700">
                    <span className="min-w-36 font-medium">{session.studentName}</span>
                    <MultiZoneTimes variant="inline" iso={session.startsAt} zones={[{ role: t.zones.academy, timeZone: settings.timezone }, { role: session.isAdult ? t.zones.student : t.zones.family, timeZone: session.studentTimezone }, { role: t.zones.teacher, timeZone: session.teacherTimezone }]} />
                    <span className="ms-auto"><StatusBadge status={session.conflict ? "conflict" : "scheduled"} size="sm" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {setupDone < setupSteps.length && (
          <Card className="flex flex-col gap-2.5 p-5">
            <h2 className="text-sm font-semibold">{t.nav.setup}</h2>
            <p className="text-[13px] text-muted">{t.home.setup(formatNumber(setupDone, tag), formatNumber(setupSteps.length, tag))}</p>
            <div className="h-1.5 rounded-full bg-subtle"><div className="h-full rounded-full bg-brand-700" style={{ width: `${(setupDone / setupSteps.length) * 100}%` }} /></div>
            <ButtonLink href="/manage/setup" size="sm" className="self-start">{t.shell.continueSetup}</ButtonLink>
          </Card>
        )}
      </div>
    </>
  );
}
