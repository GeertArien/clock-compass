/**
 * Recurring tasks (#105): the dates of the next occurrence, as plain
 * calendar days ("YYYY-MM-DD"). Pure functions on top of the shared cadence
 * arithmetic (domain/cadence.ts); the service turns days into stored
 * instants: due dates and "show from" at UTC midnight, the scheduled day at
 * the user's local midnight.
 */
import type { CadenceUnit, RepeatFrom } from "@prisma/client";
import { addCadenceToDay, type Cadence } from "./cadence.js";

export interface RecurrenceRule {
  unit: CadenceUnit;
  every: number;
  from: RepeatFrom;
  /** The plain date a fixed schedule is counted from. */
  anchorDate: string;
  /** "Show from" this many days before the due date; null = no "show from". */
  leadDays: number | null;
}

/** An occurrence's dates as plain days (the scheduled day in the user's zone). */
export interface OccurrenceDates {
  /** The date this occurrence stands for in the series. */
  slot: string;
  due: string | null;
  scheduledDay: string | null;
  scheduledTime: string | null;
  showFrom: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const asTime = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** `day` moved by `n` days. */
export function addDays(day: string, n: number): string {
  return new Date(asTime(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((asTime(b) - asTime(a)) / DAY_MS);
}

const cadenceOf = (rule: RecurrenceRule): Cadence => ({ unit: rule.unit, value: rule.every });

/**
 * The first date of a fixed schedule strictly after `after`: the anchor
 * moved by the smallest whole number of cadences (counted from the anchor, so
 * a clamped month does not drift).
 */
export function firstSlotAfter(rule: RecurrenceRule, after: string): string {
  const cadence = cadenceOf(rule);
  const stepDays = rule.unit === "DAY" ? rule.every : rule.unit === "WEEK" ? 7 * rule.every : null;
  let n: number;
  if (stepDays !== null) {
    n = Math.floor(daysBetween(rule.anchorDate, after) / stepDays) + 1;
  } else {
    const months = rule.unit === "YEAR" ? 12 * rule.every : rule.every;
    const [ay, am] = rule.anchorDate.split("-").map(Number) as [number, number];
    const [fy, fm] = after.split("-").map(Number) as [number, number];
    n = Math.floor((fy * 12 + fm - (ay * 12 + am)) / months);
  }
  n = Math.max(n, 0);
  while (addCadenceToDay(rule.anchorDate, cadence, n) <= after) n++;
  while (n > 0 && addCadenceToDay(rule.anchorDate, cadence, n - 1) > after) n--;
  return addCadenceToDay(rule.anchorDate, cadence, n);
}

/**
 * The slot of the occurrence after `current`. On a fixed schedule: the first
 * scheduled date after both today and the current slot, so a late completion
 * or a skip never makes a backlog of overdue copies. Counted from completion:
 * one cadence after the day it was completed (or skipped).
 */
export function nextSlot(rule: RecurrenceRule, currentSlot: string, completedOn: string, today: string): string {
  if (rule.from === "COMPLETION") return addCadenceToDay(completedOn, cadenceOf(rule), 1);
  return firstSlotAfter(rule, today > currentSlot ? today : currentSlot);
}

/** "Show from" for an occurrence due (or standing) on `day`. */
export function showFromFor(rule: Pick<RecurrenceRule, "leadDays">, day: string): string | null {
  return rule.leadDays === null ? null : addDays(day, -rule.leadDays);
}

/**
 * The dates of the next occurrence. The due date repeats when the task has
 * one; a scheduled day keeps its distance to the due date (or to the slot
 * when there is none); the time of day carries over.
 */
export function nextOccurrenceDates(rule: RecurrenceRule, current: OccurrenceDates, slot: string): OccurrenceDates {
  const due = current.due === null ? null : slot;
  const scheduledDay =
    current.scheduledDay === null ? null : addDays(slot, daysBetween(current.due ?? current.slot, current.scheduledDay));
  return {
    slot,
    due,
    scheduledDay,
    scheduledTime: scheduledDay === null ? null : current.scheduledTime,
    showFrom: showFromFor(rule, due ?? slot),
  };
}

/** An upcoming occurrence that does not exist yet: a preview for the calendar (#105 step 2). */
export interface UpcomingOccurrence extends OccurrenceDates {
  /** The day it sits on in the calendar: its scheduled day, else its due date, else its slot. */
  day: string;
  /**
   * Counted from completion: there is no fixed date, so this is the date it
   * would get if the open occurrence were completed on its day (or today,
   * when that day has passed).
   */
  approximate: boolean;
}

/** The most previews worked out for one series, whatever the range (a daily rule over two months). */
const MAX_PREVIEWS = 100;

/**
 * The occurrences that would follow the open one, as they would be created
 * if it were completed (or skipped) today or on its day, whichever is later:
 * the same `nextSlot` and `nextOccurrenceDates` the service uses, so a
 * preview lands where the real occurrence will. Only those whose `day` is in
 * `from`..`to` (inclusive) are returned.
 *
 * On a fixed schedule that is every slot after the open one. Counted from
 * completion there is no fixed future, so there is at most one preview, one
 * cadence after the open occurrence's day, marked approximate.
 */
export function upcomingOccurrences(
  rule: RecurrenceRule,
  open: OccurrenceDates,
  today: string,
  from: string,
  to: string,
): UpcomingOccurrence[] {
  const dayOf = (d: OccurrenceDates) => d.scheduledDay ?? d.due ?? d.slot;
  const inRange = (d: UpcomingOccurrence) => d.day >= from && d.day <= to;
  const openDay = open.due ?? open.slot;
  if (rule.from === "COMPLETION") {
    const completedOn = today > openDay ? today : openDay;
    const dates = nextOccurrenceDates(rule, open, nextSlot(rule, open.slot, completedOn, today));
    const preview = { ...dates, day: dayOf(dates), approximate: true };
    return inRange(preview) ? [preview] : [];
  }
  // The calendar day sits a fixed number of days from the slot (a scheduled
  // day keeps its distance to the due date), so start just before the range
  // rather than walking from today: browsing a year ahead stays cheap.
  const offset = open.scheduledDay === null ? 0 : daysBetween(openDay, open.scheduledDay);
  const before = addDays(from, -offset - 1);
  let slot = [open.slot, today, before].reduce((a, b) => (a > b ? a : b));
  const found: UpcomingOccurrence[] = [];
  while (found.length < MAX_PREVIEWS) {
    slot = firstSlotAfter(rule, slot);
    const dates = nextOccurrenceDates(rule, open, slot);
    const preview = { ...dates, day: dayOf(dates), approximate: false };
    if (preview.day > to) break;
    if (inRange(preview)) found.push(preview);
  }
  return found;
}
