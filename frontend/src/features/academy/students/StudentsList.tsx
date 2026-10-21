"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus, Upload, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { ageFrom, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { SearchInput, Select } from "@/components/ds/Field";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ZoneTime } from "@/components/ds/Time";
import { EmptyState } from "@/components/ds/States";
import { Menu } from "@/components/ds/Menu";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { useAccess } from "../access";
import { academyApi } from "../api";
import type { StudentRow } from "../types";
import { ArchiveStudentDialog } from "../dialogs/ArchiveStudentDialog";

type StatusFilter = "all" | "active" | "paused" | "archived";
type BalanceFilter = "any" | "low";

export function StudentsList() {
  const { t, tag } = useI18n();
  const router = useRouter();
  const { can } = useAccess();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => academyApi.listStudents());
  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);

  // Filters can arrive from the overview ("every number opens a filtered list").
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<StatusFilter>(() => {
    const value = params.get("status");
    return value === "all" || value === "paused" || value === "archived" || value === "active" ? value : "active";
  });
  const [teacher, setTeacher] = useState(params.get("teacher") ?? "any");
  const [balance, setBalance] = useState<BalanceFilter>(params.get("balance") === "low" ? "low" : "any");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"reminder" | "assign" | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [archiving, setArchiving] = useState<StudentRow | null>(null);

  const teacherOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.teacherId && r.teacherName) seen.set(r.teacherId, r.teacherName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (teacher === "unassigned" && r.teacherId) return false;
      if (teacher !== "any" && teacher !== "unassigned" && r.teacherId !== teacher) return false;
      if (balance === "low" && !r.renewalDue) return false;
      if (q && ![r.name, r.familyName, r.teacherName ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, query, status, teacher, balance]);

  const counts = useMemo(() => ({
    active: rows.filter((r) => r.status === "active").length,
    paused: rows.filter((r) => r.status === "paused").length,
    archived: rows.filter((r) => r.status === "archived").length,
  }), [rows]);

  const hasFilters = query !== "" || status !== "active" || teacher !== "any" || balance !== "any";
  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setTeacher("any");
    setBalance("any");
    setPage(1);
  };
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const canManage = can("manage_people");

  const columns: Column<StudentRow>[] = [
    {
      key: "student",
      header: t.students.colStudent,
      cell: (r) => {
        const age = ageFrom(r.birthDate);
        return (
          <div>
            <Link href={`/manage/students/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
            <div className="text-xs text-muted">{r.isAdult ? t.students.adult : age !== null ? t.students.age(formatNumber(age, tag)) : "—"} · {t.programs[r.program]}</div>
          </div>
        );
      },
    },
    { key: "family", header: t.students.colFamily, hideBelow: "md", cell: (r) => (r.isAdult ? <span className="text-muted">{t.students.selfAdult}</span> : <Link href={`/manage/families/${r.familyId}`} className="hover:text-brand-700">{r.familyName}</Link>) },
    { key: "teacher", header: t.students.colTeacher, cell: (r) => (r.teacherName ? r.teacherName : <span className="font-medium text-st-review">{t.status.unassigned}</span>) },
    { key: "next", header: t.students.colNext, hideBelow: "lg", cell: (r) => (r.nextSession ? <ZoneTime iso={r.nextSession.startsAt} timeZone={r.timezone} withWeekday /> : <span className="text-muted">—</span>) },
    { key: "left", header: t.students.colLeft, align: "end", cell: (r) => <span className={cn("tabular", r.renewalDue && "font-semibold text-st-review")}>{formatNumber(r.lessonsLeft, tag)}</span> },
    { key: "status", header: t.students.colStatus, cell: (r) => <StatusBadge status={r.renewalDue ? "renewal_due" : r.status} /> },
    {
      key: "actions",
      header: <span className="sr-only">{t.common.actions}</span>,
      align: "end",
      cell: (r) => (
        <Menu
          label={t.common.actionsFor(r.name)}
          items={[
            { label: t.students.viewProfile, onSelect: () => router.push(`/manage/students/${r.id}`) },
            { label: t.students.archive, danger: true, disabled: !canManage || r.status === "archived", hint: !canManage ? t.common.notAllowed : undefined, onSelect: () => setArchiving(r) },
          ]}
          trigger={(props) => (
            <button type="button" {...props} aria-label={t.common.actionsFor(r.name)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-page">
              <MoreHorizontal aria-hidden className="size-[18px]" />
            </button>
          )}
        />
      ),
    },
  ];

  const addActions = canManage ? (
    <>
      <ButtonLink href="/manage/import" icon={<Upload aria-hidden className="size-4" />}>{t.students.importExcel}</ButtonLink>
      <ButtonLink href="/manage/students/new" variant="primary" icon={<Plus aria-hidden className="size-4" />}>{t.students.add}</ButtonLink>
    </>
  ) : (
    <Button locked aria-describedby="students-locked">{t.students.add}</Button>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.students }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.students}
        meta={isLoading ? " " : t.students.meta(formatNumber(counts.active, tag), formatNumber(counts.paused, tag), formatNumber(counts.archived, tag))}
        actions={addActions}
      />
      {!canManage && <p id="students-locked" className="-mt-3 text-xs text-muted">{t.common.lockedForRole}</p>}

      <TableToolbar summary={!isLoading && !error && rows.length > 0 ? t.common.resultCount(formatNumber(filtered.length, tag)) : undefined}>
        <SearchInput label={t.students.searchLabel} placeholder={t.students.searchPlaceholder} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="w-full sm:w-80" />
        <FilterSelect label={t.students.filterStatus} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: "all", label: t.common.all },
          { value: "active", label: t.status.active },
          { value: "paused", label: t.status.paused },
          { value: "archived", label: t.status.archived },
        ]} />
        <FilterSelect label={t.students.filterTeacher} value={teacher} onChange={(v) => { setTeacher(v); setPage(1); }} options={[
          { value: "any", label: t.common.any },
          { value: "unassigned", label: t.status.unassigned },
          ...teacherOptions,
        ]} />
        <FilterSelect<BalanceFilter> label={t.students.filterBalance} value={balance} onChange={(v) => { setBalance(v); setPage(1); }} options={[
          { value: "any", label: t.common.any },
          { value: "low", label: t.students.balanceLow },
        ]} />
        {hasFilters && <Button variant="tertiary" onClick={clearFilters}>{t.common.clear}</Button>}
      </TableToolbar>

      <DataTable
        caption={t.nav.students}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        selectable={canManage}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={() => (
          <>
            <Button size="sm" onClick={() => setBulk("reminder")}>{t.students.sendReminder}</Button>
            <Button size="sm" onClick={() => setBulk("assign")}>{t.students.assignTeacher}</Button>
          </>
        )}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        errorTitle={t.students.loadError}
        empty={rows.length === 0 ? (
          <EmptyState
            icon={<UserPlus aria-hidden className="size-[22px]" />}
            title={t.students.emptyTitle}
            description={t.students.emptyBody}
            actions={canManage && (
              <>
                <ButtonLink href="/manage/students/new" variant="primary" size="sm">{t.students.add}</ButtonLink>
                <ButtonLink href="/manage/import" size="sm">{t.students.importExcel}</ButtonLink>
              </>
            )}
          />
        ) : (
          <EmptyState
            icon={<UserPlus aria-hidden className="size-[22px]" />}
            title={t.students.noMatchTitle}
            description={t.students.noMatchBody}
            actions={<Button size="sm" onClick={clearFilters}>{t.common.clearFilters}</Button>}
          />
        )}
      />

      <ConfirmDialog
        open={bulk === "reminder"}
        onClose={() => setBulk(null)}
        title={t.students.reminderTitle(selectedRows.length)}
        confirmLabel={t.students.sendReminder}
        onConfirm={() => setSelected(new Set())}
        effects={[
          { label: t.students.recipients, value: t.students.familiesCount(new Set(selectedRows.map((r) => r.familyId)).size) },
          { label: t.students.channel, value: t.students.whatsappQueued },
        ]}
      >
        <SelectedList rows={selectedRows} />
      </ConfirmDialog>

      <ConfirmDialog
        open={bulk === "assign"}
        onClose={() => { setBulk(null); setAssignTo(""); }}
        title={t.students.assignTitle(selectedRows.length)}
        confirmLabel={t.students.assignTeacher}
        canConfirm={assignTo !== ""}
        onConfirm={async () => {
          await academyApi.assignTeacher([...selected], assignTo);
          setSelected(new Set());
          setAssignTo("");
          reload();
        }}
        effects={assignTo ? [
          { label: t.students.willChange, value: t.students.studentsCount(selectedRows.filter((r) => r.teacherId !== assignTo).length) },
          { label: t.students.futureClasses, value: t.students.futureUnchanged },
        ] : undefined}
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-secondary">{t.students.colTeacher}</span>
          <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">{t.common.choose}</option>
            {teacherOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
        <SelectedList rows={selectedRows} />
      </ConfirmDialog>

      {archiving && (
        <ArchiveStudentDialog
          open
          onClose={() => setArchiving(null)}
          student={archiving}
          futureSessions={archiving.nextSession ? 4 : 0}
          remainingBalance={archiving.lessonsLeft}
          onArchived={reload}
        />
      )}
    </>
  );
}

/** Bulk confirmations list exactly which records will change. */
function SelectedList({ rows }: { rows: StudentRow[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-medium text-secondary">{t.students.affected}</div>
      <ul className="max-h-40 overflow-y-auto rounded-[10px] border border-line-soft">
        {rows.map((r) => (
          <li key={r.id} className="flex justify-between gap-3 border-b border-subtle px-3 py-2 last:border-b-0">
            <span className="font-medium">{r.name}</span>
            <span className="text-muted">{r.teacherName ?? t.status.unassigned}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
