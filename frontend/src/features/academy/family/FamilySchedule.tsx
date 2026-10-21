"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/hooks/useNow";
import { useResource } from "@/hooks/useResource";
import { formatDay, formatNumber, formatTime, wallTime, zoneCity, zonedParts, zonedTimeToUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/Button";
import { Badge, StatusBadge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Field, Input } from "@/components/ds/Field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { useFamilyChild } from "@/components/shells/FamilyShell";
import { familyApi, policyEffect } from "../family-api";
import { enrollments } from "../fixtures";
import type { SessionRow } from "../types";

export function FamilySchedule() {
  const { t, tag } = useI18n();
  const fs = t.familySchedule;
  const params = useSearchParams();
  const now = useNow(60_000);
  const { familyId, childId, isAdultAccount } = useFamilyChild();
  const { data, error, isLoading, reload } = useResource(() => familyApi.schedule(familyId), [familyId]);
  const [selected, setSelected] = useState<{ session: SessionRow; kind: "cancel" | "reschedule" } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const focus = params.get("session");

  const rows = useMemo(() => (data?.sessions ?? []).filter((s) => childId === "all" || s.studentId === childId), [data, childId]);
  if (isLoading) return <LoadingState rows={8} />;
  if (error || !data) return <ErrorState title={t.common.errorTitle} onRetry={reload} />;

  const upcoming = rows.filter((s) => new Date(s.endsAt).getTime() > now && s.status !== "cancelled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = rows.filter((s) => new Date(s.endsAt).getTime() <= now || s.status === "cancelled").sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 8);
  const requestFor = (id: string) => data.requests.find((r) => r.sessionId === id && r.status === "pending");
  const zone = data.family.timezone;

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{t.familyNav.schedule}</h1>
        <span className="text-[13px] text-muted">{t.teacherSchedule.timesIn(zoneCity(zone, tag))}</span>
      </div>
      <p className="rounded-xl border border-line-soft bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-secondary">
        {fs.policy(data.policy.cancellationHours, data.policy.lateCancelDeduct, isAdultAccount)}
      </p>
      {sent && <p role="status" className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800"><CheckCircle2 aria-hidden className="size-4 shrink-0" />{sent}</p>}

      <section aria-labelledby="upcoming" className="flex flex-col gap-2">
        <h2 id="upcoming" className="text-sm font-semibold">{fs.upcoming}</h2>
        {upcoming.length === 0 ? <EmptyState icon={<CalendarDays aria-hidden className="size-[22px]" />} title={t.studentProfile.noUpcoming} /> : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((s) => {
              const request = requestFor(s.id);
              const started = new Date(s.startsAt).getTime() <= now;
              return (
                <li key={s.id} className={cn("flex flex-col gap-2 rounded-2xl border bg-surface p-4", focus === s.id ? "border-brand-800 ring-1 ring-brand-800" : "border-line-soft")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5 tabular">
                      <span className="text-[15px] font-semibold">{formatDay(s.startsAt, zone, tag)} · {formatTime(s.startsAt, zone, tag)} <span className="text-xs font-normal text-muted">{zoneCity(zone, tag)}</span></span>
                      <span className="text-xs text-muted">
                        {childId === "all" && !isAdultAccount ? `${s.studentName} · ` : ""}{s.teacherName}
                        {s.teacherTimezone !== zone && ` · ${fs.theirTime(formatTime(s.startsAt, s.teacherTimezone, tag), zoneCity(s.teacherTimezone, tag))}`}
                      </span>
                    </div>
                    {request ? <Badge tone="pending" size="sm">{fs.requested[request.kind]}</Badge> : <StatusBadge status="scheduled" size="sm" />}
                  </div>
                  {!request && !started && (
                    <div className="flex gap-2">
                      <Button className="h-11 flex-1 rounded-xl" onClick={() => setSelected({ session: s, kind: "reschedule" })}>{fs.reschedule}</Button>
                      <Button variant="danger" className="h-11 flex-1 rounded-xl" onClick={() => setSelected({ session: s, kind: "cancel" })}>{fs.cancel}</Button>
                    </div>
                  )}
                  {request && <p className="text-xs text-muted">{fs.waiting}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past" className="flex flex-col gap-2">
          <h2 id="past" className="text-sm font-semibold">{fs.recent}</h2>
          <ul className="flex flex-col divide-y divide-subtle rounded-2xl border border-line-soft bg-surface">
            {past.map((s) => (
              <li key={s.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13px] tabular">
                <span>{formatDay(s.startsAt, zone, tag)} · {formatTime(s.startsAt, zone, tag)}</span>
                <StatusBadge status={s.status === "completed" ? s.attendance : s.status === "scheduled" ? "pending" : s.status} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <RequestDialog
          session={selected.session}
          kind={selected.kind}
          zone={zone}
          isAdult={isAdultAccount}
          requestedBy={data.family.contacts[0]?.name ?? ""}
          onClose={() => setSelected(null)}
          onSent={(message) => { setSent(message); reload(); }}
        />
      )}
    </>
  );
}

/** The policy effect is shown before the family submits — never discovered afterwards. */
function RequestDialog({ session, kind, zone, isAdult, requestedBy, onClose, onSent }: {
  session: SessionRow;
  kind: "cancel" | "reschedule";
  zone: string;
  isAdult: boolean;
  requestedBy: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const { t, tag } = useI18n();
  const fs = t.familySchedule;
  const now = useNow(30_000);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => zonedParts(new Date(new Date(session.startsAt).getTime() + 86_400_000).toISOString(), zone).dateKey);
  const [time, setTime] = useState(() => wallTime(session.startsAt, zone));
  const effect = policyEffect(session.id, kind, now);
  const balance = enrollments.find((e) => e.id === session.enrollmentId)?.balance ?? 0;
  const first = session.studentName.split(" ")[0];
  const proposed = kind === "reschedule" && date && time ? zonedTimeToUtc(date, time, zone).toISOString() : undefined;
  const proposedInPast = proposed ? new Date(proposed).getTime() < now : false;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone={kind === "cancel" ? "danger" : "primary"}
      title={kind === "cancel" ? fs.cancelTitle : fs.rescheduleTitle}
      context={`${isAdult ? "" : `${session.studentName} · `}${formatDay(session.startsAt, zone, tag)} ${formatTime(session.startsAt, zone, tag)} ${zoneCity(zone, tag)}`}
      confirmLabel={fs.send}
      cancelLabel={fs.keep}
      canConfirm={reason.trim().length > 0 && (kind === "cancel" || (!!proposed && !proposedInPast))}
      onConfirm={async () => {
        await familyApi.requestChange(session.id, kind, reason.trim(), requestedBy, proposed);
        onSent(fs.sent);
      }}
      effects={[
        { label: fs.notice, value: fs.noticeValue(formatNumber(Math.floor(effect.hoursNotice), tag), effect.late), tone: effect.late ? "negative" : "plain" },
        kind === "cancel"
          ? { label: fs.balance, value: effect.deducts ? fs.usesLesson(isAdult ? null : first, formatNumber(balance, tag), formatNumber(balance - 1, tag)) : fs.noLesson, tone: effect.deducts ? "negative" : "positive" }
          : { label: fs.balance, value: effect.late ? fs.lateReschedule : fs.noLesson, tone: effect.late ? "negative" : "positive" },
        { label: fs.next, value: fs.academyConfirms },
      ]}
    >
      {kind === "reschedule" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={fs.preferredDate}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 tabular" />}</Field>
          <Field label={fs.preferredTime} hint={zoneCity(zone, tag)} error={proposedInPast ? t.sessionDialogs.inPast : undefined}>{(p) => <Input {...p} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="h-11 tabular" />}</Field>
        </div>
      )}
      <Field label={fs.reason} required hint={fs.reasonHint}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} className="h-11" />}
      </Field>
    </ConfirmDialog>
  );
}
