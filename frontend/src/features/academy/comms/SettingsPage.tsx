"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Plus, Upload, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { TIME_ZONES, zoneOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { Card, KeyValue } from "@/components/ds/Card";
import { Checkbox, Field, Input, Select } from "@/components/ds/Field";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { useAccess } from "../access";
import { settingsApi, type SettingsData } from "../admin-api";
import type { AcademySettings, Role, StaffMember } from "../types";

const SECTIONS = ["profile", "locale", "policy", "reminders", "whatsapp", "methods", "staff", "data"] as const;

export function SettingsPage() {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = useResource(() => settingsApi.get());
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.settings }]} breadcrumbLabel={t.common.breadcrumb} title={t.nav.settings} meta={t.settingsPage.meta} />
      {isLoading ? <Card><LoadingState rows={10} /></Card> : error || !data ? <ErrorState title={t.common.errorTitle} onRetry={reload} /> : <SettingsForm data={data} onSaved={reload} />}
    </>
  );
}

function SettingsForm({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const { t } = useI18n();
  const s = t.settingsPage;
  const { can } = useAccess();
  const editable = can("manage_settings");
  const [form, setForm] = useState<AcademySettings>(() => structuredClone(data.settings));
  const [methods, setMethods] = useState<string[]>(() => [...data.paymentMethods]);
  const [newMethod, setNewMethod] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings) || methods.join("|") !== data.paymentMethods.join("|");
  const set = <K extends keyof AcademySettings>(k: K, v: AcademySettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    await settingsApi.save(form, methods);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved();
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label={s.sections} className="sticky top-24 hidden flex-col gap-0.5 lg:flex">
        {SECTIONS.map((key) => <a key={key} href={`#set-${key}`} className="rounded-lg px-3 py-2 text-[13px] text-secondary hover:bg-surface hover:text-ink">{s.nav[key]}</a>)}
      </nav>
      <div className="flex flex-col gap-4">
        {!editable && <p className="rounded-[10px] border border-line-soft bg-surface px-3.5 py-2.5 text-[13px] text-muted">{s.readOnly}</p>}

        <Section id="profile" title={s.nav.profile}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={s.nameEn} required>{(f) => <Input {...f} value={form.name.en} disabled={!editable} onChange={(e) => set("name", { ...form.name, en: e.target.value })} />}</Field>
            <Field label={s.nameAr} required>{(f) => <Input {...f} dir="rtl" lang="ar" value={form.name.ar} disabled={!editable} onChange={(e) => set("name", { ...form.name, ar: e.target.value })} />}</Field>
          </div>
          <Field label={s.logo} hint={s.logoHint}>
            {(f) => <input {...f} type="file" accept="image/png,image/svg+xml,image/jpeg" disabled={!editable} className="text-[13px] file:me-3 file:h-9 file:rounded-[10px] file:border file:border-line file:bg-surface file:px-3 file:text-[13px] file:font-medium" />}
          </Field>
        </Section>

        <Section id="locale" title={s.nav.locale}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.setup.defaultLanguage} hint={s.languageHint}>{(f) => (
              <Select {...f} value={form.language} disabled={!editable} onChange={(e) => set("language", e.target.value as AcademySettings["language"])}>
                <option value="ar">{t.languages.ar}</option>
                <option value="en">{t.languages.en}</option>
              </Select>
            )}</Field>
            <Field label={t.setup.academyZone} hint={t.setup.academyZoneHint}>{(f) => (
              <Select {...f} value={form.timezone} disabled={!editable} onChange={(e) => set("timezone", e.target.value)}>
                {TIME_ZONES.map((z) => <option key={z} value={z}>{z} ({zoneOffset(z)})</option>)}
              </Select>
            )}</Field>
          </div>
        </Section>

        <Section id="policy" title={s.nav.policy}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.setup.noticeHours} hint={t.setup.noticeHint(form.cancellationHours)}>{(f) => <Input {...f} type="number" min={0} max={168} value={form.cancellationHours} disabled={!editable} onChange={(e) => set("cancellationHours", Number(e.target.value))} className="tabular" />}</Field>
            <div className="flex flex-col justify-center gap-2.5">
              <Checkbox label={t.setup.deductLate} checked={form.lateCancelDeduct} disabled={!editable} onChange={(e) => set("lateCancelDeduct", e.target.checked)} />
              <Checkbox label={t.setup.payTeacherLate} checked={form.lateCancelPayTeacher} disabled={!editable} onChange={(e) => set("lateCancelPayTeacher", e.target.checked)} />
            </div>
          </div>
          <p className="rounded-[10px] border border-accent-border bg-accent-50 px-3.5 py-3 text-[13px] text-accent-ink"><strong>{t.setup.familySees}</strong> {t.setup.policyPreview(form.cancellationHours, form.lateCancelDeduct)}</p>
          <p className="text-xs text-muted">{s.policyNote}</p>
        </Section>

        <Section id="reminders" title={s.nav.reminders}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={s.reminderMinutes} hint={s.reminderHint}>{(f) => (
              <Select {...f} value={form.reminderMinutes} disabled={!editable} onChange={(e) => set("reminderMinutes", Number(e.target.value))}>
                {[15, 30, 60, 120, 180, 1440].map((m) => <option key={m} value={m}>{s.minutesBefore(m)}</option>)}
              </Select>
            )}</Field>
            <Field label={s.lowBalance} hint={s.lowBalanceHint}>{(f) => <Input {...f} type="number" min={0} max={20} value={form.lowBalanceThreshold} disabled={!editable} onChange={(e) => set("lowBalanceThreshold", Number(e.target.value))} className="tabular" />}</Field>
          </div>
        </Section>

        <Section id="whatsapp" title={s.nav.whatsapp} action={<ButtonLink href="/manage/whatsapp" size="sm">{s.manage}</ButtonLink>}>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <KeyValue label={t.whatsapp.provider}>{data.whatsapp.provider} · {t.whatsapp.channel(data.whatsapp.channelId)}</KeyValue>
            <KeyValue label={t.whatsapp.sender}><span dir="ltr" className="tabular">{data.whatsapp.sender}</span></KeyValue>
            <KeyValue label={t.students.colStatus}><StatusBadge status={data.whatsapp.status} size="sm" /></KeyValue>
            <KeyValue label={t.whatsapp.apiKey}>{data.whatsapp.apiKeyConfigured ? t.status.connected : t.whatsapp.keyMissing}</KeyValue>
          </div>
          <p className="text-xs text-muted">{t.whatsapp.serverSide}</p>
        </Section>

        <Section id="methods" title={s.nav.methods}>
          <ul className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <li key={m} className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-surface ps-3 pe-1 text-[13px]">
                {m}
                {editable && <button type="button" aria-label={s.removeMethod(m)} onClick={() => setMethods(methods.filter((x) => x !== m))} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-page"><X aria-hidden className="size-3.5" /></button>}
              </li>
            ))}
          </ul>
          {editable && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newMethod.trim() && !methods.includes(newMethod.trim())) setMethods([...methods, newMethod.trim()]); setNewMethod(""); }}>
              <Input aria-label={s.addMethod} placeholder={s.methodPlaceholder} value={newMethod} onChange={(e) => setNewMethod(e.target.value)} className="max-w-64" />
              <Button type="submit" icon={<Plus aria-hidden className="size-4" />}>{s.addMethod}</Button>
            </form>
          )}
          <p className="text-xs text-muted">{s.methodsNote}</p>
        </Section>

        <StaffSection staff={data.staff} onChanged={onSaved} />

        <Section id="data" title={s.nav.data}>
          <p className="text-[13px] text-secondary">{s.importBody}</p>
          <ButtonLink href="/manage/import" className="self-start" icon={<Upload aria-hidden className="size-4" />}>{t.placeholder.import}</ButtonLink>
        </Section>

        <div className={cn("sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border bg-surface/95 px-4 py-3 shadow-popover backdrop-blur", dirty ? "border-accent-border" : "border-line-soft")}>
          <span role="status" className={cn("me-auto text-[13px]", dirty ? "text-accent-ink" : saved ? "text-success" : "text-muted")}>
            {dirty ? s.unsaved : saved ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 aria-hidden className="size-4" />{s.saved}</span> : s.upToDate}
          </span>
          <Button disabled={!dirty} onClick={() => { setForm(structuredClone(data.settings)); setMethods([...data.paymentMethods]); }}>{s.discard}</Button>
          <Button variant="primary" disabled={!dirty || !form.name.en.trim() || !form.name.ar.trim()} locked={!editable} onClick={save}>{t.common.save}</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card id={`set-${id}`} className="flex scroll-mt-24 flex-col gap-4 p-5" aria-labelledby={`set-${id}-h`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`set-${id}-h`} className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function StaffSection({ staff, onChanged }: { staff: StaffMember[]; onChanged: () => void }) {
  const { t } = useI18n();
  const s = t.settingsPage;
  const { can } = useAccess();
  const canRoles = can("manage_roles");
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  return (
    <Section id="staff" title={s.nav.staff} action={<Button size="sm" locked={!canRoles} icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setEditing("new")}>{s.addStaff}</Button>}>
      <div className="overflow-x-auto rounded-xl border border-line-soft">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{s.nav.staff}</caption>
          <thead>
            <tr className="bg-page text-xs text-secondary">
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{s.staffName}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.addStudent.phone}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{s.role}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t.students.colStatus}</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t.common.actions}</span></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((m) => (
              <tr key={m.id} className="border-t border-subtle">
                <td className="px-4 py-2.5 font-medium">{m.name}</td>
                <td className="px-4 py-2.5"><span dir="ltr" className="tabular">{m.phone}</span></td>
                <td className="px-4 py-2.5">{t.roles[m.role]}</td>
                <td className="px-4 py-2.5"><StatusBadge status={m.isActive ? "active" : "inactive"} size="sm" /></td>
                <td className="px-4 py-2.5 text-end"><Button size="sm" variant="tertiary" locked={!canRoles} onClick={() => setEditing(m)}>{t.common.edit}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1 text-xs text-muted sm:grid-cols-3">
        {(["admin", "coordinator", "accountant"] as Role[]).map((r) => <li key={r}><strong className="text-secondary">{t.roles[r]}:</strong> {s.roleCan[r as "admin" | "coordinator" | "accountant"]}</li>)}
      </ul>
      {!canRoles && <p className="text-xs text-muted">{s.rolesLocked}</p>}
      {editing && <StaffDialog member={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </Section>
  );
}

function StaffDialog({ member, onClose, onSaved }: { member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const s = t.settingsPage;
  const [form, setForm] = useState<Omit<StaffMember, "id">>(member ?? { name: "", phone: "+20", role: "coordinator", isActive: true });
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={member ? s.editStaff(member.name) : s.addStaff}
      confirmLabel={member ? t.common.save : s.invite}
      canConfirm={!!form.name.trim() && /^\+\d{8,15}$/.test(form.phone.replace(/\s/g, ""))}
      onConfirm={async () => { await settingsApi.saveStaff(form, member?.id); onSaved(); }}
      effects={[
        { label: s.role, value: `${t.roles[form.role]} — ${s.roleCan[form.role as "admin" | "coordinator" | "accountant"]}` },
        ...(member ? [] : [{ label: s.signIn, value: s.signInValue }]),
      ]}
    >
      <Field label={s.staffName} required>{(f) => <Input {...f} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
      <Field label={t.addStudent.phone} required hint={s.phoneHint}>{(f) => <Input {...f} dir="ltr" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="tabular" />}</Field>
      <Field label={s.role}>{(f) => (
        <Select {...f} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {(["admin", "coordinator", "accountant"] as Role[]).map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}
        </Select>
      )}</Field>
      {member && <Checkbox label={s.activeStaff} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />}
    </ConfirmDialog>
  );
}

