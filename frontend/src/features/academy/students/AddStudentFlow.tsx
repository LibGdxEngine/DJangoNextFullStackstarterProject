"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Search, User, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useResource } from "@/hooks/useResource";
import { TIME_ZONES, formatMoney, zoneCity, zoneOffset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button } from "@/components/ds/Button";
import { Card, Eyebrow, KeyValue } from "@/components/ds/Card";
import { Stepper } from "@/components/ds/Stepper";
import { COUNTRY_CODES, ChoiceCard, Field, Input, PhoneInput, SearchInput, Select, Textarea } from "@/components/ds/Field";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { InfoNote } from "@/components/ds/Panels";
import { useAccess } from "../access";
import { academyApi } from "../api";
import type { Lang, Program } from "../types";

type FamilyMode = "existing" | "new" | "adult";

interface Draft {
  mode: FamilyMode;
  familyId: string;
  familyName: string;
  contactName: string;
  countryCode: string;
  phone: string;
  familyTimezone: string;
  familyLanguage: Lang;
  name: string;
  birthDate: string;
  language: Lang;
  timezone: string;
  program: Program;
  teacherId: string;
  packageId: string;
  note: string;
}

const DRAFT_KEY = "academy_add_student_draft";

const emptyDraft: Draft = {
  mode: "existing",
  familyId: "",
  familyName: "",
  contactName: "",
  countryCode: "+20",
  phone: "",
  familyTimezone: "Africa/Cairo",
  familyLanguage: "ar",
  name: "",
  birthDate: "",
  language: "ar",
  timezone: "",
  program: "memorization",
  teacherId: "",
  packageId: "",
  note: "",
};

export function AddStudentFlow() {
  const { t, tag } = useI18n();
  const f = t.addStudent;
  const router = useRouter();
  const { can } = useAccess();
  const { data: lookups, error, isLoading, reload } = useResource(() => academyApi.lookups());
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [familyQuery, setFamilyQuery] = useState("");
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DRAFT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved draft after mount.
      if (stored) setDraft({ ...emptyDraft, ...JSON.parse(stored) });
    } catch {
      // Ignore unreadable drafts.
    }
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const family = lookups?.families.find((x) => x.id === draft.familyId);
  const inheritedZone = draft.mode === "existing" ? family?.timezone : draft.familyTimezone;
  const zone = draft.timezone || inheritedZone || "";
  const phoneDigits = COUNTRY_CODES.find((c) => c.code === draft.countryCode)?.digits ?? 10;

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (step === 0) {
      if (draft.mode === "existing" && !draft.familyId) e.familyId = f.errors.pickFamily;
      if (draft.mode === "new" && !draft.familyName.trim()) e.familyName = f.errors.required;
      if (draft.mode !== "existing") {
        if (!draft.contactName.trim() && draft.mode === "new") e.contactName = f.errors.required;
        if (draft.phone.replace(/\s/g, "").length !== phoneDigits) e.phone = f.errors.phone(phoneDigits);
      }
    }
    if (step === 1) {
      if (draft.mode !== "adult" && !draft.name.trim()) e.name = f.errors.required;
      if (draft.mode === "adult" && !draft.contactName.trim()) e.contactName = f.errors.required;
      if (draft.birthDate && Number.isNaN(Date.parse(draft.birthDate))) e.birthDate = f.errors.date;
    }
    return e;
  }, [draft, step, f, phoneDigits]);

  const steps = [f.steps.family, f.steps.details, f.steps.program, f.steps.review];

  function next() {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // Storage unavailable.
    }
  }

  async function create() {
    setCreating(true);
    const isAdult = draft.mode === "adult";
    const student = await academyApi.createStudent({
      familyId: draft.familyId,
      newFamily: draft.mode === "existing" ? undefined : {
        name: isAdult ? draft.contactName : draft.familyName,
        timezone: draft.familyTimezone,
        language: draft.familyLanguage,
        contacts: [{ id: "c-new", name: draft.contactName, phone: `${draft.countryCode} ${draft.phone}`, relationship: isAdult ? "self" : "parent", receivesNotifications: true }],
      },
      teacherId: draft.teacherId || null,
      name: isAdult ? draft.contactName : draft.name,
      birthDate: draft.birthDate || null,
      isAdult,
      language: draft.language,
      timezone: zone || "Africa/Cairo",
      program: draft.program,
    });
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore.
    }
    router.push(`/manage/students/${student.id}`);
  }

  const err = (key: keyof Draft) => (showErrors ? errors[key] : undefined);

  if (!can("manage_people")) {
    return <ErrorState title={t.common.lockedForRole} />;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.students, href: "/manage/students" }, { label: f.title }]}
        breadcrumbLabel={t.common.breadcrumb}
        title={f.title}
        meta={f.meta}
      />
      <Card className="flex max-w-4xl flex-col gap-6 p-6">
        <Stepper steps={steps} current={step} label={f.progress} stepOf={t.common.stepOf} />
        {isLoading ? <LoadingState /> : error || !lookups ? <ErrorState title={t.common.errorTitle} onRetry={reload} /> : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (step === steps.length - 1) void create();
              else next();
            }}
            className="flex flex-col gap-5"
          >
            {showErrors && Object.keys(errors).length > 0 && (
              <div role="alert" className="rounded-[10px] border border-danger-border bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{f.errors.summary(Object.keys(errors).length)}</div>
            )}

            {step === 0 && (
              <>
                <fieldset className="grid gap-2 sm:grid-cols-3">
                  <legend className="mb-2 text-sm font-semibold">{f.familyQuestion}</legend>
                  <ChoiceCard name="mode" value="existing" checked={draft.mode === "existing"} onChange={() => set("mode", "existing")} icon={<Search aria-hidden className="size-4" />} title={f.linkExisting} description={f.linkExistingHint} />
                  <ChoiceCard name="mode" value="new" checked={draft.mode === "new"} onChange={() => set("mode", "new")} icon={<Home aria-hidden className="size-4" />} title={f.createFamily} description={f.createFamilyHint} />
                  <ChoiceCard name="mode" value="adult" checked={draft.mode === "adult"} onChange={() => set("mode", "adult")} icon={<User aria-hidden className="size-4" />} title={f.adult} description={f.adultHint} />
                </fieldset>

                {draft.mode === "existing" && (
                  <div className="flex flex-col gap-3">
                    <SearchInput label={f.searchFamilies} placeholder={f.searchFamiliesPlaceholder} value={familyQuery} onChange={(e) => setFamilyQuery(e.target.value)} className="sm:w-96" />
                    <div role="radiogroup" aria-label={f.familyList} aria-invalid={!!err("familyId")} className="grid gap-2 sm:grid-cols-2">
                      {lookups.families
                        .filter((x) => x.contacts[0]?.relationship !== "self")
                        .filter((x) => !familyQuery || [x.name, ...x.contacts.map((c) => `${c.name} ${c.phone}`)].join(" ").toLowerCase().includes(familyQuery.toLowerCase()))
                        .map((x) => (
                          <ChoiceCard
                            key={x.id}
                            name="family"
                            value={x.id}
                            checked={draft.familyId === x.id}
                            onChange={() => set("familyId", x.id)}
                            title={x.name}
                            description={<span className="tabular">{x.contacts[0]?.name} · <span dir="ltr">{x.contacts[0]?.phone}</span> · {zoneCity(x.timezone, tag)}</span>}
                          />
                        ))}
                    </div>
                    {err("familyId") && <p role="alert" className="text-xs text-danger">{err("familyId")}</p>}
                    <p className="text-xs text-muted">{f.notFound} <button type="button" className="font-medium text-brand-700 underline-offset-2 hover:underline" onClick={() => set("mode", "new")}>{f.createInstead}</button></p>
                  </div>
                )}

                {draft.mode !== "existing" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {draft.mode === "new" && (
                      <Field label={f.familyName} required error={err("familyName")}>
                        {(p) => <Input {...p} value={draft.familyName} onChange={(e) => set("familyName", e.target.value)} placeholder={f.familyNamePlaceholder} />}
                      </Field>
                    )}
                    <Field label={draft.mode === "adult" ? f.studentName : f.guardianName} required error={err("contactName")}>
                      {(p) => <Input {...p} value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} autoComplete="name" />}
                    </Field>
                    <Field label={draft.mode === "adult" ? f.phone : f.guardianPhone} required error={err("phone")} hint={f.phoneHint}>
                      {(p) => <PhoneInput countryCode={draft.countryCode} onCountryCodeChange={(v) => set("countryCode", v)} value={draft.phone} onChange={(v) => set("phone", v)} countryLabel={f.countryCode} fieldProps={p} />}
                    </Field>
                    <Field label={f.timezone} required hint={`${zoneCity(draft.familyTimezone, tag)} · ${zoneOffset(draft.familyTimezone)}`}>
                      {(p) => (
                        <Select {...p} value={draft.familyTimezone} onChange={(e) => set("familyTimezone", e.target.value)}>
                          {TIME_ZONES.map((z) => <option key={z} value={z}>{z} ({zoneOffset(z)})</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label={f.messageLanguage}>
                      {(p) => (
                        <Select {...p} value={draft.familyLanguage} onChange={(e) => set("familyLanguage", e.target.value as Lang)}>
                          <option value="ar">{t.languages.ar}</option>
                          <option value="en">{t.languages.en}</option>
                        </Select>
                      )}
                    </Field>
                  </div>
                )}
              </>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {draft.mode !== "adult" ? (
                  <Field label={f.fullName} required error={err("name")}>
                    {(p) => <Input {...p} value={draft.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />}
                  </Field>
                ) : (
                  <Field label={f.fullName} required error={err("contactName")}>
                    {(p) => <Input {...p} value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} />}
                  </Field>
                )}
                <Field label={f.birthDate} optionalLabel={t.common.optional} error={err("birthDate")} hint={f.birthDateHint}>
                  {(p) => <Input {...p} type="date" value={draft.birthDate} onChange={(e) => set("birthDate", e.target.value)} className="tabular" />}
                </Field>
                <Field label={f.timezone} required success={!draft.timezone && inheritedZone ? f.inherited(draft.mode === "existing" ? family?.name ?? "" : f.thisFamily) : undefined}>
                  {(p) => (
                    <Select {...p} value={zone} onChange={(e) => set("timezone", e.target.value)}>
                      {TIME_ZONES.map((z) => <option key={z} value={z}>{z} ({zoneOffset(z)})</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={f.lessonLanguage}>
                  {(p) => (
                    <Select {...p} value={draft.language} onChange={(e) => set("language", e.target.value as Lang)}>
                      <option value="ar">{t.languages.ar}</option>
                      <option value="en">{t.languages.en}</option>
                    </Select>
                  )}
                </Field>
                <Field label={f.internalNote} optionalLabel={t.notes.staffOnly} className="sm:col-span-2">
                  {(p) => <Textarea {...p} rows={2} value={draft.note} onChange={(e) => set("note", e.target.value)} />}
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={f.program} required>
                  {(p) => (
                    <Select {...p} value={draft.program} onChange={(e) => set("program", e.target.value as Program)}>
                      {(Object.keys(t.programs) as Program[]).map((k) => <option key={k} value={k}>{t.programs[k]}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={f.teacher} optionalLabel={f.canAssignLater} hint={draft.teacherId ? f.teacherZone(zoneCity(lookups.teachers.find((x) => x.id === draft.teacherId)!.timezone, tag)) : undefined}>
                  {(p) => (
                    <Select {...p} value={draft.teacherId} onChange={(e) => set("teacherId", e.target.value)}>
                      <option value="">{t.status.unassigned}</option>
                      {lookups.teachers.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.specialties.map((s) => t.programs[s]).join(", ")}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={f.package} optionalLabel={f.canEnrollLater} className="sm:col-span-2">
                  {(p) => (
                    <Select {...p} value={draft.packageId} onChange={(e) => set("packageId", e.target.value)}>
                      <option value="">{f.noPackage}</option>
                      {lookups.packages.map((x) => <option key={x.id} value={x.id}>{x.name} · {f.packageSummary(x.lessonCount, x.durationMinutes)} · {formatMoney(x.price, x.currency, tag)}</option>)}
                    </Select>
                  )}
                </Field>
                <InfoNote className="sm:col-span-2">{f.packageNote}</InfoNote>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft p-4">
                  <Eyebrow>{f.steps.family}</Eyebrow>
                  <KeyValue label={f.familyMode}>{draft.mode === "existing" ? f.linkExisting : draft.mode === "new" ? f.createFamily : f.adult}</KeyValue>
                  <KeyValue label={f.familyName}>{draft.mode === "existing" ? family?.name : draft.mode === "new" ? draft.familyName : draft.contactName}</KeyValue>
                  {draft.mode !== "existing" && <KeyValue label={f.phone}><span dir="ltr" className="tabular">{draft.countryCode} {draft.phone}</span></KeyValue>}
                </section>
                <section className="flex flex-col gap-2.5 rounded-xl border border-line-soft p-4">
                  <Eyebrow>{f.steps.details}</Eyebrow>
                  <KeyValue label={f.fullName}>{draft.mode === "adult" ? draft.contactName : draft.name}</KeyValue>
                  <KeyValue label={f.timezone}>{zoneCity(zone, tag)} ({zoneOffset(zone)})</KeyValue>
                  <KeyValue label={f.program}>{t.programs[draft.program]}</KeyValue>
                  <KeyValue label={f.teacher}>{lookups.teachers.find((x) => x.id === draft.teacherId)?.name ?? <span className="text-st-review">{t.status.unassigned}</span>}</KeyValue>
                  <KeyValue label={f.package}>{lookups.packages.find((x) => x.id === draft.packageId)?.name ?? f.noPackage}</KeyValue>
                </section>
                <InfoNote className="sm:col-span-2">{draft.packageId ? f.reviewWithPackage : f.reviewNoPackage}</InfoNote>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
              <Button variant="tertiary" onClick={() => (step === 0 ? router.push("/manage/students") : setStep(step - 1))}>
                <span aria-hidden className="rtl:-scale-x-100">←</span> {step === 0 ? t.common.cancel : t.common.back}
              </Button>
              <div className="flex items-center gap-2">
                <span role="status" className={cn("text-xs text-success transition-opacity", saved ? "opacity-100" : "opacity-0")}>{f.draftSaved}</span>
                <Button onClick={saveDraft}>{t.common.saveDraft}</Button>
                <Button type="submit" variant="primary" disabled={creating} icon={step === steps.length - 1 ? <UserPlus aria-hidden className="size-4" /> : undefined}>
                  {step === steps.length - 1 ? (creating ? t.common.working : f.create) : t.common.continue}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
