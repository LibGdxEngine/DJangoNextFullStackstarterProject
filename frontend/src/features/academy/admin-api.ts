/**
 * Communication, reports, settings and import (fixture-backed). Mirrors the
 * backend MessageViewSet / MessageTemplateViewSet / MessageAutomationViewSet,
 * WorkspaceDashboardViewSet (reports, export-report), AcademySettingsViewSet,
 * StaffRoleViewSet and ImportJobViewSet (upload, validate, execute, error-report).
 *
 * WhatsApp delivery itself is server-side only: the backend sends through the
 * HireAgents channel with an API key from its environment. Nothing here ever
 * holds or sends that key.
 */
import * as db from "./fixtures";
import { NotFoundError, respond } from "./api";
import { totalsByCurrency, TIME_ZONES } from "@/lib/format";
import type { AcademySettings, AutomationEvent, MessageTemplate, Program, StaffMember } from "./types";

/* ── WhatsApp ─────────────────────────────────────────────── */

function outboxRow(m: (typeof db.outbox)[number]) {
  const family = db.families.find((f) => f.id === m.familyId);
  return {
    message: m,
    familyName: family?.name ?? "",
    studentName: db.students.find((s) => s.id === m.studentId)?.name ?? "",
    template: db.templates.find((t) => t.id === m.templateId) ?? null,
  };
}

export const commsApi = {
  whatsapp: () => respond({
    connection: db.whatsapp,
    outbox: db.outbox.map(outboxRow).sort((a, b) => b.message.dueAt.localeCompare(a.message.dueAt)),
    templates: db.templates,
    automations: db.automations,
    reminderMinutes: db.settings.reminderMinutes,
  }),

  /**
   * Test message from the settings page. In production this is a POST to the
   * academy messages endpoint and the backend calls HireAgents; here it reports
   * what would be sent.
   */
  sendTest(to: string, text: string) {
    return respond({
      to,
      text,
      channelId: db.whatsapp.channelId,
      sender: db.whatsapp.sender,
      delivered: db.whatsapp.apiKeyConfigured && db.whatsapp.status === "connected",
    });
  },

  /** After the channel is fixed: mark connected and release everything queued during the outage. */
  reconnect() {
    db.whatsapp.status = "connected";
    db.whatsapp.since = new Date().toISOString();
    db.settings.whatsappStatus = "connected";
    let released = 0;
    for (const m of db.outbox) {
      if (m.status === "queued" && new Date(m.dueAt).getTime() <= Date.now()) {
        m.status = "sent";
        m.sentAt = new Date().toISOString();
        released += 1;
      }
    }
    db.whatsapp.lastSuccessAt = new Date().toISOString();
    return respond({ released });
  },

  /** Requeue only after an operator reconciled with the provider (avoids double sends). */
  requeue(ids: string[]) {
    let changed = 0;
    for (const m of db.outbox) {
      if (ids.includes(m.id) && (m.status === "failed" || m.status === "action_required")) {
        m.status = "queued";
        m.error = undefined;
        m.dueAt = new Date().toISOString();
        changed += 1;
      }
    }
    return respond({ changed });
  },

  cancelMessages(ids: string[]) {
    let changed = 0;
    for (const m of db.outbox) {
      if (ids.includes(m.id) && m.status === "queued") {
        m.status = "cancelled";
        changed += 1;
      }
    }
    return respond({ changed });
  },

  setAutomation(event: AutomationEvent, patch: { isEnabled?: boolean; templateId?: string }) {
    const automation = db.automations.find((a) => a.event === event);
    if (!automation) throw new NotFoundError("Automation");
    Object.assign(automation, patch);
    return respond(automation);
  },

  saveTemplate(input: Omit<MessageTemplate, "id">, id?: string) {
    if (id) {
      const existing = db.templates.find((t) => t.id === id);
      if (!existing) throw new NotFoundError("Template");
      Object.assign(existing, input);
      return respond(existing);
    }
    const template = { ...input, id: `tpl-${Date.now().toString(36)}` };
    db.templates.push(template);
    return respond(template);
  },
};

/* ── Settings & staff ─────────────────────────────────────── */

export const settingsApi = {
  get: () => respond({ settings: db.settings, staff: db.staff, paymentMethods: db.paymentMethods, whatsapp: db.whatsapp }),
  save(patch: Partial<AcademySettings>, paymentMethods?: string[]) {
    Object.assign(db.settings, patch);
    if (paymentMethods) db.paymentMethods.splice(0, db.paymentMethods.length, ...paymentMethods);
    return respond(db.settings);
  },
  saveStaff(member: Omit<StaffMember, "id">, id?: string) {
    if (id) {
      const existing = db.staff.find((s) => s.id === id);
      if (!existing) throw new NotFoundError("Staff");
      Object.assign(existing, member);
      return respond(existing);
    }
    const created = { ...member, id: `st-${Date.now().toString(36)}` };
    db.staff.push(created);
    return respond(created);
  },
};

/* ── Reports ──────────────────────────────────────────────── */

export type ReportPeriod = "this_month" | "last_month" | "last_30";

function periodRange(period: ReportPeriod): { from: string; to: string } {
  const now = new Date();
  const startThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "this_month") return { from: startThis.toISOString(), to: now.toISOString() };
  if (period === "last_month") return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString(), to: startThis.toISOString() };
  return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: now.toISOString() };
}

export const reportsApi = {
  get(period: ReportPeriod) {
    const { from, to } = periodRange(period);
    const inRange = (iso: string) => iso >= from && iso < to;
    const held = db.sessions.filter((s) => inRange(s.startsAt) && new Date(s.endsAt).getTime() < Date.now());
    const completed = held.filter((s) => s.status === "completed");
    const cancelled = held.filter((s) => s.status === "cancelled");
    const attended = completed.filter((s) => s.attendance === "present" || s.attendance === "late");
    const deducted = db.balanceEntries.filter((b) => inRange(b.createdAt) && b.delta < 0);
    const approved = db.payments.filter((p) => p.status === "approved" && inRange(p.reviewedAt ?? p.submittedAt));
    const months = new Set([from.slice(0, 7), new Date(new Date(to).getTime() - 1).toISOString().slice(0, 7)]);
    const earned = db.earnings.filter((e) => inRange(`${e.earnedOn}T12:00:00.000Z`) && months.has(e.payrollMonth));
    const renewals = db.enrollments.filter((e) => e.renewedFrom && inRange(`${e.startsOn}T12:00:00.000Z`));

    return respond({
      from,
      to,
      metrics: {
        held: held.length,
        completed: completed.length,
        attendanceRate: completed.length ? attended.length / completed.length : 0,
        cancellationRate: held.length ? cancelled.length / held.length : 0,
        cancelledBy: {
          family: cancelled.filter((s) => s.cancelledBy === "family").length,
          teacher: cancelled.filter((s) => s.cancelledBy === "teacher").length,
          academy: cancelled.filter((s) => s.cancelledBy === "academy").length,
        },
        lessonsDeducted: deducted.reduce((n, b) => n + Math.abs(b.delta), 0),
        revenue: totalsByCurrency(approved, (p) => p.amount, (p) => p.currency),
        earnings: totalsByCurrency(earned, (e) => e.amount, (e) => e.currency),
        activeStudents: db.students.filter((s) => s.status === "active").length,
        renewals: renewals.length,
      },
      byTeacher: db.teachers.filter((t) => t.isActive).map((t) => {
        const mine = held.filter((s) => s.teacherId === t.id);
        const done = mine.filter((s) => s.status === "completed");
        return {
          id: t.id,
          name: t.name,
          held: mine.length,
          completed: done.length,
          attendanceRate: done.length ? done.filter((s) => s.attendance !== "absent").length / done.length : 0,
          cancelled: mine.filter((s) => s.status === "cancelled").length,
          earnings: totalsByCurrency(earned.filter((e) => e.teacherId === t.id), (e) => e.amount, (e) => e.currency),
        };
      }),
      byStudent: db.students.filter((s) => s.status !== "archived").map((s) => {
        const mine = held.filter((x) => x.studentId === s.id);
        const done = mine.filter((x) => x.status === "completed");
        return {
          id: s.id,
          name: s.name,
          completed: done.length,
          missed: done.filter((x) => x.attendance === "absent").length + mine.filter((x) => x.status === "cancelled").length,
          ayahs: db.progress.filter((p) => p.studentId === s.id && inRange(`${p.date}T12:00:00.000Z`) && p.activity === "memorization").reduce((n, p) => n + p.ayahTo - p.ayahFrom + 1, 0),
          balance: db.enrollments.find((e) => e.studentId === s.id && e.status === "active")?.balance ?? 0,
        };
      }),
    });
  },
};

/* ── Excel import ─────────────────────────────────────────── */

export const IMPORT_FIELDS = ["studentName", "familyName", "guardianName", "phone", "timezone", "birthDate", "program", "teacher", "package"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ["studentName", "phone"];

/** Header guesses for auto-mapping (English and Arabic headers). */
const HEADER_HINTS: Record<ImportField, string[]> = {
  studentName: ["student", "student name", "name", "اسم الطالب", "الطالب"],
  familyName: ["family", "family name", "العائلة", "اسم العائلة"],
  guardianName: ["guardian", "parent", "ولي الأمر", "الأب", "الأم"],
  phone: ["phone", "mobile", "whatsapp", "الهاتف", "الجوال", "رقم الهاتف"],
  timezone: ["timezone", "time zone", "zone", "المنطقة الزمنية"],
  birthDate: ["dob", "birth date", "date of birth", "تاريخ الميلاد"],
  program: ["program", "course", "البرنامج"],
  teacher: ["teacher", "المعلم"],
  package: ["package", "الباقة"],
};

export function guessMapping(columns: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  for (const field of IMPORT_FIELDS) {
    const hit = columns.find((c) => HEADER_HINTS[field].includes(c.trim().toLowerCase()));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

export interface ValidatedRow {
  index: number;
  values: Partial<Record<ImportField, string>>;
  errors: string[];
  warnings: string[];
  action: "new_family" | "link_family" | "skip";
  linkedFamily?: string;
}

const PROGRAMS: Record<string, Program> = { memorization: "memorization", hifz: "memorization", "حفظ": "memorization", recitation: "recitation", "تلاوة": "recitation", tajweed: "tajweed", "تجويد": "tajweed", qaida: "qaida", "القاعدة": "qaida" };

const normPhone = (p: string) => p.replace(/[^\d+]/g, "").replace(/^00/, "+");

/** Row validation; error codes are translated by the UI. */
export function validateRows(rows: Record<string, string>[], mapping: Partial<Record<ImportField, string>>): ValidatedRow[] {
  const seenPhones = new Map<string, number>();
  return rows.map((row, index) => {
    const values: Partial<Record<ImportField, string>> = {};
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field];
      if (column) values[field] = (row[column] ?? "").trim();
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!values.studentName) errors.push("missing_name");
    const phone = normPhone(values.phone ?? "");
    if (!phone) errors.push("missing_phone");
    else if (!/^\+\d{8,15}$/.test(phone)) errors.push("bad_phone");
    if (values.timezone && !(TIME_ZONES as readonly string[]).includes(values.timezone) && !Intl.supportedValuesOf?.("timeZone").includes(values.timezone)) errors.push("bad_timezone");
    if (values.birthDate && Number.isNaN(Date.parse(values.birthDate))) errors.push("bad_date");
    if (values.program && !PROGRAMS[values.program.toLowerCase()]) warnings.push("unknown_program");
    if (values.teacher && !db.teachers.some((t) => t.name.toLowerCase().includes(values.teacher!.toLowerCase()))) warnings.push("unknown_teacher");
    if (values.package && !db.packages.some((p) => p.name.toLowerCase() === values.package!.toLowerCase())) warnings.push("unknown_package");
    const existing = db.families.find((f) => f.contacts.some((c) => normPhone(c.phone) === phone));
    const sibling = seenPhones.get(phone);
    if (phone) seenPhones.set(phone, index);
    if (existing) warnings.push("links_existing");
    else if (sibling !== undefined) warnings.push("same_family_as_row");
    return {
      index,
      values,
      errors,
      warnings,
      action: errors.length ? "skip" : existing || sibling !== undefined ? "link_family" : "new_family",
      linkedFamily: existing?.name,
    };
  });
}

export const importApi = {
  /** Creates families and students for valid rows; skipped rows are returned for the error report. */
  execute(rows: ValidatedRow[]) {
    const createdFamilies: string[] = [];
    const createdStudents: string[] = [];
    const byPhone = new Map<string, string>();
    for (const row of rows.filter((r) => r.action !== "skip")) {
      const v = row.values;
      const phone = normPhone(v.phone ?? "");
      let familyId = db.families.find((f) => f.contacts.some((c) => normPhone(c.phone) === phone))?.id ?? byPhone.get(phone);
      if (!familyId) {
        familyId = `f-imp-${Date.now().toString(36)}-${row.index}`;
        db.families.push({
          id: familyId,
          name: v.familyName || `${(v.studentName ?? "").split(" ").slice(-1)[0]} family`,
          timezone: v.timezone || db.settings.timezone,
          language: db.settings.language,
          isActive: true,
          createdAt: new Date().toISOString(),
          contacts: [{ id: `c-imp-${row.index}`, name: v.guardianName || v.studentName || "", phone, relationship: v.guardianName ? "parent" : "self", receivesNotifications: true }],
        });
        createdFamilies.push(familyId);
      }
      byPhone.set(phone, familyId);
      const teacher = v.teacher ? db.teachers.find((t) => t.name.toLowerCase().includes(v.teacher!.toLowerCase())) : undefined;
      const id = `s-imp-${Date.now().toString(36)}-${row.index}`;
      db.students.push({
        id,
        familyId,
        teacherId: teacher?.id ?? null,
        name: v.studentName ?? "",
        birthDate: v.birthDate || null,
        isAdult: !v.guardianName && !v.familyName,
        language: db.settings.language,
        timezone: v.timezone || db.families.find((f) => f.id === familyId)?.timezone || db.settings.timezone,
        status: "active",
        program: PROGRAMS[(v.program ?? "").toLowerCase()] ?? "memorization",
        createdAt: new Date().toISOString(),
      });
      createdStudents.push(id);
    }
    const step = db.setupSteps.find((s) => s.key === "students");
    if (step && createdStudents.length) step.done = true;
    return respond({ families: createdFamilies.length, students: createdStudents.length, linked: rows.filter((r) => r.action === "link_family").length, skipped: rows.filter((r) => r.action === "skip") });
  },
};

export type WhatsAppData = Awaited<ReturnType<typeof commsApi.whatsapp>>;
export type OutboxRow = WhatsAppData["outbox"][number];
export type ReportData = Awaited<ReturnType<typeof reportsApi.get>>;
export type SettingsData = Awaited<ReturnType<typeof settingsApi.get>>;
