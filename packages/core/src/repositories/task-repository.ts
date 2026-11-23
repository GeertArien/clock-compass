import type { Prisma, PrismaClient, Task } from "@prisma/client";

/**
 * The repository is the ONLY place that talks to Prisma for tasks. Services and
 * route handlers depend on this interface, which keeps the SQLite->Postgres swap
 * and the MCP adapter clean.
 */
export interface TaskRepository {
  create(data: Prisma.TaskCreateInput): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findMany(where?: Prisma.TaskWhereInput): Promise<Task[]>;
  update(id: string, data: Prisma.TaskUpdateInput): Promise<Task>;
  /** Several updates as one transaction: all of them or none. */
  updateEach(changes: readonly { id: string; data: Prisma.TaskUpdateInput }[]): Promise<Task[]>;
  delete(id: string): Promise<void>;
}

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.TaskCreateInput): Promise<Task> {
    return this.db.task.create({ data });
  }

  findById(id: string): Promise<Task | null> {
    return this.db.task.findUnique({ where: { id } });
  }

  findMany(where?: Prisma.TaskWhereInput): Promise<Task[]> {
    return this.db.task.findMany({ where, orderBy: { createdAt: "desc" } });
  }

  update(id: string, data: Prisma.TaskUpdateInput): Promise<Task> {
    return this.db.task.update({ where: { id }, data });
  }

  updateEach(changes: readonly { id: string; data: Prisma.TaskUpdateInput }[]): Promise<Task[]> {
    return this.db.$transaction(
      changes.map(({ id, data }) => this.db.task.update({ where: { id }, data })),
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.task.delete({ where: { id } });
  }
}
