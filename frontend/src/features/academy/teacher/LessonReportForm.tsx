"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, CornerDownRight, Lock, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { formatDay, formatNumber, formatTime, zoneCity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ds/Field";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { NoteCard, InfoNote } from "@/components/ds/Panels";
import { MultiZoneTimes } from "@/components/ds/Time";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { useAccess } from "../access";
import { SURAHS, ayahCount, surahName } from "../quran";
import { teacherApi, type ProgressInput, type ReportContext } from "../teacher-api";
import { teachers } from "../fixtures";
import { SurahRef } from "../progress/ProgressTimeline";
import type { QuranProgress } from "../types";

type Attendance = "present" | "late" | "absent";

export function LessonReportForm({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = useResource(() => teacherApi.reportContext(sessionId), [sessionId]);
  if (isLoading) return <LoadingState rows={10} />;
  if (error || !data) return <ErrorState title={t.report.loadError} onRetry={reload} />;
  if (data.record) return <SubmittedReport data={data} />;
  return <ReportEditor data={data} />;
}

function Header({ data }: { data: ReportContext }) {
  const { t, tag } = useI18n();
  const { session } = data;
  const teacherZone = session.teacherTimezone;
  return (
    <>
      <Link href="/teacher" className="inline-flex h-11 items-center gap-1 self-start text-[13px] font-medium text-brand-700">
        <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />{t.teacherNav.today}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">{t.report.title}</h1>
        <p className="text-[15px] font-medium">{session.studentName}</p>
        <p className="text-xs text-muted tabular">{formatDay(session.startsAt, teacherZone, tag)} · {formatTime(session.startsAt, teacherZone, tag)}–{formatTime(session.endsAt, teacherZone, tag)} {zoneCity(teacherZone, tag)}</p>
      </div>
    </>
  );
}

const emptyEntry = (activity: QuranProgress["activity"], rating: QuranProgress["rating"]): ProgressInput => ({ activity, surah: 0, ayahFrom: 1, ayahTo: 1, rating });

function ReportEditor({ data }: { data: ReportContext }) {
  const { t, tag, locale } = useI18n();
  const r = t.report;
  const router = useRouter();
  const { userName } = useAccess();
  const { session, preferences, continueFrom, lastProgress } = data;
  const remembered = preferences.remembered;
  const duration = Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000);
  const authorName = teachers.find((x) => x.id === session.teacherId)?.name ?? userName;
  const audience = session.isAdult ? t.notes.visibleToStudent : t.notes.visibleToParent;

  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [lateMinutes, setLateMinutes] = useState(5);
  const [actualMinutes, setActualMinutes] = useState(duration);
  const [entries, setEntries] = useState<ProgressInput[]>(() => [
    continueFrom
      ? { activity: remembered.activity ?? "memorization", surah: continueFrom.surah, ayahFrom: continueFrom.ayah, ayahTo: Math.min(ayahCount(continueFrom.surah), continueFrom.ayah + 7), rating: remembered.rating ?? 4 }
      : emptyEntry(remembered.activity ?? "memorization", remembered.rating ?? 4),
  ]);
  const [familyNotes, setFamilyNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [homework, setHomework] = useState("");
  const [saveReusable, setSaveReusable] = useState(false);
  const [reusable, setReusable] = useState(preferences.reusableNotes);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // Teaching minutes follow the late arrival unless the teacher edits them.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived default that stays editable.
    setActualMinutes(attendance === "late" ? Math.max(0, duration - lateMinutes) : duration);
  }, [attendance, lateMinutes, duration]);

  const attended = attendance === "present" || attendance === "late";
  const entryErrors = entries.map((e) => {
    if (!e.surah) return r.errors.surah;
    const max = ayahCount(e.surah);
    if (e.ayahFrom < 1 || e.ayahTo < e.ayahFrom || e.ayahTo > max) return r.errors.ayahs(max);
    return null;
  });
  const errors = {
    attendance: !attendance ? r.errors.attendance : null,
    progress: attended && entries.length === 0 ? r.errors.progress : null,
    note: attended && !familyNotes.trim() ? r.errors.note : null,
  };
  const invalid = Object.values(errors).some(Boolean) || (attended && entryErrors.some(Boolean));

  const update = (i: number, patch: Partial<ProgressInput>) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      setShowErrors(true);
      return;
    }
    setConfirming(true);
  }

  async function save() {
    await teacherApi.submitReport(session.id, {
      attendance: attendance!,
      actualMinutes,
      lateMinutes,
      progress: attended ? entries : [],
      familyNotes: familyNotes.trim(),
      internalNotes: internalNotes.trim(),
      homework: homework.trim(),
      saveNoteAsReusable: saveReusable,
    }, authorName);
    router.push(`/teacher?reported=${encodeURIComponent(session.studentName)}`);
  }

  function insertNote(note: string) {
    setFamilyNotes((v) => (v.trim() ? `${v.trim()} ${note}` : note));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Header data={data} />
      <MultiZoneTimes iso={session.startsAt} zones={[{ role: t.zones.you, timeZone: session.teacherTimezone }, { role: session.isAdult ? t.zones.student : t.zones.family, timeZone: session.studentTimezone }]} />

      {showErrors && invalid && <div role="alert" className="rounded-[10px] border border-danger-border bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{r.errors.summary}</div>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">{r.attendance} <span aria-hidden className="text-danger">*</span></legend>
        <div role="radiogroup" aria-label={r.attendance} className="grid grid-cols-3 gap-2">
          {(["present", "late", "absent"] as Attendance[]).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={attendance === a}
              onClick={() => setAttendance(a)}
              className={cn(
                "h-12 rounded-xl border text-sm font-semibold",
                attendance === a
                  ? a === "absent" ? "border-st-action bg-st-action-bg text-st-action" : "border-brand-800 bg-brand-800 text-white"
                  : "border-line bg-surface text-ink",
              )}
            >
              {t.status[a]}
            </button>
          ))}
        </div>
        {showErrors && errors.attendance && <p className="text-xs text-danger">{errors.attendance}</p>}
        {attendance === "late" && (
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[13px] font-medium text-secondary">{r.lateBy}</span>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15, 20].map((m) => (
                <button key={m} type="button" aria-pressed={lateMinutes === m} onClick={() => setLateMinutes(m)} className={cn("h-11 min-w-16 rounded-full border px-4 text-[13px] font-medium", lateMinutes === m ? "border-brand-800 bg-brand-50 text-brand-800" : "border-line bg-surface")}>
                  {t.recurring.minutes(m)}
                </button>
              ))}
            </div>
          </div>
        )}
        {attended && (
          <Field label={r.taught} hint={r.taughtHint(duration)}>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={duration + 30} value={actualMinutes} onChange={(e) => setActualMinutes(Number(e.target.value))} className="h-11 w-28 tabular" />}
          </Field>
        )}
        {attendance === "absent" && <InfoNote>{r.absentInfo}</InfoNote>}
      </fieldset>

      {attended && (
        <section aria-labelledby="progress-h" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="progress-h" className="text-sm font-semibold">{r.progress}</h2>
            {lastProgress && <span className="text-xs text-muted">{r.last}: <SurahRef entry={lastProgress} /></span>}
          </div>
          {entries.map((entry, i) => (
            <ProgressEntry
              key={i}
              index={i}
              entry={entry}
              error={showErrors ? entryErrors[i] : null}
              onChange={(patch) => update(i, patch)}
              onRemove={entries.length > 1 ? () => setEntries((list) => list.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            {continueFrom && (
              <Button size="md" className="h-11" icon={<CornerDownRight aria-hidden className="size-4 rtl:-scale-x-100" />} onClick={() => update(0, { surah: continueFrom.surah, ayahFrom: continueFrom.ayah, ayahTo: Math.min(ayahCount(continueFrom.surah), continueFrom.ayah + 7) })}>
                {r.continueFrom(surahName(continueFrom.surah, locale), formatNumber(continueFrom.ayah, tag))}
              </Button>
            )}
            <Button size="md" className="h-11" icon={<Plus aria-hidden className="size-4" />} onClick={() => setEntries((list) => [...list, { ...emptyEntry("revision", remembered.rating ?? 4), surah: lastProgress?.surah ?? 0, ayahFrom: lastProgress?.ayahFrom ?? 1, ayahTo: lastProgress?.ayahTo ?? 1 }])}>
              {r.addRevision}
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="family-h" className="flex flex-col gap-2">
        <h2 id="family-h" className="text-sm font-semibold">{r.familyNote(audience)} {attended && <span aria-hidden className="text-danger">*</span>}</h2>
        {reusable.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">{r.reusable}</span>
            <ul className="flex flex-wrap gap-2">
              {reusable.map((note) => (
                <li key={note} className="flex max-w-full items-stretch overflow-hidden rounded-full border border-brand-100 bg-brand-50 text-[13px] text-brand-800">
                  <button type="button" onClick={() => insertNote(note)} className="min-h-11 truncate px-3 text-start" title={note}>{note}</button>
                  <button type="button" aria-label={r.removeReusable(note)} onClick={async () => { await teacherApi.removeReusableNote(note); setReusable((list) => list.filter((n) => n !== note)); }} className="flex w-9 shrink-0 items-center justify-center border-s border-brand-100 hover:bg-brand-100">
                    <X aria-hidden className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label={<span className="sr-only">{r.familyNote(audience)}</span>} error={showErrors ? errors.note : undefined} hint={r.familyHint}>
          {(p) => <Textarea {...p} rows={3} value={familyNotes} onChange={(e) => setFamilyNotes(e.target.value)} className="border-brand-300 bg-brand-50/60" />}
        </Field>
        <Checkbox label={r.saveReusable} checked={saveReusable} onChange={(e) => setSaveReusable(e.target.checked)} className="min-h-11" />
      </section>

      {attended && (
        <section className="flex flex-col gap-2">
          <Field label={r.homework} optionalLabel={t.common.optional}>
            {(p) => <Input {...p} value={homework} onChange={(e) => setHomework(e.target.value)} className="h-11" />}
          </Field>
          {remembered.homework && homework !== remembered.homework && (
            <button type="button" onClick={() => setHomework(remembered.homework!)} className="min-h-11 self-start rounded-full border border-line bg-surface px-3 text-start text-[13px]">
              {r.useLast}: <span className="font-medium">{remembered.homework}</span>
            </button>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-line-soft bg-surface p-3.5">
        <Field label={<span className="inline-flex items-center gap-1.5"><Lock aria-hidden className="size-3.5" />{t.notes.internal}</span>} optionalLabel={t.notes.staffOnly} hint={t.notes.internalHint}>
          {(p) => <Textarea {...p} rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />}
        </Field>
      </section>

      <div className="sticky bottom-[84px] z-10 -mx-4 border-t border-line-soft bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-xl md:border">
        <Button type="submit" variant="primary" size="lg" className="w-full">{r.submit}</Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        title={r.confirmTitle}
        context={session.studentName}
        confirmLabel={r.submit}
        effects={attended ? [
          { label: r.effectStatus, value: t.status.completed },
          { label: r.effectBalance, value: r.minusOne, tone: "negative" },
          { label: r.effectEarnings, value: r.recorded, tone: "positive" },
          { label: r.effectFamily, value: r.familySees(entries.length) },
        ] : [
          { label: r.effectStatus, value: t.status.needs_review },
          { label: r.effectBalance, value: r.academyDecides },
          { label: r.effectEarnings, value: r.academyDecides },
          { label: r.effectFamily, value: familyNotes.trim() ? r.noteOnly : r.nothingYet },
        ]}
      />
    </form>
  );
}

function ProgressEntry({ index, entry, error, onChange, onRemove }: { index: number; entry: ProgressInput; error: string | null; onChange: (patch: Partial<ProgressInput>) => void; onRemove?: () => void }) {
  const { t, tag, locale } = useI18n();
  const r = t.report;
  const max = entry.surah ? ayahCount(entry.surah) : null;
  return (
    <fieldset className={cn("flex flex-col gap-3 rounded-2xl border bg-surface p-3.5", error ? "border-danger" : "border-line-soft")}>
      <legend className="sr-only">{r.entry(index + 1)}</legend>
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label={r.activity} className="flex flex-wrap gap-1.5">
          {(["memorization", "revision", "recitation"] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={entry.activity === a} onClick={() => onChange({ activity: a })} className={cn("h-10 rounded-full border px-3 text-[13px] font-medium", entry.activity === a ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-surface")}>
              {t.quran.activity[a]}
            </button>
          ))}
        </div>
        {onRemove && (
          <button type="button" aria-label={r.removeEntry(index + 1)} onClick={onRemove} className="inline-flex size-10 items-center justify-center rounded-[10px] text-muted hover:bg-page">
            <Trash2 aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <Field label={r.surah}>
        {(p) => (
          <Select {...p} value={entry.surah || ""} onChange={(e) => onChange({ surah: Number(e.target.value), ayahFrom: 1, ayahTo: Math.min(ayahCount(Number(e.target.value)), 5) })} className="[&_select]:h-11">
            <option value="">{t.common.choose}</option>
            {SURAHS.map((_, i) => <option key={i + 1} value={i + 1}>{formatNumber(i + 1, tag)} · {surahName(i + 1, locale)}</option>)}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={r.ayahFrom}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={max ?? undefined} value={entry.ayahFrom} onChange={(e) => onChange({ ayahFrom: Number(e.target.value) })} className="h-11 tabular" />}
        </Field>
        <Field label={r.ayahTo}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={entry.ayahFrom} max={max ?? undefined} value={entry.ayahTo} onChange={(e) => onChange({ ayahTo: Number(e.target.value) })} className="h-11 tabular" />}
        </Field>
      </div>
      {max && !error && <p className="-mt-1 text-xs text-muted">{r.surahHas(surahName(entry.surah, locale), formatNumber(max, tag))}</p>}
      {error && <p role="alert" className="-mt-1 text-xs text-danger">{error}</p>}
      <div role="radiogroup" aria-label={r.rating} className="flex items-center gap-1">
        <span className="me-2 text-[13px] font-medium text-secondary">{r.rating}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={entry.rating === n} aria-label={t.quran.rating(n)} onClick={() => onChange({ rating: n as QuranProgress["rating"] })} className={cn("inline-flex size-11 items-center justify-center rounded-[10px] text-xl", n <= entry.rating ? "text-accent-600" : "text-line")}>
            ★
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SubmittedReport({ data }: { data: ReportContext }) {
  const { t, tag } = useI18n();
  const record = data.record!;
  return (
    <>
      <Header data={data} />
      <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-surface p-4">
        <p className="text-[13px] text-success">{t.report.submittedOn(formatDay(record.submittedAt, data.session.teacherTimezone, tag))}</p>
        <NoteCard visibility="family">{record.familyNotes || "—"}</NoteCard>
        {record.homework && <p className="text-[13px]"><span className="text-muted">{t.report.homework}:</span> {record.homework}</p>}
        {record.internalNotes && <NoteCard visibility="internal">{record.internalNotes}</NoteCard>}
        <p className="text-xs text-muted">{t.report.editHint}</p>
      </div>
    </>
  );
}
