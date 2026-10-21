/**
 * Locale-aware formatting. Every displayed time carries its zone label, and
 * money is grouped per currency — never summed across currencies.
 */

const CITY_AR: Record<string, string> = {
  Cairo: "القاهرة",
  Istanbul: "إسطنبول",
  Riyadh: "الرياض",
  London: "لندن",
  New_York: "نيويورك",
  Dubai: "دبي",
  Toronto: "تورنتو",
};

/** "Africa/Cairo" → "Cairo" / "القاهرة". */
export function zoneCity(timeZone: string, tag: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  if (tag.startsWith("ar") && CITY_AR[city]) return CITY_AR[city];
  return city.replace(/_/g, " ");
}

/** "UTC+3" for the zone at the given instant (DST-aware). */
export function zoneOffset(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return part.replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
}

/** Wall-clock date key ("2026-10-19") and minutes after midnight in a zone. */
export function zonedParts(iso: string, timeZone: string): { dateKey: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

export function formatTime(iso: string, timeZone: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

export function formatWeekdayTime(iso: string, timeZone: string, tag: string): string {
  const weekday = new Intl.DateTimeFormat(tag, { timeZone, weekday: "short" }).format(new Date(iso));
  return `${weekday} ${formatTime(iso, timeZone, tag)}`;
}

/** Date-only values ("2026-10-19") formatted without zone shifting. */
export function formatDate(dateOrIso: string, tag: string, style: "short" | "long" = "short"): string {
  const date = dateOrIso.length === 10 ? new Date(`${dateOrIso}T12:00:00Z`) : new Date(dateOrIso);
  return new Intl.DateTimeFormat(tag, {
    timeZone: dateOrIso.length === 10 ? "UTC" : undefined,
    day: "numeric",
    month: "short",
    year: style === "long" ? "numeric" : undefined,
  }).format(date);
}

export function formatNumber(value: number, tag: string): string {
  return new Intl.NumberFormat(tag).format(value);
}

export function formatMoney(amount: number, currency: string, tag: string): string {
  return new Intl.NumberFormat(tag, { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(amount);
}

/** Groups amounts by currency, preserving first-seen order. */
export function totalsByCurrency<T>(items: T[], amount: (item: T) => number, currency: (item: T) => string): { currency: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(currency(item), (totals.get(currency(item)) ?? 0) + amount(item));
  return [...totals].map(([code, total]) => ({ currency: code, total }));
}

export function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

export function initials(name: string): string {
  const words = name.replace(/^(Ust\.|Dr\.)\s+/i, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export const TIME_ZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Europe/Istanbul",
  "Europe/London",
  "America/New_York",
  "America/Toronto",
] as const;

/** Minutes the zone is ahead of UTC at the given instant (DST-aware). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - at.getTime()) / 60_000);
}

/** The instant when the wall clock in `timeZone` reads `dateKey` `hhmm` ("2026-10-20", "16:00"). */
export function zonedTimeToUtc(dateKey: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffsetMinutes(timeZone, new Date(guess)) * 60_000;
  const second = guess - tzOffsetMinutes(timeZone, new Date(first)) * 60_000;
  return new Date(second);
}

/** "2026-10-20" + n days. */
export function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Weekday of a date key, 0 = Monday. */
export function weekdayOfKey(dateKey: string): number {
  return (new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Monday of the week containing the date key. */
export function startOfWeekKey(dateKey: string): string {
  return addDaysKey(dateKey, -weekdayOfKey(dateKey));
}

/** Wall-clock "HH:MM" of an instant in a zone. */
export function wallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Reference numbers (session #4821): locale digits, no grouping separators. */
export function formatRef(value: number, tag: string): string {
  return new Intl.NumberFormat(tag, { useGrouping: false }).format(value);
}
