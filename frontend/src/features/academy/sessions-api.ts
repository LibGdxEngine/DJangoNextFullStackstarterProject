/**
 * Fixture-backed session operations. Mirrors the backend SessionViewSet
 * (transition, bulk-transition, lesson-report) and RecurringScheduleViewSet.
 * Every change appends history, and money effects are separate rows:
 * student deductions go to the balance ledger, teacher pay to earnings.
 */
import * as db from "./fixtures";
import { NotFoundError, respond } from "./api";
import { addDaysKey, zonedParts } from "@/lib/format";
import { expandRecurrence, type RecurrenceInput } from "./recurrence";
import type { Attendance, HistoryEvent, Session, SessionRow } from "./types";

function find(id: string): Session {
  const session = db.sessions.find((s) => s.id === id);
  if (!session) throw new NotFoundError("Session");
  return session;
}

function log(session: Session, action: HistoryEvent["action"], actorName: string, detail?: string) {
  const list = db.historyFor(session);
  list.push({ id: `${session.id}-${list.length}-${Date.now().toString(36)}`, entityId: session.id, at: new Date().toISOString(), actorName, action, detail });
}

function ledger(session: Session, delta: number, kind: "lesson" | "cancellation" | "adjustment", reason: string, actorName: string) {
  const enrollment = db.enrollments.find((e) => e.id === session.enrollmentId);
  if (!enrollment || delta === 0) return;
  enrollment.balance += delta;
  db.balanceEntries.push({
    id: `${enrollment.id}-${session.id}-${Date.now().toString(36)}`,
    enrollmentId: enrollment.id,
    sessionNumber: session.number,
    delta,
    balanceAfter: enrollment.balance,
    kind,
    reason,
    actorName,
    createdAt: new Date().toISOString(),
  });
}

function earn(session: Session, share: number, kind: "session" | "late_cancel" | "substitute" | "adjustment", reason: string) {
  const pay = db.earningAmount(session.teacherId, session, share);
  if (!pay || pay.amount === 0) return;
  db.earnings.push({
    id: `en-${session.number}-${Date.now().toString(36)}`,
    teacherId: session.teacherId,
    sessionId: session.id,
    amount: pay.amount,
    currency: pay.currency,
    earnedOn: session.startsAt.slice(0, 10),
    kind,
    reason,
    payrollMonth: db.payrollMonthFor(session.startsAt.slice(0, 10)),
    adjustmentOf: kind === "adjustment" ? db.earnings.find((e) => e.sessionId === session.id && !e.adjustmentOf)?.id : undefined,
  });
}

export function toRow(session: Session): SessionRow {
  const student = db.students.find((s) => s.id === session.studentId)!;
  const teacher = db.teachers.find((t) => t.id === session.teacherId)!;
  const ended = new Date(session.endsAt).getTime() < Date.now();
  const conflict = session.status !== "cancelled" && db.sessions.some((o) =>
    o.id !== session.id && o.status !== "cancelled" && o.teacherId === session.teacherId && o.startsAt < session.endsAt && session.startsAt < o.endsAt);
  return {
    ...session,
    studentName: student.name,
    teacherName: teacher.name,
    studentTimezone: student.timezone,
    teacherTimezone: teacher.timezone,
    isAdult: student.isAdult,
    reportDue: session.status === "scheduled" && ended,
    conflict,
  };
}

export interface CancelInput {
  by: "family_late" | "family_early" | "teacher" | "academy";
  reason: string;
  deduct: boolean;
  payTeacher: boolean;
}

export const sessionApi = {
  list: () => respond(db.sessions.map(toRow)),

  /** Calendar payload: sessions plus everything the filters and overlays need. */
  calendar: () => respond({
    sessions: db.sessions.map(toRow),
    teachers: db.teachers.filter((t) => t.isActive),
    students: db.students.filter((s) => s.status !== "archived"),
    availability: db.availability,
  }),

  async get(id: string) {
    const session = find(id);
    const row = toRow(session);
    const student = db.students.find((s) => s.id === session.studentId)!;
    const family = db.families.find((f) => f.id === student.familyId)!;
    const teacher = db.teachers.find((t) => t.id === session.teacherId)!;
    const enrollment = db.enrollments.find((e) => e.id === session.enrollmentId) ?? null;
    return respond({
      session: row,
      student,
      family,
      teacher,
      originalTeacher: session.substituteFor ? db.teachers.find((t) => t.id === session.substituteFor) ?? null : null,
      enrollment,
      series: db.schedules.find((s) => s.id === session.seriesId) ?? null,
      record: db.lessonRecords.find((r) => r.sessionId === id) ?? null,
      progress: db.progress.filter((p) => p.studentId === session.studentId && p.sessionNumber === session.number),
      ledger: db.balanceEntries.filter((b) => b.sessionNumber === session.number && b.enrollmentId === session.enrollmentId),
      earnings: db.earnings.filter((e) => e.sessionId === id),
      history: [...db.historyFor(session)].sort((a, b) => b.at.localeCompare(a.at)),
      requests: db.requests.filter((r) => r.sessionId === id),
      policy: { cancellationHours: db.settings.cancellationHours, lateCancelDeduct: db.settings.lateCancelDeduct, lateCancelPayTeacher: db.settings.lateCancelPayTeacher },
      whatsappStatus: db.settings.whatsappStatus,
    });
  },

  /** Teachers free for the session's slot, with their rate for it. */
  substitutes(id: string) {
    const session = find(id);
    return respond(db.teachers
      .filter((t) => t.isActive && t.id !== session.teacherId)
      .map((t) => {
        const busy = db.sessions.some((o) => o.teacherId === t.id && o.status !== "cancelled" && o.startsAt < session.endsAt && session.startsAt < o.endsAt);
        const local = zonedParts(session.startsAt, t.timezone);
        const windows = db.availability.filter((a) => a.teacherId === t.id && a.weekday === local.weekday);
        const inWindow = windows.some((w) => {
          const [sh, sm] = w.startTime.split(":").map(Number);
          const [eh, em] = w.endTime.split(":").map(Number);
          return local.minutes >= sh * 60 + sm && local.minutes + 30 <= eh * 60 + em;
        });
        return { teacher: t, busy, inWindow, pay: db.earningAmount(t.id, session) };
      })
      .sort((a, b) => Number(a.busy) - Number(b.busy) || Number(b.inWindow) - Number(a.inWindow)));
  },

  cancel(id: string, input: CancelInput, actorName: string) {
    const session = find(id);
    session.status = "cancelled";
    session.attendance = "absent";
    session.cancelledBy = input.by.startsWith("family") ? "family" : (input.by as "teacher" | "academy");
    session.cancelReason = input.reason;
    session.version += 1;
    if (input.deduct) ledger(session, -1, "cancellation", `Late cancellation: ${input.reason}`, actorName);
    if (input.payTeacher) earn(session, 0.5, "late_cancel", "Late cancellation (50%)");
    log(session, "cancelled", actorName, input.reason);
    return respond(toRow(session));
  },

  reschedule(id: string, newStart: string, actorName: string) {
    const session = find(id);
    const duration = new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime();
    const before = session.startsAt;
    session.startsAt = newStart;
    session.endsAt = new Date(new Date(newStart).getTime() + duration).toISOString();
    session.version += 1;
    log(session, "rescheduled", actorName, before);
    return respond(toRow(session));
  },

  assignSubstitute(id: string, teacherId: string, notifyFamily: boolean, actorName: string) {
    const session = find(id);
    session.substituteFor = session.substituteFor ?? session.teacherId;
    session.teacherId = teacherId;
    session.version += 1;
    log(session, "substitute", actorName, `${db.teachers.find((t) => t.id === teacherId)?.name}${notifyFamily ? " · family notified" : ""}`);
    return respond(toRow(session));
  },

  /** Correction after the fact: attendance plus two independent money decisions. */
  correctAttendance(id: string, attendance: Attendance, reason: string, decisions: { deduct: boolean; pay: boolean }, actorName: string) {
    const session = find(id);
    const before = session.attendance;
    session.attendance = attendance;
    session.version += 1;
    const deducted = db.balanceEntries.some((b) => b.sessionNumber === session.number && b.enrollmentId === session.enrollmentId && b.delta < 0);
    const paid = db.earnings.some((e) => e.sessionId === session.id && e.amount > 0);
    if (decisions.deduct && !deducted) ledger(session, -1, "adjustment", `Attendance corrected: ${reason}`, actorName);
    if (!decisions.deduct && deducted) ledger(session, 1, "adjustment", `Attendance corrected: ${reason}`, actorName);
    if (decisions.pay && !paid) earn(session, 1, "adjustment", `Attendance corrected: ${reason}`);
    log(session, "attendance_corrected", actorName, `${before} → ${attendance}: ${reason}`);
    return respond(toRow(session));
  },

  /** Close a "needs review" session with separate decisions for the student and the teacher. */
  review(id: string, decisions: { attendance: Attendance; deduct: boolean; pay: boolean; note: string }, actorName: string) {
    const session = find(id);
    session.status = "completed";
    session.attendance = decisions.attendance;
    session.version += 1;
    if (decisions.deduct) ledger(session, -1, "lesson", decisions.note || "Reviewed: lesson counted", actorName);
    if (decisions.pay) earn(session, 1, "session", decisions.note || "Reviewed: teacher paid");
    log(session, "reviewed", actorName, decisions.note);
    return respond(toRow(session));
  },

  /** Bulk change: only eligible sessions change; the rest are reported back as skipped. */
  bulk(ids: string[], action: "cancel" | "remind", actorName: string) {
    const now = Date.now();
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      const session = find(id);
      const eligible = session.status === "scheduled" && new Date(session.startsAt).getTime() > now;
      if (!eligible) {
        skipped.push(id);
        continue;
      }
      changed.push(id);
      if (action === "cancel") {
        session.status = "cancelled";
        session.cancelledBy = "academy";
        session.cancelReason = "Bulk cancellation";
        session.version += 1;
        log(session, "cancelled", actorName, "Bulk cancellation");
      } else {
        log(session, db.settings.whatsappStatus === "connected" ? "reminder_sent" : "reminder_queued", actorName, "Manual reminder");
      }
    }
    return respond({ changed, skipped });
  },

  /** Recurring schedule context for the form (student, teacher, enrollment, existing series). */
  recurringContext: () => respond({
    students: db.students.filter((s) => s.status === "active"),
    teachers: db.teachers.filter((t) => t.isActive),
    enrollments: db.enrollments.filter((e) => e.status !== "closed"),
    schedules: db.schedules,
    sessions: db.sessions,
    availability: db.availability,
  }),

  createRecurring(input: RecurrenceInput & { studentId: string; teacherId: string; enrollmentId: string }, actorName: string) {
    const student = db.students.find((s) => s.id === input.studentId)!;
    const teacher = db.teachers.find((t) => t.id === input.teacherId)!;
    const series = { ...input, id: `rs-${Date.now().toString(36)}`, isActive: true };
    db.schedules.push(series);
    const preview = expandRecurrence(input, {
      studentId: input.studentId,
      teacherId: input.teacherId,
      studentTimezone: student.timezone,
      teacherTimezone: teacher.timezone,
      sessions: db.sessions,
      availability: db.availability,
      enrollment: db.enrollments.find((e) => e.id === input.enrollmentId) ?? null,
    });
    let number = Math.max(...db.sessions.map((s) => s.number));
    const created = preview.occurrences.map((o) => {
      number += 1;
      const session: Session = { id: `ss-${number}`, number, studentId: input.studentId, teacherId: input.teacherId, enrollmentId: input.enrollmentId, seriesId: series.id, startsAt: o.start, endsAt: o.end, status: "scheduled", attendance: "unknown", version: 1 };
      db.sessions.push(session);
      log(session, "created", actorName, "series");
      return session;
    });
    return respond({ series, created: created.length });
  },

  /**
   * Edit a series. Scope "this" moves one session; "future" replaces scheduled
   * sessions from `fromSessionId` on; "all" replaces every future scheduled one.
   * Completed and cancelled sessions are history and never change.
   */
  updateRecurring(seriesId: string, input: RecurrenceInput & { teacherId: string }, scope: "this" | "future" | "all", fromSessionId: string | null, actorName: string) {
    const series = db.schedules.find((s) => s.id === seriesId);
    if (!series) throw new NotFoundError("Series");
    if (scope === "this" && fromSessionId) {
      const session = find(fromSessionId);
      const key = input.startsOn || zonedParts(session.startsAt, input.timezone).dateKey;
      const preview = expandRecurrence({ ...input, startsOn: key, endsOn: key, weekdays: [0, 1, 2, 3, 4, 5, 6] }, {
        studentId: session.studentId, teacherId: input.teacherId, studentTimezone: input.timezone, teacherTimezone: input.timezone, sessions: [], availability: [], enrollment: null,
      });
      const occ = preview.occurrences[0];
      if (occ) {
        session.startsAt = occ.start;
        session.endsAt = occ.end;
        session.teacherId = input.teacherId;
        session.version += 1;
        log(session, "rescheduled", actorName, "Edited this session only");
      }
      return respond({ changed: occ ? 1 : 0, removed: 0, created: 0 });
    }
    const from = scope === "future" && fromSessionId ? find(fromSessionId).startsAt : new Date().toISOString();
    const replaced = db.sessions.filter((s) => s.seriesId === seriesId && s.status === "scheduled" && s.startsAt >= from);
    for (const s of replaced) db.sessions.splice(db.sessions.indexOf(s), 1);
    Object.assign(series, { ...input, startsOn: input.startsOn < from.slice(0, 10) ? from.slice(0, 10) : input.startsOn });
    const student = db.students.find((s) => s.id === series.studentId)!;
    const teacher = db.teachers.find((t) => t.id === input.teacherId)!;
    const preview = expandRecurrence({ ...input, startsOn: series.startsOn }, {
      studentId: series.studentId, teacherId: input.teacherId, studentTimezone: student.timezone, teacherTimezone: teacher.timezone, sessions: db.sessions, availability: db.availability, enrollment: null,
    });
    let number = Math.max(...db.sessions.map((s) => s.number));
    let created = 0;
    for (const o of preview.occurrences) {
      if (o.start < from) continue;
      number += 1;
      created += 1;
      const session: Session = { id: `ss-${number}`, number, studentId: series.studentId, teacherId: input.teacherId, enrollmentId: series.enrollmentId, seriesId, startsAt: o.start, endsAt: o.end, status: "scheduled", attendance: "unknown", version: 1 };
      db.sessions.push(session);
      log(session, "created", actorName, scope === "future" ? "Series edited (this and future)" : "Series edited (whole series)");
    }
    db.sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return respond({ changed: 0, removed: replaced.length, created });
  },

  /** Counts and lists for the overview; every number maps to a filtered list. */
  overview() {
    const now = Date.now();
    const todayKey = zonedParts(new Date(now).toISOString(), db.settings.timezone).dateKey;
    const rows = db.sessions.map(toRow);
    const inLast = (days: number) => rows.filter((s) => new Date(s.startsAt).getTime() > now - days * 86_400_000 && new Date(s.startsAt).getTime() < now);
    const last30 = inLast(30);
    const attended = last30.filter((s) => s.status === "completed");
    const present = attended.filter((s) => s.attendance === "present" || s.attendance === "late");
    const enrollmentFor = (studentId: string) => db.enrollments.find((e) => e.studentId === studentId && e.status !== "closed");
    const active = db.students.filter((s) => s.status === "active");
    const today = rows.filter((s) => zonedParts(s.startsAt, db.settings.timezone).dateKey === todayKey);
    return respond({
      attention: {
        needsReview: rows.filter((s) => s.status === "needs_review"),
        reportsDue: rows.filter((s) => s.reportDue),
        conflicts: rows.filter((s) => s.conflict && new Date(s.startsAt).getTime() > now),
        unassigned: active.filter((s) => !s.teacherId),
        renewals: active.filter((s) => (enrollmentFor(s.id)?.balance ?? 0) <= db.settings.lowBalanceThreshold),
        pendingPayments: db.payments.filter((p) => p.status === "pending"),
        requests: db.requests.filter((r) => r.status === "pending"),
        whatsapp: db.settings.whatsappStatus,
        queuedReminders: today.filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > now).length,
      },
      stats: {
        today: today.filter((s) => s.status !== "cancelled").length,
        todayDone: today.filter((s) => s.status === "completed").length,
        week: rows.filter((s) => s.status !== "cancelled" && new Date(s.startsAt).getTime() >= now && new Date(s.startsAt).getTime() < now + 7 * 86_400_000).length,
        activeStudents: active.length,
        attendanceRate: attended.length ? Math.round((present.length / attended.length) * 100) : 0,
        cancellations30: last30.filter((s) => s.status === "cancelled").length,
        completed30: attended.length,
      },
      upcomingToday: today.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() > now).slice(0, 5),
      todayKey,
      weekEnd: addDaysKey(todayKey, 7),
    });
  },
};

export type SessionDetail = Awaited<ReturnType<typeof sessionApi.get>>;
export type CalendarData = Awaited<ReturnType<typeof sessionApi.calendar>>;
export type OverviewData = Awaited<ReturnType<typeof sessionApi.overview>>;
export type SubstituteOption = Awaited<ReturnType<typeof sessionApi.substitutes>>[number];

/** Shared with teacher and family operations so every write path records money and history the same way. */
export { log as logEvent, ledger as ledgerEntry, earn as earnEntry, find as findSession };
