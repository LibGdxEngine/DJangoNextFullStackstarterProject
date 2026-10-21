/**
 * In-memory fixtures for the academy UI. Times are generated relative to "now"
 * so countdowns, upcoming classes and history always look current.
 */
import type {
  AcademySettings,
  Availability,
  BalanceEntry,
  EarningEntry,
  EarningsIssue,
  Enrollment,
  Family,
  Package,
  Payment,
  Payroll,
  HistoryEvent,
  LessonPreference,
  MessageAutomation,
  MessageTemplate,
  OutboxMessage,
  LessonRecord,
  QuranProgress,
  RecurringSchedule,
  Session,
  SessionRequest,
  SetupStep,
  StaffMember,
  Student,
  StudentNote,
  Teacher,
  TeacherRate,
  WhatsAppConnection,
} from "./types";
import { zonedTimeToUtc } from "@/lib/format";

const DAY = 86_400_000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

function isoDate(offsetDays: number): string {
  return new Date(today.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
}

function isoAt(offsetDays: number, utcHour: number, utcMinute = 0): string {
  return new Date(today.getTime() + offsetDays * DAY + (utcHour * 60 + utcMinute) * 60_000).toISOString();
}

export const settings: AcademySettings = {
  name: { en: "Al-Noor Academy", ar: "أكاديمية النور" },
  timezone: "Africa/Cairo",
  language: "ar",
  cancellationHours: 24,
  lateCancelDeduct: true,
  lateCancelPayTeacher: true,
  reminderMinutes: 60,
  lowBalanceThreshold: 2,
  whatsappStatus: "action_required",
  paymentStatus: "pending",
};

export const setupSteps: SetupStep[] = [
  { key: "profile", done: true },
  { key: "locale", done: true },
  { key: "policy", done: true },
  { key: "packages", done: true },
  { key: "teachers", done: true },
  { key: "students", done: false },
  { key: "whatsapp", done: false, connection: "action_required" },
  { key: "payments", done: false, connection: "pending" },
];

export const teachers: Teacher[] = [
  { id: "t-kareem", name: "Ust. Kareem Said", phone: "+90 532 555 0142", timezone: "Europe/Istanbul", language: "ar", meetingUrl: "https://meet.example.com/kareem", isActive: true, specialties: ["memorization", "recitation"], createdAt: isoDate(-400) },
  { id: "t-huda", name: "Ust. Huda Rahman", phone: "+966 55 555 0199", timezone: "Asia/Riyadh", language: "ar", meetingUrl: "https://meet.example.com/huda", isActive: true, specialties: ["tajweed", "recitation"], createdAt: isoDate(-300) },
  { id: "t-bilal", name: "Ust. Bilal Okafor", phone: "+44 7700 900123", timezone: "Europe/London", language: "en", meetingUrl: "https://meet.example.com/bilal", isActive: true, specialties: ["qaida", "memorization"], createdAt: isoDate(-120) },
  { id: "t-amina", name: "Ust. Amina Yusuf", phone: "+20 100 555 0177", timezone: "Africa/Cairo", language: "ar", isActive: false, specialties: ["qaida"], createdAt: isoDate(-500) },
];

export const teacherRates: TeacherRate[] = [
  { id: "r-1", teacherId: "t-kareem", amount: 8, currency: "USD", basis: "session", effectiveFrom: isoDate(-400) },
  { id: "r-2", teacherId: "t-kareem", amount: 9, currency: "USD", basis: "session", effectiveFrom: isoDate(-60) },
  { id: "r-3", teacherId: "t-huda", amount: 40, currency: "SAR", basis: "hour", effectiveFrom: isoDate(-300) },
  { id: "r-4", teacherId: "t-bilal", amount: 7, currency: "GBP", basis: "session", effectiveFrom: isoDate(-120) },
  { id: "r-5", teacherId: "t-amina", amount: 150, currency: "EGP", basis: "session", effectiveFrom: isoDate(-500) },
];

export const availability: Availability[] = [
  ...[0, 1, 2, 3, 6].map((weekday, i) => ({ id: `av-k${i}`, teacherId: "t-kareem", weekday, startTime: "13:00", endTime: "19:00", timezone: "Europe/Istanbul" })),
  ...[0, 2, 4, 5].map((weekday, i) => ({ id: `av-h${i}`, teacherId: "t-huda", weekday, startTime: "16:00", endTime: "21:00", timezone: "Asia/Riyadh" })),
  ...[1, 3, 5].map((weekday, i) => ({ id: `av-b${i}`, teacherId: "t-bilal", weekday, startTime: "09:00", endTime: "14:00", timezone: "Europe/London" })),
];

export const families: Family[] = [
  { id: "f-ahmed", name: "Ahmed family", timezone: "Africa/Cairo", language: "ar", isActive: true, createdAt: isoDate(-200), contacts: [
    { id: "c-1", name: "Mahmoud Ahmed", phone: "+20 102 345 6789", email: "mahmoud@example.com", relationship: "parent", receivesNotifications: true },
    { id: "c-2", name: "Rania Ahmed", phone: "+20 109 876 5432", relationship: "parent", receivesNotifications: false },
  ] },
  { id: "f-saleh", name: "Saleh family", timezone: "Asia/Riyadh", language: "ar", isActive: true, createdAt: isoDate(-180), contacts: [
    { id: "c-3", name: "Khalid Saleh", phone: "+966 50 123 4567", relationship: "parent", receivesNotifications: true },
  ] },
  { id: "f-hassan", name: "Hassan family", timezone: "Europe/London", language: "en", isActive: true, createdAt: isoDate(-90), contacts: [
    { id: "c-4", name: "Sarah Hassan", phone: "+44 7700 900456", email: "sarah.h@example.com", relationship: "parent", receivesNotifications: true },
  ] },
  { id: "f-khalil", name: "Omar Khalil", timezone: "America/New_York", language: "en", isActive: true, createdAt: isoDate(-20), contacts: [
    { id: "c-5", name: "Omar Khalil", phone: "+1 212 555 0101", email: "omar.k@example.com", relationship: "self", receivesNotifications: true },
  ] },
  { id: "f-ibrahim", name: "Ibrahim family", timezone: "Asia/Dubai", language: "ar", isActive: true, createdAt: isoDate(-150), contacts: [
    { id: "c-6", name: "Yasmin Ibrahim", phone: "+971 50 555 0133", relationship: "guardian", receivesNotifications: true },
  ] },
  { id: "f-mansour", name: "Mansour family", timezone: "Africa/Cairo", language: "ar", isActive: true, createdAt: isoDate(-240), contacts: [
    { id: "c-7", name: "Tarek Mansour", phone: "+20 111 222 3344", relationship: "parent", receivesNotifications: true },
  ] },
  { id: "f-farouk", name: "Farouk family", timezone: "America/Toronto", language: "en", isActive: true, createdAt: isoDate(-60), contacts: [
    { id: "c-8", name: "Nadia Farouk", phone: "+1 416 555 0188", email: "nadia@example.com", relationship: "parent", receivesNotifications: true },
  ] },
  { id: "f-noor", name: "Khadija Noor", timezone: "America/New_York", language: "en", isActive: true, createdAt: isoDate(-70), contacts: [
    { id: "c-10", name: "Khadija Noor", phone: "+1 646 555 0177", email: "khadija@example.com", relationship: "self", receivesNotifications: true },
  ] },
  { id: "f-zayed", name: "Zayed family", timezone: "Asia/Riyadh", language: "ar", isActive: false, createdAt: isoDate(-420), contacts: [
    { id: "c-9", name: "Hamad Zayed", phone: "+966 54 555 0111", relationship: "parent", receivesNotifications: false },
  ] },
];

export const students: Student[] = [
  { id: "s-yusuf", familyId: "f-ahmed", teacherId: "t-kareem", name: "Yusuf Ahmed", birthDate: "2017-03-14", isAdult: false, language: "ar", timezone: "Africa/Cairo", status: "active", program: "memorization", createdAt: isoDate(-200) },
  { id: "s-aisha", familyId: "f-ahmed", teacherId: "t-huda", name: "Aisha Ahmed", birthDate: "2014-08-02", isAdult: false, language: "ar", timezone: "Africa/Cairo", status: "active", program: "tajweed", createdAt: isoDate(-190) },
  { id: "s-maryam", familyId: "f-saleh", teacherId: "t-huda", name: "Maryam Saleh", birthDate: "2014-01-20", isAdult: false, language: "ar", timezone: "Asia/Riyadh", status: "active", program: "recitation", createdAt: isoDate(-180) },
  { id: "s-omar", familyId: "f-khalil", teacherId: null, name: "Omar Khalil", birthDate: null, isAdult: true, language: "en", timezone: "America/New_York", status: "active", program: "tajweed", createdAt: isoDate(-20) },
  { id: "s-layla", familyId: "f-hassan", teacherId: "t-bilal", name: "Layla Hassan", birthDate: "2019-05-11", isAdult: false, language: "en", timezone: "Europe/London", status: "paused", program: "qaida", createdAt: isoDate(-90) },
  { id: "s-adam", familyId: "f-hassan", teacherId: "t-bilal", name: "Adam Hassan", birthDate: "2016-11-30", isAdult: false, language: "en", timezone: "Europe/London", status: "active", program: "memorization", createdAt: isoDate(-88) },
  { id: "s-hamza", familyId: "f-ibrahim", teacherId: "t-kareem", name: "Hamza Ibrahim", birthDate: "2013-02-17", isAdult: false, language: "ar", timezone: "Asia/Dubai", status: "active", program: "memorization", createdAt: isoDate(-150) },
  { id: "s-salma", familyId: "f-ibrahim", teacherId: "t-huda", name: "Salma Ibrahim", birthDate: "2015-07-07", isAdult: false, language: "ar", timezone: "Asia/Dubai", status: "active", program: "recitation", createdAt: isoDate(-149) },
  { id: "s-ziad", familyId: "f-mansour", teacherId: "t-kareem", name: "Ziad Mansour", birthDate: "2012-09-09", isAdult: false, language: "ar", timezone: "Africa/Cairo", status: "active", program: "recitation", createdAt: isoDate(-240) },
  { id: "s-nour", familyId: "f-mansour", teacherId: "t-bilal", name: "Nour Mansour", birthDate: "2018-12-01", isAdult: false, language: "ar", timezone: "Africa/Cairo", status: "active", program: "qaida", createdAt: isoDate(-230) },
  { id: "s-ibrahim", familyId: "f-farouk", teacherId: "t-bilal", name: "Ibrahim Farouk", birthDate: "2015-04-22", isAdult: false, language: "en", timezone: "America/Toronto", status: "active", program: "memorization", createdAt: isoDate(-60) },
  { id: "s-zainab", familyId: "f-farouk", teacherId: "t-kareem", name: "Zainab Farouk", birthDate: "2013-10-15", isAdult: false, language: "en", timezone: "America/Toronto", status: "active", program: "tajweed", createdAt: isoDate(-58) },
  { id: "s-khadija", familyId: "f-noor", teacherId: "t-huda", name: "Khadija Noor", birthDate: null, isAdult: true, language: "en", timezone: "America/New_York", status: "active", program: "tajweed", createdAt: isoDate(-70) },
  { id: "s-faris", familyId: "f-zayed", teacherId: "t-huda", name: "Faris Zayed", birthDate: "2011-06-03", isAdult: false, language: "ar", timezone: "Asia/Riyadh", status: "archived", program: "memorization", createdAt: isoDate(-420) },
];

export const packages: Package[] = [
  { id: "p-rec12-egp", name: "Recitation 12", lessonCount: 12, durationMinutes: 45, validityDays: 30, price: 1200, currency: "EGP", isActive: true },
  { id: "p-mem8-usd", name: "Memorization 8", lessonCount: 8, durationMinutes: 30, validityDays: 30, price: 40, currency: "USD", isActive: true },
  { id: "p-taj12-sar", name: "Tajweed 12", lessonCount: 12, durationMinutes: 45, validityDays: 45, price: 360, currency: "SAR", isActive: true },
  { id: "p-qaida8-gbp", name: "Qaida 8", lessonCount: 8, durationMinutes: 30, validityDays: 30, price: 64, currency: "GBP", isActive: true },
];

/** Starting balance and package per student; the ledger replays to these numbers. */
const plan: Record<string, { packageId: string; used: number; adjustments?: number }> = {
  "s-yusuf": { packageId: "p-rec12-egp", used: 6, adjustments: 1 },
  "s-aisha": { packageId: "p-taj12-sar", used: 4 },
  "s-maryam": { packageId: "p-taj12-sar", used: 11 },
  "s-omar": { packageId: "p-mem8-usd", used: 0, adjustments: 4 },
  "s-layla": { packageId: "p-qaida8-gbp", used: 4 },
  "s-adam": { packageId: "p-qaida8-gbp", used: 6 },
  "s-hamza": { packageId: "p-mem8-usd", used: 5 },
  "s-salma": { packageId: "p-taj12-sar", used: 3 },
  "s-ziad": { packageId: "p-rec12-egp", used: 10 },
  "s-nour": { packageId: "p-rec12-egp", used: 2 },
  "s-ibrahim": { packageId: "p-mem8-usd", used: 7 },
  "s-zainab": { packageId: "p-mem8-usd", used: 3 },
  "s-khadija": { packageId: "p-taj12-sar", used: 5 },
  "s-faris": { packageId: "p-taj12-sar", used: 12 },
};

export const enrollments: Enrollment[] = [];
export const balanceEntries: BalanceEntry[] = [];

for (const student of students) {
  const entry = plan[student.id];
  const pkg = packages.find((p) => p.id === entry.packageId)!;
  const enrollmentId = `e-${student.id.slice(2)}`;
  const credit = pkg.lessonCount + (entry.adjustments ?? 0);
  const balance = credit - entry.used;
  enrollments.push({
    id: enrollmentId,
    studentId: student.id,
    packageId: pkg.id,
    packageName: pkg.name,
    lessonCount: pkg.lessonCount,
    durationMinutes: pkg.durationMinutes,
    price: pkg.price,
    currency: pkg.currency,
    startsOn: isoDate(-24),
    expiresOn: isoDate(pkg.validityDays - 24),
    status: student.status === "archived" ? "closed" : student.id === "s-omar" ? "pending" : "active",
    balance,
  });
  if (student.id === "s-ziad") {
    enrollments.push({ id: "e-ziad-old", studentId: "s-ziad", packageId: pkg.id, packageName: pkg.name, lessonCount: 12, durationMinutes: 45, price: 1100, currency: "EGP", startsOn: isoDate(-58), expiresOn: isoDate(-28), status: "closed", balance: 0 });
  }

  let running = pkg.lessonCount;
  balanceEntries.push({ id: `${enrollmentId}-0`, enrollmentId, delta: pkg.lessonCount, balanceAfter: running, kind: "activation", reason: `${pkg.name} · ${pkg.currency} ${pkg.price}`, actorName: "Sara Mostafa", createdAt: isoAt(-24, 9) });
  let day = -23;
  for (let i = 0; i < entry.used; i += 1) {
    running -= 1;
    day += 2;
    balanceEntries.push({ id: `${enrollmentId}-l${i}`, enrollmentId, sessionNumber: 4800 + i * 7 + student.name.length, delta: -1, balanceAfter: running, kind: "lesson", reason: "Lesson completed", createdAt: isoAt(Math.min(day, -1), 14) });
    if (i === 2 && entry.adjustments) {
      running += entry.adjustments;
      balanceEntries.push({ id: `${enrollmentId}-a`, enrollmentId, delta: entry.adjustments, balanceAfter: running, kind: "adjustment", reason: student.id === "s-omar" ? "Trial lessons credited" : "Teacher no-show, credited back", actorName: "Sara Mostafa", createdAt: isoAt(Math.min(day, -1), 16) });
    }
  }
  if (entry.used === 0 && entry.adjustments) {
    running += entry.adjustments;
    balanceEntries.push({ id: `${enrollmentId}-a`, enrollmentId, delta: entry.adjustments, balanceAfter: running, kind: "adjustment", reason: "Trial lessons credited", actorName: "Sara Mostafa", createdAt: isoAt(-10, 12) });
  }
}

/**
 * Recurring series, anchored in the student's local wall time. Sessions are
 * generated through the zone rules, so DST changes (London 25 Oct, Cairo 29 Oct,
 * Toronto 1 Nov) shift the other party's time exactly like production would.
 */
const seriesPlan: { studentId: string; teacherId: string; timezone: string; weekdays: number[]; localTime: string; minutes: number }[] = [
  { studentId: "s-yusuf", teacherId: "t-kareem", timezone: "Africa/Cairo", weekdays: [1, 3], localTime: "16:00", minutes: 45 },
  { studentId: "s-aisha", teacherId: "t-huda", timezone: "Africa/Cairo", weekdays: [0, 2], localTime: "17:00", minutes: 45 },
  { studentId: "s-maryam", teacherId: "t-huda", timezone: "Asia/Riyadh", weekdays: [2, 4], localTime: "18:00", minutes: 45 },
  { studentId: "s-adam", teacherId: "t-bilal", timezone: "Europe/London", weekdays: [1, 3], localTime: "10:00", minutes: 30 },
  { studentId: "s-hamza", teacherId: "t-kareem", timezone: "Asia/Dubai", weekdays: [0, 3], localTime: "16:00", minutes: 30 },
  { studentId: "s-salma", teacherId: "t-huda", timezone: "Asia/Dubai", weekdays: [0, 4], localTime: "20:00", minutes: 45 },
  { studentId: "s-ziad", teacherId: "t-kareem", timezone: "Africa/Cairo", weekdays: [1, 6], localTime: "17:00", minutes: 45 },
  { studentId: "s-nour", teacherId: "t-bilal", timezone: "Africa/Cairo", weekdays: [3, 5], localTime: "14:00", minutes: 45 },
  { studentId: "s-ibrahim", teacherId: "t-bilal", timezone: "America/Toronto", weekdays: [1, 5], localTime: "08:00", minutes: 30 },
  { studentId: "s-khadija", teacherId: "t-huda", timezone: "America/New_York", weekdays: [0, 5], localTime: "09:00", minutes: 45 },
  { studentId: "s-zainab", teacherId: "t-kareem", timezone: "America/Toronto", weekdays: [2, 5], localTime: "09:00", minutes: 30 },
];

export const schedules: RecurringSchedule[] = seriesPlan.map((p) => ({
  id: `rs-${p.studentId.slice(2)}`,
  studentId: p.studentId,
  teacherId: p.teacherId,
  enrollmentId: `e-${p.studentId.slice(2)}`,
  timezone: p.timezone,
  weekdays: p.weekdays,
  localTime: p.localTime,
  startsOn: isoDate(-21),
  endsOn: isoDate(35),
  durationMinutes: p.minutes,
  isActive: true,
}));

const CANCEL_REASONS = ["Child unwell", "Family travelling", "School exam", "Power cut"];

export const sessions: Session[] = [];
let sessionNumber = 4790;
for (let offset = -21; offset <= 21; offset += 1) {
  const dateKey = isoDate(offset);
  const weekday = (new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7;
  for (const series of schedules) {
    if (!series.weekdays.includes(weekday)) continue;
    const start = zonedTimeToUtc(dateKey, series.localTime, series.timezone);
    const end = new Date(start.getTime() + series.durationMinutes * 60_000);
    const isPast = end.getTime() < now.getTime();
    sessionNumber += 1;
    let status: Session["status"] = isPast ? "completed" : "scheduled";
    if (isPast && sessionNumber % 11 === 0) status = "cancelled";
    // Bilal hasn't filed reports for the last day: still "scheduled" after the end → report overdue.
    if (isPast && series.teacherId === "t-bilal" && now.getTime() - end.getTime() < 30 * 3_600_000) status = "scheduled";
    sessions.push({
      id: `ss-${sessionNumber}`,
      number: sessionNumber,
      studentId: series.studentId,
      teacherId: series.teacherId,
      enrollmentId: series.enrollmentId,
      seriesId: series.id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      status,
      attendance: status === "completed" ? (sessionNumber % 13 === 0 ? "absent" : sessionNumber % 7 === 0 ? "late" : "present") : status === "cancelled" ? "absent" : "unknown",
      actualMinutes: status === "completed" && sessionNumber % 13 !== 0 ? series.durationMinutes - (sessionNumber % 7 === 0 ? 8 : 0) : 0,
      lateMinutes: status === "completed" && sessionNumber % 7 === 0 ? 8 : 0,
      cancelledBy: status === "cancelled" ? (sessionNumber % 2 ? "family" : "teacher") : undefined,
      cancelReason: status === "cancelled" ? CANCEL_REASONS[sessionNumber % CANCEL_REASONS.length] : undefined,
      version: 1,
    });
  }
}

/** A one-off make-up class that overlaps Yusuf's Tuesday slot: a real teacher conflict. */
{
  const tuesdayOffset = [1, 2, 3, 4, 5, 6, 7].find((o) => (new Date(`${isoDate(o)}T12:00:00Z`).getUTCDay() + 6) % 7 === 1)!;
  const yusufTuesday = sessions.find((s) => s.studentId === "s-yusuf" && s.startsAt.slice(0, 10) === isoDate(tuesdayOffset))!;
  const start = new Date(new Date(yusufTuesday.startsAt).getTime() + 30 * 60_000);
  sessionNumber += 1;
  sessions.push({
    id: `ss-${sessionNumber}`,
    number: sessionNumber,
    studentId: "s-hamza",
    teacherId: "t-kareem",
    enrollmentId: "e-hamza",
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status: "scheduled",
    attendance: "unknown",
    version: 1,
  });
}
sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

/** Kareem (the demo teacher) hasn't reported his latest class yet. */
{
  const last = sessions.filter((s) => s.teacherId === "t-kareem" && s.status === "completed").at(-1);
  if (last) {
    last.status = "scheduled";
    last.attendance = "unknown";
    last.actualMinutes = 0;
    last.lateMinutes = 0;
  }
}

/** Maryam's most recent class: teacher marked her absent, so deductions and pay need a decision. */
{
  const last = sessions.filter((s) => s.studentId === "s-maryam" && s.status === "completed").at(-1);
  if (last) {
    last.status = "needs_review";
    last.attendance = "absent";
    last.actualMinutes = 0;
    last.lateMinutes = 0;
  }
}

export const progress: QuranProgress[] = [
  { id: "q-1", studentId: "s-yusuf", sessionNumber: 4801, date: isoDate(-20), surah: 94, ayahFrom: 1, ayahTo: 8, activity: "memorization", rating: 4 },
  { id: "q-2", studentId: "s-yusuf", sessionNumber: 4806, date: isoDate(-17), surah: 93, ayahFrom: 1, ayahTo: 11, activity: "memorization", rating: 5 },
  { id: "q-3", studentId: "s-yusuf", sessionNumber: 4811, date: isoDate(-13), surah: 94, ayahFrom: 1, ayahTo: 8, activity: "revision", rating: 5 },
  { id: "q-4", studentId: "s-yusuf", sessionNumber: 4815, date: isoDate(-10), surah: 92, ayahFrom: 1, ayahTo: 11, activity: "memorization", rating: 3, note: "Needs more practice on ayah 7–9." },
  { id: "q-5", studentId: "s-yusuf", sessionNumber: 4821, date: isoDate(-6), surah: 92, ayahFrom: 12, ayahTo: 21, activity: "memorization", rating: 5, note: "Completed Surah Al-Layl with excellent tajweed." },
  { id: "q-6", studentId: "s-yusuf", sessionNumber: 4826, date: isoDate(-3), surah: 91, ayahFrom: 1, ayahTo: 8, activity: "memorization", rating: 4 },
  { id: "q-7", studentId: "s-maryam", sessionNumber: 4808, date: isoDate(-12), surah: 67, ayahFrom: 1, ayahTo: 15, activity: "recitation", rating: 4 },
  { id: "q-8", studentId: "s-maryam", sessionNumber: 4818, date: isoDate(-5), surah: 67, ayahFrom: 16, ayahTo: 30, activity: "recitation", rating: 5 },
  { id: "q-9", studentId: "s-aisha", sessionNumber: 4810, date: isoDate(-9), surah: 36, ayahFrom: 1, ayahTo: 12, activity: "recitation", rating: 3 },
  { id: "q-10", studentId: "s-ziad", sessionNumber: 4812, date: isoDate(-8), surah: 2, ayahFrom: 1, ayahTo: 20, activity: "recitation", rating: 4 },
  { id: "q-11", studentId: "s-khadija", sessionNumber: 0, date: isoDate(-10), surah: 18, ayahFrom: 1, ayahTo: 10, activity: "recitation", rating: 4, note: "Clear makharij; watch the ghunnah on noon sakinah." },
  { id: "q-12", studentId: "s-khadija", sessionNumber: 0, date: isoDate(-6), surah: 18, ayahFrom: 11, ayahTo: 22, activity: "recitation", rating: 4 },
  { id: "q-13", studentId: "s-khadija", sessionNumber: 0, date: isoDate(-3), surah: 18, ayahFrom: 23, ayahTo: 31, activity: "recitation", rating: 5, note: "Excellent idgham today." },
  { id: "q-14", studentId: "s-aisha", sessionNumber: 0, date: isoDate(-4), surah: 36, ayahFrom: 13, ayahTo: 27, activity: "recitation", rating: 4 },
  { id: "q-15", studentId: "s-hamza", sessionNumber: 0, date: isoDate(-7), surah: 78, ayahFrom: 1, ayahTo: 16, activity: "memorization", rating: 4 },
  { id: "q-16", studentId: "s-hamza", sessionNumber: 0, date: isoDate(-3), surah: 78, ayahFrom: 17, ayahTo: 30, activity: "memorization", rating: 3, note: "Mixing up ayahs 26–27; revise before next class." },
  { id: "q-17", studentId: "s-zainab", sessionNumber: 0, date: isoDate(-5), surah: 1, ayahFrom: 1, ayahTo: 7, activity: "revision", rating: 5 },
  { id: "q-18", studentId: "s-ziad", sessionNumber: 0, date: isoDate(-2), surah: 2, ayahFrom: 21, ayahTo: 39, activity: "recitation", rating: 4 },
];

export const notes: StudentNote[] = [
  { id: "n-1", studentId: "s-yusuf", authorName: "Sara Mostafa", visibility: "internal", text: "Father prefers WhatsApp after 20:00 Cairo. Payment usually late by a few days.", createdAt: isoAt(-15, 10) },
  { id: "n-2", studentId: "s-yusuf", authorName: "Ust. Kareem Said", visibility: "family", text: "Yusuf completed Surah Al-Layl with excellent tajweed. Next: Surah Ash-Shams.", createdAt: isoAt(-6, 15) },
  { id: "n-3", studentId: "s-yusuf", authorName: "Sara Mostafa", visibility: "internal", text: "Transferred from another academy; has memorized Juz 30 up to An-Naba.", createdAt: isoAt(-200, 9) },
  { id: "n-4", studentId: "s-maryam", authorName: "Ust. Huda Rahman", visibility: "family", text: "Great focus this week. Please practise Al-Mulk 16–30 daily.", createdAt: isoAt(-5, 16) },
  { id: "n-5", studentId: "s-omar", authorName: "Sara Mostafa", visibility: "internal", text: "Waiting for a teacher with evening availability in New York time.", createdAt: isoAt(-3, 11) },
];

export const payments: Payment[] = [
  { id: "pay-1", enrollmentId: "e-yusuf", studentId: "s-yusuf", familyId: "f-ahmed", amount: 1200, currency: "EGP", reference: "InstaPay 88213", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-25, 8), receiptName: "receipt-oct.jpg" },
  { id: "pay-2", enrollmentId: "e-aisha", studentId: "s-aisha", familyId: "f-ahmed", amount: 360, currency: "SAR", reference: "Bank transfer", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-25, 8) },
  { id: "pay-3", enrollmentId: "e-maryam", studentId: "s-maryam", familyId: "f-saleh", amount: 360, currency: "SAR", reference: "STC Pay 5521", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-24, 12) },
  { id: "pay-4", enrollmentId: "e-omar", studentId: "s-omar", familyId: "f-khalil", amount: 40, currency: "USD", reference: "Zelle", source: "family_upload", submittedBy: "", status: "pending", submittedAt: isoAt(-1, 18), receiptName: "zelle.png" },
  { id: "pay-5", enrollmentId: "e-adam", studentId: "s-adam", familyId: "f-hassan", amount: 64, currency: "GBP", reference: "FPS 1192", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-24, 9) },
  { id: "pay-6", enrollmentId: "e-hamza", studentId: "s-hamza", familyId: "f-ibrahim", amount: 40, currency: "USD", reference: "Card", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-24, 9) },
  { id: "pay-7", enrollmentId: "e-salma", studentId: "s-salma", familyId: "f-ibrahim", amount: 360, currency: "SAR", reference: "Card", source: "family_upload", submittedBy: "", status: "pending", submittedAt: isoAt(-2, 9), receiptName: "transfer.pdf" },
  { id: "pay-8", enrollmentId: "e-ziad", studentId: "s-ziad", familyId: "f-mansour", amount: 1200, currency: "EGP", reference: "Vodafone Cash", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-24, 9) },
  { id: "pay-9", enrollmentId: "e-ziad-old", studentId: "s-ziad", familyId: "f-mansour", amount: 1100, currency: "EGP", reference: "Vodafone Cash", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-58, 9) },
  { id: "pay-10", enrollmentId: "e-ibrahim", studentId: "s-ibrahim", familyId: "f-farouk", amount: 40, currency: "USD", reference: "Interac", source: "family_upload", submittedBy: "", status: "rejected", submittedAt: isoAt(-4, 20), receiptName: "blurry.jpg" },
  { id: "pay-11", enrollmentId: "e-nour", studentId: "s-nour", familyId: "f-mansour", amount: 1200, currency: "EGP", reference: "Vodafone Cash", source: "family_upload", submittedBy: "", status: "approved", submittedAt: isoAt(-24, 9) },
];

/* ── Derived records tied to real sessions ─────────────────────────────── */

const completedBy = (studentId: string) => sessions.filter((s) => s.studentId === studentId && s.status === "completed");

// Progress entries point at the student's actual completed sessions, in order.
for (const studentId of new Set(progress.map((p) => p.studentId))) {
  const done = completedBy(studentId);
  const entries = progress.filter((p) => p.studentId === studentId).sort((a, b) => a.date.localeCompare(b.date));
  const offset = Math.max(0, done.length - entries.length);
  entries.forEach((entry, i) => {
    const session = done[offset + i];
    if (!session) return;
    entry.sessionNumber = session.number;
    entry.date = session.startsAt.slice(0, 10);
  });
}

// Ledger "lesson completed" rows point at real completed sessions too.
for (const enrollment of enrollments) {
  const done = completedBy(enrollment.studentId);
  const rows = balanceEntries.filter((b) => b.enrollmentId === enrollment.id && b.kind === "lesson");
  const offset = Math.max(0, done.length - rows.length);
  rows.forEach((row, i) => {
    const session = done[offset + i];
    if (!session) return;
    row.sessionNumber = session.number;
    row.createdAt = session.endsAt;
  });
}

const FAMILY_NOTES = [
  "Good focus today. Please revise the new ayahs twice before the next class.",
  "Excellent recitation of the previous lesson. Moving on next time.",
  "Struggled a little with the madd rules; practise the highlighted lines.",
];
const INTERNAL_NOTES = ["", "Joined from a phone; audio dropped twice.", "Parent asked about adding a third weekly class."];
const HOMEWORK = ["Revise ayahs 1–8 daily", "Listen to the recitation recording 3 times", "Practise the qalqalah letters"];

export const lessonRecords: LessonRecord[] = sessions
  .filter((s) => s.status === "completed")
  .map((s) => ({
    sessionId: s.id,
    authorName: teachers.find((t) => t.id === s.teacherId)?.name ?? "",
    familyNotes: FAMILY_NOTES[s.number % FAMILY_NOTES.length],
    internalNotes: INTERNAL_NOTES[s.number % INTERNAL_NOTES.length],
    homework: HOMEWORK[s.number % HOMEWORK.length],
    submittedAt: new Date(new Date(s.endsAt).getTime() + 20 * 60_000).toISOString(),
  }));

/** Rate in force on a date (latest effective_from on or before it). */
export function rateFor(teacherId: string, onDate: string) {
  return teacherRates
    .filter((r) => r.teacherId === teacherId && r.effectiveFrom <= onDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function earningAmount(teacherId: string, session: Session, share = 1): { amount: number; currency: string } | null {
  const rate = rateFor(teacherId, session.startsAt.slice(0, 10));
  if (!rate) return null;
  const minutes = (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000;
  const base = rate.basis === "hour" ? (rate.amount * minutes) / 60 : rate.amount;
  return { amount: Math.round(base * share * 100) / 100, currency: rate.currency };
}

/** Monthly payrolls: last month is closed and paid, this month is still a draft. */
const thisMonth = today.toISOString().slice(0, 7);
const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
export const payrolls: Payroll[] = [
  { month: lastMonth, status: "paid", reviewedBy: "Mona Adel", approvedBy: "Sara Mostafa", approvedAt: `${thisMonth}-02T10:00:00.000Z`, paidAt: `${thisMonth}-03T09:00:00.000Z`, paymentReference: "Wise batch 3381" },
  { month: thisMonth, status: "draft" },
];

/**
 * Month an earning is paid in. A closed (approved or paid) month never takes
 * new rows — they land in the earliest open month as adjustments.
 */
export function payrollMonthFor(dateKey: string): string {
  const month = dateKey.slice(0, 7);
  const payroll = payrolls.find((p) => p.month === month);
  if (!payroll || payroll.status === "draft" || payroll.status === "reviewed") return month;
  const open = payrolls.filter((p) => p.month > month && (p.status === "draft" || p.status === "reviewed")).sort((a, b) => a.month.localeCompare(b.month))[0];
  if (open) return open.month;
  payrolls.push({ month: thisMonth, status: "draft" });
  return thisMonth;
}

export const earnings: EarningEntry[] = [];
for (const s of sessions) {
  const late = s.status === "cancelled" && s.cancelledBy === "family" && settings.lateCancelPayTeacher && s.number % 3 === 0;
  if (s.status !== "completed" && !late) continue;
  const pay = earningAmount(s.teacherId, s, late ? 0.5 : 1);
  if (!pay) continue;
  earnings.push({
    id: `en-${s.number}`,
    teacherId: s.teacherId,
    sessionId: s.id,
    amount: pay.amount,
    currency: pay.currency,
    earnedOn: s.startsAt.slice(0, 10),
    kind: late ? "late_cancel" : "session",
    reason: late ? "Late cancellation by family (50%)" : "Lesson taught",
    // Historic rows were paid in the month they were earned; only new rows get routed by payrollMonthFor.
    payrollMonth: s.startsAt.slice(0, 7),
  });
}

/** Append-only history per session, built lazily and extended by every change. */
export const history: Record<string, HistoryEvent[]> = {};

export function historyFor(session: Session): HistoryEvent[] {
  if (history[session.id]) return history[session.id];
  const at = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
  const teacherName = teachers.find((t) => t.id === session.teacherId)?.name ?? "";
  const events: HistoryEvent[] = [
    { id: `${session.id}-c`, entityId: session.id, at: at(session.startsAt, -21 * 24 * 60), actorName: "Sara Mostafa", action: "created", detail: session.seriesId ? "series" : "one-off" },
  ];
  const nowMs = Date.now();
  const reminderAt = at(session.startsAt, -settings.reminderMinutes);
  if (new Date(reminderAt).getTime() < nowMs && session.status !== "cancelled") {
    const queued = settings.whatsappStatus === "action_required" && nowMs - new Date(reminderAt).getTime() < 12 * 3_600_000;
    events.push({ id: `${session.id}-r`, entityId: session.id, at: reminderAt, actorName: "System", action: queued ? "reminder_queued" : "reminder_sent" });
  }
  if (session.status === "cancelled") {
    events.push({ id: `${session.id}-x`, entityId: session.id, at: at(session.startsAt, -300), actorName: session.cancelledBy === "teacher" ? teacherName : "Sara Mostafa", action: "cancelled", detail: session.cancelReason });
  }
  if (session.status === "completed" || session.status === "needs_review") {
    events.push({ id: `${session.id}-s`, entityId: session.id, at: at(session.endsAt, 20), actorName: teacherName, action: "report_submitted" });
  }
  if (session.status === "completed") {
    events.push({ id: `${session.id}-d`, entityId: session.id, at: at(session.endsAt, 21), actorName: "System", action: "completed" });
  }
  history[session.id] = events;
  return events;
}


/** Teacher quick entries: remembered selections and reusable notes. */
export const preferences: LessonPreference[] = [
  {
    teacherId: "t-kareem",
    reusableNotes: [
      "Great focus today. Please revise the new ayahs twice before the next class.",
      "Revise yesterday's portion daily; we will test it next class.",
      "Practise the highlighted madd rules with the recording.",
    ],
    remembered: { activity: "memorization", rating: 4, homework: "Revise the new ayahs twice a day", descending: true },
  },
  { teacherId: "t-huda", reusableNotes: ["Lovely recitation. Keep practising the ghunnah."], remembered: { activity: "recitation", rating: 4 } },
  { teacherId: "t-bilal", reusableNotes: [], remembered: {} },
];

/** Family cancel/reschedule requests awaiting the academy. */
export const requests: SessionRequest[] = [];
{
  const nextAisha = sessions.find((s) => s.studentId === "s-aisha" && s.status === "scheduled" && new Date(s.startsAt).getTime() > now.getTime() + 36 * 3_600_000);
  if (nextAisha) {
    const hoursNotice = (new Date(nextAisha.startsAt).getTime() - now.getTime() - 6 * 3_600_000) / 3_600_000;
    requests.push({
      id: "req-1",
      sessionId: nextAisha.id,
      kind: "reschedule",
      reason: "School trip that afternoon",
      proposedStart: new Date(new Date(nextAisha.startsAt).getTime() + 24 * 3_600_000).toISOString(),
      status: "pending",
      requestedBy: "Mahmoud Ahmed",
      createdAt: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      policy: { hoursNotice: Math.round(hoursNotice), late: hoursNotice < settings.cancellationHours, deducts: false },
    });
  }
}

/* ── Money records that need the generated data above ─────────────────── */

for (const p of payments) {
  const family = families.find((f) => f.id === p.familyId);
  p.submittedBy = family?.contacts[0]?.name ?? "";
}
for (const id of ["pay-2", "pay-6", "pay-8"]) {
  const p = payments.find((x) => x.id === id);
  if (p) {
    p.source = "staff_record";
    p.submittedBy = "Mona Adel";
  }
}
for (const p of payments.filter((x) => x.status !== "pending")) {
  p.reviewedBy = "Mona Adel";
  p.reviewedAt = new Date(new Date(p.submittedAt).getTime() + 3 * 3_600_000).toISOString();
  if (p.status === "rejected") p.reviewReason = "Receipt is unreadable — please upload a clearer photo";
}

/** Yusuf's family started a renewal and uploaded a receipt that looks like last month's. */
{
  const current = enrollments.find((e) => e.id === "e-yusuf")!;
  const pkg = packages.find((x) => x.id === current.packageId)!;
  enrollments.push({
    id: "e-yusuf-r1",
    renewedFrom: current.id,
    studentId: "s-yusuf",
    packageId: pkg.id,
    packageName: pkg.name,
    lessonCount: pkg.lessonCount,
    durationMinutes: pkg.durationMinutes,
    price: pkg.price,
    currency: pkg.currency,
    startsOn: current.expiresOn,
    expiresOn: isoDate(pkg.validityDays + 6),
    status: "pending",
    balance: 0,
  });
  payments.push({ id: "pay-12", enrollmentId: "e-yusuf-r1", studentId: "s-yusuf", familyId: "f-ahmed", amount: 1200, currency: "EGP", reference: "InstaPay 88213", status: "pending", submittedAt: isoAt(0, 6), receiptName: "instapay.jpg", method: "InstaPay", source: "family_upload", submittedBy: "Mahmoud Ahmed" });
}

/** A correction to last month, made after that payroll was paid: a traceable adjustment row. */
{
  const original = earnings.find((e) => e.payrollMonth === lastMonth && e.teacherId === "t-huda" && e.kind === "session");
  if (original) {
    earnings.push({
      id: `${original.id}-adj`,
      teacherId: original.teacherId,
      sessionId: original.sessionId,
      amount: Math.round(original.amount * 0.5 * 100) / 100,
      currency: original.currency,
      earnedOn: original.earnedOn,
      kind: "adjustment",
      reason: "Class ran 60 min, not 45 (confirmed by family)",
      payrollMonth: thisMonth,
      adjustmentOf: original.id,
      createdBy: "Mona Adel",
    });
  }
}

export const issues: EarningsIssue[] = [];
{
  const recent = earnings.filter((e) => e.teacherId === "t-kareem" && e.kind === "session" && e.payrollMonth === thisMonth).at(-2);
  if (recent) {
    issues.push({
      id: "iss-1",
      teacherId: "t-kareem",
      entryId: recent.id,
      sessionId: recent.sessionId,
      description: "This class ran 15 minutes over because the student joined late from school — can it be paid as 60 minutes?",
      status: "open",
      createdAt: isoAt(-2, 18),
    });
  }
}


/* ── Communication & settings ──────────────────────────────────────────── */

/** HireAgents channel 70 sends from the academy number. The API key lives only in the backend env. */
export const whatsapp: WhatsAppConnection = {
  provider: "HireAgents",
  channelId: "70",
  sender: "+20 12 05396657",
  status: settings.whatsappStatus,
  // The channel stopped delivering six hours ago; everything due since then is queued.
  since: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
  lastSuccessAt: new Date(now.getTime() - 6 * 3_600_000 - 18 * 60_000).toISOString(),
  apiKeyConfigured: false,
};

export const templates: MessageTemplate[] = [
  { id: "tpl-rem-ar", name: "class_reminder_ar", providerTemplate: "class_reminder", language: "ar", body: "تذكير: حصة {{student}} مع {{teacher}} اليوم الساعة {{time}}. رابط الحصة: {{meeting_url}}", isActive: true },
  { id: "tpl-rem-en", name: "class_reminder_en", providerTemplate: "class_reminder", language: "en", body: "Reminder: {{student}}'s class with {{teacher}} is today at {{time}}. Join: {{meeting_url}}", isActive: true },
  { id: "tpl-chg-ar", name: "schedule_changed_ar", providerTemplate: "schedule_changed", language: "ar", body: "تم تغيير موعد حصة {{student}}: {{old_time}} ← {{new_time}}.", isActive: true },
  { id: "tpl-chg-en", name: "schedule_changed_en", providerTemplate: "schedule_changed", language: "en", body: "{{student}}'s class moved: {{old_time}} → {{new_time}}.", isActive: true },
  { id: "tpl-low-ar", name: "low_balance_ar", providerTemplate: "low_balance", language: "ar", body: "تبقّى {{lessons}} حصص في باقة {{student}}. جدّدوا لاستمرار الحصص.", isActive: true },
  { id: "tpl-low-en", name: "low_balance_en", providerTemplate: "low_balance", language: "en", body: "{{student}} has {{lessons}} lessons left. Renew to keep classes going.", isActive: true },
  { id: "tpl-ren-en", name: "renewal_confirmed_en", providerTemplate: "renewal_confirmed", language: "en", body: "Payment received — {{package}} is active for {{student}}. {{lessons}} lessons added.", isActive: false },
];

export const automations: MessageAutomation[] = [
  { id: "au-1", event: "reminder", templateId: "tpl-rem-ar", isEnabled: true },
  { id: "au-2", event: "session_changed", templateId: "tpl-chg-ar", isEnabled: true },
  { id: "au-3", event: "low_balance", templateId: "tpl-low-ar", isEnabled: true },
  { id: "au-4", event: "renewal", templateId: "tpl-ren-en", isEnabled: false },
];

/** Outbox: today's reminders are queued because the channel needs attention. */
export const outbox: OutboxMessage[] = [];
{
  let n = 0;
  const contactFor = (familyId: string) => families.find((f) => f.id === familyId)?.contacts.find((c) => c.receivesNotifications);
  const windowStart = now.getTime() - 3 * DAY;
  const windowEnd = now.getTime() + 2 * DAY;
  for (const s of sessions.filter((x) => x.status !== "cancelled" && new Date(x.startsAt).getTime() > windowStart && new Date(x.startsAt).getTime() < windowEnd)) {
    const student = students.find((x) => x.id === s.studentId)!;
    const contact = contactFor(student.familyId);
    if (!contact) continue;
    const due = new Date(new Date(s.startsAt).getTime() - settings.reminderMinutes * 60_000);
    const past = due.getTime() < now.getTime();
    const withinOutage = past && due.getTime() >= now.getTime() - 6 * 3_600_000;
    const tooOld = now.getTime() - due.getTime() > 3 * DAY;
    if (tooOld) continue;
    n += 1;
    outbox.push({
      id: `msg-${n}`,
      familyId: student.familyId,
      studentId: student.id,
      sessionId: s.id,
      templateId: student.language === "en" ? "tpl-rem-en" : "tpl-rem-ar",
      destination: contact.phone,
      variables: { student: student.name.split(" ")[0], teacher: teachers.find((t) => t.id === s.teacherId)?.name ?? "" },
      dueAt: due.toISOString(),
      status: withinOutage ? "queued" : past ? (n % 17 === 0 ? "failed" : "sent") : "queued",
      error: !withinOutage && past && n % 17 === 0 ? "Recipient is not on WhatsApp" : undefined,
      sentAt: past && !withinOutage && n % 17 !== 0 ? new Date(due.getTime() + 4_000).toISOString() : undefined,
    });
  }
  const failing = outbox.find((m) => m.status === "queued" && new Date(m.dueAt).getTime() < now.getTime());
  if (failing) {
    failing.status = "action_required";
    failing.error = "Delivery outcome is uncertain. Reconcile with the provider before retrying.";
  }
  outbox.push({ id: `msg-${n + 1}`, familyId: "f-saleh", studentId: "s-maryam", templateId: "tpl-low-ar", destination: "+966 50 123 4567", variables: { student: "Maryam", lessons: "1" }, dueAt: isoAt(-1, 9), status: "sent", sentAt: isoAt(-1, 9, 1) });
}

export const staff: StaffMember[] = [
  { id: "st-1", name: "Sara Mostafa", phone: "+20 100 111 2233", role: "admin", isActive: true },
  { id: "st-2", name: "Mona Adel", phone: "+20 101 222 3344", role: "accountant", isActive: true },
  { id: "st-3", name: "Hassan Fathy", phone: "+20 102 333 4455", role: "coordinator", isActive: true },
];

export const paymentMethods: string[] = ["InstaPay", "Vodafone Cash", "Bank transfer", "STC Pay", "Zelle"];
