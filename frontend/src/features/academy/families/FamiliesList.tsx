"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Home, Plus, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { formatNumber, zoneCity, zoneOffset } from "@/lib/format";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { SearchInput } from "@/components/ds/Field";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { EmptyState } from "@/components/ds/States";
import { useAccess } from "../access";
import { academyApi } from "../api";
import type { FamilyRow } from "../types";

export function FamiliesList() {
  const { t, tag } = useI18n();
  const { can } = useAccess();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => academyApi.listFamilies());
  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [attention, setAttention] = useState<"any" | "attention">("any");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "active" && !r.isActive) return false;
      if (status === "inactive" && r.isActive) return false;
      if (attention === "attention" && r.lowBalanceCount === 0 && r.pendingPayments === 0) return false;
      if (q && ![r.name, ...r.contacts.flatMap((c) => [c.name, c.phone.replace(/\s/g, ""), c.email ?? ""])].some((v) => v.toLowerCase().includes(q.replace(/\s/g, "")) || v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, query, status, attention]);

  const hasFilters = query !== "" || status !== "active" || attention !== "any";
  const clear = () => {
    setQuery("");
    setStatus("all");
    setAttention("any");
    setPage(1);
  };

  const columns: Column<FamilyRow>[] = [
    {
      key: "family",
      header: t.families.colFamily,
      cell: (r) => (
        <div>
          <Link href={`/manage/families/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
          <div className="text-xs text-muted">{r.primaryContact?.relationship === "self" ? t.students.selfAdult : r.primaryContact?.name}</div>
        </div>
      ),
    },
    { key: "phone", header: t.families.colPhone, hideBelow: "md", cell: (r) => <span dir="ltr" className="tabular">{r.primaryContact?.phone ?? "—"}</span> },
    { key: "students", header: t.families.colStudents, align: "end", cell: (r) => <span className="tabular">{formatNumber(r.studentCount, tag)}</span> },
    { key: "zone", header: t.families.colZone, hideBelow: "lg", cell: (r) => <span className="tabular">{zoneCity(r.timezone, tag)} <span className="text-xs text-muted">{zoneOffset(r.timezone)}</span></span> },
    { key: "lang", header: t.families.colLanguage, hideBelow: "lg", cell: (r) => t.languages[r.language] },
    {
      key: "attention",
      header: t.families.colAttention,
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {r.lowBalanceCount > 0 && <Badge tone="review" size="sm">{t.families.lowBalance(r.lowBalanceCount)}</Badge>}
          {r.pendingPayments > 0 && <Badge tone="pending" size="sm">{t.families.pendingPayments(r.pendingPayments)}</Badge>}
          {r.lowBalanceCount === 0 && r.pendingPayments === 0 && <span className="text-muted">—</span>}
        </div>
      ),
    },
    { key: "status", header: t.students.colStatus, cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.families }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={t.nav.families}
        meta={isLoading ? " " : t.families.meta(formatNumber(rows.filter((r) => r.isActive).length, tag), formatNumber(rows.filter((r) => r.lowBalanceCount > 0).length, tag))}
        actions={can("manage_people") ? (
          <>
            <ButtonLink href="/manage/import" icon={<Upload aria-hidden className="size-4" />}>{t.students.importExcel}</ButtonLink>
            <ButtonLink href="/manage/students/new" variant="primary" icon={<Plus aria-hidden className="size-4" />}>{t.students.add}</ButtonLink>
          </>
        ) : <Button locked title={t.common.lockedForRole}>{t.students.add}</Button>}
      />
      <TableToolbar summary={!isLoading && rows.length > 0 ? t.common.resultCount(formatNumber(filtered.length, tag)) : undefined}>
        <SearchInput label={t.families.searchLabel} placeholder={t.families.searchPlaceholder} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="w-full sm:w-80" />
        <FilterSelect label={t.students.filterStatus} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: "all", label: t.common.all },
          { value: "active", label: t.status.active },
          { value: "inactive", label: t.status.inactive },
        ]} />
        <FilterSelect label={t.families.colAttention} value={attention} onChange={(v) => { setAttention(v); setPage(1); }} options={[
          { value: "any", label: t.common.any },
          { value: "attention", label: t.families.needsAttention },
        ]} />
        {hasFilters && <Button variant="tertiary" onClick={clear}>{t.common.clear}</Button>}
      </TableToolbar>
      <DataTable
        caption={t.nav.families}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        errorTitle={t.families.loadError}
        empty={rows.length === 0 ? (
          <EmptyState
            icon={<Home aria-hidden className="size-[22px]" />}
            title={t.families.emptyTitle}
            description={t.families.emptyBody}
            actions={can("manage_people") && (
              <>
                <ButtonLink href="/manage/students/new" variant="primary" size="sm">{t.students.add}</ButtonLink>
                <ButtonLink href="/manage/import" size="sm">{t.students.importExcel}</ButtonLink>
              </>
            )}
          />
        ) : (
          <EmptyState icon={<Home aria-hidden className="size-[22px]" />} title={t.students.noMatchTitle} description={t.students.noMatchBody} actions={<Button size="sm" onClick={clear}>{t.common.clearFilters}</Button>} />
        )}
      />
    </>
  );
}
