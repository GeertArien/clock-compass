/** Monday of the current ISO week, as an ISO string (matches the server). */
export function startOfIsoWeekIso(reference: Date = new Date()): string {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return d.toISOString();
}

/**
 * The Monday of this week as a plain date at UTC midnight, the way the server
 * stores a week (#112): the date the device sees, never moved by a zone.
 */
export function isoWeekMondayPlain(reference: Date = new Date()): string {
  return `${localDay(new Date(startOfIsoWeekIso(reference)))}T00:00:00.000Z`;
}

/** The seven Dates (local midnight, Mon–Sun) of the week `offset` weeks away. */
export function weekDays(offset = 0, reference: Date = new Date()): Date[] {
  const monday = new Date(startOfIsoWeekIso(reference));
  monday.setDate(monday.getDate() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/** True when the ISO timestamp falls on the same local calendar day as `day`. */
export function isSameLocalDay(iso: string | null, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

/** A Date's local calendar day as YYYY-MM-DD (how the Clock names a day). */
export function localDay(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * A task's scheduled day, `YYYY-MM-DD` (#136): a plain date, sent and stored
 * as that date at UTC midnight like a due date, so it is the same day in
 * every zone.
 *
 * LEGACY (#136, to remove in #137): a value not moved yet is midnight on the
 * device that scheduled it; it is read as the day it falls on here, as it
 * was before. A value at UTC midnight is the plain form (an old one written
 * in UTC was its own date already).
 */
export function scheduledDayOf(task: { scheduledDay: string | null }): string | null {
  const stored = task.scheduledDay;
  if (!stored) return null;
  if (stored.length === 10 || stored.slice(10, 24) === "T00:00:00.000Z") return stored.slice(0, 10);
  return localDay(new Date(stored)); // LEGACY (#137)
}

/** A plain day as the server stores and answers it (`2026-11-26T00:00:00.000Z`). */
export function storedDay(day: string): string {
  return `${day.slice(0, 10)}T00:00:00.000Z`;
}

/**
 * The calendar day a task sits on in Clock · Week: its scheduled day (a plain
 * date, #136). A recurring task with no scheduled day sits on
 * its due date (#105 step 2; a due date is a plain date at UTC midnight).
 * Other tasks with only a due date stay off the calendar, as before, and so
 * does a task whose series stopped repeating: it is a normal task again.
 */
export function calendarDay(task: {
  scheduledDay: string | null;
  dueDate: string | null;
  recurrence?: { active: boolean } | null;
}): string | null {
  if (task.scheduledDay) return scheduledDayOf(task);
  if (task.recurrence?.active && task.dueDate) return task.dueDate.slice(0, 10);
  return null;
}

/** "7:30 pm" from "19:30"; null passes through. */
export function formatTime(hhmm: string | null): string | null {
  if (!hhmm) return null;
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
