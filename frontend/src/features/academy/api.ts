/**
 * Fixture-backed academy API. Same call shapes the real `/api/v1/academy/...`
 * wrappers will have; swap the bodies for `apiClient` calls once the backend
 * routes are wired and `make api-generate` has run.
 */
import * as db from "./fixtures";
import type {
  BalanceEntry,
  Enrollment,
  Family,
  FamilyRow,
  Payment,
  Session,
  SetupStep,
  Student,
  StudentNote,
  StudentRow,
  Teacher,
  TeacherRow,
  Workspace,
} from "./types";

const LATENCY_MS = 220;

export function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS));
}

export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found`);
  }
}

function nextSessionFor(studentId: string): Session | null {
  const now = Date.now();
  return db.sessions
    .filter((s) => s.studentId === studentId && s.status === "scheduled" && new Date(s.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
}

function activeEnrollment(studentId: string): Enrollment | null {
  return db.enrollments.find((e) => e.studentId === studentId && e.status !== "closed") ?? null;
}

function toStudentRow(student: Student): StudentRow {
  const enrollment = activeEnrollment(student.id);
  const lessonsLeft = enrollment?.balance ?? 0;
  return {
    ...student,
    familyName: db.families.find((f) => f.id === student.familyId)?.name ?? "",
    teacherName: db.teachers.find((t) => t.id === student.teacherId)?.name ?? null,
    nextSession: student.status === "active" ? nextSessionFor(student.id) : null,
    lessonsLeft,
    renewalDue: student.status === "active" && lessonsLeft <= db.settings.lowBalanceThreshold,
  };
}

export const academyApi = {
  getSettings: () => respond(db.settings),

  getSetupSteps: () => respond(db.setupSteps),

  saveSetupStep(key: SetupStep["key"], done: boolean) {
    const step = db.setupSteps.find((s) => s.key === key);
    if (step) step.done = done;
    return respond(db.setupSteps);
  },

  listStudents: () => respond(db.students.map(toStudentRow)),

  async getStudent(id: string) {
    const student = db.students.find((s) => s.id === id);
    if (!student) throw new NotFoundError("Student");
    const row = toStudentRow(student);
    const family = db.families.find((f) => f.id === student.familyId)!;
    const teacher = db.teachers.find((t) => t.id === student.teacherId) ?? null;
    const enrollments = db.enrollments.filter((e) => e.studentId === id);
    const enrollmentIds = new Set(enrollments.map((e) => e.id));
    const ledger = db.balanceEntries
      .filter((b) => enrollmentIds.has(b.enrollmentId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return respond({
      student: row,
      family,
      teacher,
      enrollments,
      ledger,
      sessions: db.sessions.filter((s) => s.studentId === id).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      progress: db.progress.filter((p) => p.studentId === id).sort((a, b) => b.date.localeCompare(a.date)),
      payments: db.payments.filter((p) => p.studentId === id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      notes: db.notes.filter((n) => n.studentId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  },

  createStudent(input: Omit<Student, "id" | "createdAt" | "status"> & { newFamily?: Omit<Family, "id" | "createdAt" | "isActive"> }) {
    let familyId = input.familyId;
    if (input.newFamily) {
      familyId = `f-${Date.now().toString(36)}`;
      db.families.push({ ...input.newFamily, id: familyId, isActive: true, createdAt: new Date().toISOString() });
    }
    const student: Student = {
      id: `s-${Date.now().toString(36)}`,
      familyId,
      teacherId: input.teacherId,
      name: input.name,
      birthDate: input.birthDate,
      isAdult: input.isAdult,
      language: input.language,
      timezone: input.timezone,
      program: input.program,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    db.students.push(student);
    return respond(student);
  },

  setStudentStatus(id: string, status: Student["status"], futureSessions: "cancel" | "keep" = "cancel") {
    const student = db.students.find((s) => s.id === id);
    if (!student) throw new NotFoundError("Student");
    student.status = status;
    if (status === "archived" && futureSessions === "cancel") {
      const now = Date.now();
      for (const s of db.sessions) {
        if (s.studentId === id && s.status === "scheduled" && new Date(s.startsAt).getTime() > now) s.status = "cancelled";
      }
    }
    return respond(student);
  },

  assignTeacher(studentIds: string[], teacherId: string) {
    for (const student of db.students) {
      if (studentIds.includes(student.id)) student.teacherId = teacherId;
    }
    return respond({ updated: studentIds.length });
  },

  addNote(studentId: string, visibility: StudentNote["visibility"], text: string, authorName: string) {
    const note: StudentNote = { id: `n-${Date.now().toString(36)}`, studentId, visibility, text, authorName, createdAt: new Date().toISOString() };
    db.notes.push(note);
    return respond(note);
  },

  adjustBalance(enrollmentId: string, delta: number, reason: string, actorName: string) {
    const enrollment = db.enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment) throw new NotFoundError("Enrollment");
    enrollment.balance += delta;
    const entry: BalanceEntry = {
      id: `${enrollmentId}-adj-${Date.now().toString(36)}`,
      enrollmentId,
      delta,
      balanceAfter: enrollment.balance,
      kind: "adjustment",
      reason,
      actorName,
      createdAt: new Date().toISOString(),
    };
    db.balanceEntries.push(entry);
    return respond(entry);
  },

  listFamilies(): Promise<FamilyRow[]> {
    return respond(db.families.map((family) => {
      const kids = db.students.filter((s) => s.familyId === family.id);
      return {
        ...family,
        studentCount: kids.filter((s) => s.status !== "archived").length,
        primaryContact: family.contacts[0] ?? null,
        lowBalanceCount: kids.filter((s) => toStudentRow(s).renewalDue).length,
        pendingPayments: db.payments.filter((p) => p.familyId === family.id && p.status === "pending").length,
      };
    }));
  },

  async getFamily(id: string) {
    const family = db.families.find((f) => f.id === id);
    if (!family) throw new NotFoundError("Family");
    return respond({
      family,
      students: db.students.filter((s) => s.familyId === id).map(toStudentRow),
      payments: db.payments.filter((p) => p.familyId === id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    });
  },

  listTeachers(): Promise<TeacherRow[]> {
    const now = Date.now();
    const weekAhead = now + 7 * 86_400_000;
    return respond(db.teachers.map((teacher) => ({
      ...teacher,
      studentCount: db.students.filter((s) => s.teacherId === teacher.id && s.status === "active").length,
      weekSessions: db.sessions.filter((s) => {
        const t = new Date(s.startsAt).getTime();
        return s.teacherId === teacher.id && s.status === "scheduled" && t > now && t < weekAhead;
      }).length,
    })));
  },

  async getTeacher(id: string) {
    const teacher = db.teachers.find((t) => t.id === id);
    if (!teacher) throw new NotFoundError("Teacher");
    return respond({
      teacher,
      students: db.students.filter((s) => s.teacherId === id).map(toStudentRow),
      availability: db.availability.filter((a) => a.teacherId === id),
      sessions: db.sessions.filter((s) => s.teacherId === id),
      rates: db.teacherRates.filter((r) => r.teacherId === id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    });
  },

  /** Every progress entry with who and where, for the supervisor view. */
  progressFeed: () => respond(db.progress.map((p) => {
    const student = db.students.find((s) => s.id === p.studentId)!;
    const session = db.sessions.find((s) => s.studentId === p.studentId && s.number === p.sessionNumber) ?? null;
    const teacher = db.teachers.find((t) => t.id === (session?.teacherId ?? student.teacherId)) ?? null;
    return { ...p, studentName: student.name, program: student.program, teacherId: teacher?.id ?? null, teacherName: teacher?.name ?? null, sessionId: session?.id ?? null };
  }).sort((a, b) => b.date.localeCompare(a.date))),

  /** Lightweight lookups used by forms and pickers. */
  lookups: () => respond({
    families: db.families.filter((f) => f.isActive) as Family[],
    teachers: db.teachers.filter((t) => t.isActive) as Teacher[],
    packages: db.packages.filter((p) => p.isActive),
  }),

  /** Mock phone sign-in: any valid number gets a code; 123456 is accepted. */
  requestCode: (phone: string) => respond({ phone, resendAfterSeconds: 30 }),

  verifyCode(code: string) {
    if (code === "000000") return Promise.reject(new Error("expired"));
    if (code !== "123456") return Promise.reject(new Error("invalid"));
    const workspaces: Workspace[] = ["management", "teacher", "family"];
    return respond({ workspaces });
  },
};

export type StudentDetail = Awaited<ReturnType<typeof academyApi.getStudent>>;
export type FamilyDetail = Awaited<ReturnType<typeof academyApi.getFamily>>;
export type TeacherDetail = Awaited<ReturnType<typeof academyApi.getTeacher>>;
export type { Payment };
