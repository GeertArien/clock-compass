/**
 * An in-memory TaskRepository for tests: lets the service be tested with no
 * database. Supports the subset of Prisma filters and updates the service
 * produces, the unique `id` and `previousId` the database enforces, and
 * series. Test-only: exported from `@clock-compass/core/testing` alone.
 */
import type { Prisma, Task, TaskSeries } from "@prisma/client";
import type { TaskRecord, TaskRepository } from "../repositories/task-repository.js";

const unique = (field: string) =>
  Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), { code: "P2002" });
const missing = () => Object.assign(new Error("No record was found for an update."), { code: "P2025" });

export class FakeTaskRepository implements TaskRepository {
  private store = new Map<string, Task>();
  private series = new Map<string, TaskSeries>();
  private stats = { writes: 0, seq: 0 };
  /** Every task write, for tests that check nothing was written. */
  get writes(): number {
    return this.stats.writes;
  }

  private record(task: Task): TaskRecord {
    return { ...task, series: task.seriesId ? (this.series.get(task.seriesId) ?? null) : null };
  }

  async create(data: Prisma.TaskCreateInput): Promise<TaskRecord> {
    const id = data.id ?? `task_${++this.stats.seq}`;
    // Like the database: an id is unique, and so is the occurrence an occurrence follows.
    if (this.store.has(id)) throw unique("id");
    const previousId = data.previous?.connect?.id ?? null;
    if (previousId && [...this.store.values()].some((t) => t.previousId === previousId)) throw unique("previousId");
    const now = new Date();
    const task: Task = {
      id,
      title: data.title,
      notes: (data.notes as string | null) ?? null,
      important: (data.important as boolean | undefined) ?? false,
      urgent: (data.urgent as boolean | undefined) ?? false,
      status: "TODO",
      proactivity: (data.proactivity as Task["proactivity"] | undefined) ?? null,
      isBigRock: false,
      plannedWeek: null,
      dueDate: (data.dueDate as Date | null) ?? null,
      completedAt: null,
      goalId: data.goal?.connect?.id ?? null,
      projectId: data.project?.connect?.id ?? null,
      scheduledDay: (data.scheduledDay as Date | null) ?? null,
      scheduledTime: (data.scheduledTime as string | null) ?? null,
      seriesId: data.series?.connect?.id ?? null,
      previousId,
      slotDate: (data.slotDate as Date | null) ?? null,
      showFrom: (data.showFrom as Date | null) ?? null,
      source: "MANUAL",
      externalId: null,
      externalPriority: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, task);
    this.stats.writes++;
    return this.record(task);
  }

  async findById(id: string): Promise<TaskRecord | null> {
    const task = this.store.get(id);
    return task ? this.record(task) : null;
  }

  async findByPreviousId(previousId: string): Promise<TaskRecord | null> {
    const task = [...this.store.values()].find((t) => t.previousId === previousId);
    return task ? this.record(task) : null;
  }

  async findMany(where?: Prisma.TaskWhereInput): Promise<TaskRecord[]> {
    let tasks = [...this.store.values()];
    if (typeof where?.status === "string") tasks = tasks.filter((t) => t.status === where.status);
    const notStatus = (where?.status as { not?: string } | undefined)?.not;
    if (notStatus) tasks = tasks.filter((t) => t.status !== notStatus);
    if (where?.isBigRock !== undefined) tasks = tasks.filter((t) => t.isBigRock === where.isBigRock);
    if (where?.important !== undefined) tasks = tasks.filter((t) => t.important === where.important);
    if (where?.urgent !== undefined) tasks = tasks.filter((t) => t.urgent === where.urgent);
    if (where?.goalId !== undefined) tasks = tasks.filter((t) => t.goalId === where.goalId);
    if (where?.projectId !== undefined) tasks = tasks.filter((t) => t.projectId === where.projectId);
    if (where?.seriesId !== undefined) tasks = tasks.filter((t) => t.seriesId === where.seriesId);
    if (where?.plannedWeek !== undefined) {
      const wk = where.plannedWeek as Date;
      tasks = tasks.filter((t) => t.plannedWeek?.getTime() === wk.getTime());
    }
    return tasks.map((t) => this.record(t));
  }

  async update(id: string, data: Prisma.TaskUpdateInput): Promise<TaskRecord> {
    const existing = this.store.get(id);
    if (!existing) throw missing();
    // Flatten the subset of Prisma update shapes the service produces.
    const patch: Partial<Task> = {};
    for (const key of [
      "title",
      "notes",
      "important",
      "urgent",
      "dueDate",
      "isBigRock",
      "plannedWeek",
      "status",
      "completedAt",
      "scheduledDay",
      "scheduledTime",
      "proactivity",
      "slotDate",
      "showFrom",
    ] as const) {
      if (data[key] !== undefined) {
        // @ts-expect-error narrow assignment from Prisma update fields
        patch[key] = data[key];
      }
    }
    for (const [relation, key] of [["goal", "goalId"], ["project", "projectId"], ["series", "seriesId"]] as const) {
      const link = data[relation] as { connect?: { id: string }; disconnect?: boolean } | undefined;
      if (link?.connect) patch[key] = link.connect.id;
      else if (link?.disconnect) patch[key] = null;
    }
    const updated = { ...existing, ...patch, updatedAt: new Date() } as Task;
    this.store.set(id, updated);
    this.stats.writes++;
    return this.record(updated);
  }

  async updateEach(changes: readonly { id: string; data: Prisma.TaskUpdateInput }[]): Promise<Task[]> {
    // All or none, like the transaction: check every id before writing.
    for (const { id } of changes) if (!this.store.has(id)) throw missing();
    const updated: Task[] = [];
    for (const { id, data } of changes) updated.push(await this.update(id, data));
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw missing();
    this.store.delete(id);
    // Like onDelete: SetNull on the occurrence that followed it.
    for (const [key, t] of this.store) if (t.previousId === id) this.store.set(key, { ...t, previousId: null });
    this.stats.writes++;
  }

  async createSeries(data: Prisma.TaskSeriesCreateInput): Promise<TaskSeries> {
    const now = new Date();
    const series: TaskSeries = {
      id: `series_${++this.stats.seq}`,
      cadenceUnit: data.cadenceUnit,
      cadenceValue: data.cadenceValue ?? 1,
      from: data.from ?? "SCHEDULE",
      anchorDate: data.anchorDate as Date,
      leadDays: data.leadDays ?? null,
      endedAt: (data.endedAt as Date | null) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.series.set(series.id, series);
    return series;
  }

  async updateSeries(id: string, data: Prisma.TaskSeriesUpdateInput): Promise<TaskSeries> {
    const existing = this.series.get(id);
    if (!existing) throw missing();
    const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<TaskSeries>;
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.series.set(id, updated);
    return updated;
  }

  private lock: Promise<unknown> = Promise.resolve();

  /**
   * All or nothing, like the database: a failure inside restores what was
   * there. Transactions run one at a time, as SQLite's write lock makes them;
   * `work` gets a view whose own `transaction` runs inline (nested).
   */
  async transaction<T>(work: (repo: TaskRepository) => Promise<T>): Promise<T> {
    const inner = Object.create(this) as FakeTaskRepository;
    inner.transaction = (nested) => nested(inner);
    const run = async () => {
      const tasks = new Map(this.store);
      const series = new Map(this.series);
      try {
        return await work(inner);
      } catch (err) {
        this.store = tasks;
        this.series = series;
        throw err;
      }
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  /** Every series, for tests. */
  allSeries(): TaskSeries[] {
    return [...this.series.values()];
  }
}
