"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { GraduationCap, Lock, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { formatNumber, zoneCity, zoneOffset } from "@/lib/format";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { SearchInput } from "@/components/ds/Field";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { EmptyState } from "@/components/ds/States";
import { Avatar } from "@/components/ds/DetailHeader";
import { teacherRates } from "../fixtures";
import { useAccess } from "../access";
import { academyApi } from "../api";
import type { TeacherRow } from "../types";
import { Money } from "@/components/ds/Time";

export function TeachersList() {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => academyApi.listTeachers());
  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(1);
  const canSeeRates = can("view_finance");

  const filtered = rows.filter((r) => {
    if (status === "active" && !r.isActive) return false;
    if (status === "inactive" && r.isActive) return false;
    return !query || r.name.toLowerCase().includes(query.toLowerCase());
  });

  const currentRate = (teacherId: string) => teacherRates.filter((r) => r.teacherId === teacherId).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

  const columns: Column<TeacherRow>[] = [
    {
      key: "teacher",
      header: t.teachers.colTeacher,
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} />
          <div>
            <Link href={`/manage/teachers/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
            <div className="text-xs text-muted">{r.specialties.map((s) => t.programs[s]).join(" · ")}</div>
          </div>
        </div>
      ),
    },
    { key: "zone", header: t.families.colZone, hideBelow: "md", cell: (r) => <span className="tabular">{zoneCity(r.timezone, tag)} <span className="text-xs text-muted">{zoneOffset(r.timezone)}</span></span> },
    { key: "students", header: t.teachers.colStudents, align: "end", cell: (r) => <span className="tabular">{formatNumber(r.studentCount, tag)}</span> },
    { key: "week", header: t.teachers.colWeek, align: "end", hideBelow: "md", cell: (r) => <span className="tabular">{formatNumber(r.weekSessions, tag)}</span> },
    {
      key: "rate",
      header: t.teachers.colRate,
      hideBelow: "lg",
      cell: (r) => {
        if (!canSeeRates) return <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock aria-hidden className="size-3" />{t.common.hiddenForRole}</span>;
        const rate = currentRate(r.id);
        return rate ? <span><Money amount={rate.amount} currency={rate.currency} /> <span className="text-xs text-muted">/ {t.teachers.basis[rate.basis]}</span></span> : "—";
      },
    },
    { key: "status", header: t.students.colStatus, cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.teachers }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.teachers}
        meta={isLoading ? " " : t.teachers.meta(formatNumber(rows.filter((r) => r.isActive).length, tag), formatNumber(rows.reduce((n, r) => n + r.weekSessions, 0), tag))}
        actions={<Button variant="primary" locked={!can("manage_people")} icon={<Plus aria-hidden className="size-4" />}>{t.teachers.add}</Button>}
      />
      <TableToolbar summary={!isLoading && rows.length > 0 ? t.common.resultCount(formatNumber(filtered.length, tag)) : undefined}>
        <SearchInput label={t.teachers.searchLabel} placeholder={t.teachers.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} className="w-full sm:w-80" />
        <FilterSelect label={t.students.filterStatus} value={status} onChange={setStatus} options={[
          { value: "all", label: t.common.all },
          { value: "active", label: t.status.active },
          { value: "inactive", label: t.status.inactive },
        ]} />
      </TableToolbar>
      <DataTable
        caption={t.nav.teachers}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        errorTitle={t.teachers.loadError}
        empty={(
          <EmptyState
            icon={<GraduationCap aria-hidden className="size-[22px]" />}
            title={rows.length === 0 ? t.teachers.emptyTitle : t.students.noMatchTitle}
            description={rows.length === 0 ? t.teachers.emptyBody : t.students.noMatchBody}
            actions={rows.length === 0 ? <Button variant="primary" size="sm">{t.teachers.add}</Button> : <Button size="sm" onClick={() => { setQuery(""); setStatus("all"); }}>{t.common.clearFilters}</Button>}
          />
        )}
      />
    </>
  );
}
