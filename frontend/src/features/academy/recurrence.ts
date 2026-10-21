/**
 * Recurring-schedule expansion with pre-save checks. Pure: the form recomputes
 * it on every change so the preview and warnings are always live.
 */
import { addDaysKey, wallTime, weekdayOfKey, zonedParts, zonedTimeToUtc } from "@/lib/format";
import type { Availability, Enrollment, Session } from "./types";

export interface RecurrenceInput {
  timezone: string;
  weekdays: number[];
  localTime: string;
  startsOn: string;
  endsOn: string;
  durationMinutes: number;
}

export interface Occurrence {
  dateKey: string;
  start: string;
  end: string;
  studentTime: string;
  teacherTime: string;
  teacherDateKey: string;
  conflictWith: Session | null;
  outsideAvailability: boolean;
  beyondValidity: boolean;
  beyondBalance: boolean;
  /** The party's wall time differs from the first occurrence (DST moved it). */
  studentShift: boolean;
  teacherShift: boolean;
}

export interface DstShift {
  party: "student" | "teacher";
  timeZone: string;
  fromDate: string;
  before: string;
  after: string;
}

export interface RecurrencePreview {
  occurrences: Occurrence[];
  conflicts: Occurrence[];
  unavailable: Occurrence[];
  beyondValidity: Occurrence[];
  beyondBalance: Occurrence[];
  dstShifts: DstShift[];
  truncated: boolean;
}

const MAX_OCCURRENCES = 80;

export function expandRecurrence(
  input: RecurrenceInput,
  ctx: {
    studentId: string;
    teacherId: string;
    studentTimezone: string;
    teacherTimezone: string;
    sessions: Session[];
    availability: Availability[];
    enrollment: Enrollment | null;
    /** Sessions being replaced by this edit are not conflicts with themselves. */
    ignoreSessionIds?: Set<string>;
  },
): RecurrencePreview {
  const occurrences: Occurrence[] = [];
  let truncated = false;
  if (!input.weekdays.length || !input.localTime || !input.startsOn || !input.endsOn || input.endsOn < input.startsOn) {
    return { occurrences, conflicts: [], unavailable: [], beyondValidity: [], beyondBalance: [], dstShifts: [], truncated };
  }

  const others = ctx.sessions.filter((s) => s.status !== "cancelled" && !ctx.ignoreSessionIds?.has(s.id) && (s.teacherId === ctx.teacherId || s.studentId === ctx.studentId));
  const windows = ctx.availability.filter((a) => a.teacherId === ctx.teacherId);
  let firstStudent = "";
  let firstTeacher = "";
  let used = 0;
  const balance = ctx.enrollment?.balance ?? 0;

  for (let key = input.startsOn; key <= input.endsOn; key = addDaysKey(key, 1)) {
    if (!input.weekdays.includes(weekdayOfKey(key))) continue;
    if (occurrences.length >= MAX_OCCURRENCES) {
      truncated = true;
      break;
    }
    const start = zonedTimeToUtc(key, input.localTime, input.timezone);
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const studentTime = wallTime(startIso, ctx.studentTimezone);
    const teacherTime = wallTime(startIso, ctx.teacherTimezone);
    if (!firstStudent) {
      firstStudent = studentTime;
      firstTeacher = teacherTime;
    }
    const teacherStart = zonedParts(startIso, ctx.teacherTimezone);
    const teacherEnd = teacherStart.minutes + input.durationMinutes;
    const outsideAvailability = windows.length > 0 && !windows.some((w) => {
      const [sh, sm] = w.startTime.split(":").map(Number);
      const [eh, em] = w.endTime.split(":").map(Number);
      return w.weekday === teacherStart.weekday && teacherStart.minutes >= sh * 60 + sm && teacherEnd <= eh * 60 + em;
    });
    const conflictWith = others.find((s) => s.startsAt < endIso && startIso < s.endsAt) ?? null;
    used += 1;
    occurrences.push({
      dateKey: key,
      start: startIso,
      end: endIso,
      studentTime,
      teacherTime,
      teacherDateKey: teacherStart.dateKey,
      conflictWith,
      outsideAvailability,
      beyondValidity: !!ctx.enrollment && key > ctx.enrollment.expiresOn,
      beyondBalance: !!ctx.enrollment && used > balance,
      studentShift: studentTime !== firstStudent,
      teacherShift: teacherTime !== firstTeacher,
    });
  }

  const dstShifts: DstShift[] = [];
  for (const party of ["student", "teacher"] as const) {
    let previous: Occurrence | null = null;
    for (const occ of occurrences) {
      const time = party === "student" ? occ.studentTime : occ.teacherTime;
      const prevTime = previous ? (party === "student" ? previous.studentTime : previous.teacherTime) : null;
      if (prevTime && prevTime !== time) {
        dstShifts.push({ party, timeZone: party === "student" ? ctx.studentTimezone : ctx.teacherTimezone, fromDate: occ.dateKey, before: prevTime, after: time });
      }
      previous = occ;
    }
  }

  return {
    occurrences,
    conflicts: occurrences.filter((o) => o.conflictWith),
    unavailable: occurrences.filter((o) => o.outsideAvailability),
    beyondValidity: occurrences.filter((o) => o.beyondValidity),
    beyondBalance: occurrences.filter((o) => o.beyondBalance),
    dstShifts,
    truncated,
  };
}

/** Teacher availability for a set of display days, converted into the display zone. */
export function availabilityInZone(
  windows: Availability[],
  dayKeys: string[],
  displayZone: string,
): Record<string, { start: number; end: number }[]> {
  const out: Record<string, { start: number; end: number }[]> = Object.fromEntries(dayKeys.map((k) => [k, []]));
  if (!dayKeys.length) return out;
  // Walk teacher-local dates one day either side so windows crossing midnight in the display zone land correctly.
  for (let key = addDaysKey(dayKeys[0], -1); key <= addDaysKey(dayKeys[dayKeys.length - 1], 1); key = addDaysKey(key, 1)) {
    for (const w of windows) {
      if (w.weekday !== weekdayOfKey(key)) continue;
      const start = zonedTimeToUtc(key, w.startTime, w.timezone).toISOString();
      const end = zonedTimeToUtc(key, w.endTime, w.timezone).toISOString();
      const s = zonedParts(start, displayZone);
      const e = zonedParts(end, displayZone);
      if (s.dateKey === e.dateKey) {
        out[s.dateKey]?.push({ start: s.minutes, end: e.minutes });
      } else {
        out[s.dateKey]?.push({ start: s.minutes, end: 24 * 60 });
        out[e.dateKey]?.push({ start: 0, end: e.minutes });
      }
    }
  }
  return out;
}
