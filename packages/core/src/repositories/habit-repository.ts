import type {
  Habit,
  HabitMark,
  Prisma,
  PrismaClient,
  RenewalActivity,
  RenewalDimension,
  WeeklyIntention,
} from "@prisma/client";

/** A habit with its marks and (optional) goal title — enough to derive views. */
export type HabitWithMarks = Habit & {
  marks: { day: Date }[];
  goal: { title: string } | null;
};

/** The only place Prisma is touched for habits, marks, and renewal activities. */
export interface HabitRepository {
  create(data: Prisma.HabitCreateInput): Promise<HabitWithMarks>;
  findById(id: string): Promise<HabitWithMarks | null>;
  findMany(): Promise<HabitWithMarks[]>;
  update(id: string, data: Prisma.HabitUpdateInput): Promise<HabitWithMarks>;
  delete(id: string): Promise<void>;
  findMark(habitId: string, day: Date): Promise<HabitMark | null>;
  createMark(habitId: string, day: Date): Promise<void>;
  deleteMark(id: string): Promise<void>;
  createActivity(
    data: Prisma.RenewalActivityCreateInput,
  ): Promise<RenewalActivity>;
  findActivities(since: Date): Promise<RenewalActivity[]>;
  findActivity(id: string): Promise<RenewalActivity | null>;
  deleteActivity(id: string): Promise<void>;
  upsertIntention(
    dimension: RenewalDimension,
    weekStart: Date,
    text: string,
  ): Promise<WeeklyIntention>;
  deleteIntention(dimension: RenewalDimension, weekStart: Date): Promise<void>;
  findIntentions(weekStart: Date): Promise<WeeklyIntention[]>;
}

const withMarks = {
  marks: { select: { day: true } },
  goal: { select: { title: true } },
} satisfies Prisma.HabitInclude;

export class PrismaHabitRepository implements HabitRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.HabitCreateInput): Promise<HabitWithMarks> {
    return this.db.habit.create({ data, include: withMarks });
  }

  findById(id: string): Promise<HabitWithMarks | null> {
    return this.db.habit.findUnique({ where: { id }, include: withMarks });
  }

  findMany(): Promise<HabitWithMarks[]> {
    return this.db.habit.findMany({
      where: { archived: false },
      include: withMarks,
      orderBy: { createdAt: "asc" },
    });
  }

  update(id: string, data: Prisma.HabitUpdateInput): Promise<HabitWithMarks> {
    return this.db.habit.update({ where: { id }, data, include: withMarks });
  }

  async delete(id: string): Promise<void> {
    await this.db.habit.delete({ where: { id } }); // marks cascade
  }

  findMark(habitId: string, day: Date): Promise<HabitMark | null> {
    return this.db.habitMark.findUnique({
      where: { habitId_day: { habitId, day } },
    });
  }

  async createMark(habitId: string, day: Date): Promise<void> {
    await this.db.habitMark.create({ data: { habitId, day } });
  }

  async deleteMark(id: string): Promise<void> {
    await this.db.habitMark.delete({ where: { id } });
  }

  createActivity(data: Prisma.RenewalActivityCreateInput): Promise<RenewalActivity> {
    return this.db.renewalActivity.create({ data });
  }

  findActivities(since: Date): Promise<RenewalActivity[]> {
    return this.db.renewalActivity.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
    });
  }

  findActivity(id: string): Promise<RenewalActivity | null> {
    return this.db.renewalActivity.findUnique({ where: { id } });
  }

  async deleteActivity(id: string): Promise<void> {
    await this.db.renewalActivity.delete({ where: { id } });
  }

  upsertIntention(
    dimension: RenewalDimension,
    weekStart: Date,
    text: string,
  ): Promise<WeeklyIntention> {
    return this.db.weeklyIntention.upsert({
      where: { dimension_weekStart: { dimension, weekStart } },
      create: { dimension, weekStart, text },
      update: { text },
    });
  }

  async deleteIntention(dimension: RenewalDimension, weekStart: Date): Promise<void> {
    await this.db.weeklyIntention.deleteMany({ where: { dimension, weekStart } });
  }

  findIntentions(weekStart: Date): Promise<WeeklyIntention[]> {
    return this.db.weeklyIntention.findMany({ where: { weekStart } });
  }
}
