import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@clock-compass/web-client/api";

// Ported from apps/web/src/lib/stores/tasks.svelte.test.ts (issue #64). The
// stores are singletons that reach the REST API; stub it so the tests exercise
// only the store's optimistic update, rollback and refresh wiring.
const api = vi.hoisted(() => ({
  listTasks: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
  listGoals: vi.fn(async () => []),
  createTask: vi.fn(async (b: Partial<Task>) => ({ id: "new", ...b })),
  updateTask: vi.fn(async (id: string, b: Partial<Task>) => ({ id, ...b })),
  completeTask: vi.fn(async (id: string) => ({ id, status: "DONE" })),
  reopenTask: vi.fn(async (id: string) => ({ id, status: "TODO" })),
  deleteTask: vi.fn(async () => undefined),
}));
vi.mock("@clock-compass/web-client/api", () => api);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("./toast", () => ({ toast: toastMock }));

const { tasksStore } = await import("./tasks");
const { projectsStore } = await import("./projects");
const { goalsStore } = await import("./goals");

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
    tasksStore.setTasks([]);
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
    tasksStore.setTasks([makeTask({ id: "t1", projectId: "p1" })]);
    await tasksStore.setProject(tasksStore.state.tasks[0]!, "p2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes projects when completing a task in a project", async () => {
    const task = makeTask({ id: "t1", projectId: "p1" });
    tasksStore.setTasks([task]);
    await tasksStore.toggleComplete(task);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh projects when completing an inbox task", async () => {
    const task = makeTask({ id: "t1", projectId: null });
    tasksStore.setTasks([task]);
    await tasksStore.toggleComplete(task);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("tasksStore optimistic updates", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    vi.spyOn(goalsStore, "refresh").mockResolvedValue(undefined);
    toastMock.error.mockClear();
    tasksStore.setTasks([]);
  });

  it("applies the change before the request settles, then reconciles", async () => {
    const task = makeTask();
    tasksStore.setTasks([task]);
    let release!: () => void;
    api.completeTask.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          release = () => resolve({ ...task, id, status: "DONE" });
        }),
    );
    const pending = tasksStore.toggleComplete(task);
    expect(tasksStore.state.tasks[0]!.status).toBe("DONE");
    release();
    await pending;
    expect(tasksStore.state.tasks[0]!.status).toBe("DONE");
  });

  it("rolls back and shows a toast when the request fails", async () => {
    const task = makeTask({ important: false, urgent: false, quadrant: "Q4" });
    tasksStore.setTasks([task]);
    api.updateTask.mockRejectedValueOnce(new Error("Server said no"));
    await tasksStore.setFlags(task, { important: true });
    expect(tasksStore.state.tasks[0]).toEqual(task);
    expect(toastMock.error).toHaveBeenCalledWith("Server said no");
  });

  it("derives the quadrant optimistically from the new flags", async () => {
    const task = makeTask();
    tasksStore.setTasks([task]);
    api.updateTask.mockImplementationOnce(() => new Promise(() => {}));
    void tasksStore.setFlags(task, { important: true });
    expect(tasksStore.state.tasks[0]!.quadrant).toBe("Q2");
  });

  it("refreshes goal progress when a task is completed or relinked", async () => {
    const task = makeTask();
    tasksStore.setTasks([task]);
    await tasksStore.toggleComplete(task);
    await tasksStore.setGoal(tasksStore.state.tasks[0]!, "g1");
    expect(goalsStore.refresh).toHaveBeenCalledTimes(2);
  });

  it("drops the optimistic task when adding fails", async () => {
    api.createTask.mockRejectedValueOnce(new Error("nope"));
    await tasksStore.add({ title: "New" });
    expect(tasksStore.state.tasks).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
  });
});
