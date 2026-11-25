import type { PrismaClient } from "@prisma/client";
import { isPlainDate } from "../domain/week.js";

/**
 * The start-up check of #137: how many stored days are not plain dates (the
 * calendar date at UTC midnight). Only the three columns that were once
 * stored otherwise are read: `Task.scheduledDay` (before #136),
 * `HabitMark.day` and `WeeklyIntention.weekStart` (before #112). There is no
 * portable SQL test for "is UTC midnight" across SQLite and Postgres, so the
 * values are judged here. The only place Prisma is touched for it.
 */
export interface StoredDayCheckRepository {
  countNotPlain(): Promise<number>;
}

export class PrismaStoredDayCheckRepository implements StoredDayCheckRepository {
  constructor(private readonly db: PrismaClient) {}

  async countNotPlain(): Promise<number> {
    // The check also runs before the migrations (the container's entrypoint),
    // on a database that may be empty or older than a table or column: what
    // does not exist yet holds no days.
    const [tasks, marks, intentions] = await Promise.all([
      ifThere(() => this.db.task.findMany({ where: { scheduledDay: { not: null } }, select: { scheduledDay: true } })),
      ifThere(() => this.db.habitMark.findMany({ select: { day: true } })),
      ifThere(() => this.db.weeklyIntention.findMany({ select: { weekStart: true } })),
    ]);
    const days = [...tasks.map((t) => t.scheduledDay!), ...marks.map((m) => m.day), ...intentions.map((i) => i.weekStart)];
    return days.filter((d) => !isPlainDate(d)).length;
  }
}

/** The rows, or none when the table (P2021) or the column (P2022) does not exist yet. */
async function ifThere<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return [];
    throw err;
  }
}
