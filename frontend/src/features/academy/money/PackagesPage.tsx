"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Package as PackageIcon, Plus, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, KeyValue } from "@/components/ds/Card";
import { TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { Checkbox, Field, Input, SearchInput, Select } from "@/components/ds/Field";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Ledger } from "@/components/ds/Ledger";
import { InfoNote, SidePanel } from "@/components/ds/Panels";
import { Money } from "@/components/ds/Time";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { financeApi } from "../finance-api";
import { AdjustBalanceDialog } from "../dialogs/AdjustBalanceDialog";
import type { Package } from "../types";
import { FinanceGate } from "./FinanceGate";

type Tab = "catalog" | "enrollments";
const CURRENCIES = ["EGP", "USD", "SAR", "GBP", "AED", "EUR"];

export function PackagesPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "enrollments" ? "enrollments" : "catalog";
  const setTab = (next: Tab) => router.replace(`${pathname}${next === "catalog" ? "" : "?tab=enrollments"}`, { scroll: false });
  return (
    <FinanceGate title={t.nav.packages}>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.packages }]} breadcrumbLabel={t.common.breadcrumb} title={t.nav.packages} meta={t.packages.meta} />
      <Tabs idBase="pkg" label={t.nav.packages} value={tab} onChange={setTab} items={[{ key: "catalog", label: t.packages.catalog }, { key: "enrollments", label: t.packages.enrollments }]} />
      <TabPanel idBase="pkg" tab={tab} className="flex flex-col gap-4">
        {tab === "catalog" ? <Catalog /> : <Enrollments />}
      </TabPanel>
    </FinanceGate>
  );
}

function Catalog() {
  const { t, tag } = useI18n();
  const p = t.packages;
  const { can } = useAccess();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => financeApi.packages());
  const [editing, setEditing] = useState<{ pkg: Package | null; activeEnrollments: number; pendingEnrollments: number } | null>(null);
  const list = demo === "empty" ? [] : data ?? [];
  const currencies = [...new Set(list.map((x) => x.pkg.currency))];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InfoNote className="max-w-2xl">{p.catalogNote}</InfoNote>
        <Button variant="primary" locked={!can("manage_finance")} icon={<Plus aria-hidden className="size-4" />} onClick={() => setEditing({ pkg: null, activeEnrollments: 0, pendingEnrollments: 0 })}>{p.newPackage}</Button>
      </div>
      {isLoading ? <Card><LoadingState /></Card> : error ? <ErrorState title={p.loadError} onRetry={reload} /> : list.length === 0 ? (
        <Card><EmptyState icon={<PackageIcon aria-hidden className="size-[22px]" />} title={p.emptyTitle} description={p.emptyBody} actions={can("manage_finance") && <Button variant="primary" size="sm" onClick={() => setEditing({ pkg: null, activeEnrollments: 0, pendingEnrollments: 0 })}>{p.newPackage}</Button>} /></Card>
      ) : currencies.map((currency) => (
        <section key={currency} aria-labelledby={`cur-${currency}`} className="flex flex-col gap-2">
          <h2 id={`cur-${currency}`} className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">{p.priced(currency)}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.filter((x) => x.pkg.currency === currency).map(({ pkg, activeEnrollments, pendingEnrollments }) => (
              <Card key={pkg.id} as="article" className={cn("flex flex-col gap-3 p-4", !pkg.isActive && "opacity-70")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold">{pkg.name}</h3>
                    <p className="text-xs text-muted tabular">{p.terms(formatNumber(pkg.lessonCount, tag), formatNumber(pkg.durationMinutes, tag), formatNumber(pkg.validityDays, tag))}</p>
                  </div>
                  <StatusBadge status={pkg.isActive ? "active" : "inactive"} size="sm" />
                </div>
                <Money amount={pkg.price} currency={pkg.currency} className="text-xl font-semibold" />
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <Link href={`/manage/packages?tab=enrollments`} className="text-brand-700">{p.inUse(activeEnrollments, pendingEnrollments)}</Link>
                  <Button size="sm" locked={!can("manage_finance")} onClick={() => setEditing({ pkg, activeEnrollments, pendingEnrollments })}>{t.common.edit}</Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
      {editing && <PackageDialog editing={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function PackageDialog({ editing, onClose, onSaved }: { editing: { pkg: Package | null; activeEnrollments: number; pendingEnrollments: number }; onClose: () => void; onSaved: () => void }) {
  const { t, tag } = useI18n();
  const p = t.packages;
  const init = editing.pkg ?? { name: "", lessonCount: 8, durationMinutes: 30, validityDays: 30, price: 0, currency: "EGP", isActive: true };
  const [form, setForm] = useState<Omit<Package, "id">>({ name: init.name, lessonCount: init.lessonCount, durationMinutes: init.durationMinutes, validityDays: init.validityDays, price: init.price, currency: init.currency, isActive: init.isActive });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.lessonCount > 0 && form.durationMinutes >= 5 && form.validityDays > 0 && form.price >= 0;
  const changedTerms = editing.pkg && (["lessonCount", "durationMinutes", "validityDays", "price", "currency"] as const).some((k) => editing.pkg![k] !== form[k]);

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={editing.pkg ? p.editTitle(editing.pkg.name) : p.newPackage}
      confirmLabel={editing.pkg ? p.save : p.create}
      canConfirm={!!valid}
      onConfirm={async () => { await financeApi.savePackage({ ...form, name: form.name.trim() }, editing.pkg?.id); onSaved(); }}
      effects={editing.pkg ? [
        { label: p.existing, value: p.existingValue(editing.activeEnrollments + editing.pendingEnrollments), tone: "plain" },
        { label: p.newPurchases, value: changedTerms ? p.newTerms : p.noTermChange, tone: changedTerms ? "negative" : "plain" },
      ] : [{ label: p.newPurchases, value: p.availableNow }]}
    >
      <Field label={p.name} required>{(f) => <Input {...f} value={form.name} onChange={(e) => set("name", e.target.value)} />}</Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={p.lessons} required>{(f) => <Input {...f} type="number" min={1} value={form.lessonCount} onChange={(e) => set("lessonCount", Number(e.target.value))} className="tabular" />}</Field>
        <Field label={p.minutes} required>{(f) => <Input {...f} type="number" min={5} max={240} value={form.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} className="tabular" />}</Field>
        <Field label={p.validity} required>{(f) => <Input {...f} type="number" min={1} value={form.validityDays} onChange={(e) => set("validityDays", Number(e.target.value))} className="tabular" />}</Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={p.price} required>{(f) => <Input {...f} type="number" min={0} step="0.01" value={form.price} onChange={(e) => set("price", Number(e.target.value))} className="tabular" />}</Field>
        <Field label={p.currency} required hint={p.currencyHint}>{(f) => (
          <Select {...f} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}</Field>
      </div>
      <Checkbox label={p.activeLabel} checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
      <p className="text-xs text-muted tabular">{p.perLesson(formatNumber(form.lessonCount ? Math.round((form.price / form.lessonCount) * 100) / 100 : 0, tag), form.currency)}</p>
    </ConfirmDialog>
  );
}

type EnrollmentFilter = "active" | "pending" | "closed" | "attention" | "all";

function Enrollments() {
  const { t, tag } = useI18n();
  const p = t.packages;
  const { can } = useAccess();
  const now = useNow();
  const demo = useDemoState();
  const { data, error, isLoading, reload } = useResource(() => financeApi.enrollments());
  const [status, setStatus] = useState<EnrollmentFilter>("active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = new Date(now + 7 * 86_400_000).toISOString().slice(0, 10);

  const rows = useMemo(() => (demo === "empty" ? [] : data ?? []), [data, demo]);
  const filtered = rows.filter((r) => {
    const e = r.enrollment;
    const attention = e.status === "active" && (e.balance <= settings.lowBalanceThreshold || e.expiresOn <= soon);
    if (status === "attention" && !attention) return false;
    if (status !== "all" && status !== "attention" && e.status !== status) return false;
    return !query || r.studentName.toLowerCase().includes(query.toLowerCase()) || e.packageName.toLowerCase().includes(query.toLowerCase());
  });
  const selected = rows.find((r) => r.enrollment.id === selectedId) ?? null;

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "student",
      header: t.students.colStudent,
      cell: (r) => (
        <button type="button" onClick={() => setSelectedId(r.enrollment.id)} aria-pressed={selectedId === r.enrollment.id} className="text-start font-medium text-ink hover:text-brand-700">
          {r.studentName}
          {r.enrollment.renewedFrom && <span className="block text-xs font-normal text-muted">{p.renewal}</span>}
        </button>
      ),
    },
    { key: "package", header: p.package, cell: (r) => r.enrollment.packageName },
    {
      key: "left",
      header: p.left,
      align: "end",
      cell: (r) => <span className={cn("tabular", r.enrollment.status === "active" && r.enrollment.balance <= settings.lowBalanceThreshold && "font-semibold text-st-review")}>{p.leftOf(formatNumber(r.enrollment.balance, tag), formatNumber(r.enrollment.lessonCount, tag))}</span>,
    },
    {
      key: "valid",
      header: p.validUntil,
      hideBelow: "md",
      cell: (r) => <span className={cn("tabular", r.enrollment.status === "active" && r.enrollment.expiresOn <= soon && "font-semibold text-st-review")}>{formatDate(r.enrollment.expiresOn, tag)}{r.enrollment.status === "active" && r.enrollment.expiresOn < today ? ` · ${p.expired}` : ""}</span>,
    },
    { key: "price", header: p.price, align: "end", hideBelow: "lg", cell: (r) => <Money amount={r.enrollment.price} currency={r.enrollment.currency} /> },
    {
      key: "status",
      header: t.students.colStatus,
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge status={r.enrollment.status} size="sm" />
          {r.pendingPayment && <Badge tone="pending" size="sm">{p.receiptWaiting}</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <TableToolbar summary={!isLoading ? t.common.resultCount(formatNumber(filtered.length, tag)) : undefined}>
        <SearchInput label={p.search} placeholder={p.search} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="w-full sm:w-72" />
        <FilterSelect<EnrollmentFilter> label={t.students.filterStatus} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: "active", label: t.status.active },
          { value: "attention", label: p.attention },
          { value: "pending", label: p.pendingPayment },
          { value: "closed", label: t.status.closed },
          { value: "all", label: t.common.all },
        ]} />
      </TableToolbar>
      <div className={cn("grid items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <DataTable
          caption={p.enrollments}
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.enrollment.id}
          rowLabel={(r) => `${r.studentName} ${r.enrollment.packageName}`}
          page={page}
          onPageChange={setPage}
          isLoading={isLoading}
          error={error}
          onRetry={reload}
          errorTitle={p.loadError}
          empty={<EmptyState icon={<PackageIcon aria-hidden className="size-[22px]" />} title={rows.length ? t.students.noMatchTitle : p.noEnrollments} description={rows.length ? t.students.noMatchBody : p.noEnrollmentsBody} />}
        />
        {selected && <EnrollmentPanel id={selected.enrollment.id} onClose={() => setSelectedId(null)} onChanged={reload} canManage={can("manage_finance")} />}
      </div>
    </>
  );
}

function EnrollmentPanel({ id, onClose, onChanged, canManage }: { id: string; onClose: () => void; onChanged: () => void; canManage: boolean }) {
  const { t, tag } = useI18n();
  const p = t.packages;
  const { data, reload } = useResource(() => financeApi.enrollment(id), [id]);
  const [dialog, setDialog] = useState<"adjust" | "renew" | null>(null);
  if (!data) return <SidePanel title={t.common.loading} onClose={onClose}><LoadingState rows={4} /></SidePanel>;
  const { enrollment: e } = data;
  const done = () => { reload(); onChanged(); };
  return (
    <div className="xl:sticky xl:top-24">
      <SidePanel
        title={`${data.studentName} · ${e.packageName}`}
        onClose={onClose}
        footer={e.status !== "closed" && (
          <>
            <Button size="sm" locked={!canManage} onClick={() => setDialog("adjust")} disabled={e.status !== "active"}>{t.dialogs.adjust.title}</Button>
            <Button size="sm" variant="primary" locked={!canManage} icon={<RefreshCw aria-hidden className="size-3.5" />} onClick={() => setDialog("renew")}>{p.renew}</Button>
          </>
        )}
      >
        <KeyValue label={t.students.colStatus}><StatusBadge status={e.status} size="sm" /></KeyValue>
        <KeyValue label={p.left}>{p.leftOf(formatNumber(e.balance, tag), formatNumber(e.lessonCount, tag))}</KeyValue>
        <KeyValue label={p.period}>{formatDate(e.startsOn, tag)} – {formatDate(e.expiresOn, tag)}</KeyValue>
        <KeyValue label={p.price}><Money amount={e.price} currency={e.currency} /></KeyValue>
        {data.renewedFrom && <KeyValue label={p.renewedFrom}>{data.renewedFrom.packageName} · {formatDate(data.renewedFrom.startsOn, tag)}</KeyValue>}
        <KeyValue label={t.nav.payments}>{data.payments.length === 0 ? p.noPayment : data.payments.map((x) => <span key={x.id} className="block"><Money amount={x.amount} currency={x.currency} /> · {t.status[x.status]}</span>)}</KeyValue>
        <p className="text-xs text-muted">{p.termsFrozen}</p>
        {data.ledger.length > 0 && (
          <Ledger caption={t.studentProfile.ledgerTitle} items={data.ledger.map((l) => ({
            id: l.id,
            date: formatDate(l.createdAt, tag),
            change: l.delta,
            balance: l.balanceAfter,
            entry: <span>{t.ledger.kinds[l.kind]}{l.kind !== "lesson" && <span className="text-muted"> · {l.reason}</span>}</span>,
          }))} />
        )}
      </SidePanel>
      {dialog === "adjust" && <AdjustBalanceDialog open onClose={() => setDialog(null)} enrollment={e} studentName={data.studentName} onAdjusted={done} />}
      {dialog === "renew" && <RenewDialog studentId={e.studentId} studentName={data.studentName} current={e} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

export function RenewDialog({ studentId, studentName, current, onClose, onDone, audience = "staff" }: {
  studentId: string;
  studentName: string;
  current: { packageId: string; balance: number; expiresOn: string; packageName: string } | null;
  onClose: () => void;
  onDone: (enrollmentId: string) => void;
  audience?: "staff" | "family";
}) {
  const { t, tag } = useI18n();
  const p = t.packages;
  const { data } = useResource(() => financeApi.packages());
  const [packageId, setPackageId] = useState(current?.packageId ?? "");
  const pkg = data?.find((x) => x.pkg.id === packageId)?.pkg;
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={p.renewTitle(studentName)}
      confirmLabel={audience === "family" ? p.chooseAndPay : p.createRenewal}
      canConfirm={!!pkg}
      onConfirm={async () => { const e = await financeApi.renew(studentId, packageId); onDone(e.id); }}
      effects={pkg ? [
        { label: p.newEnrollment, value: `${pkg.name} · ${p.terms(formatNumber(pkg.lessonCount, tag), formatNumber(pkg.durationMinutes, tag), formatNumber(pkg.validityDays, tag))}` },
        { label: p.price, value: <Money amount={pkg.price} currency={pkg.currency} /> },
        { label: p.activation, value: p.activatesOnPayment, tone: "plain" },
        ...(current ? [{ label: p.currentPackage, value: p.currentStays(formatNumber(current.balance, tag), formatDate(current.expiresOn, tag)) }] : []),
      ] : undefined}
    >
      <Field label={p.package} required>
        {(f) => (
          <Select {...f} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">{t.common.choose}</option>
            {(data ?? []).filter((x) => x.pkg.isActive).map(({ pkg: x }) => <option key={x.id} value={x.id}>{x.name} · {formatNumber(x.price, tag)} {x.currency}</option>)}
          </Select>
        )}
      </Field>
      <p className="text-xs text-muted">{p.renewNote}</p>
    </ConfirmDialog>
  );
}
