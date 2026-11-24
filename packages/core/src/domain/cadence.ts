import type { CadenceUnit } from "@prisma/client";

/**
 * Shared cadence/recurrence logic, modelled once (CLAUDE.md): relationship
 * commitments (Habits 4-6) use it today, recurring tasks (#105) next.
 *
 * Dates move on the calendar, not by a fixed number of milliseconds: a
 * month is a calendar month and a year a calendar year, so "monthly" from
 * 15 March is 15 April. The calendar is UTC's, which is exact for the plain
 * dates the app stores at UTC midnight (due dates, and the dates of #105);
 * for an instant such as a logged occurrence, the time of day is kept.
 */
export interface Cadence {
  unit: CadenceUnit;
  value: number; // every `value` `unit`s, e.g. { WEEK, 2 } = every two weeks.
}

export type CommitmentStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * `from` moved by `n` cadences (n × value units; n may be negative).
 * Days and weeks add days. Months and years add calendar months and keep the
 * day of the month where it exists, else the month's last day: 31 January
 * monthly gives 28 (or 29) February; 29 February yearly gives 28 February in
 * other years. Counting from one anchor (`n` = 1, 2, 3…), rather than from
 * the previous result, keeps the 31st on the 31st where a month has one.
 */
export function addCadence(from: Date, cadence: Cadence, n = 1): Date {
  const steps = Math.max(1, cadence.value) * n;
  switch (cadence.unit) {
    case "DAY":
      return new Date(from.getTime() + steps * MS_PER_DAY);
    case "WEEK":
      return new Date(from.getTime() + steps * 7 * MS_PER_DAY);
    case "MONTH":
    case "YEAR": {
      const months = cadence.unit === "YEAR" ? steps * 12 : steps;
      const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
      const year = Math.floor(total / 12);
      const month = total - year * 12;
      const day = Math.min(from.getUTCDate(), daysInMonth(year, month));
      const timeOfDay = from.getTime() - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
      return new Date(Date.UTC(year, month, day) + timeOfDay);
    }
  }
}

/** A plain date ("YYYY-MM-DD") moved by `n` cadences, as `addCadence` does. */
export function addCadenceToDay(day: string, cadence: Cadence, n = 1): string {
  return addCadence(new Date(`${day}T00:00:00.000Z`), cadence, n).toISOString().slice(0, 10);
}

/** When the next occurrence is due, given the last time it happened: one cadence later on the calendar. */
export function nextDueDate(lastOccurred: Date, cadence: Cadence): Date {
  return addCadence(lastOccurred, cadence, 1);
}

/**
 * Hit/miss history for the last `periods` cadence periods, oldest first —
 * the streak/history view (chosen over pass/fail-per-period rows). Periods
 * are counted back from `now` on the calendar (a monthly period is a calendar
 * month long). A period is "hit" when at least one occurrence falls inside it.
 */
export function periodHistory(
  occurrences: Date[],
  cadence: Cadence,
  periods = 8,
  now: Date = new Date(),
): boolean[] {
  const times = occurrences.map((d) => d.getTime());
  const history: boolean[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    const end = addCadence(now, cadence, -i).getTime();
    const start = addCadence(now, cadence, -(i + 1)).getTime();
    history.push(times.some((t) => t > start && t <= end));
  }
  return history;
}

/**
 * Derive an on-track / due-soon / overdue status from the cadence and the most
 * recent occurrence. "Due soon" is the final 20% of the interval, the interval
 * being this period's real length (a calendar month is 28 to 31 days).
 */
export function deriveStatus(
  lastOccurred: Date | null,
  cadence: Cadence,
  now: Date = new Date(),
): CommitmentStatus {
  if (!lastOccurred) return "OVERDUE";
  const due = nextDueDate(lastOccurred, cadence).getTime();
  if (now.getTime() >= due) return "OVERDUE";
  const interval = due - lastOccurred.getTime();
  const remaining = due - now.getTime();
  return remaining <= interval * 0.2 ? "DUE_SOON" : "ON_TRACK";
}
