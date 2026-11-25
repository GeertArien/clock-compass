/**
 * A task's scheduled day (#136). It is a plain date, like a due date: the
 * calendar date at UTC midnight, with the time (`scheduledTime`, "HH:MM")
 * floating beside it, no zone attached. Thursday 26 November is stored as
 * `2026-11-26T00:00:00.000Z` whoever wrote it, and reads as Thursday in every
 * zone. Nothing else can be stored (`TaskService` refuses it), and a database
 * that still holds the form of before #136 is stopped at start-up (#137).
 */
import { dayAtUtc, plainDayOf, type PlainDay } from "./week.js";

/** The scheduled day of a stored value, `YYYY-MM-DD`. */
export function scheduledDayOf(stored: Date | string | null | undefined): PlainDay | null {
  if (!stored) return null;
  return plainDayOf(typeof stored === "string" ? new Date(stored) : stored);
}

/** A scheduled day as it is stored: that date at UTC midnight. */
export function storedScheduledDay(day: PlainDay): Date {
  return dayAtUtc(day);
}
