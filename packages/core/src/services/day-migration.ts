/**
 * Moving stored days to plain dates (#112, #136).
 *
 * LEGACY (to remove in #137, once every stored day has moved).
 *
 * Before #112 a habit mark (`HabitMark.day`) and a weekly intention
 * (`WeeklyIntention.weekStart`) were stored as the local midnight of the
 * server that wrote them. Before #136 a task's scheduled day
 * (`Task.scheduledDay`) was stored as midnight on the device that scheduled
 * it. Now all three are the calendar date at UTC midnight. A value written in
 * UTC is that already and nothing moves. Any other value is turned into the
 * date it had in the zone it was written in.
 *
 * `planDayMigration` is pure: it decides, and the repository applies the plan
 * in one transaction. A value already at UTC midnight is left alone, so a
 * second run changes nothing, and so does a deployment that ran in UTC first
 * and in another zone later: only the values that are not plain are judged.
 * Several zones may be given (tasks scheduled while travelling): each value
 * is read in the first zone where it is a midnight. Two zones that both fit
 * give the same date, since their clocks agree at that moment.
 */
import { dayAtUtc, isPlainDate, isoWeekday, plainDayOf } from "../domain/week.js";
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

/** A task with a scheduled day (#136). */
export interface StoredScheduledDay {
  id: string;
  title: string;
  scheduledDay: Date;
  scheduledTime: string | null;
}

export interface StoredDays {
  marks: StoredMark[];
  intentions: StoredIntention[];
  /** Tasks with a scheduled day (#136); absent = none. */
  scheduled?: StoredScheduledDay[];
}

/** One value to move: the row, what it holds now, and the plain date it becomes. */
export interface DayMove {
  id: string;
  from: Date;
  to: Date;
}

/** A scheduled day to move, with what the report shows of its task. */
export interface ScheduledDayMove extends DayMove {
  title: string;
  scheduledTime: string | null;
}

export type DayTable = "HabitMark" | "WeeklyIntention" | "Task";

export interface DayMigrationPlan {
  /** Marks moved to their plain date. */
  marks: DayMove[];
  /** Intentions moved to their plain Monday. */
  intentions: DayMove[];
  /** Scheduled days moved to their plain date (#136). */
  scheduled: ScheduledDayMove[];
  /** Rows deleted because another row of the same habit (or dimension) holds that day. */
  deleteMarks: string[];
  deleteIntentions: string[];
  /** Values that are not a midnight in any given zone: a zone is wrong or missing, nothing may run. */
  refused: { table: DayTable; id: string; value: Date }[];
  /** Values already plain (left alone). */
  alreadyPlain: number;
  /** How many values each given zone explained, in the order given. */
  perZone: { zone: string; count: number }[];
}

/** Whether a stored value is already a plain date (UTC midnight). */
export const isPlain = isPlainDate;

/** How many stored habit marks and intentions are not plain dates yet (the start-up warning of #112). */
export function countNotPlain(days: StoredDays): number {
  return (
    days.marks.filter((m) => !isPlain(m.day)).length +
    days.intentions.filter((i) => !isPlain(i.weekStart)).length
  );
}

/** How many scheduled days are not plain dates yet (#136). */
export function countOldScheduledDays(days: StoredDays): number {
  return (days.scheduled ?? []).filter((t) => !isPlain(t.scheduledDay)).length;
}

/** The plain date `value` had in the first of `zones` where it is a midnight. */
function dayIn(value: Date, zones: readonly string[]): { day: string; zone: string } | null {
  for (const zone of zones) {
    const day = zonedDay(value, zone);
    if (zonedMidnight(day, zone).getTime() === value.getTime()) return { day, zone };
  }
  return null;
}

/** What moving `days` written in `fromZones` to plain dates would do. */
export function planDayMigration(days: StoredDays, fromZones: readonly string[]): DayMigrationPlan {
  const plan: DayMigrationPlan = {
    marks: [],
    intentions: [],
    scheduled: [],
    deleteMarks: [],
    deleteIntentions: [],
    refused: [],
    alreadyPlain: 0,
    perZone: fromZones.map((zone) => ({ zone, count: 0 })),
  };
  const read = (value: Date) => {
    const found = dayIn(value, fromZones);
    if (found) plan.perZone.find((z) => z.zone === found.zone)!.count++;
    return found?.day ?? null;
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
    const day = read(m.day);
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
    const day = read(i.weekStart);
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

  // Scheduled days (#136): no duplicates possible, two tasks on a day is normal.
  // The time beside the day is not touched.
  plan.scheduled = planScheduled(days.scheduled ?? [], read, plan);
  return plan;
}

function planScheduled(
  tasks: StoredScheduledDay[],
  read: (value: Date) => string | null,
  plan: DayMigrationPlan,
): ScheduledDayMove[] {
  const moves: ScheduledDayMove[] = [];
  for (const t of tasks) {
    if (isPlain(t.scheduledDay)) {
      plan.alreadyPlain++;
      continue;
    }
    const day = read(t.scheduledDay);
    if (!day) plan.refused.push({ table: "Task", id: t.id, value: t.scheduledDay });
    else moves.push({ id: t.id, title: t.title, scheduledTime: t.scheduledTime, from: t.scheduledDay, to: dayAtUtc(day) });
  }
  return moves;
}

/** Only the scheduled days of `days` (the automatic move of #136 leaves habit days alone). */
export function planScheduledDayMove(days: StoredDays, zones: readonly string[]): DayMigrationPlan {
  return planDayMigration({ marks: [], intentions: [], scheduled: days.scheduled ?? [] }, zones);
}

/** Whether a plan has anything to write. */
export function planWork(plan: DayMigrationPlan): number {
  return plan.marks.length + plan.intentions.length + plan.scheduled.length + plan.deleteMarks.length + plan.deleteIntentions.length;
}

/**
 * Up to three scheduled days to show the owner, chosen to be checked by eye:
 * different UTC hours first (winter and summer), then one with a time.
 */
export function scheduledExamples(moves: readonly ScheduledDayMove[]): ScheduledDayMove[] {
  const picked: ScheduledDayMove[] = [];
  const hours = new Set<number>();
  for (const m of moves) {
    if (picked.length === 2) break;
    if (!hours.has(m.from.getUTCHours())) {
      hours.add(m.from.getUTCHours());
      picked.push(m);
    }
  }
  const timed = moves.find((m) => m.scheduledTime && !picked.includes(m));
  if (timed) picked.push(timed);
  for (const m of moves) {
    if (picked.length >= 3) break;
    if (!picked.includes(m)) picked.push(m);
  }
  return picked.slice(0, 3);
}

/** One scheduled-day example: `"Call the dentist" 09:30  2026-11-25T23:00:00.000Z  ->  2026-11-26`. */
export function describeScheduledMove(m: ScheduledDayMove): string {
  const time = m.scheduledTime ? ` ${m.scheduledTime}` : "";
  return `  "${m.title}"${time}  ${m.from.toISOString()}  ->  ${plainDayOf(m.to)}`;
}

/** The plan in words, for the command's report. */
export function describePlan(plan: DayMigrationPlan, fromZones: readonly string[]): string[] {
  const iso = (d: Date) => d.toISOString();
  const lines = [
    `Reading the stored days as written in ${fromZones.join(", ")}.`,
    `Habit marks to move: ${plan.marks.length}. Weekly intentions to move: ${plan.intentions.length}. Scheduled days to move: ${plan.scheduled.length}.`,
    `Already plain dates (left alone): ${plan.alreadyPlain}.`,
  ];
  if (plan.perZone.length > 1) {
    lines.push(`Values each zone explained: ${plan.perZone.map((z) => `${z.zone} ${z.count}`).join(", ")}.`);
  }
  if (plan.deleteMarks.length) {
    lines.push(`Duplicate habit marks removed (the same habit on the same day): ${plan.deleteMarks.length}.`);
  }
  if (plan.deleteIntentions.length) {
    lines.push(`Duplicate intentions merged (the newest text kept): ${plan.deleteIntentions.length}.`);
  }
  const days = [...plan.marks, ...plan.intentions].slice(0, 3);
  if (days.length) {
    lines.push("Examples (habit marks and intentions):");
    for (const e of days) lines.push(`  ${iso(e.from)}  ->  ${iso(e.to)}`);
  }
  if (plan.scheduled.length) {
    lines.push("Examples (scheduled days; the time is not changed):");
    for (const m of scheduledExamples(plan.scheduled)) lines.push(describeScheduledMove(m));
  }
  if (plan.refused.length) {
    lines.push(
      `Refused: ${plan.refused.length} values are not a midnight in ${fromZones.join(" or ")}, so that is not the zone they were written in. Nothing was changed.`,
    );
    for (const r of plan.refused.slice(0, 3)) lines.push(`  ${r.table} ${r.id}: ${iso(r.value)}`);
  }
  return lines;
}
