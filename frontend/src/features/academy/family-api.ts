/**
 * Family portal (fixture-backed). Families see their own children (or
 * themselves, for adult students), family-visible notes only, and the
 * cancellation-policy effect before any request is submitted.
 */
import * as db from "./fixtures";
import { NotFoundError, respond } from "./api";
import { findSession, logEvent, toRow, sessionApi } from "./sessions-api";
import type { SessionRequest } from "./types";

/** Demo accounts: a parent with two children, and an adult student. */
export const FAMILY_ACCOUNTS = { parent: "f-ahmed", adult: "f-noor" } as const;

function account(familyId: string) {
  const family = db.families.find((f) => f.id === familyId);
  if (!family) throw new NotFoundError("Family");
  const students = db.students.filter((s) => s.familyId === familyId && s.status !== "archived");
  return { family, students, isAdult: family.contacts[0]?.relationship === "self" };
}

/** What a cancel/reschedule request would cost right now, under the academy policy. */
export function policyEffect(sessionId: string, kind: SessionRequest["kind"], at = Date.now()) {
  const session = findSession(sessionId);
  const hoursNotice = Math.max(0, (new Date(session.startsAt).getTime() - at) / 3_600_000);
  const late = hoursNotice < db.settings.cancellationHours;
  return {
    hoursNotice,
    late,
    deducts: kind === "cancel" && late && db.settings.lateCancelDeduct,
    cancellationHours: db.settings.cancellationHours,
  };
}

export const familyApi = {
  account: (familyId: string) => respond(account(familyId)),

  home(familyId: string) {
    const { family, students, isAdult } = account(familyId);
    const now = Date.now();
    const weekAhead = now + 7 * 86_400_000;
    return respond({
      family,
      isAdult,
      children: students.map((s) => {
        const teacher = db.teachers.find((t) => t.id === s.teacherId) ?? null;
        const upcoming = db.sessions
          .filter((x) => x.studentId === s.id && x.status === "scheduled" && new Date(x.endsAt).getTime() > now)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return {
          student: s,
          teacher,
          next: upcoming[0] ? toRow(upcoming[0]) : null,
          week: upcoming.filter((x) => new Date(x.startsAt).getTime() < weekAhead).map(toRow),
          enrollment: db.enrollments.find((e) => e.studentId === s.id && e.status !== "closed") ?? null,
          latest: db.progress.filter((p) => p.studentId === s.id).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
          messages: db.notes.filter((n) => n.studentId === s.id && n.visibility === "family").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2),
        };
      }),
      lowBalanceThreshold: db.settings.lowBalanceThreshold,
    });
  },

  schedule(familyId: string) {
    const { students, isAdult, family } = account(familyId);
    const ids = new Set(students.map((s) => s.id));
    const from = Date.now() - 14 * 86_400_000;
    return respond({
      family,
      isAdult,
      students,
      sessions: db.sessions.filter((s) => ids.has(s.studentId) && new Date(s.startsAt).getTime() > from).map(toRow),
      requests: db.requests.filter((r) => db.sessions.some((s) => s.id === r.sessionId && ids.has(s.studentId))),
      policy: { cancellationHours: db.settings.cancellationHours, lateCancelDeduct: db.settings.lateCancelDeduct },
    });
  },

  progress(familyId: string) {
    const { students, isAdult } = account(familyId);
    return respond({
      isAdult,
      children: students.map((s) => {
        const sessionIds = new Set(db.sessions.filter((x) => x.studentId === s.id).map((x) => x.id));
        const records = db.lessonRecords.filter((r) => sessionIds.has(r.sessionId));
        return {
          student: s,
          teacher: db.teachers.find((t) => t.id === s.teacherId) ?? null,
          progress: db.progress.filter((p) => p.studentId === s.id).sort((a, b) => b.date.localeCompare(a.date)),
          // Family-visible content only: never internal notes.
          lessons: records
            .map((r) => {
              const session = db.sessions.find((x) => x.id === r.sessionId)!;
              return { sessionNumber: session.number, startsAt: session.startsAt, familyNotes: r.familyNotes, homework: r.homework };
            })
            .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
        };
      }),
    });
  },

  requestChange(sessionId: string, kind: SessionRequest["kind"], reason: string, requestedBy: string, proposedStart?: string) {
    const effect = policyEffect(sessionId, kind);
    const request: SessionRequest = {
      id: `req-${Date.now().toString(36)}`,
      sessionId,
      kind,
      reason,
      proposedStart,
      status: "pending",
      requestedBy,
      createdAt: new Date().toISOString(),
      policy: { hoursNotice: Math.round(effect.hoursNotice), late: effect.late, deducts: effect.deducts },
    };
    db.requests.push(request);
    return respond(request);
  },

  /** Management decision on a family request; applies the policy snapshot taken at request time. */
  async reviewRequest(requestId: string, approve: boolean, actorName: string) {
    const request = db.requests.find((r) => r.id === requestId);
    if (!request) throw new NotFoundError("Request");
    request.status = approve ? "approved" : "rejected";
    const session = findSession(request.sessionId);
    if (approve && request.kind === "cancel") {
      await sessionApi.cancel(session.id, {
        by: request.policy.late ? "family_late" : "family_early",
        reason: request.reason,
        deduct: request.policy.deducts,
        payTeacher: request.policy.late && db.settings.lateCancelPayTeacher,
      }, actorName);
    } else if (approve && request.kind === "reschedule" && request.proposedStart) {
      await sessionApi.reschedule(session.id, request.proposedStart, actorName);
    } else {
      logEvent(session, "reviewed", actorName, `Request declined: ${request.reason}`);
    }
    return respond(request);
  },

  requestsFor: (sessionId: string) => respond(db.requests.filter((r) => r.sessionId === sessionId)),
};

export type FamilyHome = Awaited<ReturnType<typeof familyApi.home>>;
export type FamilySchedule = Awaited<ReturnType<typeof familyApi.schedule>>;
export type FamilyProgress = Awaited<ReturnType<typeof familyApi.progress>>;
