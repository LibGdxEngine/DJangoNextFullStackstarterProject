"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/PageHeader";
import { Button, ButtonLink } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { Stepper } from "@/components/ds/Stepper";
import { Select } from "@/components/ds/Field";
import { Badge } from "@/components/ds/StatusBadge";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { InfoNote } from "@/components/ds/Panels";
import { ErrorState } from "@/components/ds/States";
import { useAccess } from "../access";
import { guessMapping, IMPORT_FIELDS, importApi, REQUIRED_FIELDS, validateRows, type ImportField, type ValidatedRow } from "../admin-api";

type Step = 0 | 1 | 2 | 3 | 4 | 5;

const TEMPLATE_HEADERS = ["Student name", "Family name", "Guardian name", "Phone", "Time zone", "Date of birth", "Program", "Teacher", "Package"];

const SAMPLE_COLUMNS = ["Student", "Family", "Parent", "WhatsApp", "Time zone", "DOB", "Program", "Teacher", "Package"];
const SAMPLE_ROWS: Record<string, string>[] = [
  { Student: "Hana Ahmed", Family: "Ahmed family", Parent: "Mahmoud Ahmed", WhatsApp: "+20 102 345 6789", "Time zone": "Africa/Cairo", DOB: "2018-04-02", Program: "Qaida", Teacher: "Bilal", Package: "Qaida 8" },
  { Student: "Khaled Nasser", Family: "Nasser family", Parent: "Amal Nasser", WhatsApp: "+971 50 555 0190", "Time zone": "Asia/Dubai", DOB: "2014-09-12", Program: "Hifz", Teacher: "Kareem", Package: "Memorization 8" },
  { Student: "Lina Nasser", Family: "Nasser family", Parent: "Amal Nasser", WhatsApp: "+971 50 555 0190", "Time zone": "Asia/Dubai", DOB: "2016-01-30", Program: "Recitation", Teacher: "Huda", Package: "Tajweed 12" },
  { Student: "Ali Karim", Family: "Karim family", Parent: "Rami Karim", WhatsApp: "0100 123", "Time zone": "Africa/Cairo", DOB: "2015-06-10", Program: "Memorization", Teacher: "Kareem", Package: "Recitation 12" },
  { Student: "", Family: "Saeed family", Parent: "Noha Saeed", WhatsApp: "+20 111 444 5566", "Time zone": "Africa/Cairo", DOB: "", Program: "Tajweed", Teacher: "", Package: "" },
  { Student: "Sami Haddad", Family: "Haddad family", Parent: "Rana Haddad", WhatsApp: "+44 7700 900777", "Time zone": "Europe/Paris-ish", DOB: "2013-11-21", Program: "Tajweed", Teacher: "Huda", Package: "" },
  { Student: "Mariam Yousef", Family: "", Parent: "", WhatsApp: "+1 416 555 0144", "Time zone": "America/Toronto", DOB: "", Program: "Tajweed", Teacher: "Ustadh Musa", Package: "Tajweed 12" },
  { Student: "Yahya Fathy", Family: "Fathy family", Parent: "Dina Fathy", WhatsApp: "+20 122 555 7788", "Time zone": "Africa/Cairo", DOB: "2017-03-03", Program: "Qaida", Teacher: "Bilal", Package: "Qaida 8" },
];

/** Minimal CSV parser (quoted fields, commas, CRLF). Excel files are parsed server-side. */
function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      record.push(field);
      if (record.some((v) => v.trim())) records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field);
  if (record.some((v) => v.trim())) records.push(record);
  const [header = [], ...body] = records;
  const columns = header.map((h) => h.trim());
  return { columns, rows: body.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()]))) };
}

function csvDownload(name: string, header: string[], rows: string[][]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const url = URL.createObjectURL(new Blob(["﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportFlow() {
  const { t, tag } = useI18n();
  const im = t.importFlow;
  const { can } = useAccess();
  const [step, setStep] = useState<Step>(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [usedSample, setUsedSample] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ families: number; students: number; linked: number; skipped: ValidatedRow[] } | null>(null);
  const validated = useMemo(() => (step >= 2 ? validateRows(rows, mapping) : []), [rows, mapping, step]);
  const counts = {
    ok: validated.filter((r) => r.action !== "skip" && r.warnings.length === 0).length,
    warnings: validated.filter((r) => r.action !== "skip" && r.warnings.length > 0).length,
    errors: validated.filter((r) => r.action === "skip").length,
  };
  const steps = [im.steps.upload, im.steps.map, im.steps.validate, im.steps.preview, im.steps.import, im.steps.results];
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);

  if (!can("import")) return <ErrorState title={t.common.lockedForRole} />;

  function load(cols: string[], data: Record<string, string>[], name: string, sample: boolean) {
    setColumns(cols);
    setRows(data);
    setMapping(guessMapping(cols));
    setFileName(name);
    setUsedSample(sample);
    setUploadError(null);
    setStep(1);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (/\.csv$/i.test(file.name)) {
      const parsed = parseCsv(await file.text());
      if (!parsed.columns.length || !parsed.rows.length) {
        setUploadError(im.emptyFile);
        return;
      }
      load(parsed.columns, parsed.rows, file.name, false);
    } else if (/\.xlsx?$/i.test(file.name)) {
      // The backend ImportJob parses Excel; this preview build loads sample rows for .xlsx files.
      load(SAMPLE_COLUMNS, SAMPLE_ROWS, file.name, true);
    } else {
      setUploadError(im.badType);
    }
  }

  const errorReport = (list: ValidatedRow[]) => csvDownload("import-errors.csv", [im.row, ...TEMPLATE_HEADERS, im.problems],
    list.filter((r) => r.errors.length || r.warnings.length).map((r) => [String(r.index + 2), ...IMPORT_FIELDS.map((f) => r.values[f] ?? ""), [...r.errors, ...r.warnings].map((c) => im.codes[c as keyof typeof im.codes] ?? c).join("; ")]));

  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: t.nav.students, href: "/manage/students" }, { label: im.title }]} breadcrumbLabel={t.common.breadcrumb} title={im.title} meta={im.meta} />
      <Card className="flex flex-col gap-6 p-6">
        <Stepper steps={steps} current={step} label={im.title} stepOf={t.common.stepOf} />

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line-dashed bg-page px-6 py-12 text-center hover:border-brand-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-info"
            >
              <span className="flex size-12 items-center justify-center rounded-[14px] bg-brand-100 text-brand-800"><FileSpreadsheet aria-hidden className="size-6" /></span>
              <span className="text-sm font-semibold">{im.drop}</span>
              <span className="text-xs text-muted">{im.accepted}</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
              <span className="mt-1 inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-800 px-4 text-sm font-medium text-white"><Upload aria-hidden className="size-4" />{im.choose}</span>
            </label>
            {uploadError && <p role="alert" className="text-[13px] text-danger">{uploadError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button icon={<Download aria-hidden className="size-4" />} onClick={() => csvDownload("students-template.csv", TEMPLATE_HEADERS, [["Yusuf Ahmed", "Ahmed family", "Mahmoud Ahmed", "+20 102 345 6789", "Africa/Cairo", "2017-03-14", "Memorization", "Kareem", "Recitation 12"]])}>{im.template}</Button>
              <Button variant="tertiary" onClick={() => load(SAMPLE_COLUMNS, SAMPLE_ROWS, "sample-students.xlsx", true)}>{im.useSample}</Button>
            </div>
            <InfoNote>{im.uploadNote}</InfoNote>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-secondary">{im.mapIntro(fileName ?? "", rows.length)}</p>
            {usedSample && <InfoNote>{im.sampleNote}</InfoNote>}
            <div className="overflow-x-auto rounded-xl border border-line-soft">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">{im.steps.map}</caption>
                <thead>
                  <tr className="bg-page text-xs text-secondary">
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.field}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.column}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.example}</th>
                  </tr>
                </thead>
                <tbody>
                  {IMPORT_FIELDS.map((field) => (
                    <tr key={field} className="border-t border-subtle">
                      <th scope="row" className="px-4 py-2.5 text-start font-medium">{im.fields[field]}{REQUIRED_FIELDS.includes(field) && <span aria-hidden className="text-danger"> *</span>}</th>
                      <td className="px-4 py-2">
                        <Select aria-label={im.fields[field]} value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })} className="w-56">
                          <option value="">{im.notImported}</option>
                          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{mapping[field] ? rows[0]?.[mapping[field]!] || "—" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missingRequired.length > 0 && <p role="alert" className="text-[13px] text-danger">{im.requiredMissing(missingRequired.map((f) => im.fields[f]).join(", "))}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile tone="ok" label={im.ready} value={formatNumber(counts.ok, tag)} />
              <Tile tone="warn" label={im.withWarnings} value={formatNumber(counts.warnings, tag)} />
              <Tile tone="error" label={im.withErrors} value={formatNumber(counts.errors, tag)} />
            </div>
            {validated.some((r) => r.errors.length || r.warnings.length) && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{im.issues}</h2>
                  <Button size="sm" icon={<Download aria-hidden className="size-3.5" />} onClick={() => errorReport(validated)}>{im.errorReport}</Button>
                </div>
                <ul className="flex flex-col divide-y divide-subtle rounded-xl border border-line-soft">
                  {validated.filter((r) => r.errors.length || r.warnings.length).map((r) => (
                    <li key={r.index} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
                      <span className="w-16 text-muted tabular">{im.rowN(r.index + 2)}</span>
                      <span className="min-w-40 font-medium">{r.values.studentName || <span className="text-muted">{im.noName}</span>}</span>
                      <span className="flex flex-1 flex-wrap gap-1.5">
                        {r.errors.map((c) => <Badge key={c} tone="action" size="sm">{im.codes[c as keyof typeof im.codes]}</Badge>)}
                        {r.warnings.map((c) => <Badge key={c} tone={c === "links_existing" || c === "same_family_as_row" ? "scheduled" : "review"} size="sm">{c === "links_existing" ? im.linksTo(r.linkedFamily ?? "") : im.codes[c as keyof typeof im.codes]}</Badge>)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <InfoNote>{im.validateNote}</InfoNote>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile tone="ok" label={im.newFamilies} value={formatNumber(new Set(validated.filter((r) => r.action === "new_family").map((r) => r.values.phone)).size, tag)} />
              <Tile tone="info" label={im.linked} value={formatNumber(validated.filter((r) => r.action === "link_family").length, tag)} />
              <Tile tone="error" label={im.skipped} value={formatNumber(counts.errors, tag)} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-line-soft">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">{im.steps.preview}</caption>
                <thead>
                  <tr className="bg-page text-xs text-secondary">
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.row}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.fields.studentName}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.fields.familyName}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.fields.phone}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{im.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {validated.map((r) => (
                    <tr key={r.index} className={cn("border-t border-subtle", r.action === "skip" && "text-muted")}>
                      <td className="px-4 py-2.5 tabular">{r.index + 2}</td>
                      <td className="px-4 py-2.5">{r.values.studentName || "—"}</td>
                      <td className="px-4 py-2.5">{r.linkedFamily ?? r.values.familyName ?? "—"}</td>
                      <td className="px-4 py-2.5"><span dir="ltr" className="tabular">{r.values.phone || "—"}</span></td>
                      <td className="px-4 py-2.5"><Badge tone={r.action === "new_family" ? "completed" : r.action === "link_family" ? "scheduled" : "cancelled"} size="sm">{im.actions[r.action]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-[14px] bg-brand-100 text-brand-800"><Upload aria-hidden className="size-6" /></span>
            <p className="text-sm font-semibold">{im.readyTitle(validated.filter((r) => r.action !== "skip").length)}</p>
            <p className="max-w-md text-[13px] text-muted">{im.readyBody}</p>
            <Button variant="primary" onClick={() => setConfirming(true)}>{im.runImport}</Button>
          </div>
        )}

        {step === 5 && result && (
          <div className="flex flex-col gap-4">
            <p role="status" className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 aria-hidden className="size-5" />{im.done}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile tone="ok" label={im.studentsCreated} value={formatNumber(result.students, tag)} />
              <Tile tone="ok" label={im.familiesCreated} value={formatNumber(result.families, tag)} />
              <Tile tone="info" label={im.linked} value={formatNumber(result.linked, tag)} />
              <Tile tone="error" label={im.skipped} value={formatNumber(result.skipped.length, tag)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/manage/students" variant="primary">{im.viewStudents}</ButtonLink>
              {result.skipped.length > 0 && <Button icon={<Download aria-hidden className="size-4" />} onClick={() => errorReport(result.skipped)}>{im.errorReport}</Button>}
              <Button variant="tertiary" onClick={() => { setStep(0); setResult(null); setRows([]); }}>{im.another}</Button>
            </div>
            <InfoNote>{im.nextSteps}</InfoNote>
          </div>
        )}

        {step > 0 && step < 4 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
            <Button variant="tertiary" onClick={() => setStep((step - 1) as Step)}><span aria-hidden className="rtl:-scale-x-100">←</span> {t.common.back}</Button>
            <Button variant="primary" disabled={(step === 1 && missingRequired.length > 0) || (step === 2 && counts.ok + counts.warnings === 0)} onClick={() => setStep((step + 1) as Step)}>{t.common.continue}</Button>
          </div>
        )}
      </Card>

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          title={im.confirmTitle}
          context={fileName ?? undefined}
          confirmLabel={im.runImport}
          onConfirm={async () => { setResult(await importApi.execute(validated)); setStep(5); }}
          effects={[
            { label: im.studentsCreated, value: formatNumber(validated.filter((r) => r.action !== "skip").length, tag), tone: "positive" },
            { label: im.linked, value: formatNumber(validated.filter((r) => r.action === "link_family").length, tag) },
            { label: im.skipped, value: formatNumber(counts.errors, tag), tone: counts.errors ? "negative" : "plain" },
            { label: im.messages, value: im.noMessages },
          ]}
        />
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "error" | "info" }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-2xl border p-3.5",
      tone === "ok" && "border-st-completed-bg bg-st-completed-bg/40",
      tone === "warn" && "border-st-review-bg bg-st-review-bg/40",
      tone === "error" && "border-st-action-bg bg-st-action-bg/40",
      tone === "info" && "border-st-scheduled-bg bg-st-scheduled-bg/40")}>
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-2xl font-semibold tabular">{value}</span>
    </div>
  );
}
