/**
 * Plain calendar days (issue #112).
 *
 * A day is a string `YYYY-MM-DD` with no zone. It is stored as that date at
 * UTC midnight, like a due date, so a stored day never moves when the
 * server's zone changes. "Today" is the day an instant falls on in a zone:
 * the caller's (`X-Time-Zone`) when there is one, else the server's (`TZ`).
 * Nothing here reads the process's local time.
 *
 * Weeks are ISO weeks: they start on Monday (the weekly "big rocks first"
 * planning view).
 */
import { isTimeZone, zonedDay } from "./zoned.js";

/** A calendar day, `YYYY-MM-DD`. */
export type PlainDay = string;

/**
 * The zone the server runs in (`TZ`): "today" for callers without a zone.
 * UTC when the runtime cannot name one (an empty or unknown `TZ`).
 */
export function serverZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone as string | undefined;
  return zone && isTimeZone(zone) ? zone : "UTC";
}

/** Where "today" comes from: an instant and the zone it is read in. */
export interface DayClock {
  now?: Date;
  /** IANA zone; absent = the server's. */
  timeZone?: string;
}

/** The clock filled in: now, and the caller's zone or else the server's. */
export function resolveClock(clock: DayClock = {}): { now: Date; timeZone: string } {
  return { now: clock.now ?? new Date(), timeZone: clock.timeZone ?? serverZone() };
}

/** Today in the clock's zone. */
export function todayOf(clock: DayClock = {}): PlainDay {
  const { now, timeZone } = resolveClock(clock);
  return zonedDay(now, timeZone);
}

/** A day as it is stored: that date at UTC midnight. */
export function dayAtUtc(day: PlainDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A stored day (UTC midnight) back as `YYYY-MM-DD`. */
export function plainDayOf(stored: Date): PlainDay {
  return stored.toISOString().slice(0, 10);
}

/** The day `n` days after `day` (before, for a negative `n`). */
export function addDays(day: PlainDay, n: number): PlainDay {
  const d = dayAtUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return plainDayOf(d);
}

/** The Monday of the ISO week `day` is in. */
export function isoWeekStart(day: PlainDay): PlainDay {
  const weekday = dayAtUtc(day).getUTCDay(); // 0 = Sunday ... 6 = Saturday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

/** The ISO weekday of `day`: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: PlainDay): number {
  const weekday = dayAtUtc(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Whether `day` is in the week starting on Monday `weekStart`. */
export function inWeek(day: PlainDay, weekStart: PlainDay): boolean {
  return day >= weekStart && day < addDays(weekStart, 7);
}
