/**
 * Teacher workspace (fixture-backed). Teachers see their own students and
 * sessions, internal notes (view_internal), and never rates or family money.
 */
import * as db from "./fixtures";
import { NotFoundError, respond } from "./api";
import { earnEntry, findSession, ledgerEntry, logEvent, toRow } from "./sessions-api";
import { nextPosition } from "./quran";
import type { Attendance, QuranProgress } from "./types";

/** The signed-in teacher in this demo. */
export const CURRENT_TEACHER_ID = "t-kareem";

function prefsFor(teacherId: string) {
  let prefs = db.preferences.find((p) => p.teacherId === teacherId);
  if (!prefs) {
    prefs = { teacherId, reusableNotes: [], remembered: {} };
    db.preferences.push(prefs);
  }
  return prefs;
}

function lastProgress(studentId: string) {
  return db.progress.filter((p) => p.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

export interface ProgressInput {
  activity: QuranProgress["activity"];
  surah: number;
  ayahFrom: number;
  ayahTo: number;
  rating: QuranProgress["rating"];
}

export interface ReportInput {
  attendance: Exclude<Attendance, "unknown">;
  actualMinutes: number;
  lateMinutes: number;
  progress: ProgressInput[];
  familyNotes: string;
  internalNotes: string;
  homework: string;
  saveNoteAsReusable: boolean;
}

export const teacherApi = {
  today(teacherId = CURRENT_TEACHER_ID) {
    const teacher = db.teachers.find((t) => t.id === teacherId)!;
    const rows = db.sessions.filter((s) => s.teacherId === teacherId).map(toRow);
    return respond({ teacher, sessions: rows });
  },

  students(teacherId = CURRENT_TEACHER_ID) {
    const now = Date.now();
    return respond(db.students
      .filter((s) => s.teacherId === teacherId && s.status !== "archived")
      .map((s) => {
        const family = db.families.find((f) => f.id === s.familyId)!;
        const enrollment = db.enrollments.find((e) => e.studentId === s.id && e.status !== "closed");
        return {
          student: s,
          familyName: family.name,
          nextSession: db.sessions.filter((x) => x.studentId === s.id && x.teacherId === teacherId && x.status === "scheduled" && new Date(x.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
          lastProgress: lastProgress(s.id),
          lessonsLeft: enrollment?.balance ?? 0,
          reportsDue: db.sessions.filter((x) => x.studentId === s.id && x.teacherId === teacherId && x.status === "scheduled" && new Date(x.endsAt).getTime() < now).length,
        };
      }));
  },

  async student(studentId: string, teacherId = CURRENT_TEACHER_ID) {
    const student = db.students.find((s) => s.id === studentId && s.teacherId === teacherId);
    if (!student) throw new NotFoundError("Student");
    const family = db.families.find((f) => f.id === student.familyId)!;
    const sessions = db.sessions.filter((s) => s.studentId === studentId && s.teacherId === teacherId).map(toRow);
    return respond({
      student,
      familyName: family.name,
      enrollment: db.enrollments.find((e) => e.studentId === studentId && e.status !== "closed") ?? null,
      sessions,
      progress: db.progress.filter((p) => p.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date)),
      notes: db.notes.filter((n) => n.studentId === studentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      records: db.lessonRecords.filter((r) => sessions.some((s) => s.id === r.sessionId)),
    });
  },

  /** Everything the report form needs, including quick entries and where to continue. */
  async reportContext(sessionId: string, teacherId = CURRENT_TEACHER_ID) {
    const session = findSession(sessionId);
    if (session.teacherId !== teacherId) throw new NotFoundError("Session");
    const student = db.students.find((s) => s.id === session.studentId)!;
    const prefs = prefsFor(teacherId);
    const last = lastProgress(student.id);
    return respond({
      session: toRow(session),
      student,
      record: db.lessonRecords.find((r) => r.sessionId === sessionId) ?? null,
      lastProgress: last,
      continueFrom: last ? nextPosition(last.surah, last.ayahTo, prefs.remembered.descending ?? true) : null,
      preferences: prefs,
      policy: { lateCancelDeduct: db.settings.lateCancelDeduct, lateCancelPayTeacher: db.settings.lateCancelPayTeacher },
    });
  },

  /**
   * Submitting a report completes the session. Present/late → lesson deducted
   * and teacher paid. Absent → "needs review" so staff decide the money effects.
   */
  submitReport(sessionId: string, input: ReportInput, authorName: string, teacherId = CURRENT_TEACHER_ID) {
    const session = findSession(sessionId);
    if (session.teacherId !== teacherId) throw new NotFoundError("Session");
    const attended = input.attendance !== "absent";
    session.attendance = input.attendance;
    session.actualMinutes = attended ? input.actualMinutes : 0;
    session.lateMinutes = input.attendance === "late" ? input.lateMinutes : 0;
    session.status = attended ? "completed" : "needs_review";
    session.version += 1;

    const existing = db.lessonRecords.findIndex((r) => r.sessionId === sessionId);
    const record = { sessionId, authorName, familyNotes: input.familyNotes, internalNotes: input.internalNotes, homework: input.homework, submittedAt: new Date().toISOString() };
    if (existing >= 0) db.lessonRecords[existing] = record;
    else db.lessonRecords.push(record);

    if (attended) {
      input.progress.forEach((p, i) => {
        db.progress.push({ id: `q-${session.number}-${i}-${Date.now().toString(36)}`, studentId: session.studentId, sessionNumber: session.number, date: session.startsAt.slice(0, 10), ...p, note: i === 0 ? input.familyNotes || undefined : undefined });
      });
      ledgerEntry(session, -1, "lesson", "Lesson completed", authorName);
      earnEntry(session, 1, "session", "Lesson taught");
    }
    logEvent(session, "report_submitted", authorName);
    if (attended) logEvent(session, "completed", "System");

    // Quick entries: remember this lesson's choices for next time.
    const prefs = prefsFor(teacherId);
    const first = input.progress[0];
    if (first) {
      prefs.remembered.activity = first.activity;
      prefs.remembered.rating = first.rating;
      prefs.remembered.descending = first.surah >= 78 ? true : prefs.remembered.descending;
    }
    if (input.homework) prefs.remembered.homework = input.homework;
    if (input.saveNoteAsReusable && input.familyNotes.trim() && !prefs.reusableNotes.includes(input.familyNotes.trim())) {
      prefs.reusableNotes.unshift(input.familyNotes.trim());
    }
    return respond({ status: session.status });
  },

  removeReusableNote(note: string, teacherId = CURRENT_TEACHER_ID) {
    const prefs = prefsFor(teacherId);
    prefs.reusableNotes = prefs.reusableNotes.filter((n) => n !== note);
    return respond(prefs);
  },
};

export type TeacherStudentDetail = Awaited<ReturnType<typeof teacherApi.student>>;
export type ReportContext = Awaited<ReturnType<typeof teacherApi.reportContext>>;
export type TeacherStudentCard = Awaited<ReturnType<typeof teacherApi.students>>[number];
