/**
 * An in-memory HabitRepository for tests (the renewal service and the
 * operation handlers). Test-only: exported from `@clock-compass/core/testing` alone.
 */
import type {
  HabitMark,
  Prisma,
  RenewalActivity,
  RenewalDimension,
  WeeklyIntention,
} from "@prisma/client";
import type {
  HabitRepository,
  HabitWithMarks,
} from "../repositories/habit-repository.js";

export class FakeHabitRepository implements HabitRepository {
  habits = new Map<string, HabitWithMarks>();
  activities: RenewalActivity[] = [];
  private seq = 0;

  /** Every stored mark of every habit, for tests. */
  get marks(): { day: Date }[] {
    return [...this.habits.values()].flatMap((h) => h.marks);
  }

  async create(data: Prisma.HabitCreateInput): Promise<HabitWithMarks> {
    const id = `habit_${++this.seq}`;
    const now = new Date();
    const habit: HabitWithMarks = {
      id,
      name: data.name,
      dimension: (data.dimension as HabitWithMarks["dimension"]) ?? null,
      goalId: data.goal?.connect?.id ?? null,
      targetPerWeek: (data.targetPerWeek as number | undefined) ?? 7,
      archived: false,
      createdAt: now,
      updatedAt: now,
      marks: [],
      goal: data.goal?.connect?.id ? { title: `Goal ${data.goal.connect.id}` } : null,
    };
    this.habits.set(id, habit);
    return habit;
  }

  async findById(id: string): Promise<HabitWithMarks | null> {
    return this.habits.get(id) ?? null;
  }

  async findMany(): Promise<HabitWithMarks[]> {
    return [...this.habits.values()].filter((h) => !h.archived);
  }

  async update(id: string, data: Prisma.HabitUpdateInput): Promise<HabitWithMarks> {
    const existing = this.habits.get(id);
    if (!existing) throw new Error("not found");
    const { goal, ...rest } = data;
    const updated = { ...existing, ...rest } as HabitWithMarks;
    if (goal) {
      const connectId = "connect" in goal && goal.connect ? goal.connect.id : null;
      updated.goalId = connectId ?? null;
      updated.goal = connectId ? { title: `Goal ${connectId}` } : null;
    }
    this.habits.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.habits.delete(id);
  }

  async findMark(habitId: string, day: Date): Promise<HabitMark | null> {
    const habit = this.habits.get(habitId);
    const mark = habit?.marks.find((m) => m.day.getTime() === day.getTime());
    return mark
      ? ({ id: `${habitId}|${day.toISOString()}`, habitId, day: mark.day, createdAt: day } as HabitMark)
      : null;
  }

  async createMark(habitId: string, day: Date): Promise<void> {
    this.habits.get(habitId)?.marks.push({ day });
  }

  async deleteMark(id: string): Promise<void> {
    const [habitId, iso] = id.split("|") as [string, string];
    const habit = this.habits.get(habitId);
    if (habit) habit.marks = habit.marks.filter((m) => m.day.toISOString() !== iso);
  }

  async createActivity(data: Prisma.RenewalActivityCreateInput): Promise<RenewalActivity> {
    const activity: RenewalActivity = {
      id: (data.id as string | undefined) ?? `activity_${++this.seq}`,
      dimension: data.dimension,
      title: data.title,
      note: (data.note as string | null) ?? null,
      occurredAt: (data.occurredAt as Date | undefined) ?? new Date(),
      createdAt: new Date(),
    };
    this.activities.push(activity);
    return activity;
  }

  async findActivities(since: Date): Promise<RenewalActivity[]> {
    return this.activities.filter((a) => a.occurredAt >= since);
  }

  async findActivity(id: string): Promise<RenewalActivity | null> {
    return this.activities.find((a) => a.id === id) ?? null;
  }

  async deleteActivity(id: string): Promise<void> {
    this.activities = this.activities.filter((a) => a.id !== id);
  }

  intentions: WeeklyIntention[] = [];

  async upsertIntention(
    dimension: RenewalDimension,
    weekStart: Date,
    text: string,
  ): Promise<WeeklyIntention> {
    const existing = this.intentions.find(
      (i) => i.dimension === dimension && i.weekStart.getTime() === weekStart.getTime(),
    );
    if (existing) {
      existing.text = text;
      return existing;
    }
    const row: WeeklyIntention = {
      id: `intention_${++this.seq}`,
      dimension,
      weekStart,
      text,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.intentions.push(row);
    return row;
  }

  async deleteIntention(dimension: RenewalDimension, weekStart: Date): Promise<void> {
    this.intentions = this.intentions.filter(
      (i) => !(i.dimension === dimension && i.weekStart.getTime() === weekStart.getTime()),
    );
  }

  async findIntentions(weekStart: Date): Promise<WeeklyIntention[]> {
    return this.intentions.filter((i) => i.weekStart.getTime() === weekStart.getTime());
  }
}
