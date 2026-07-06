import { beforeEach, describe, expect, it } from "vitest";
import type { Goal, Prisma, TaskStatus } from "@prisma/client";
import type {
  GoalRepository,
  GoalWithTasks,
} from "../repositories/goal-repository.js";
import { GoalService } from "./goal-service.js";

class FakeGoalRepository implements GoalRepository {
  private store = new Map<string, GoalWithTasks>();
  private seq = 0;
  private taskSeq = 0;

  async create(data: Prisma.GoalCreateInput): Promise<GoalWithTasks> {
    const id = `goal_${++this.seq}`;
    const now = new Date();
    const goal: GoalWithTasks = {
      id,
      title: data.title,
      description: (data.description as string | null) ?? null,
      targetDate: (data.targetDate as Date | null) ?? null,
      status: (data.status as Goal["status"] | undefined) ?? "ACTIVE",
      order: (data.order as number | undefined) ?? 0,
      roleId: data.role?.connect?.id ?? null,
      dimension: null,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      projects: [],
    };
    this.store.set(id, goal);
    return goal;
  }

  async findById(id: string): Promise<GoalWithTasks | null> {
    return this.store.get(id) ?? null;
  }

  async findMany(where?: Prisma.GoalWhereInput): Promise<GoalWithTasks[]> {
    let goals = [...this.store.values()];
    if (where?.status) goals = goals.filter((g) => g.status === where.status);
    return goals.sort((a, b) => a.order - b.order);
  }

  async update(id: string, data: Prisma.GoalUpdateInput): Promise<GoalWithTasks> {
    const existing = this.store.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...data } as GoalWithTasks;
    this.store.set(id, updated);
    return updated;
  }

  async reorder(ids: string[]): Promise<void> {
    ids.forEach((id, index) => {
      const goal = this.store.get(id);
      if (goal) goal.order = index;
    });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  private refs(statuses: TaskStatus[]): { id: string; status: TaskStatus }[] {
    return statuses.map((status) => ({ id: `task_${++this.taskSeq}`, status }));
  }

  /** Test helper: attach directly-linked task statuses to a goal. */
  setTasks(id: string, statuses: TaskStatus[]): void {
    const goal = this.store.get(id);
    if (goal) goal.tasks = this.refs(statuses);
  }

  /** Test helper: attach a project's task statuses to a goal. */
  setProjectTasks(id: string, statuses: TaskStatus[]): void {
    const goal = this.store.get(id);
    if (goal) goal.projects = [{ tasks: this.refs(statuses) }];
  }

  /** Test helper: give the goal a task shared between its direct + project set. */
  setSharedTask(id: string, status: TaskStatus): void {
    const goal = this.store.get(id);
    if (goal) {
      const ref = { id: `task_${++this.taskSeq}`, status };
      goal.tasks = [ref];
      goal.projects = [{ tasks: [ref] }];
    }
  }
}

describe("GoalService", () => {
  let repo: FakeGoalRepository;
  let service: GoalService;

  beforeEach(() => {
    repo = new FakeGoalRepository();
    service = new GoalService(repo);
  });

  it("creates a goal defaulting to ACTIVE with zero progress", async () => {
    const goal = await service.create({ title: "Ship v1" });
    expect(goal.status).toBe("ACTIVE");
    expect(goal.progress).toEqual({ total: 0, done: 0, ratio: 0 });
  });

  it("derives progress from the goal's tasks", async () => {
    const goal = await service.create({ title: "Read 12 books" });
    repo.setTasks(goal.id, ["DONE", "DONE", "TODO", "TODO"]);
    const fetched = await service.get(goal.id);
    expect(fetched?.progress).toEqual({ total: 4, done: 2, ratio: 0.5 });
  });

  it("counts tasks reached through the goal's projects", async () => {
    const goal = await service.create({ title: "Launch newsletter" });
    repo.setTasks(goal.id, ["DONE"]); // one directly-linked, done
    repo.setProjectTasks(goal.id, ["TODO", "DONE"]); // two via a project
    const fetched = await service.get(goal.id);
    expect(fetched?.progress).toEqual({ total: 3, done: 2, ratio: 2 / 3 });
  });

  it("does not double-count a task linked both directly and via a project", async () => {
    const goal = await service.create({ title: "Ship it" });
    repo.setSharedTask(goal.id, "DONE");
    const fetched = await service.get(goal.id);
    expect(fetched?.progress).toEqual({ total: 1, done: 1, ratio: 1 });
  });

  it("reorders goals by the given id sequence", async () => {
    const a = await service.create({ title: "A", order: 0 });
    const b = await service.create({ title: "B", order: 1 });
    const c = await service.create({ title: "C", order: 2 });
    await service.reorder([c.id, a.id, b.id]);
    const goals = await service.list();
    expect(goals.map((g) => g.title)).toEqual(["C", "A", "B"]);
  });

  it("updates status and filters by it", async () => {
    const a = await service.create({ title: "A" });
    await service.create({ title: "B" });
    await service.update(a.id, { status: "ACHIEVED" });
    expect(await service.list("ACHIEVED")).toHaveLength(1);
    expect(await service.list("ACTIVE")).toHaveLength(1);
  });
});
