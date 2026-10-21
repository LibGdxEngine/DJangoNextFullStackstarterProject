"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Download, Info } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { FilterSelect } from "@/components/ds/DataTable";
import { MoneyByCurrency } from "@/components/ds/Time";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { useAccess } from "../access";
import { reportsApi, type ReportData, type ReportPeriod } from "../admin-api";

/** CSV with a UTF-8 BOM so Excel opens Arabic names correctly. */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { t, tag } = useI18n();
  const r = t.reports;
  const { can } = useAccess();
  const [period, setPeriod] = useState<ReportPeriod>("this_month");
  const { data, error, isLoading, reload } = useResource(() => reportsApi.get(period), [period]);
  const finance = can("view_finance");
  const pct = (v: number) => new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const money = (list: { currency: string; total: number }[]) => list.map((x) => formatMoney(x.total, x.currency, "en-GB")).join(" | ") || "0";

  function exportTeachers(d: ReportData) {
    downloadCsv(`teachers-${period}.csv`, ["Teacher", "Classes held", "Completed", "Attendance", "Cancelled", ...(finance ? ["Earnings (per currency)"] : [])],
      d.byTeacher.map((x) => [x.name, x.held, x.completed, `${Math.round(x.attendanceRate * 100)}%`, x.cancelled, ...(finance ? [money(x.earnings)] : [])]));
  }
  function exportStudents(d: ReportData) {
    downloadCsv(`students-${period}.csv`, ["Student", "Completed", "Missed", "Ayahs memorized", "Lessons left"],
      d.byStudent.map((x) => [x.name, x.completed, x.missed, x.ayahs, x.balance]));
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.reports }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.reports}
        meta={data ? r.range(formatDate(data.from, tag, "long"), formatDate(new Date(new Date(data.to).getTime() - 1).toISOString(), tag, "long")) : r.meta}
        actions={<FilterSelect<ReportPeriod> label={r.period} value={period} onChange={setPeriod} options={[
          { value: "this_month", label: r.periods.this_month },
          { value: "last_month", label: r.periods.last_month },
          { value: "last_30", label: r.periods.last_30 },
        ]} />}
      />
      {isLoading ? <Card><LoadingState rows={8} /></Card> : error || !data ? <ErrorState title={r.loadError} onRetry={reload} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={r.m.held} value={formatNumber(data.metrics.held, tag)} definition={r.d.held} href="/manage/sessions?range=last30" />
            <Metric label={r.m.attendance} value={pct(data.metrics.attendanceRate)} definition={r.d.attendance} />
            <Metric label={r.m.cancellation} value={pct(data.metrics.cancellationRate)} definition={r.d.cancellation(data.metrics.cancelledBy.family, data.metrics.cancelledBy.teacher, data.metrics.cancelledBy.academy)} href="/manage/sessions?status=cancelled&range=last30" />
            <Metric label={r.m.lessonsUsed} value={formatNumber(data.metrics.lessonsDeducted, tag)} definition={r.d.lessonsUsed} />
            <Metric label={r.m.revenue} value={finance ? <MoneyByCurrency items={data.metrics.revenue} amount={(x) => x.total} currency={(x) => x.currency} /> : t.common.hiddenForRole} definition={r.d.revenue} href={finance ? "/manage/payments?status=approved" : undefined} />
            <Metric label={r.m.earnings} value={finance ? <MoneyByCurrency items={data.metrics.earnings} amount={(x) => x.total} currency={(x) => x.currency} /> : t.common.hiddenForRole} definition={r.d.earnings} href={finance ? "/manage/payroll" : undefined} />
            <Metric label={r.m.active} value={formatNumber(data.metrics.activeStudents, tag)} definition={r.d.active} href="/manage/students?status=active" />
            <Metric label={r.m.renewals} value={formatNumber(data.metrics.renewals, tag)} definition={r.d.renewals} href="/manage/packages?tab=enrollments" />
          </div>

          <ReportTable
            title={r.byTeacher}
            onExport={() => exportTeachers(data)}
            headers={[t.students.colTeacher, r.m.held, r.cols.completed, r.m.attendance, r.cols.cancelled, ...(finance ? [r.m.earnings] : [])]}
            rows={data.byTeacher.map((x) => [
              <Link key="n" href={`/manage/teachers/${x.id}`} className="font-medium hover:text-brand-700">{x.name}</Link>,
              formatNumber(x.held, tag), formatNumber(x.completed, tag), pct(x.attendanceRate), formatNumber(x.cancelled, tag),
              ...(finance ? [<MoneyByCurrency key="e" items={x.earnings} amount={(e) => e.total} currency={(e) => e.currency} className="justify-end" />] : []),
            ])}
          />
          <ReportTable
            title={r.byStudent}
            onExport={() => exportStudents(data)}
            headers={[t.students.colStudent, r.cols.completed, r.cols.missed, r.cols.ayahs, t.students.colLeft]}
            rows={data.byStudent.map((x) => [
              <Link key="n" href={`/manage/students/${x.id}`} className="font-medium hover:text-brand-700">{x.name}</Link>,
              formatNumber(x.completed, tag), formatNumber(x.missed, tag), formatNumber(x.ayahs, tag), formatNumber(x.balance, tag),
            ])}
          />
          <p className="text-xs text-muted">{r.footnote}</p>
        </>
      )}
    </>
  );
}

/** Every metric shows how it is calculated, not just the number. */
function Metric({ label, value, definition, href }: { label: string; value: React.ReactNode; definition: string; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular">{value}</span>
      <span className="flex items-start gap-1.5 text-xs leading-relaxed text-muted"><Info aria-hidden className="mt-0.5 size-3 shrink-0" />{definition}</span>
    </>
  );
  return href
    ? <Link href={href} className="flex flex-col gap-1.5 rounded-2xl border border-line-soft bg-surface p-4 hover:border-brand-300">{body}</Link>
    : <div className="flex flex-col gap-1.5 rounded-2xl border border-line-soft bg-surface p-4">{body}</div>;
}

function ReportTable({ title, headers, rows, onExport }: { title: string; headers: string[]; rows: React.ReactNode[][]; onExport: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button size="sm" icon={<Download aria-hidden className="size-3.5" />} onClick={onExport}>{t.reports.export}</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-soft">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="bg-page text-xs text-secondary">
              {headers.map((h, i) => <th key={h} scope="col" className={`px-4 py-2.5 font-semibold ${i === 0 ? "text-start" : "text-end"}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} className="border-t border-subtle tabular">
                {cells.map((c, j) => <td key={j} className={`px-4 py-2.5 ${j === 0 ? "text-start" : "text-end"}`}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
