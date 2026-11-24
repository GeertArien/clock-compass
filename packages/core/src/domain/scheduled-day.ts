/**
 * A task's scheduled day (#136). It is a plain date, like a due date: the
 * calendar date at UTC midnight, with the time (`scheduledTime`, "HH:MM")
 * floating beside it, no zone attached. Thursday 26 November is stored as
 * `2026-11-26T00:00:00.000Z` whoever wrote it, and reads as Thursday in every
 * zone.
 */
import { dayAtUtc, isPlainDate, plainDayOf, type PlainDay } from "./week.js";
import { zonedDay } from "./zoned.js";

/**
 * The scheduled day of a stored value, `YYYY-MM-DD`.
 *
 * LEGACY (#136, to remove in #137): before #136 a scheduled day was stored as
 * midnight on the device that scheduled it (Thursday from Brussels =
 * `2026-11-25T23:00Z`). Such a value, not moved yet, is read as it was read
 * before: the day it falls on in `zone`, the reader's zone. A value at UTC
 * midnight is taken as plain, which is safe for an old value too: one written
 * by a device in UTC (or in London in winter) was its own date at UTC
 * midnight already, so both readings give the same day.
 */
export function scheduledDayOf(stored: Date | string | null | undefined, zone: string): PlainDay | null {
  if (!stored) return null;
  const value = typeof stored === "string" ? new Date(stored) : stored;
  if (isPlainDate(value)) return plainDayOf(value);
  return zonedDay(value, zone); // LEGACY (#137)
}

/** A scheduled day as it is stored: that date at UTC midnight. */
export function storedScheduledDay(day: PlainDay): Date {
  return dayAtUtc(day);
}
