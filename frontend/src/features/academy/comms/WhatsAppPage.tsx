"use client";

import React, { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, MessageCircle, Plug, Send } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDemoState, useResource } from "@/hooks/useResource";
import { useNow } from "@/hooks/useNow";
import { formatDate, formatTime, zoneCity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, KeyValue } from "@/components/ds/Card";
import { TabPanel, Tabs } from "@/components/ds/DetailHeader";
import { DataTable, FilterSelect, TableToolbar, type Column } from "@/components/ds/DataTable";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ds/Field";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog, Dialog } from "@/components/ds/Dialog";
import { InfoNote } from "@/components/ds/Panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { settings } from "../fixtures";
import { useAccess } from "../access";
import { commsApi, type OutboxRow, type WhatsAppData } from "../admin-api";
import type { AutomationEvent, Lang, MessageStatus, MessageTemplate } from "../types";

type Tab = "outbox" | "automations" | "templates";

/** Failed, held, or queued past its due time. Future reminders waiting normally are not a problem. */
function needsAttention(row: OutboxRow): boolean {
  const m = row.message;
  return m.status === "failed" || m.status === "action_required" || (m.status === "queued" && new Date(m.dueAt).getTime() <= Date.now());
}

export function WhatsAppPage() {
  const { t } = useI18n();
  const w = t.whatsapp;
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = (["outbox", "automations", "templates"] as const).find((x) => x === params.get("tab")) ?? "outbox";
  const { data, error, isLoading, reload } = useResource(() => commsApi.whatsapp());

  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.whatsapp }]} breadcrumbLabel={t.common.breadcrumb} title={t.nav.whatsapp} meta={w.meta} />
      {isLoading ? <Card><LoadingState rows={8} /></Card> : error || !data ? <ErrorState title={w.loadError} onRetry={reload} /> : (
        <>
          <Connection data={data} onChanged={reload} />
          <Tabs idBase="wa" label={t.nav.whatsapp} value={tab} onChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })} items={[
            { key: "outbox", label: w.tabs.outbox, count: data.outbox.filter(needsAttention).length },
            { key: "automations", label: w.tabs.automations },
            { key: "templates", label: w.tabs.templates, count: data.templates.length },
          ]} />
          <TabPanel idBase="wa" tab={tab} className="flex flex-col gap-4">
            {tab === "outbox" && <Outbox data={data} onChanged={reload} />}
            {tab === "automations" && <Automations data={data} onChanged={reload} />}
            {tab === "templates" && <Templates data={data} onChanged={reload} />}
          </TabPanel>
        </>
      )}
    </>
  );
}

/** Connection card. A problem is shown prominently, with what is affected and how to fix it. */
function Connection({ data, onChanged }: { data: WhatsAppData; onChanged: () => void }) {
  const { t, tag } = useI18n();
  const w = t.whatsapp;
  const { can } = useAccess();
  const { connection } = data;
  const [testing, setTesting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const now = useNow(60_000);
  const queued = data.outbox.filter((m) => m.message.status === "queued" && new Date(m.message.dueAt).getTime() <= now).length;
  const problem = connection.status === "action_required" || connection.status === "not_connected";

  return (
    <>
      {problem && (
        <section role="alert" className="flex flex-col gap-3 rounded-card border-2 border-danger-border bg-st-action-bg p-5 text-st-action">
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">{w.problemTitle}</h2>
              <p className="text-[13px]">{w.problemBody(connection.since ? `${formatTime(connection.since, settings.timezone, tag)} ${zoneCity(settings.timezone, tag)}` : "—", queued)}</p>
            </div>
          </div>
          <ol className="ms-8 list-decimal text-[13px] text-secondary">
            {!connection.apiKeyConfigured && <li>{w.fixKey}</li>}
            <li>{w.fixChannel(connection.channelId, connection.sender)}</li>
            <li>{w.fixRetry}</li>
          </ol>
          <div className="ms-8 flex flex-wrap gap-2">
            <Button variant="danger-solid" locked={!can("manage_settings")} icon={<Plug aria-hidden className="size-4" />} onClick={() => setReconnecting(true)}>{w.reconnect}</Button>
            <Button onClick={() => setTesting(true)} icon={<Send aria-hidden className="size-4" />}>{w.sendTest}</Button>
          </div>
        </section>
      )}
      <Card className="grid gap-x-8 gap-y-2.5 p-5 md:grid-cols-2">
        <KeyValue label={w.provider}>{connection.provider} · {w.channel(connection.channelId)}</KeyValue>
        <KeyValue label={w.sender}><span dir="ltr" className="tabular">{connection.sender}</span></KeyValue>
        <KeyValue label={t.students.colStatus}><StatusBadge status={connection.status} size="sm" /></KeyValue>
        <KeyValue label={w.apiKey}>{connection.apiKeyConfigured ? <StatusBadge status="connected" size="sm" /> : <Badge tone="action" size="sm">{w.keyMissing}</Badge>}</KeyValue>
        <KeyValue label={w.lastSent}>{connection.lastSuccessAt ? `${formatDate(connection.lastSuccessAt, tag)} ${formatTime(connection.lastSuccessAt, settings.timezone, tag)} ${zoneCity(settings.timezone, tag)}` : "—"}</KeyValue>
        <KeyValue label={w.reminders}>{w.minutesBefore(data.reminderMinutes)}</KeyValue>
        <p className="text-xs text-muted md:col-span-2">{w.serverSide}</p>
        {!problem && <div className="md:col-span-2"><Button size="sm" icon={<Send aria-hidden className="size-3.5" />} onClick={() => setTesting(true)}>{w.sendTest}</Button></div>}
      </Card>
      {testing && <TestMessageDialog data={data} onClose={() => setTesting(false)} />}
      {reconnecting && (
        <ConfirmDialog
          open
          onClose={() => setReconnecting(false)}
          title={w.reconnectTitle}
          confirmLabel={w.reconnect}
          onConfirm={async () => { await commsApi.reconnect(); onChanged(); }}
          effects={[
            { label: w.channelLabel, value: `${connection.provider} · ${w.channel(connection.channelId)} · ${connection.sender}` },
            { label: w.queuedNow, value: w.releasedCount(queued), tone: "positive" },
            { label: w.oldReminders, value: w.skippedOld },
          ]}
        >
          <InfoNote>{w.reconnectNote}</InfoNote>
        </ConfirmDialog>
      )}
    </>
  );
}

function TestMessageDialog({ data, onClose }: { data: WhatsAppData; onClose: () => void }) {
  const { t } = useI18n();
  const w = t.whatsapp;
  const [to, setTo] = useState("+20");
  const [text, setText] = useState(w.testText);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ delivered: boolean } | null>(null);
  const valid = /^\+\d{8,15}$/.test(to.replace(/\s/g, ""));
  return (
    <Dialog
      open
      onClose={onClose}
      title={w.sendTest}
      context={`${data.connection.provider} · ${w.channel(data.connection.channelId)} · ${data.connection.sender}`}
      footer={result ? <Button onClick={onClose}>{t.common.close}</Button> : (
        <>
          <Button onClick={onClose}>{t.common.cancel}</Button>
          <Button
            variant="primary"
            disabled={!valid || !text.trim() || busy}
            icon={<Send aria-hidden className="size-4" />}
            onClick={async () => {
              setBusy(true);
              setResult(await commsApi.sendTest(to.replace(/\s/g, ""), text.trim()));
              setBusy(false);
            }}
          >
            {busy ? t.common.working : w.send}
          </Button>
        </>
      )}
    >
      <Field label={w.to} required hint={w.toHint} error={to.length > 3 && !valid ? w.badPhone : undefined}>
        {(f) => <Input {...f} dir="ltr" type="tel" value={to} onChange={(e) => setTo(e.target.value)} className="tabular" disabled={!!result} />}
      </Field>
      <Field label={w.message} required hint={w.plainText}>{(f) => <Textarea {...f} rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={!!result} />}</Field>
      {result && (
        <p role="status" className={cn("rounded-[10px] px-3.5 py-2.5", result.delivered ? "bg-st-completed-bg text-st-completed" : "bg-st-review-bg text-st-review")}>
          {result.delivered ? w.testSent : w.testNotSent}
        </p>
      )}
    </Dialog>
  );
}

type OutboxFilter = "attention" | MessageStatus | "all";

function Outbox({ data, onChanged }: { data: WhatsAppData; onChanged: () => void }) {
  const { t, tag } = useI18n();
  const w = t.whatsapp;
  const { can } = useAccess();
  const demo = useDemoState();
  const [filter, setFilter] = useState<OutboxFilter>("attention");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"requeue" | "cancel" | null>(null);
  const rows = useMemo(() => (demo === "empty" ? [] : data.outbox), [data, demo]);
  const filtered = rows.filter((r) => filter === "all" ? true : filter === "attention" ? needsAttention(r) : r.message.status === filter);
  const chosen = rows.filter((r) => selected.has(r.message.id));
  const eligible = chosen.filter((r) => (action === "requeue" ? ["failed", "action_required"] : ["queued"]).includes(r.message.status));

  const columns: Column<OutboxRow>[] = [
    { key: "due", header: w.due, cell: (r) => <span className="tabular">{formatDate(r.message.dueAt, tag)} · {formatTime(r.message.dueAt, settings.timezone, tag)} <span className="text-xs text-muted">{zoneCity(settings.timezone, tag)}</span></span> },
    { key: "to", header: w.recipient, cell: (r) => <span>{r.familyName}<span dir="ltr" className="block text-xs text-muted tabular">{r.message.destination}</span></span> },
    { key: "template", header: w.template, hideBelow: "md", cell: (r) => <span>{r.template ? w.events[eventOf(r.template.providerTemplate)] : "—"}<span className="block text-xs text-muted">{r.studentName} · {r.template?.language.toUpperCase()}</span></span> },
    {
      key: "status",
      header: t.students.colStatus,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge status={r.message.status} size="sm" />
          {r.message.error && <span className="max-w-64 text-xs text-st-action">{r.message.error}</span>}
        </span>
      ),
    },
  ];

  return (
    <>
      <TableToolbar>
        <FilterSelect<OutboxFilter> label={t.students.filterStatus} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[
          { value: "attention", label: w.needsAttention },
          { value: "queued", label: t.status.queued },
          { value: "sent", label: t.status.sent },
          { value: "failed", label: t.status.failed },
          { value: "action_required", label: t.status.action_required },
          { value: "cancelled", label: t.status.cancelled },
          { value: "all", label: t.common.all },
        ]} />
      </TableToolbar>
      <DataTable
        caption={w.tabs.outbox}
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.message.id}
        rowLabel={(r) => `${r.familyName} ${r.message.destination}`}
        selectable={can("manage_settings")}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={() => (
          <>
            <Button size="sm" onClick={() => setAction("requeue")}>{w.requeue}</Button>
            <Button size="sm" variant="danger" onClick={() => setAction("cancel")}>{w.cancelMessages}</Button>
          </>
        )}
        page={page}
        pageSize={12}
        onPageChange={setPage}
        empty={<EmptyState icon={<MessageCircle aria-hidden className="size-[22px]" />} title={rows.length ? w.allClear : w.emptyTitle} description={rows.length ? undefined : w.emptyBody} />}
      />
      {action && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          tone={action === "cancel" ? "danger" : "primary"}
          title={action === "requeue" ? w.requeueTitle(eligible.length) : w.cancelTitle(eligible.length)}
          confirmLabel={action === "requeue" ? w.requeue : w.cancelMessages}
          canConfirm={eligible.length > 0}
          onConfirm={async () => {
            const ids = eligible.map((r) => r.message.id);
            if (action === "requeue") await commsApi.requeue(ids);
            else await commsApi.cancelMessages(ids);
            setSelected(new Set());
            onChanged();
          }}
          effects={[
            { label: t.sessions.willChange, value: w.messagesCount(eligible.length) },
            { label: t.sessions.skipped, value: w.messagesCount(chosen.length - eligible.length) },
          ]}
        >
          {action === "requeue" && <InfoNote>{w.requeueNote}</InfoNote>}
          <ul className="max-h-40 overflow-y-auto rounded-[10px] border border-line-soft">
            {eligible.map((r) => <li key={r.message.id} className="flex justify-between gap-3 border-b border-subtle px-3 py-2 last:border-b-0"><span>{r.familyName}</span><span dir="ltr" className="text-muted tabular">{r.message.destination}</span></li>)}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}

function eventOf(providerTemplate: string): AutomationEvent {
  if (providerTemplate.includes("reminder")) return "reminder";
  if (providerTemplate.includes("changed")) return "session_changed";
  if (providerTemplate.includes("low")) return "low_balance";
  return "renewal";
}

function Automations({ data, onChanged }: { data: WhatsAppData; onChanged: () => void }) {
  const { t } = useI18n();
  const w = t.whatsapp;
  const { can } = useAccess();
  const editable = can("manage_settings");
  return (
    <div className="flex flex-col gap-3">
      <InfoNote>{w.automationsNote}</InfoNote>
      {data.automations.map((a) => {
        const template = data.templates.find((x) => x.id === a.templateId);
        const options = data.templates.filter((x) => eventOf(x.providerTemplate) === a.event);
        return (
          <Card key={a.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{w.events[a.event]}</h3>
                <p className="text-xs text-muted">{w.when[a.event](data.reminderMinutes, settings.lowBalanceThreshold)}</p>
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <span>{a.isEnabled ? w.on : w.off}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.isEnabled}
                  aria-label={w.toggle(w.events[a.event])}
                  disabled={!editable || !template?.isActive}
                  onClick={async () => { await commsApi.setAutomation(a.event, { isEnabled: !a.isEnabled }); onChanged(); }}
                  className={cn("relative h-7 w-12 rounded-full transition-colors disabled:opacity-50", a.isEnabled ? "bg-brand-800" : "bg-line")}
                >
                  <span aria-hidden className={cn("absolute top-1 size-5 rounded-full bg-white transition-all", a.isEnabled ? "start-6" : "start-1")} />
                </button>
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
              <Field label={w.template}>{(f) => (
                <Select {...f} value={a.templateId} disabled={!editable} onChange={async (e) => { await commsApi.setAutomation(a.event, { templateId: e.target.value }); onChanged(); }}>
                  {options.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isActive ? "" : ` (${t.status.inactive})`}</option>)}
                </Select>
              )}</Field>
              {template && <TemplatePreview template={template} />}
            </div>
            {!template?.isActive && <p className="text-xs text-st-review">{w.inactiveTemplate}</p>}
          </Card>
        );
      })}
    </div>
  );
}

const SAMPLE: Record<string, string> = { student: "Yusuf", teacher: "Ust. Kareem", time: "16:00 Cairo", meeting_url: "meet.example.com/kareem", old_time: "Tue 16:00", new_time: "Wed 17:00", lessons: "2", package: "Recitation 12" };

function TemplatePreview({ template }: { template: MessageTemplate }) {
  const { t } = useI18n();
  const parts = template.body.split(/(\{\{\w+\}\})/g);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-secondary">{t.whatsapp.preview}</span>
      <div dir={template.language === "ar" ? "rtl" : "ltr"} lang={template.language} className="self-start rounded-2xl rounded-ss-sm bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800">
        {parts.map((part, i) => {
          const m = part.match(/^\{\{(\w+)\}\}$/);
          return m ? <mark key={i} className="rounded bg-brand-100 px-0.5 text-brand-800">{SAMPLE[m[1]] ?? m[1]}</mark> : <React.Fragment key={i}>{part}</React.Fragment>;
        })}
      </div>
    </div>
  );
}

function Templates({ data, onChanged }: { data: WhatsAppData; onChanged: () => void }) {
  const { t } = useI18n();
  const w = t.whatsapp;
  const { can } = useAccess();
  const [editing, setEditing] = useState<MessageTemplate | "new" | null>(null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InfoNote className="max-w-2xl">{w.templatesNote}</InfoNote>
        <Button variant="primary" locked={!can("manage_settings")} onClick={() => setEditing("new")}>{w.newTemplate}</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.templates.map((tpl) => (
          <Card key={tpl.id} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{tpl.name}</h3>
                <p className="text-xs text-muted">{w.providerId}: <code>{tpl.providerTemplate}</code> · {t.languages[tpl.language]}</p>
              </div>
              <StatusBadge status={tpl.isActive ? "active" : "inactive"} size="sm" />
            </div>
            <TemplatePreview template={tpl} />
            <Button size="sm" className="self-start" locked={!can("manage_settings")} onClick={() => setEditing(tpl)}>{t.common.edit}</Button>
          </Card>
        ))}
      </div>
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </>
  );
}

function TemplateDialog({ template, onClose, onSaved }: { template: MessageTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const w = t.whatsapp;
  const [form, setForm] = useState<Omit<MessageTemplate, "id">>(template ?? { name: "", providerTemplate: "", language: "ar", body: "", isActive: true });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const variables = [...new Set(form.body.match(/\{\{(\w+)\}\}/g) ?? [])];
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={template ? w.editTemplate(template.name) : w.newTemplate}
      confirmLabel={t.common.save}
      canConfirm={!!form.name.trim() && !!form.providerTemplate.trim() && !!form.body.trim()}
      onConfirm={async () => { await commsApi.saveTemplate(form, template?.id); onSaved(); }}
      effects={[
        { label: w.variables, value: variables.length ? variables.join(" ") : "—" },
        { label: w.approval, value: w.approvalValue },
      ]}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={w.name} required>{(f) => <Input {...f} value={form.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label={w.providerId} required hint={w.providerHint}>{(f) => <Input {...f} dir="ltr" value={form.providerTemplate} onChange={(e) => set("providerTemplate", e.target.value)} />}</Field>
      </div>
      <Field label={t.studentProfile.language}>{(f) => (
        <Select {...f} value={form.language} onChange={(e) => set("language", e.target.value as Lang)}>
          <option value="ar">{t.languages.ar}</option>
          <option value="en">{t.languages.en}</option>
        </Select>
      )}</Field>
      <Field label={w.body} required hint={w.bodyHint}>{(f) => <Textarea {...f} dir={form.language === "ar" ? "rtl" : "ltr"} rows={4} value={form.body} onChange={(e) => set("body", e.target.value)} />}</Field>
      <Checkbox label={w.activeLabel} checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
    </ConfirmDialog>
  );
}
