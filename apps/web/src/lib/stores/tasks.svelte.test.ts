import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/api";

// The stores are singletons that reach the REST API; stub it so the tests
// exercise only the store's reconcile/refresh wiring.
vi.mock("@/lib/api", () => ({
  listTasks: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
  listGoals: vi.fn(async () => []),
  createTask: vi.fn(async (b: Partial<Task>) => ({ id: "new", ...b })),
  updateTask: vi.fn(async (id: string, b: Partial<Task>) => ({ id, ...b })),
  completeTask: vi.fn(async (id: string) => ({ id, status: "DONE" })),
  reopenTask: vi.fn(async (id: string) => ({ id, status: "TODO" })),
  deleteTask: vi.fn(async () => undefined),
}));

vi.mock("@/lib/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { tasksStore } = await import("./tasks.svelte");
const { projectsStore } = await import("./projects.svelte");

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    notes: null,
    important: false,
    urgent: false,
    quadrant: "Q4",
    status: "TODO",
    proactivity: null,
    isBigRock: false,
    plannedWeek: null,
    dueDate: null,
    completedAt: null,
    scheduledDay: null,
    scheduledTime: null,
    goalId: null,
    projectId: null,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("tasksStore project-count refresh", () => {
  let refresh: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence the network reload the store triggers; just record the call.
    refresh = vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    tasksStore.tasks = [];
  });

  it("refreshes projects when a task in a project is deleted", async () => {
    await tasksStore.remove(makeTask({ id: "t1", projectId: "p1" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh projects when an inbox task is deleted", async () => {
    await tasksStore.remove(makeTask({ id: "t1", projectId: null }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes projects when a task is moved between projects", async () => {
    tasksStore.tasks = [makeTask({ id: "t1", projectId: "p1" })];
    await tasksStore.setProject(tasksStore.tasks[0]!, "p2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes projects when completing a task in a project", async () => {
    const task = makeTask({ id: "t1", projectId: "p1" });
    tasksStore.tasks = [task];
    await tasksStore.toggleComplete(task);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh projects when completing an inbox task", async () => {
    const task = makeTask({ id: "t1", projectId: null });
    tasksStore.tasks = [task];
    await tasksStore.toggleComplete(task);
    expect(refresh).not.toHaveBeenCalled();
  });
});
