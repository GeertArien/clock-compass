import type { RenewalActivity, RenewalDimension } from "@prisma/client";
import { countThisWeek, weekStreak } from "../domain/habit.js";
import { startOfIsoWeek } from "../domain/week.js";
import type {
  HabitRepository,
  HabitWithMarks,
} from "../repositories/habit-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
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

function localMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return localMidnight(a).getTime() === localMidnight(b).getTime();
}

function toView(habit: HabitWithMarks, now: Date): HabitView {
  const marks = habit.marks.map((m) => m.day);
  const weekStart = startOfIsoWeek(now);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart.getTime() + i * DAY_MS);
    return marks.some((m) => isSameLocalDay(m, day));
  });
  return {
    id: habit.id,
    name: habit.name,
    dimension: habit.dimension,
    goalId: habit.goalId,
    goalTitle: habit.goal?.title ?? null,
    targetPerWeek: habit.targetPerWeek,
    weekDays,
    doneThisWeek: countThisWeek(marks, now),
    markedToday: marks.some((m) => isSameLocalDay(m, now)),
    streak: weekStreak(marks, habit.targetPerWeek, now),
  };
}

/**
 * Habit 7: recurring renewal (Habits + marks) and one-off RenewalActivity.
 * Owner decision: habits do NOT absorb one-offs — dimension aggregates count
 * both, streaks remain habit-only.
 */
export class RenewalService {
  constructor(private readonly repo: HabitRepository) {}

  // --- Habits (defined in Compass, checked off in Clock) ----------------------

  async createHabit(input: CreateHabitInput): Promise<HabitView> {
    const habit = await this.repo.create({
      name: input.name,
      dimension: input.dimension ?? null,
      targetPerWeek: Math.min(7, Math.max(1, input.targetPerWeek ?? 7)),
      ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
    });
    return toView(habit, new Date());
  }

  async listHabits(now: Date = new Date()): Promise<HabitView[]> {
    return (await this.repo.findMany()).map((h) => toView(h, now));
  }

  async updateHabit(id: string, input: UpdateHabitInput): Promise<HabitView> {
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
    return toView(habit, new Date());
  }

  async removeHabit(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  /** Toggle a day's check-off. Future days are rejected. */
  async toggleMark(
    habitId: string,
    day: Date,
    now: Date = new Date(),
  ): Promise<HabitView> {
    const normalized = localMidnight(day);
    if (normalized.getTime() > localMidnight(now).getTime()) {
      throw new Error("Cannot mark a future day");
    }
    const existing = await this.repo.findMark(habitId, normalized);
    if (existing) await this.repo.deleteMark(existing.id);
    else await this.repo.createMark(habitId, normalized);
    const habit = await this.repo.findById(habitId);
    if (!habit) throw new Error("Habit not found");
    return toView(habit, now);
  }

  /**
   * Set a day's check-off to a target state (done or not), unlike
   * `toggleMark`: repeating it changes nothing, so a caller need not read the
   * habit first (issue #109). Future days are rejected.
   */
  async setMark(
    habitId: string,
    day: Date,
    done: boolean,
    now: Date = new Date(),
  ): Promise<{ habit: HabitView; changed: boolean }> {
    const normalized = localMidnight(day);
    if (normalized.getTime() > localMidnight(now).getTime()) {
      throw new Error("Cannot mark a future day");
    }
    const existing = await this.repo.findMark(habitId, normalized);
    let changed = !!existing !== done;
    try {
      if (changed && existing) await this.repo.deleteMark(existing.id);
      else if (changed) await this.repo.createMark(habitId, normalized);
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
    return { habit: toView(habit, now), changed };
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
    return this.repo.findActivities(new Date(now.getTime() - 30 * DAY_MS));
  }

  async removeActivity(id: string): Promise<void> {
    await this.repo.deleteActivity(id);
  }

  // --- Weekly intentions (intent, never scored; history kept) --------------------

  /** This ISO week's intention per dimension (missing = none set). */
  async intentions(
    now: Date = new Date(),
  ): Promise<{ dimension: RenewalDimension; text: string }[]> {
    const rows = await this.repo.findIntentions(startOfIsoWeek(now));
    return rows.map((r) => ({ dimension: r.dimension, text: r.text }));
  }

  /** Set (or clear, with empty text) this week's intention for a dimension. */
  async setIntention(
    dimension: RenewalDimension,
    text: string,
    now: Date = new Date(),
  ): Promise<void> {
    const weekStart = startOfIsoWeek(now);
    const trimmed = text.trim();
    if (trimmed) await this.repo.upsertIntention(dimension, weekStart, trimmed);
    else await this.repo.deleteIntention(dimension, weekStart);
  }

  // --- Aggregates (the Almanac) --------------------------------------------------

  /** This week per dimension — habit marks AND one-off activities both count. */
  async summary(now: Date = new Date()): Promise<DimensionSummary[]> {
    const weekStart = startOfIsoWeek(now);
    const habits = await this.repo.findMany();
    const activities = await this.repo.findActivities(weekStart);

    return DIMENSIONS.map((dimension) => {
      const tagged = habits.filter((h) => h.dimension === dimension);
      const habitsDone = tagged.reduce(
        (sum, h) => sum + countThisWeek(h.marks.map((m) => m.day), now),
        0,
      );
      const habitsTarget = tagged.reduce((sum, h) => sum + h.targetPerWeek, 0);
      const oneOffs = activities.filter((a) => a.dimension === dimension).length;
      return { dimension, habitsDone, habitsTarget, oneOffs, total: habitsDone + oneOffs };
    });
  }

  async trends(now: Date = new Date()): Promise<RenewalTrends> {
    const habits = await this.repo.findMany();
    const heatmapStart = startOfIsoWeek(new Date(now.getTime() - 11 * WEEK_MS));
    const activities = await this.repo.findActivities(heatmapStart);
    const thisWeekStart = startOfIsoWeek(now).getTime();
    const lastWeekStart = thisWeekStart - WEEK_MS;

    const allDays = [
      ...habits.flatMap((h) => h.marks.map((m) => m.day)),
      ...activities.map((a) => a.occurredAt),
    ];
    const inRange = (t: number, start: number, end: number) => t >= start && t < end;
    const thisWeek = allDays.filter((d) =>
      inRange(d.getTime(), thisWeekStart, thisWeekStart + WEEK_MS),
    ).length;
    const lastWeek = allDays.filter((d) =>
      inRange(d.getTime(), lastWeekStart, thisWeekStart),
    ).length;

    let longestStreak: RenewalTrends["longestStreak"] = { weeks: 0, habitName: null };
    for (const habit of habits) {
      const weeks = weekStreak(habit.marks.map((m) => m.day), habit.targetPerWeek, now);
      if (weeks > longestStreak.weeks) longestStreak = { weeks, habitName: habit.name };
    }

    // Goal momentum: last 30 days of marks vs the pro-rated weekly target.
    const since = now.getTime() - 30 * DAY_MS;
    const byGoal = new Map<string, { title: string; done: number; possible: number }>();
    for (const habit of habits) {
      if (!habit.goalId || !habit.goal) continue;
      const entry = byGoal.get(habit.goalId) ?? {
        title: habit.goal.title,
        done: 0,
        possible: 0,
      };
      entry.done += habit.marks.filter((m) => m.day.getTime() >= since).length;
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
        const dayStart = heatmapStart.getTime() + (w * 7 + d) * DAY_MS;
        row.push(
          allDays.filter((x) => inRange(x.getTime(), dayStart, dayStart + DAY_MS)).length,
        );
      }
      heatmap.push(row);
    }

    return { thisWeek, lastWeek, longestStreak, goalMomentum, heatmap };
  }
}
