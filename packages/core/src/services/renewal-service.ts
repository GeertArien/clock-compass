import type { RenewalActivity, RenewalDimension } from "@prisma/client";
import { countThisWeek, weekStreak } from "../domain/habit.js";
import {
  addDays,
  dayAtUtc,
  isoWeekStart,
  plainDayOf,
  resolveClock,
  todayOf,
  type DayClock,
  type PlainDay,
} from "../domain/week.js";
import { zonedDay, zonedMidnight } from "../domain/zoned.js";
import type {
  HabitRepository,
  HabitWithMarks,
} from "../repositories/habit-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DIMENSIONS: RenewalDimension[] = [
  "PHYSICAL",
  "MENTAL",
  "SOCIAL_EMOTIONAL",
  "SPIRITUAL",
];

export interface CreateHabitInput {
  name: string;
  dimension?: RenewalDimension | null;
  goalId?: string | null;
  targetPerWeek?: number;
}

export interface UpdateHabitInput {
  name?: string;
  dimension?: RenewalDimension | null;
  goalId?: string | null;
  targetPerWeek?: number;
  archived?: boolean;
}

/** The shape the Compass/Clock/Almanac habit surfaces consume. */
export interface HabitView {
  id: string;
  name: string;
  dimension: RenewalDimension | null;
  goalId: string | null;
  goalTitle: string | null;
  targetPerWeek: number;
  /** Mon–Sun of the current ISO week. */
  weekDays: boolean[];
  doneThisWeek: number;
  markedToday: boolean;
  /** Consecutive weeks the target was met (current week never breaks it). */
  streak: number;
}

/** Per-dimension aggregate: habits AND one-off activities both count. */
export interface DimensionSummary {
  dimension: RenewalDimension;
  habitsDone: number;
  habitsTarget: number;
  oneOffs: number;
  /** habitsDone + oneOffs. */
  total: number;
}

export interface RenewalTrends {
  thisWeek: number;
  lastWeek: number;
  longestStreak: { weeks: number; habitName: string | null };
  goalMomentum: { goalId: string; title: string; pct: number }[];
  /** 12 ISO weeks (oldest first) × 7 days (Mon–Sun) of combined completions. */
  heatmap: number[][];
}

/** A habit as the surfaces show it, with "today" and "this week" from `today`. */
function toView(habit: HabitWithMarks, today: PlainDay): HabitView {
  const marks = habit.marks.map((m) => plainDayOf(m.day));
  const weekStart = isoWeekStart(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => marks.includes(addDays(weekStart, i)));
  return {
    id: habit.id,
    name: habit.name,
    dimension: habit.dimension,
    goalId: habit.goalId,
    goalTitle: habit.goal?.title ?? null,
    targetPerWeek: habit.targetPerWeek,
    weekDays,
    doneThisWeek: countThisWeek(marks, today),
    markedToday: marks.includes(today),
    streak: weekStreak(marks, habit.targetPerWeek, today),
  };
}

/** A habit day is a plain date: refused when it is not one, or still to come. */
function markDay(day: PlainDay | undefined, today: PlainDay): PlainDay {
  if (day === undefined) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || plainDayOf(dayAtUtc(day)) !== day) {
    throw new Error("A day is a date as YYYY-MM-DD");
  }
  if (day > today) throw new Error("Cannot mark a future day");
  return day;
}

/**
 * Habit 7: recurring renewal (Habits + marks) and one-off RenewalActivity.
 * Owner decision: habits do NOT absorb one-offs — dimension aggregates count
 * both, streaks remain habit-only.
 *
 * Days (#112): a mark is a plain date and an intention belongs to a plain
 * Monday, both stored at UTC midnight. "Today" and "this week" come from the
 * clock: the caller's zone when it has one (the app sends `X-Time-Zone`), else
 * the server's (`TZ`). A one-off activity is a real moment; it counts on the
 * day it falls on in that same zone.
 */
export class RenewalService {
  constructor(private readonly repo: HabitRepository) {}

  // --- Habits (defined in Compass, checked off in Clock) ----------------------

  async createHabit(input: CreateHabitInput, clock: DayClock = {}): Promise<HabitView> {
    const habit = await this.repo.create({
      name: input.name,
      dimension: input.dimension ?? null,
      targetPerWeek: Math.min(7, Math.max(1, input.targetPerWeek ?? 7)),
      ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
    });
    return toView(habit, todayOf(clock));
  }

  async listHabits(clock: DayClock = {}): Promise<HabitView[]> {
    const today = todayOf(clock);
    return (await this.repo.findMany()).map((h) => toView(h, today));
  }

  async updateHabit(id: string, input: UpdateHabitInput, clock: DayClock = {}): Promise<HabitView> {
    const { goalId, targetPerWeek, ...fields } = input;
    const habit = await this.repo.update(id, {
      ...fields,
      ...(targetPerWeek !== undefined
        ? { targetPerWeek: Math.min(7, Math.max(1, targetPerWeek)) }
        : {}),
      ...(goalId !== undefined
        ? { goal: goalId ? { connect: { id: goalId } } : { disconnect: true } }
        : {}),
    });
    return toView(habit, todayOf(clock));
  }

  async removeHabit(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  /** Toggle a day's check-off (`day` absent: today). Future days are rejected. */
  async toggleMark(habitId: string, day: PlainDay | undefined, clock: DayClock = {}): Promise<HabitView> {
    const today = todayOf(clock);
    const stored = dayAtUtc(markDay(day, today));
    const existing = await this.repo.findMark(habitId, stored);
    if (existing) await this.repo.deleteMark(existing.id);
    else await this.repo.createMark(habitId, stored);
    const habit = await this.repo.findById(habitId);
    if (!habit) throw new Error("Habit not found");
    return toView(habit, today);
  }

  /**
   * Set a day's check-off to a target state (done or not), unlike
   * `toggleMark`: repeating it changes nothing, so a caller need not read the
   * habit first (issue #109). `day` absent: today. Future days are rejected.
   */
  async setMark(
    habitId: string,
    day: PlainDay | undefined,
    done: boolean,
    clock: DayClock = {},
  ): Promise<{ habit: HabitView; changed: boolean }> {
    const today = todayOf(clock);
    const stored = dayAtUtc(markDay(day, today));
    const existing = await this.repo.findMark(habitId, stored);
    let changed = !!existing !== done;
    try {
      if (changed && existing) await this.repo.deleteMark(existing.id);
      else if (changed) await this.repo.createMark(habitId, stored);
    } catch (err) {
      // The same target state arriving twice at once: the other call got there
      // first (the mark exists already, or is gone already). That is the state
      // asked for, so it is "nothing changed", not an error.
      const code = (err as { code?: unknown }).code;
      if (code !== "P2002" && code !== "P2025") throw err;
      changed = false;
    }
    const habit = await this.repo.findById(habitId);
    if (!habit) throw new Error("Habit not found");
    return { habit: toView(habit, today), changed };
  }

  // --- One-off renewal activities ----------------------------------------------

  logActivity(input: {
    /** Chosen by the caller (an idempotent create, #109); left out = generated. */
    id?: string;
    dimension: RenewalDimension;
    title: string;
    note?: string | null;
    occurredAt?: Date;
  }): Promise<RenewalActivity> {
    return this.repo.createActivity({
      ...(input.id ? { id: input.id } : {}),
      dimension: input.dimension,
      title: input.title,
      note: input.note ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  }

  getActivity(id: string): Promise<RenewalActivity | null> {
    return this.repo.findActivity(id);
  }

  async recentActivities(now: Date = new Date()): Promise<RenewalActivity[]> {
    // A rolling window of instants, not of days: no zone involved.
    return this.repo.findActivities(new Date(now.getTime() - 30 * DAY_MS));
  }

  async removeActivity(id: string): Promise<void> {
    await this.repo.deleteActivity(id);
  }

  // --- Weekly intentions (intent, never scored; history kept) --------------------

  /** This ISO week's intention per dimension (missing = none set). */
  async intentions(clock: DayClock = {}): Promise<{ dimension: RenewalDimension; text: string }[]> {
    const rows = await this.repo.findIntentions(dayAtUtc(isoWeekStart(todayOf(clock))));
    return rows.map((r) => ({ dimension: r.dimension, text: r.text }));
  }

  /** Set (or clear, with empty text) this week's intention for a dimension. */
  async setIntention(dimension: RenewalDimension, text: string, clock: DayClock = {}): Promise<void> {
    const weekStart = dayAtUtc(isoWeekStart(todayOf(clock)));
    const trimmed = text.trim();
    if (trimmed) await this.repo.upsertIntention(dimension, weekStart, trimmed);
    else await this.repo.deleteIntention(dimension, weekStart);
  }

  // --- Aggregates (the Almanac) --------------------------------------------------

  /** This week per dimension — habit marks AND one-off activities both count. */
  async summary(clock: DayClock = {}): Promise<DimensionSummary[]> {
    const { now, timeZone } = resolveClock(clock);
    const today = zonedDay(now, timeZone);
    const weekStart = isoWeekStart(today);
    const habits = await this.repo.findMany();
    const activities = (await this.repo.findActivities(zonedMidnight(weekStart, timeZone))).filter(
      (a) => zonedDay(a.occurredAt, timeZone) >= weekStart,
    );

    return DIMENSIONS.map((dimension) => {
      const tagged = habits.filter((h) => h.dimension === dimension);
      const habitsDone = tagged.reduce(
        (sum, h) => sum + countThisWeek(h.marks.map((m) => plainDayOf(m.day)), today),
        0,
      );
      const habitsTarget = tagged.reduce((sum, h) => sum + h.targetPerWeek, 0);
      const oneOffs = activities.filter((a) => a.dimension === dimension).length;
      return { dimension, habitsDone, habitsTarget, oneOffs, total: habitsDone + oneOffs };
    });
  }

  async trends(clock: DayClock = {}): Promise<RenewalTrends> {
    const { now, timeZone } = resolveClock(clock);
    const today = zonedDay(now, timeZone);
    const thisWeekStart = isoWeekStart(today);
    const lastWeekStart = addDays(thisWeekStart, -7);
    const heatmapStart = addDays(thisWeekStart, -7 * 11);
    const habits = await this.repo.findMany();
    const activities = await this.repo.findActivities(zonedMidnight(heatmapStart, timeZone));

    // Every completion as the day it counts on: a mark's own date, an
    // activity's day in the clock's zone.
    const allDays = [
      ...habits.flatMap((h) => h.marks.map((m) => plainDayOf(m.day))),
      ...activities.map((a) => zonedDay(a.occurredAt, timeZone)),
    ];
    const between = (day: PlainDay, start: PlainDay, end: PlainDay) => day >= start && day < end;
    const thisWeek = allDays.filter((d) => between(d, thisWeekStart, addDays(thisWeekStart, 7))).length;
    const lastWeek = allDays.filter((d) => between(d, lastWeekStart, thisWeekStart)).length;

    let longestStreak: RenewalTrends["longestStreak"] = { weeks: 0, habitName: null };
    for (const habit of habits) {
      const weeks = weekStreak(habit.marks.map((m) => plainDayOf(m.day)), habit.targetPerWeek, today);
      if (weeks > longestStreak.weeks) longestStreak = { weeks, habitName: habit.name };
    }

    // Goal momentum: the last 30 days of marks (today included) vs the
    // pro-rated weekly target.
    const since = addDays(today, -29);
    const byGoal = new Map<string, { title: string; done: number; possible: number }>();
    for (const habit of habits) {
      if (!habit.goalId || !habit.goal) continue;
      const entry = byGoal.get(habit.goalId) ?? {
        title: habit.goal.title,
        done: 0,
        possible: 0,
      };
      entry.done += habit.marks.filter((m) => plainDayOf(m.day) >= since).length;
      entry.possible += (habit.targetPerWeek * 30) / 7;
      byGoal.set(habit.goalId, entry);
    }
    const goalMomentum = [...byGoal.entries()].map(([goalId, g]) => ({
      goalId,
      title: g.title,
      pct: g.possible ? Math.min(100, Math.round((100 * g.done) / g.possible)) : 0,
    }));

    // 12-week heatmap (oldest week first), combined habit marks + one-offs.
    const heatmap: number[][] = [];
    for (let w = 0; w < 12; w++) {
      const row: number[] = [];
      for (let d = 0; d < 7; d++) {
        const day = addDays(heatmapStart, w * 7 + d);
        row.push(allDays.filter((x) => x === day).length);
      }
      heatmap.push(row);
    }

    return { thisWeek, lastWeek, longestStreak, goalMomentum, heatmap };
  }
}
