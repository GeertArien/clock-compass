import type { PrismaClient } from "@prisma/client";
import type { DayMigrationPlan, StoredDays } from "../services/day-migration.js";

/**
 * The stored days of habit marks and weekly intentions, for the move to plain
 * dates (#112). The only place Prisma is touched for it.
 */
export interface DayRepository {
  findAll(): Promise<StoredDays>;
  /** Apply a plan in one transaction: all or nothing. */
  apply(plan: DayMigrationPlan): Promise<void>;
}

export class PrismaDayRepository implements DayRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<StoredDays> {
    const [marks, intentions] = await Promise.all([
      this.db.habitMark.findMany({ select: { id: true, habitId: true, day: true } }),
      this.db.weeklyIntention.findMany({ select: { id: true, dimension: true, weekStart: true, updatedAt: true } }),
    ]);
    return { marks, intentions };
  }

  async apply(plan: DayMigrationPlan): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Deletes first, so a moved row never meets the row it replaces.
      if (plan.deleteMarks.length) await tx.habitMark.deleteMany({ where: { id: { in: plan.deleteMarks } } });
      if (plan.deleteIntentions.length) {
        await tx.weeklyIntention.deleteMany({ where: { id: { in: plan.deleteIntentions } } });
      }
      for (const m of plan.marks) await tx.habitMark.update({ where: { id: m.id }, data: { day: m.to } });
      for (const i of plan.intentions) {
        // Keep `updatedAt` as it was: moving a day is not an edit of the text.
        const row = await tx.weeklyIntention.findUniqueOrThrow({ where: { id: i.id }, select: { updatedAt: true } });
        await tx.weeklyIntention.update({ where: { id: i.id }, data: { weekStart: i.to, updatedAt: row.updatedAt } });
      }
    });
  }
}
