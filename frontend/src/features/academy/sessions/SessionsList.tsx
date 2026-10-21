"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, Repeat } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDay, formatNumber, formatRef, formatTime, zoneCity, zonedParts } from "@/lib/format";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { SearchInput } from "@/components/ds/Field";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { EmptyState } from "@/components/ds/States";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { sessionApi } from "../sessions-api";
import type { SessionRow } from "../types";

type StatusFilter = "all" | "scheduled" | "needs_review" | "report_due" | "completed" | "cancelled";
type RangeFilter = "today" | "next7" | "last7" | "last30" | "all";

const STATUSES: StatusFilter[] = ["all", "scheduled", "needs_review", "report_due", "completed", "cancelled"];
const RANGES: RangeFilter[] = ["today", "next7", "last7", "last30", "all"];

export function SessionsList() {
  const { t, tag } = useI18n();
  const s = t.sessions;
  const { can, userName } = useAccess();
  const params = useSearchParams();
  const demo = useDemoState();
  const now = useNow();
  const { data, error, isLoading, reload } = useResource(() => sessionApi.list());
  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);

  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const [status, setStatus] = useState<StatusFilter>(pick(params.get("status"), STATUSES, "all"));
  const [range, setRange] = useState<RangeFilter>(pick(params.get("range"), RANGES, params.get("status") ? "all" : "next7"));
  const [teacher, setTeacher] = useState(params.get("teacher") ?? "any");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"cancel" | "remind" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const todayKey = zonedParts(new Date(now).toISOString(), settings.timezone).dateKey;
  const teachers = useMemo(() => [...new Map(rows.map((r) => [r.teacherId, r.teacherName])).entries()], [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const day = 86_400_000;
    const list = rows.filter((r) => {
      const start = new Date(r.startsAt).getTime();
      if (range === "today" && zonedParts(r.startsAt, settings.timezone).dateKey !== todayKey) return false;
      if (range === "next7" && (start < now - 3_600_000 || start > now + 7 * day)) return false;
      if (range === "last7" && (start > now || start < now - 7 * day)) return false;
      if (range === "last30" && (start > now || start < now - 30 * day)) return false;
      if (status === "report_due" && !r.reportDue) return false;
      if (status !== "all" && status !== "report_due" && r.status !== status) return false;
      if (teacher !== "any" && r.teacherId !== teacher) return false;
      if (q && ![r.studentName, r.teacherName, String(r.number)].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    });
    const past = range === "last7" || range === "last30" || status === "completed" || status === "report_due";
    return list.sort((a, b) => (past ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
  }, [rows, query, range, status, teacher, todayKey, now]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const eligible = (r: SessionRow) => r.status === "scheduled" && new Date(r.startsAt).getTime() > now;
  const willChange = selectedRows.filter(eligible);
  const skipped = selectedRows.filter((r) => !eligible(r));
  const canEdit = can("manage_schedule");

  const columns: Column<SessionRow>[] = [
    {
      key: "session",
      header: s.colSession,
      cell: (r) => (
        <Link href={`/manage/sessions/${r.id}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-brand-700 tabular">
          #{formatRef(r.number, tag)}
          {r.seriesId && <Repeat aria-label={s.recurring} className="size-3 text-muted" />}
        </Link>
      ),
    },
    {
      key: "when",
      header: s.colWhen,
      cell: (r) => (
        <div className="tabular">
          <div className="font-medium">{formatDay(r.startsAt, settings.timezone, tag)} · {formatTime(r.startsAt, settings.timezone, tag)} <span className="text-xs font-normal text-muted">{zoneCity(settings.timezone, tag)}</span></div>
          {r.studentTimezone !== settings.timezone && <div className="text-xs text-muted">{formatTime(r.startsAt, r.studentTimezone, tag)} {zoneCity(r.studentTimezone, tag)}</div>}
        </div>
      ),
    },
    { key: "student", header: t.students.colStudent, cell: (r) => <Link href={`/manage/students/${r.studentId}`} className="hover:text-brand-700">{r.studentName}</Link> },
    {
      key: "teacher",
      header: t.students.colTeacher,
      hideBelow: "md",
      cell: (r) => (
        <div>
          <div>{r.teacherName}</div>
          {r.substituteFor && <div className="text-xs text-muted">{s.substitute}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: t.students.colStatus,
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge status={r.reportDue ? "report_due" : r.status} size="sm" />
          {r.conflict && <StatusBadge status="conflict" size="sm" />}
        </span>
      ),
    },
    { key: "attendance", header: s.colAttendance, hideBelow: "lg", cell: (r) => (r.status === "scheduled" ? <span className="text-muted">—</span> : <StatusBadge status={r.attendance} size="sm" />) },
  ];

  const bulkLabel = bulk === "cancel" ? s.bulkCancel : s.bulkRemind;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.sessions }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.sessions}
        meta={isLoading ? " " : s.meta(formatNumber(rows.filter((r) => r.status === "needs_review").length, tag), formatNumber(rows.filter((r) => r.reportDue).length, tag))}
        actions={canEdit ? <ButtonLink href="/manage/schedule/new" variant="primary" icon={<CalendarPlus aria-hidden className="size-4" />}>{t.schedule.newRecurring}</ButtonLink> : undefined}
      />
      {result && <div role="status" className="rounded-[10px] border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800">{result}</div>}
      <TableToolbar summary={!isLoading && rows.length > 0 ? t.common.resultCount(formatNumber(filtered.length, tag)) : undefined}>
        <SearchInput label={s.searchLabel} placeholder={s.searchPlaceholder} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="w-full sm:w-72" />
        <FilterSelect label={s.range} value={range} onChange={(v) => { setRange(v); setPage(1); }} options={RANGES.map((v) => ({ value: v, label: s.ranges[v] }))} />
        <FilterSelect label={t.students.filterStatus} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUSES.map((v) => ({ value: v, label: v === "all" ? t.common.all : t.status[v] }))} />
        <FilterSelect label={t.students.filterTeacher} value={teacher} onChange={(v) => { setTeacher(v); setPage(1); }} options={[{ value: "any", label: t.common.any }, ...teachers.map(([value, label]) => ({ value, label }))]} />
        {(status !== "all" || range !== "next7" || teacher !== "any" || query) && <Button variant="tertiary" onClick={() => { setStatus("all"); setRange("all"); setTeacher("any"); setQuery(""); }}>{t.common.clear}</Button>}
      </TableToolbar>
      <DataTable
        caption={t.nav.sessions}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.id}
        rowLabel={(r) => `${r.studentName} #${r.number}`}
        selectable={canEdit}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={() => (
          <>
            <Button size="sm" onClick={() => setBulk("remind")}>{s.bulkRemind}</Button>
            <Button size="sm" variant="danger" onClick={() => setBulk("cancel")}>{s.bulkCancel}</Button>
          </>
        )}
        page={page}
        pageSize={15}
        onPageChange={setPage}
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        errorTitle={s.loadError}
        empty={(
          <EmptyState
            icon={<CalendarPlus aria-hidden className="size-[22px]" />}
            title={rows.length === 0 ? s.emptyTitle : t.students.noMatchTitle}
            description={rows.length === 0 ? s.emptyBody : t.students.noMatchBody}
            actions={rows.length === 0
              ? canEdit && <ButtonLink href="/manage/schedule/new" variant="primary" size="sm">{t.schedule.newRecurring}</ButtonLink>
              : <Button size="sm" onClick={() => { setStatus("all"); setRange("all"); setTeacher("any"); setQuery(""); }}>{t.common.clearFilters}</Button>}
          />
        )}
      />

      <ConfirmDialog
        open={bulk !== null}
        onClose={() => setBulk(null)}
        tone={bulk === "cancel" ? "danger" : "primary"}
        title={s.bulkTitle(bulkLabel, willChange.length)}
        confirmLabel={bulkLabel}
        canConfirm={willChange.length > 0}
        onConfirm={async () => {
          const res = await sessionApi.bulk(willChange.map((r) => r.id), bulk!, userName);
          setResult(s.bulkResult(bulkLabel, res.changed.length, skipped.length));
          setSelected(new Set());
          reload();
        }}
        effects={[
          { label: s.willChange, value: s.sessionsCount(willChange.length), tone: bulk === "cancel" ? "negative" : "plain" },
          { label: s.skipped, value: s.sessionsCount(skipped.length) },
          ...(bulk === "cancel" ? [
            { label: t.dialogs.cancel.balance, value: s.noDeduction },
            { label: t.dialogs.cancel.teacherPay, value: s.noPay },
          ] : []),
          { label: t.dialogs.cancel.notification, value: settings.whatsappStatus === "connected" ? t.sessionDialogs.notifyBoth : t.sessionDialogs.notifyQueued },
        ]}
      >
        <SessionList title={s.changeList} rows={willChange} />
        {skipped.length > 0 && <SessionList title={s.skipList} rows={skipped} muted reason={(r) => (r.status !== "scheduled" ? t.status[r.status] : s.alreadyStarted)} />}
      </ConfirmDialog>
    </>
  );
}

function SessionList({ title, rows, muted, reason }: { title: string; rows: SessionRow[]; muted?: boolean; reason?: (r: SessionRow) => string }) {
  const { tag } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-medium text-secondary">{title}</div>
      <ul className="max-h-40 overflow-y-auto rounded-[10px] border border-line-soft">
        {rows.map((r) => (
          <li key={r.id} className={`flex justify-between gap-3 border-b border-subtle px-3 py-2 last:border-b-0 tabular ${muted ? "text-muted" : ""}`}>
            <span><span className="font-medium">{r.studentName}</span> · {formatDay(r.startsAt, r.studentTimezone, tag)} {formatTime(r.startsAt, r.studentTimezone, tag)} {zoneCity(r.studentTimezone, tag)}</span>
            <span className="shrink-0 text-xs">{reason ? reason(r) : r.teacherName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
