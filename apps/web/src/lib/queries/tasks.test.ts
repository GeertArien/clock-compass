import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@clock-compass/web-client/api";

// The writes run on the app's query client and reach the REST API; stub it so
// the tests exercise only the optimistic update, rollback and refresh wiring.
const api = vi.hoisted(() => ({
  listTasks: vi.fn(async (): Promise<Task[]> => []),
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
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

// Goal progress and project counts reload silently after task changes.
const goalsMock = vi.hoisted(() => ({ refreshGoals: vi.fn(async () => undefined) }));
vi.mock("./goals", () => goalsMock);
const projectsMock = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => undefined) }));
vi.mock("./projects", () => projectsMock);

const { reloadTasks, replaceTasks, taskWrites, tasksQuery } = await import("./tasks");
const { queryClient } = await import("@/lib/query-client");
const { tick } = await import("./test-client");

/** The tasks as shown (the app's query cache). */
const tasks = () => queryClient.getQueryData(tasksQuery.queryKey) ?? [];

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

describe("tasks project-count refresh", () => {
  const refresh = projectsMock.refreshProjects;

  beforeEach(() => {
    // Silence the network reload the store triggers; just record the call.
    refresh.mockClear();
    replaceTasks(queryClient, []);
  });

  it("refreshes projects when a task in a project is deleted", async () => {
    await taskWrites.remove(makeTask({ id: "t1", projectId: "p1" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh projects when an inbox task is deleted", async () => {
    await taskWrites.remove(makeTask({ id: "t1", projectId: null }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes projects when a task is moved between projects", async () => {
    replaceTasks(queryClient, [makeTask({ id: "t1", projectId: "p1" })]);
    await taskWrites.setProject(tasks()[0]!, "p2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes projects when completing a task in a project", async () => {
    const task = makeTask({ id: "t1", projectId: "p1" });
    replaceTasks(queryClient, [task]);
    await taskWrites.toggleComplete(task);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh projects when completing an inbox task", async () => {
    const task = makeTask({ id: "t1", projectId: null });
    replaceTasks(queryClient, [task]);
    await taskWrites.toggleComplete(task);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("tasks optimistic updates", () => {
  beforeEach(() => {
    projectsMock.refreshProjects.mockClear();
    goalsMock.refreshGoals.mockClear();
    toastMock.error.mockClear();
    replaceTasks(queryClient, []);
  });

  it("applies the change before the request settles, then reconciles", async () => {
    const task = makeTask();
    replaceTasks(queryClient, [task]);
    let release!: () => void;
    api.completeTask.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          release = () => resolve({ ...task, id, status: "DONE" });
        }),
    );
    const pending = taskWrites.toggleComplete(task);
    await tick();
    expect(tasks()[0]!.status).toBe("DONE");
    release();
    await pending;
    expect(tasks()[0]!.status).toBe("DONE");
  });

  it("rolls back and shows a toast when the request fails", async () => {
    const task = makeTask({ important: false, urgent: false, quadrant: "Q4" });
    replaceTasks(queryClient, [task]);
    api.updateTask.mockRejectedValueOnce(new Error("Server said no"));
    await taskWrites.setFlags(task, { important: true });
    expect(tasks()[0]).toEqual(task);
    expect(toastMock.error).toHaveBeenCalledWith("Server said no");
  });

  it("derives the quadrant optimistically from the new flags", async () => {
    const task = makeTask();
    replaceTasks(queryClient, [task]);
    api.updateTask.mockImplementationOnce(() => new Promise(() => {}));
    void taskWrites.setFlags(task, { important: true });
    await tick();
    expect(tasks()[0]!.quadrant).toBe("Q2");
  });

  it("refreshes goal progress when a task is completed or relinked", async () => {
    const task = makeTask();
    replaceTasks(queryClient, [task]);
    await taskWrites.toggleComplete(task);
    await taskWrites.setGoal(tasks()[0]!, "g1");
    expect(goalsMock.refreshGoals).toHaveBeenCalledTimes(2);
  });

  // What TaskCard's memo relies on: an edit replaces only the edited task
  // object, so every other card gets an identical prop (no re-render). The
  // projects slice it also read is a query now, which a task edit never writes
  // (counts reload through refreshProjects). Checking the re-render itself
  // would need a DOM test dependency.
  it("keeps other tasks referentially stable", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    replaceTasks(queryClient, [a, b]);
    api.updateTask.mockImplementationOnce(async (id: string, body: Partial<Task>) => ({ ...a, ...body, id }));
    await taskWrites.setFlags(a, { important: true });
    const [nextA, nextB] = tasks();
    expect(nextA).not.toBe(a);
    expect(nextB).toBe(b);
  });

  it("drops the optimistic task when adding fails", async () => {
    api.createTask.mockRejectedValueOnce(new Error("nope"));
    await taskWrites.add({ title: "New" });
    expect(tasks()).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
  });
});

describe("tasks overlapping edits", () => {
  beforeEach(() => {
    projectsMock.refreshProjects.mockClear();
    goalsMock.refreshGoals.mockClear();
    replaceTasks(queryClient, []);
  });

  // Toggle Important (its request fails later), then tag Influence meanwhile.
  function startOverlap() {
    const task = makeTask();
    replaceTasks(queryClient, [task]);
    let fail!: (err: Error) => void;
    api.updateTask.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const first = taskWrites.setFlags(task, { important: true });
    return { task, first, fail: (msg: string) => fail(new Error(msg)) };
  }

  it("a failed edit keeps a later edit that already succeeded", async () => {
    const { task, first, fail } = startOverlap();
    // The server applies only the second edit, so its response has important: false.
    api.updateTask.mockImplementationOnce(async (id: string) => ({
      ...task,
      id,
      proactivity: "INFLUENCE",
    }));
    await taskWrites.setProactivity(tasks()[0]!, "INFLUENCE");
    fail("500");
    await first;
    expect(tasks()[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed edit keeps a later edit that is still in flight", async () => {
    const { first, fail } = startOverlap();
    api.updateTask.mockImplementationOnce(() => new Promise(() => {}));
    void taskWrites.setProactivity(tasks()[0]!, "INFLUENCE");
    await tick(); // both requests sent
    fail("500");
    await first;
    expect(tasks()[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed delete puts the task back in place without undoing others", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    replaceTasks(queryClient, [a, b]);
    let fail!: (err: Error) => void;
    api.deleteTask.mockImplementationOnce(() => new Promise((_r, reject) => (fail = reject)));
    const removing = taskWrites.remove(a);
    await taskWrites.setProactivity(b, "CONCERN");
    fail(new Error("500"));
    await removing;
    expect(tasks().map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasks()[1]!.proactivity).toBe("CONCERN");
  });
});

describe("tasks: two overlapping edits that both fail", () => {
  beforeEach(() => {
    projectsMock.refreshProjects.mockClear();
    goalsMock.refreshGoals.mockClear();
  });

  /** Run two edits whose requests both fail, rejecting them in `order`. */
  async function bothFail(start: Task, first: () => Promise<void>, second: () => Promise<void>, order: "first-first" | "second-first") {
    replaceTasks(queryClient, [start]);
    const rejects: ((err: Error) => void)[] = [];
    const deferred = () => new Promise<never>((_r, reject) => rejects.push(reject));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const a = first();
    const b = second();
    await tick(); // both requests sent
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
    return tasks()[0]!;
  }

  it.each(["first-first", "second-first"] as const)(
    "Influence then Concern, both failing (%s), ends as never tagged",
    async (order) => {
      const task = makeTask({ proactivity: null });
      const end = await bothFail(
        task,
        () => taskWrites.setProactivity(tasks()[0]!, "INFLUENCE"),
        () => taskWrites.setProactivity(tasks()[0]!, "CONCERN"),
        order,
      );
      expect(end.proactivity).toBeNull();
    },
  );

  it.each(["first-first", "second-first"] as const)(
    "urgent on then important off, both failing (%s), ends back in Q2",
    async (order) => {
      const task = makeTask({ important: true, urgent: false, quadrant: "Q2" });
      const end = await bothFail(
        task,
        () => taskWrites.setFlags(tasks()[0]!, { urgent: true }),
        () => taskWrites.setFlags(tasks()[0]!, { important: false }),
        order,
      );
      expect(end).toMatchObject({ important: true, urgent: false, quadrant: "Q2" });
    },
  );
});

describe("tasks: responses that arrive out of order", () => {
  beforeEach(() => {
    projectsMock.refreshProjects.mockClear();
    goalsMock.refreshGoals.mockClear();
  });

  it("keeps the newer edit when the older request's response arrives last", async () => {
    const task = makeTask({ important: true, urgent: false, quadrant: "Q2", proactivity: null });
    replaceTasks(queryClient, [task]);
    const resolvers: ((t: Task) => void)[] = [];
    const deferred = () => new Promise<Task>((resolve) => resolvers.push(resolve));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const first = taskWrites.setFlags(tasks()[0]!, { urgent: true });
    const second = taskWrites.setProactivity(tasks()[0]!, "INFLUENCE");
    await tick(); // both requests sent
    const [r1, r2] = resolvers as [(t: Task) => void, (t: Task) => void];
    // The server applied both, in order; the second response arrives first.
    r2({ ...task, urgent: true, quadrant: "Q1", proactivity: "INFLUENCE" });
    await second;
    r1({ ...task, urgent: true, quadrant: "Q1", proactivity: null });
    await first;
    expect(tasks()[0]).toMatchObject({
      urgent: true,
      quadrant: "Q1",
      proactivity: "INFLUENCE",
    });
  });
  it("still keeps the newer edit when a reload lands between the requests and responses", async () => {
    const task = makeTask({ id: "reload", important: true, urgent: false, quadrant: "Q2", proactivity: null });
    replaceTasks(queryClient, [task]);
    const resolvers: ((t: Task) => void)[] = [];
    const deferred = () => new Promise<Task>((resolve) => resolvers.push(resolve));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const first = taskWrites.setFlags(tasks()[0]!, { urgent: true });
    const second = taskWrites.setProactivity(tasks()[0]!, "INFLUENCE");
    await tick(); // both requests sent
    const saved = { ...task, urgent: true, quadrant: "Q1" as const, proactivity: "INFLUENCE" as const };
    // A full reload returns the server's list, which already has both edits.
    api.listTasks.mockResolvedValueOnce([saved]);
    await reloadTasks();
    const [r1, r2] = resolvers as [(t: Task) => void, (t: Task) => void];
    r2(saved);
    await second;
    r1({ ...task, urgent: true, quadrant: "Q1", proactivity: null });
    await first;
    expect(tasks()[0]).toMatchObject({ proactivity: "INFLUENCE", urgent: true });
  });
});

describe("tasks: a failed delete during an edit", () => {
  // One tap on the checkbox, then delete, on a bad connection: both fail.
  it.each(["edit first", "delete first"] as const)(
    "both failing (%s) puts back the task as the server has it",
    async (order) => {
      projectsMock.refreshProjects.mockClear();
      goalsMock.refreshGoals.mockClear();
      replaceTasks(queryClient, [makeTask({ id: "t1", title: "Call Mom" })]);
      let failEdit!: (err: Error) => void;
      let failDelete!: (err: Error) => void;
      api.updateTask.mockImplementationOnce(() => new Promise((_r, reject) => (failEdit = reject)));
      api.deleteTask.mockImplementationOnce(() => new Promise((_r, reject) => (failDelete = reject)));
      const editing = taskWrites.update(tasks()[0]!, { important: true });
      await tick();
      const deleting = taskWrites.remove(tasks()[0]!);
      await tick();
      expect(tasks()).toEqual([]);
      if (order === "edit first") {
        failEdit(new Error("offline"));
        await editing;
        failDelete(new Error("offline"));
        await deleting;
      } else {
        failDelete(new Error("offline"));
        await deleting;
        failEdit(new Error("offline"));
        await editing;
      }
      expect(tasks()).toHaveLength(1);
      expect(tasks()[0]).toMatchObject({ id: "t1", important: false, quadrant: "Q4" });
    },
  );
});
