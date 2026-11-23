/**
 * An in-memory TaskRepository for tests: lets the service be tested with no
 * database. Supports the subset of Prisma filters and updates the service
 * produces. Test-only: exported from `@clock-compass/core/testing` alone.
 */
import type { Prisma, Task } from "@prisma/client";
import type { TaskRepository } from "../repositories/task-repository.js";

export class FakeTaskRepository implements TaskRepository {
  private store = new Map<string, Task>();
  private seq = 0;

  async create(data: Prisma.TaskCreateInput): Promise<Task> {
    const id = data.id ?? `task_${++this.seq}`;
    // Like the database: an id is unique.
    if (this.store.has(id)) throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" });
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
      source: "MANUAL",
      externalId: null,
      externalPriority: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, task);
    return task;
  }

  async findById(id: string): Promise<Task | null> {
    return this.store.get(id) ?? null;
  }

  async findMany(where?: Prisma.TaskWhereInput): Promise<Task[]> {
    let tasks = [...this.store.values()];
    if (typeof where?.status === "string") tasks = tasks.filter((t) => t.status === where.status);
    const notStatus = (where?.status as { not?: string } | undefined)?.not;
    if (notStatus) tasks = tasks.filter((t) => t.status !== notStatus);
    if (where?.isBigRock !== undefined)
      tasks = tasks.filter((t) => t.isBigRock === where.isBigRock);
    if (where?.important !== undefined)
      tasks = tasks.filter((t) => t.important === where.important);
    if (where?.urgent !== undefined)
      tasks = tasks.filter((t) => t.urgent === where.urgent);
    if (where?.plannedWeek !== undefined) {
      const wk = where.plannedWeek as Date;
      tasks = tasks.filter(
        (t) => t.plannedWeek?.getTime() === wk.getTime(),
      );
    }
    return tasks;
  }

  async update(id: string, data: Prisma.TaskUpdateInput): Promise<Task> {
    const existing = this.store.get(id);
    if (!existing) throw new Error("not found");
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
    ] as const) {
      if (data[key] !== undefined) {
        // @ts-expect-error narrow assignment from Prisma update fields
        patch[key] = data[key];
      }
    }
    for (const [relation, key] of [["goal", "goalId"], ["project", "projectId"]] as const) {
      const link = data[relation] as { connect?: { id: string }; disconnect?: boolean } | undefined;
      if (link?.connect) patch[key] = link.connect.id;
      else if (link?.disconnect) patch[key] = null;
    }
    const updated = { ...existing, ...patch } as Task;
    this.store.set(id, updated);
    return updated;
  }

  async updateEach(
    changes: readonly { id: string; data: Prisma.TaskUpdateInput }[],
  ): Promise<Task[]> {
    // All or none, like the transaction: check every id before writing.
    for (const { id } of changes) if (!this.store.has(id)) throw new Error("not found");
    const updated: Task[] = [];
    for (const { id, data } of changes) updated.push(await this.update(id, data));
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
