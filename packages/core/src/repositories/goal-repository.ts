import type { Goal, Prisma, PrismaClient, TaskStatus } from "@prisma/client";

/** A task reference slim enough to derive progress, with id for de-duping. */
export type GoalTaskRef = { id: string; status: TaskStatus };

/**
 * A goal with the tasks that count toward its progress: those linked directly
 * (`task.goalId`) plus those reached through a project the goal owns
 * (`project.goalId`). The service de-dupes by task id.
 */
export type GoalWithTasks = Goal & {
  tasks: GoalTaskRef[];
  projects: { tasks: GoalTaskRef[] }[];
};

/**
 * The only place Prisma is touched for goals. Goals are returned with a slim
 * view of their (and their projects') tasks so the service can derive progress.
 */
export interface GoalRepository {
  create(data: Prisma.GoalCreateInput): Promise<GoalWithTasks>;
  findById(id: string): Promise<GoalWithTasks | null>;
  findMany(where?: Prisma.GoalWhereInput): Promise<GoalWithTasks[]>;
  update(id: string, data: Prisma.GoalUpdateInput): Promise<GoalWithTasks>;
  reorder(ids: string[]): Promise<void>;
  delete(id: string): Promise<void>;
}

const withTasks = {
  tasks: { select: { id: true, status: true } },
  projects: { select: { tasks: { select: { id: true, status: true } } } },
} satisfies Prisma.GoalInclude;

export class PrismaGoalRepository implements GoalRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.GoalCreateInput): Promise<GoalWithTasks> {
    return this.db.goal.create({ data, include: withTasks });
  }

  findById(id: string): Promise<GoalWithTasks | null> {
    return this.db.goal.findUnique({ where: { id }, include: withTasks });
  }

  findMany(where?: Prisma.GoalWhereInput): Promise<GoalWithTasks[]> {
    return this.db.goal.findMany({
      where,
      include: withTasks,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
  }

  update(id: string, data: Prisma.GoalUpdateInput): Promise<GoalWithTasks> {
    return this.db.goal.update({ where: { id }, data, include: withTasks });
  }

  /** Persist a new sort order — the goal at index i gets `order = i`. */
  async reorder(ids: string[]): Promise<void> {
    await this.db.$transaction(
      ids.map((id, index) =>
        this.db.goal.update({ where: { id }, data: { order: index } }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    // Tasks keep existing; their goalId is set null (schema onDelete: SetNull).
    await this.db.goal.delete({ where: { id } });
  }
}
