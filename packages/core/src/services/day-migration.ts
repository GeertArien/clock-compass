/**
 * Moving stored days to plain dates (#112).
 *
 * Before #112 a habit mark (`HabitMark.day`) and a weekly intention
 * (`WeeklyIntention.weekStart`) were stored as the local midnight of the
 * server that wrote them. Now they are the calendar date at UTC midnight. On a
 * server that always ran in UTC the two are the same and nothing moves. On
 * one that ran in another zone, each value is turned into the date it had in
 * that zone.
 *
 * `planDayMigration` is pure: it decides, and the repository applies the plan
 * in one transaction. A value already at UTC midnight is left alone, so a
 * second run changes nothing, and so does a deployment that ran in UTC first
 * and in another zone later: only the values that are not plain are judged.
 */
import { dayAtUtc, isoWeekday, plainDayOf } from "../domain/week.js";
import { zonedDay, zonedMidnight } from "../domain/zoned.js";

export interface StoredMark {
  id: string;
  habitId: string;
  day: Date;
}

export interface StoredIntention {
  id: string;
  dimension: string;
  weekStart: Date;
  updatedAt: Date;
}

export interface StoredDays {
  marks: StoredMark[];
  intentions: StoredIntention[];
}

/** One value to move: the row, what it holds now, and the plain date it becomes. */
export interface DayMove {
  id: string;
  from: Date;
  to: Date;
}

export interface DayMigrationPlan {
  /** Marks moved to their plain date. */
  marks: DayMove[];
  /** Intentions moved to their plain Monday. */
  intentions: DayMove[];
  /** Rows deleted because another row of the same habit (or dimension) holds that day. */
  deleteMarks: string[];
  deleteIntentions: string[];
  /** Values that are not a midnight in the given zone: the zone is wrong, nothing may run. */
  refused: { table: "HabitMark" | "WeeklyIntention"; id: string; value: Date }[];
  /** Values already plain (left alone). */
  alreadyPlain: number;
}

/** Whether a stored value is already a plain date (UTC midnight). */
export function isPlain(value: Date): boolean {
  return value.getTime() === dayAtUtc(plainDayOf(value)).getTime();
}

/** How many stored values are not plain dates yet (the start-up warning). */
export function countNotPlain(days: StoredDays): number {
  return (
    days.marks.filter((m) => !isPlain(m.day)).length +
    days.intentions.filter((i) => !isPlain(i.weekStart)).length
  );
}

/** The plain date `value` had in `zone`, if `value` is a midnight there. */
function dayIn(value: Date, zone: string): string | null {
  const day = zonedDay(value, zone);
  return zonedMidnight(day, zone).getTime() === value.getTime() ? day : null;
}

/** What moving `days` written in `fromZone` to plain dates would do. */
export function planDayMigration(days: StoredDays, fromZone: string): DayMigrationPlan {
  const plan: DayMigrationPlan = {
    marks: [],
    intentions: [],
    deleteMarks: [],
    deleteIntentions: [],
    refused: [],
    alreadyPlain: 0,
  };

  // Marks: one per habit and day. A plain row already there wins; between
  // two moved rows, the first one met wins (they mark the same day).
  const taken = new Set<string>();
  for (const m of days.marks) if (isPlain(m.day)) taken.add(`${m.habitId}|${plainDayOf(m.day)}`);
  for (const m of days.marks) {
    if (isPlain(m.day)) {
      plan.alreadyPlain++;
      continue;
    }
    const day = dayIn(m.day, fromZone);
    if (!day) {
      plan.refused.push({ table: "HabitMark", id: m.id, value: m.day });
      continue;
    }
    const key = `${m.habitId}|${day}`;
    if (taken.has(key)) plan.deleteMarks.push(m.id);
    else {
      taken.add(key);
      plan.marks.push({ id: m.id, from: m.day, to: dayAtUtc(day) });
    }
  }

  // Intentions: one per dimension and week. Two on the same week are merged
  // by keeping the newest text.
  const kept = new Map<string, { id: string; updatedAt: Date; moved: boolean }>();
  for (const i of days.intentions) {
    if (isPlain(i.weekStart)) kept.set(`${i.dimension}|${plainDayOf(i.weekStart)}`, { id: i.id, updatedAt: i.updatedAt, moved: false });
  }
  for (const i of days.intentions) {
    if (isPlain(i.weekStart)) {
      plan.alreadyPlain++;
      continue;
    }
    const day = dayIn(i.weekStart, fromZone);
    if (!day || isoWeekday(day) !== 1) {
      plan.refused.push({ table: "WeeklyIntention", id: i.id, value: i.weekStart });
      continue;
    }
    const key = `${i.dimension}|${day}`;
    const other = kept.get(key);
    const move = { id: i.id, from: i.weekStart, to: dayAtUtc(day) };
    if (!other) {
      kept.set(key, { id: i.id, updatedAt: i.updatedAt, moved: true });
      plan.intentions.push(move);
    } else if (i.updatedAt > other.updatedAt) {
      // This one is newer: it takes the week, the other goes.
      plan.deleteIntentions.push(other.id);
      if (other.moved) plan.intentions = plan.intentions.filter((x) => x.id !== other.id);
      kept.set(key, { id: i.id, updatedAt: i.updatedAt, moved: true });
      plan.intentions.push(move);
    } else {
      plan.deleteIntentions.push(i.id);
    }
  }
  return plan;
}

/** The plan in words, for the command's report. */
export function describePlan(plan: DayMigrationPlan, fromZone: string): string[] {
  const day = (d: Date) => d.toISOString();
  const lines = [
    `Reading the stored days as written in ${fromZone}.`,
    `Habit marks to move: ${plan.marks.length}. Weekly intentions to move: ${plan.intentions.length}.`,
    `Already plain dates (left alone): ${plan.alreadyPlain}.`,
  ];
  if (plan.deleteMarks.length) {
    lines.push(`Duplicate habit marks removed (the same habit on the same day): ${plan.deleteMarks.length}.`);
  }
  if (plan.deleteIntentions.length) {
    lines.push(`Duplicate intentions merged (the newest text kept): ${plan.deleteIntentions.length}.`);
  }
  const examples = [...plan.marks, ...plan.intentions].slice(0, 3);
  if (examples.length) {
    lines.push("Examples:");
    for (const e of examples) lines.push(`  ${day(e.from)}  ->  ${day(e.to)}`);
  }
  if (plan.refused.length) {
    lines.push(
      `Refused: ${plan.refused.length} values are not a midnight in ${fromZone}, so that is not the zone they were written in. Nothing was changed.`,
    );
    for (const r of plan.refused.slice(0, 3)) lines.push(`  ${r.table} ${r.id}: ${day(r.value)}`);
  }
  return lines;
}
