"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatNumber, TIME_ZONES, zoneOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Checkbox, Field, Input, Select } from "@/components/ds/Field";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { academyApi } from "../api";
import type { ConnectionStatus, SetupStep, SetupStepKey } from "../types";

const LINKS: Partial<Record<SetupStepKey, string>> = {
  packages: "/manage/packages",
  teachers: "/manage/teachers",
  students: "/manage/import",
  whatsapp: "/manage/whatsapp",
  payments: "/manage/settings",
};

export function SetupChecklist() {
  const { t, tag } = useI18n();
  const s = t.setup;
  const { can } = useAccess();
  const { data, error, isLoading, reload } = useResource(() => academyApi.getSetupSteps());
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  const [open, setOpen] = useState<SetupStepKey | null>(null);
  const list = steps ?? data ?? [];
  const done = list.filter((x) => x.done).length;
  const firstOpen = list.find((x) => !x.done)?.key;
  const canEdit = can("manage_settings");

  async function mark(key: SetupStepKey, value: boolean) {
    setSteps(await academyApi.saveSetupStep(key, value));
    setOpen(null);
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.setup }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={s.title}
        meta={s.meta}
      />
      <Card className="flex max-w-4xl flex-col gap-5 p-6">
        {isLoading ? <LoadingState rows={8} /> : error ? <ErrorState title={t.common.errorTitle} onRetry={reload} /> : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{s.progress(formatNumber(done, tag), formatNumber(list.length, tag))}</h2>
                <span className="text-xs text-muted">{s.autosaved}</span>
              </div>
              <div className="h-2 rounded-full bg-subtle" role="progressbar" aria-label={s.title} aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done}>
                <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${(done / Math.max(list.length, 1)) * 100}%` }} />
              </div>
            </div>

            <ol className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
              {list.map((step, i) => {
                const expanded = open === step.key;
                const isNext = step.key === firstOpen;
                const panelId = `setup-${step.key}`;
                return (
                  <li key={step.key} className={cn(isNext && !expanded && "bg-brand-50/60")}>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                      <span className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        step.done ? "bg-brand-800 text-white" : "border-2 border-line text-muted",
                      )}>
                        {step.done ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : formatNumber(i + 1, tag)}
                        <span className="sr-only">{step.done ? t.status.done : t.status.todo}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{s.steps[step.key].title}</div>
                        <div className="text-xs text-muted">{s.steps[step.key].body}</div>
                      </div>
                      {step.connection ? <StatusBadge status={step.connection} /> : <StatusBadge status={step.done ? "done" : "todo"} />}
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => setOpen(expanded ? null : step.key)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium"
                      >
                        {step.done ? s.review : isNext ? s.start : s.open}
                        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
                      </button>
                    </div>
                    {expanded && (
                      <div id={panelId} className="border-t border-subtle bg-page/60 px-4 py-4 sm:ps-14">
                        <StepBody step={step} canEdit={canEdit} onDone={(v) => mark(step.key, v)} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            <section aria-labelledby="conn-legend" className="flex flex-col gap-2">
              <h3 id="conn-legend" className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">{s.connectionLegend}</h3>
              <ul className="grid gap-2 text-xs text-secondary sm:grid-cols-2">
                {(["not_connected", "pending", "connected", "action_required"] as ConnectionStatus[]).map((c) => (
                  <li key={c} className="flex items-start gap-2"><StatusBadge status={c} size="sm" /><span className="pt-0.5">{s.connection[c]}</span></li>
                ))}
              </ul>
            </section>
          </>
        )}
      </Card>
    </>
  );
}

function StepBody({ step, canEdit, onDone }: { step: SetupStep; canEdit: boolean; onDone: (value: boolean) => void }) {
  const { t } = useI18n();
  const s = t.setup;
  const [hours, setHours] = useState(settings.cancellationHours);
  const [deduct, setDeduct] = useState(settings.lateCancelDeduct);
  const [pay, setPay] = useState(settings.lateCancelPayTeacher);
  const actions = (
    <div className="flex flex-wrap gap-2">
      {LINKS[step.key] && <ButtonLink href={LINKS[step.key]!} size="sm">{s.goTo}</ButtonLink>}
      {canEdit ? (
        <Button size="sm" variant={step.done ? "secondary" : "primary"} onClick={() => onDone(!step.done)}>{step.done ? s.markUndone : s.markDone}</Button>
      ) : (
        <Button size="sm" locked title={t.common.lockedForRole}>{s.markDone}</Button>
      )}
    </div>
  );

  if (step.key === "profile") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={s.academyNameEn} required>{(p) => <Input {...p} defaultValue={settings.name.en} disabled={!canEdit} />}</Field>
          <Field label={s.academyNameAr} required>{(p) => <Input {...p} dir="rtl" lang="ar" defaultValue={settings.name.ar} disabled={!canEdit} />}</Field>
        </div>
        {actions}
      </div>
    );
  }
  if (step.key === "locale") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={s.defaultLanguage}>{(p) => (
            <Select {...p} defaultValue={settings.language} disabled={!canEdit}>
              <option value="ar">{t.languages.ar}</option>
              <option value="en">{t.languages.en}</option>
            </Select>
          )}</Field>
          <Field label={s.academyZone} hint={s.academyZoneHint}>{(p) => (
            <Select {...p} defaultValue={settings.timezone} disabled={!canEdit}>
              {TIME_ZONES.map((z) => <option key={z} value={z}>{z} ({zoneOffset(z)})</option>)}
            </Select>
          )}</Field>
        </div>
        {actions}
      </div>
    );
  }
  if (step.key === "policy") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={s.noticeHours} hint={s.noticeHint(hours)}>{(p) => <Input {...p} type="number" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!canEdit} className="tabular" />}</Field>
          <div className="flex flex-col justify-center gap-2.5">
            <Checkbox label={s.deductLate} checked={deduct} onChange={(e) => setDeduct(e.target.checked)} disabled={!canEdit} />
            <Checkbox label={s.payTeacherLate} checked={pay} onChange={(e) => setPay(e.target.checked)} disabled={!canEdit} />
          </div>
        </div>
        <div className="rounded-[10px] border border-accent-border bg-accent-50 px-3.5 py-3 text-[13px] text-accent-ink">
          <strong>{s.familySees}</strong> {s.policyPreview(hours, deduct)}
        </div>
        {actions}
      </div>
    );
  }
  if (step.connection) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-secondary">{step.key === "whatsapp" ? s.whatsappDetail : s.paymentsDetail}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={LINKS[step.key]!} size="sm" variant="primary">{step.connection === "action_required" ? s.fixConnection : s.connect}</ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-secondary">{s.steps[step.key].body}</p>
      {actions}
      {step.key === "students" && <p className="text-xs text-muted">{s.importHint} <Link className="text-brand-700" href="/manage/students/new">{t.students.add}</Link></p>}
    </div>
  );
}
