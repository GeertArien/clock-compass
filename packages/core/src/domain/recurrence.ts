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
