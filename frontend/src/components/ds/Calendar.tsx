"use client";

import React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { zonedParts, zoneCity } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionStatus } from "@/features/academy/types";
import { StatusBadge } from "./StatusBadge";
import { MultiZoneTimes, type ZoneRole } from "./Time";
import { Button } from "./Button";

export interface CalendarEvent {
  id: string;
  startsAt: string;
  endsAt: string;
  title: string;
  status: SessionStatus;
}

export interface CalendarDay {
  dateKey: string;
  label: string;
  isToday?: boolean;
  /** Available windows in minutes after midnight (display zone). Outside them is hatched. */
  available?: { start: number; end: number }[];
}

const eventStyle: Record<SessionStatus, string> = {
  scheduled: "bg-st-scheduled-bg border-st-scheduled text-st-scheduled",
  completed: "bg-st-completed-bg border-st-completed text-st-completed",
  needs_review: "bg-st-review-bg border-st-review text-st-review",
  cancelled: "bg-st-cancelled-bg border-st-cancelled text-st-cancelled line-through",
};

const HOUR_PX = 56;

/**
 * Week/day time grid in one display zone. Hatched = teacher unavailable,
 * red = overlapping classes. Events are buttons, so the grid is fully
 * keyboard-operable (no drag required).
 */
export function WeekGrid({ days, events, timeZone, startHour = 8, endHour = 22, onSelect, selectedId, conflicts, minWidth = 640 }: {
  days: CalendarDay[];
  events: CalendarEvent[];
  timeZone: string;
  startHour?: number;
  endHour?: number;
  onSelect?: (event: CalendarEvent) => void;
  selectedId?: string;
  /** Ids in conflict. When omitted, any overlap in a column counts (single-teacher views). */
  conflicts?: Set<string>;
  minWidth?: number;
}) {
  const { t, tag } = useI18n();
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_PX;
  const hourLabel = new Intl.DateTimeFormat(tag, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const timeLabel = new Intl.DateTimeFormat(tag, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const placed = events.map((event) => {
    const start = zonedParts(event.startsAt, timeZone);
    const end = zonedParts(event.endsAt, timeZone);
    return { event, dateKey: start.dateKey, start: start.minutes, end: end.dateKey === start.dateKey ? end.minutes : 24 * 60 };
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-line-soft bg-surface">
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, minWidth }}>
        <div className="border-b border-line-soft bg-page p-2 text-xs text-muted">{zoneCity(timeZone, tag)}</div>
        {days.map((day) => (
          <div key={day.dateKey} className={cn("border-b border-s border-line-soft p-2 text-xs font-semibold", day.isToday ? "bg-brand-50 text-brand-800" : "bg-page")}>
            {day.label}{day.isToday && ` · ${t.calendar.today}`}
          </div>
        ))}

        <div className="relative" style={{ height }}>
          {hours.map((h, i) => (
            <div key={h} className="absolute inset-x-0 px-2 pt-1 text-xs text-muted tabular" style={{ top: i * HOUR_PX }}>
              {hourLabel.format(Date.UTC(2000, 0, 1, h))}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayEvents = placed
            .filter((p) => p.dateKey === day.dateKey && p.end > startHour * 60 && p.start < endHour * 60)
            .sort((a, b) => a.start - b.start || b.end - a.end);
          const lanes = layoutLanes(dayEvents);
          const blocked = day.available ? invert(day.available, startHour * 60, endHour * 60) : [];
          return (
            <div key={day.dateKey} className="relative border-s border-line-soft" style={{ height }}>
              {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-subtle" style={{ top: i * HOUR_PX }} />)}
              {blocked.map((b, i) => (
                <div
                  key={i}
                  title={t.calendar.unavailable}
                  className="absolute inset-x-0"
                  style={{ top: ((b.start - startHour * 60) / 60) * HOUR_PX, height: ((b.end - b.start) / 60) * HOUR_PX, background: "repeating-linear-gradient(135deg, var(--color-page) 0 6px, var(--color-surface) 6px 12px)" }}
                >
                  <span className="sr-only">{t.calendar.unavailable}</span>
                </div>
              ))}
              {dayEvents.map(({ event, start, end }, index) => {
                const conflict = conflicts
                  ? conflicts.has(event.id)
                  : event.status !== "cancelled" && dayEvents.some((o) => o.event.id !== event.id && o.event.status !== "cancelled" && o.start < end && start < o.end);
                const top = ((Math.max(start, startHour * 60) - startHour * 60) / 60) * HOUR_PX;
                const h = Math.max(((Math.min(end, endHour * 60) - Math.max(start, startHour * 60)) / 60) * HOUR_PX - 4, 28);
                const { lane, of } = lanes[index];
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelect?.(event)}
                    aria-pressed={onSelect ? selectedId === event.id : undefined}
                    aria-label={`${event.title}, ${timeLabel.format(new Date(event.startsAt))}–${timeLabel.format(new Date(event.endsAt))}, ${conflict ? t.calendar.conflict : t.status[event.status]}`}
                    className={cn(
                      "absolute overflow-hidden rounded-lg border-s-[3px] px-1.5 py-1 text-start text-xs leading-tight",
                      conflict ? "bg-st-action-bg border-st-action text-st-action" : eventStyle[event.status],
                      selectedId === event.id && "z-10 ring-2 ring-brand-800",
                    )}
                    style={{ top: top + 2, height: h, insetInlineStart: `calc(${(lane / of) * 100}% + 3px)`, width: `calc(${100 / of}% - 6px)` }}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      {conflict && <AlertTriangle aria-hidden className="size-3 shrink-0" />}
                      {event.status === "completed" && !conflict && <Check aria-hidden className="size-3 shrink-0" />}
                      <span className="truncate">{event.title}</span>
                    </span>
                    {h > 34 && <span className="block truncate">{conflict ? t.calendar.conflict : t.status[event.status]}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 border-t border-subtle px-3 py-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border border-line" style={{ background: "repeating-linear-gradient(135deg, var(--color-page) 0 3px, var(--color-surface) 3px 6px)" }} />{t.calendar.unavailable}</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle aria-hidden className="size-3 text-st-action" />{t.calendar.conflict}</span>
      </div>
    </div>
  );
}

/** Side-by-side lanes for overlapping events (input sorted by start). */
function layoutLanes(items: { start: number; end: number }[]): { lane: number; of: number }[] {
  const result: { lane: number; of: number }[] = [];
  let cluster: number[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    for (const i of cluster) result[i].of = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  items.forEach((item, i) => {
    if (item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    result[i] = { lane, of: 1 };
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  flush();
  return result;
}

function invert(windows: { start: number; end: number }[], from: number, to: number) {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = from;
  for (const w of sorted) {
    if (w.start > cursor) out.push({ start: cursor, end: Math.min(w.start, to) });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out.filter((b) => b.end > b.start);
}

/** Prominent class card (dark) used for "next class" on Today and overview surfaces. */
export function ClassCard({ statusLabel, meta, title, withWhom, iso, zones, onJoin, joinLabel, secondary }: {
  statusLabel: React.ReactNode;
  meta?: React.ReactNode;
  title: React.ReactNode;
  withWhom?: React.ReactNode;
  iso: string;
  zones: ZoneRole[];
  onJoin?: () => void;
  joinLabel: string;
  secondary?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2.5 rounded-[20px] bg-brand-800 p-4 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-[3px] text-xs font-medium text-brand-100">{statusLabel}</span>
        {meta && <span className="text-xs text-brand-300">{meta}</span>}
      </div>
      <div className="text-lg font-semibold">
        {title} {withWhom && <span className="font-normal text-brand-300">{withWhom}</span>}
      </div>
      <MultiZoneTimes iso={iso} zones={zones} variant="on-dark" />
      <div className="mt-1 flex gap-2">
        <Button variant="on-dark" className="flex-1" onClick={onJoin}>{joinLabel}</Button>
        {secondary}
      </div>
    </article>
  );
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <StatusBadge status={status} />;
}
