import type { Prisma, PrismaClient, Task, TaskSeries } from "@prisma/client";

/** A task with its series' rule, when it is an occurrence of a recurring task (#105). */
export type TaskRecord = Task & { series: TaskSeries | null };

/**
 * The repository is the ONLY place that talks to Prisma for tasks. Services and
 * route handlers depend on this interface, which keeps the SQLite->Postgres swap
 * and the MCP adapter clean.
 */
export interface TaskRepository {
  create(data: Prisma.TaskCreateInput): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  findMany(where?: Prisma.TaskWhereInput): Promise<TaskRecord[]>;
  /** The occurrence that follows this one in its series, if one was created. */
  findByPreviousId(previousId: string): Promise<TaskRecord | null>;
  update(id: string, data: Prisma.TaskUpdateInput): Promise<TaskRecord>;
  /** Several updates as one transaction: all of them or none. */
  updateEach(changes: readonly { id: string; data: Prisma.TaskUpdateInput }[]): Promise<Task[]>;
  delete(id: string): Promise<void>;
  createSeries(data: Prisma.TaskSeriesCreateInput): Promise<TaskSeries>;
  updateSeries(id: string, data: Prisma.TaskSeriesUpdateInput): Promise<TaskSeries>;
  /** Runs `work` in one transaction: every write in it happens, or none does. */
  transaction<T>(work: (repo: TaskRepository) => Promise<T>): Promise<T>;
}

const withSeries = { series: true } satisfies Prisma.TaskInclude;

type Db = PrismaClient | Prisma.TransactionClient;
const isClient = (db: Db): db is PrismaClient => "$transaction" in db;

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: Db) {}

  create(data: Prisma.TaskCreateInput): Promise<TaskRecord> {
    return this.db.task.create({ data, include: withSeries });
  }

  findById(id: string): Promise<TaskRecord | null> {
    return this.db.task.findUnique({ where: { id }, include: withSeries });
  }

  findMany(where?: Prisma.TaskWhereInput): Promise<TaskRecord[]> {
    return this.db.task.findMany({ where, orderBy: { createdAt: "desc" }, include: withSeries });
  }

  findByPreviousId(previousId: string): Promise<TaskRecord | null> {
    return this.db.task.findUnique({ where: { previousId }, include: withSeries });
  }

  update(id: string, data: Prisma.TaskUpdateInput): Promise<TaskRecord> {
    return this.db.task.update({ where: { id }, data, include: withSeries });
  }

  async updateEach(changes: readonly { id: string; data: Prisma.TaskUpdateInput }[]): Promise<Task[]> {
    const updates = (db: Db) => changes.map(({ id, data }) => db.task.update({ where: { id }, data }));
    if (isClient(this.db)) return this.db.$transaction(updates(this.db));
    // Already inside a transaction: run them in it, one after the other.
    const done: Task[] = [];
    for (const update of updates(this.db)) done.push(await update);
    return done;
  }

  async delete(id: string): Promise<void> {
    await this.db.task.delete({ where: { id } });
  }

  createSeries(data: Prisma.TaskSeriesCreateInput): Promise<TaskSeries> {
    return this.db.taskSeries.create({ data });
  }

  updateSeries(id: string, data: Prisma.TaskSeriesUpdateInput): Promise<TaskSeries> {
    return this.db.taskSeries.update({ where: { id }, data });
  }

  transaction<T>(work: (repo: TaskRepository) => Promise<T>): Promise<T> {
    if (!isClient(this.db)) return work(this);
    const db = this.db;
    // One at a time. Each of these transactions reads and then writes, and
    // SQLite has a single writer: several at once wait on each other until
    // Prisma times them out (five ticks at the same moment all failed after
    // 5 s). Queued, each takes a few milliseconds. The unique index on
    // `previousId` still guards against a second process (the MCP adapter).
    const run = () => db.$transaction((tx) => work(new PrismaTaskRepository(tx)));
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }
}

/** The tail of the queue of task transactions in this process (see `transaction`). */
let queue: Promise<unknown> = Promise.resolve();
