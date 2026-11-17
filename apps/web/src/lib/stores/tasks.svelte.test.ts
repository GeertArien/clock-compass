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

const api = await import("@/lib/api");
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

describe("tasksStore overlapping edits", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    tasksStore.tasks = [];
  });

  // Toggle Important (its request fails later), then tag Influence meanwhile.
  function startOverlap() {
    const task = makeTask();
    tasksStore.tasks = [task];
    let fail!: (err: Error) => void;
    vi.mocked(api.updateTask).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const first = tasksStore.setFlags(task, { important: true });
    return { task, first, fail: (msg: string) => fail(new Error(msg)) };
  }

  it("a failed edit keeps a later edit that already succeeded", async () => {
    const { task, first, fail } = startOverlap();
    // The server applies only the second edit, so its response has important: false.
    vi.mocked(api.updateTask).mockImplementationOnce(async (id: string) => ({
      ...task,
      id,
      proactivity: "INFLUENCE",
    }));
    await tasksStore.setProactivity(tasksStore.tasks[0]!, "INFLUENCE");
    fail("500");
    await first;
    expect(tasksStore.tasks[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed edit keeps a later edit that is still in flight", async () => {
    const { first, fail } = startOverlap();
    vi.mocked(api.updateTask).mockImplementationOnce(() => new Promise(() => {}));
    void tasksStore.setProactivity(tasksStore.tasks[0]!, "INFLUENCE");
    fail("500");
    await first;
    expect(tasksStore.tasks[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed delete puts the task back in place without undoing others", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    tasksStore.tasks = [a, b];
    let fail!: (err: Error) => void;
    vi.mocked(api.deleteTask).mockImplementationOnce(
      () => new Promise((_r, reject) => (fail = reject)),
    );
    const removing = tasksStore.remove(a);
    await tasksStore.setProactivity(b, "CONCERN");
    fail(new Error("500"));
    await removing;
    expect(tasksStore.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasksStore.tasks[1]!.proactivity).toBe("CONCERN");
  });
});

describe("tasksStore: two overlapping edits that both fail", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
  });

  /** Run two edits whose requests both fail, rejecting them in `order`. */
  async function bothFail(
    start: Task,
    first: () => Promise<void>,
    second: () => Promise<void>,
    order: "first-first" | "second-first",
  ) {
    tasksStore.tasks = [start];
    const rejects: ((err: Error) => void)[] = [];
    const deferred = () => new Promise<never>((_r, reject) => rejects.push(reject));
    vi.mocked(api.updateTask).mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const a = first();
    const b = second();
    const [ra, rb] = rejects as [(e: Error) => void, (e: Error) => void];
    if (order === "first-first") {
      ra(new Error("offline"));
      await a;
      rb(new Error("offline"));
      await b;
    } else {
      rb(new Error("offline"));
      await b;
      ra(new Error("offline"));
      await a;
    }
    return tasksStore.tasks[0]!;
  }

  it.each(["first-first", "second-first"] as const)(
    "Influence then Concern, both failing (%s), ends as never tagged",
    async (order) => {
      const end = await bothFail(
        makeTask({ id: `p-${order}`, proactivity: null }),
        () => tasksStore.setProactivity(tasksStore.tasks[0]!, "INFLUENCE"),
        () => tasksStore.setProactivity(tasksStore.tasks[0]!, "CONCERN"),
        order,
      );
      expect(end.proactivity).toBeNull();
    },
  );

  it.each(["first-first", "second-first"] as const)(
    "urgent on then important off, both failing (%s), ends back in Q2",
    async (order) => {
      const end = await bothFail(
        makeTask({ id: `f-${order}`, important: true, urgent: false, quadrant: "Q2" }),
        () => tasksStore.setFlags(tasksStore.tasks[0]!, { urgent: true }),
        () => tasksStore.setFlags(tasksStore.tasks[0]!, { important: false }),
        order,
      );
      expect(end).toMatchObject({ important: true, urgent: false, quadrant: "Q2" });
    },
  );
});

describe("tasksStore: responses that arrive out of order", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
  });

  it("keeps the newer edit when the older request's response arrives last", async () => {
    const task = makeTask({
      id: "ooo",
      important: true,
      urgent: false,
      quadrant: "Q2",
      proactivity: null,
    });
    tasksStore.tasks = [task];
    const resolvers: ((t: Task) => void)[] = [];
    const deferred = () => new Promise<Task>((resolve) => resolvers.push(resolve));
    vi.mocked(api.updateTask).mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const first = tasksStore.setFlags(tasksStore.tasks[0]!, { urgent: true });
    const second = tasksStore.setProactivity(tasksStore.tasks[0]!, "INFLUENCE");
    const [r1, r2] = resolvers as [(t: Task) => void, (t: Task) => void];
    // The server applied both, in order; the second response arrives first.
    r2({ ...task, urgent: true, quadrant: "Q1", proactivity: "INFLUENCE" });
    await second;
    r1({ ...task, urgent: true, quadrant: "Q1", proactivity: null });
    await first;
    expect(tasksStore.tasks[0]).toMatchObject({
      urgent: true,
      quadrant: "Q1",
      proactivity: "INFLUENCE",
    });
  });
});
