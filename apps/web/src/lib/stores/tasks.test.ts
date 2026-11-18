import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@clock-compass/web-client/api";

// The stores are singletons that reach the REST API; stub it so the tests exercise
// only the store's optimistic update, rollback and refresh wiring.
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

  // What TaskCard's memo and useStore's selectors rely on: an edit replaces only
  // the edited task object, so every other card gets an identical prop and a
  // selector over another store returns the same reference (no re-render).
  // Checking the re-render itself would need a DOM test dependency.
  it("keeps other tasks and other stores' slices referentially stable", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    tasksStore.setTasks([a, b]);
    const projectsBefore = projectsStore.getSnapshot().projects;
    api.updateTask.mockImplementationOnce(async (id: string, body: Partial<Task>) => ({ ...a, ...body, id }));
    await tasksStore.setFlags(a, { important: true });
    const [nextA, nextB] = tasksStore.state.tasks;
    expect(nextA).not.toBe(a);
    expect(nextB).toBe(b);
    expect(projectsStore.getSnapshot().projects).toBe(projectsBefore);
  });

  it("drops the optimistic task when adding fails", async () => {
    api.createTask.mockRejectedValueOnce(new Error("nope"));
    await tasksStore.add({ title: "New" });
    expect(tasksStore.state.tasks).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
  });
});

describe("tasksStore overlapping edits", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    vi.spyOn(goalsStore, "refresh").mockResolvedValue(undefined);
    tasksStore.setTasks([]);
  });

  // Toggle Important (its request fails later), then tag Influence meanwhile.
  function startOverlap() {
    const task = makeTask();
    tasksStore.setTasks([task]);
    let fail!: (err: Error) => void;
    api.updateTask.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const first = tasksStore.setFlags(task, { important: true });
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
    await tasksStore.setProactivity(tasksStore.state.tasks[0]!, "INFLUENCE");
    fail("500");
    await first;
    expect(tasksStore.state.tasks[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed edit keeps a later edit that is still in flight", async () => {
    const { first, fail } = startOverlap();
    api.updateTask.mockImplementationOnce(() => new Promise(() => {}));
    void tasksStore.setProactivity(tasksStore.state.tasks[0]!, "INFLUENCE");
    fail("500");
    await first;
    expect(tasksStore.state.tasks[0]).toMatchObject({
      proactivity: "INFLUENCE",
      important: false,
      quadrant: "Q4",
    });
  });

  it("a failed delete puts the task back in place without undoing others", async () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    tasksStore.setTasks([a, b]);
    let fail!: (err: Error) => void;
    api.deleteTask.mockImplementationOnce(() => new Promise((_r, reject) => (fail = reject)));
    const removing = tasksStore.remove(a);
    await tasksStore.setProactivity(b, "CONCERN");
    fail(new Error("500"));
    await removing;
    expect(tasksStore.state.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasksStore.state.tasks[1]!.proactivity).toBe("CONCERN");
  });
});

describe("tasksStore: two overlapping edits that both fail", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    vi.spyOn(goalsStore, "refresh").mockResolvedValue(undefined);
  });

  /** Run two edits whose requests both fail, rejecting them in `order`. */
  async function bothFail(start: Task, first: () => Promise<void>, second: () => Promise<void>, order: "first-first" | "second-first") {
    tasksStore.setTasks([start]);
    const rejects: ((err: Error) => void)[] = [];
    const deferred = () => new Promise<never>((_r, reject) => rejects.push(reject));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
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
    return tasksStore.state.tasks[0]!;
  }

  it.each(["first-first", "second-first"] as const)(
    "Influence then Concern, both failing (%s), ends as never tagged",
    async (order) => {
      const task = makeTask({ proactivity: null });
      const end = await bothFail(
        task,
        () => tasksStore.setProactivity(tasksStore.state.tasks[0]!, "INFLUENCE"),
        () => tasksStore.setProactivity(tasksStore.state.tasks[0]!, "CONCERN"),
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
        () => tasksStore.setFlags(tasksStore.state.tasks[0]!, { urgent: true }),
        () => tasksStore.setFlags(tasksStore.state.tasks[0]!, { important: false }),
        order,
      );
      expect(end).toMatchObject({ important: true, urgent: false, quadrant: "Q2" });
    },
  );
});

describe("tasksStore: responses that arrive out of order", () => {
  beforeEach(() => {
    vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
    vi.spyOn(goalsStore, "refresh").mockResolvedValue(undefined);
  });

  it("keeps the newer edit when the older request's response arrives last", async () => {
    const task = makeTask({ important: true, urgent: false, quadrant: "Q2", proactivity: null });
    tasksStore.setTasks([task]);
    const resolvers: ((t: Task) => void)[] = [];
    const deferred = () => new Promise<Task>((resolve) => resolvers.push(resolve));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const first = tasksStore.setFlags(tasksStore.state.tasks[0]!, { urgent: true });
    const second = tasksStore.setProactivity(tasksStore.state.tasks[0]!, "INFLUENCE");
    const [r1, r2] = resolvers as [(t: Task) => void, (t: Task) => void];
    // The server applied both, in order; the second response arrives first.
    r2({ ...task, urgent: true, quadrant: "Q1", proactivity: "INFLUENCE" });
    await second;
    r1({ ...task, urgent: true, quadrant: "Q1", proactivity: null });
    await first;
    expect(tasksStore.state.tasks[0]).toMatchObject({
      urgent: true,
      quadrant: "Q1",
      proactivity: "INFLUENCE",
    });
  });
  it("still keeps the newer edit when a reload lands between the requests and responses", async () => {
    const task = makeTask({ id: "reload", important: true, urgent: false, quadrant: "Q2", proactivity: null });
    tasksStore.setTasks([task]);
    const resolvers: ((t: Task) => void)[] = [];
    const deferred = () => new Promise<Task>((resolve) => resolvers.push(resolve));
    api.updateTask.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
    const first = tasksStore.setFlags(tasksStore.state.tasks[0]!, { urgent: true });
    const second = tasksStore.setProactivity(tasksStore.state.tasks[0]!, "INFLUENCE");
    const saved = { ...task, urgent: true, quadrant: "Q1" as const, proactivity: "INFLUENCE" as const };
    // A full reload returns the server's list, which already has both edits.
    api.listTasks.mockResolvedValueOnce([saved]);
    await tasksStore.load();
    const [r1, r2] = resolvers as [(t: Task) => void, (t: Task) => void];
    r2(saved);
    await second;
    r1({ ...task, urgent: true, quadrant: "Q1", proactivity: null });
    await first;
    expect(tasksStore.state.tasks[0]).toMatchObject({ proactivity: "INFLUENCE", urgent: true });
  });
});

describe("tasksStore: a failed delete during an edit", () => {
  // One tap on the checkbox, then delete, on a bad connection: both fail.
  it.each(["edit first", "delete first"] as const)(
    "both failing (%s) puts back the task as the server has it",
    async (order) => {
      vi.spyOn(projectsStore, "refresh").mockResolvedValue(undefined);
      vi.spyOn(goalsStore, "refresh").mockResolvedValue(undefined);
      tasksStore.setTasks([makeTask({ id: "t1", title: "Call Mom" })]);
      let failEdit!: (err: Error) => void;
      let failDelete!: (err: Error) => void;
      api.updateTask.mockImplementationOnce(() => new Promise((_r, reject) => (failEdit = reject)));
      api.deleteTask.mockImplementationOnce(() => new Promise((_r, reject) => (failDelete = reject)));
      const editing = tasksStore.update(tasksStore.state.tasks[0]!, { important: true });
      const deleting = tasksStore.remove(tasksStore.state.tasks[0]!);
      expect(tasksStore.state.tasks).toEqual([]);
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
      expect(tasksStore.state.tasks).toHaveLength(1);
      expect(tasksStore.state.tasks[0]).toMatchObject({ id: "t1", important: false, quadrant: "Q4" });
    },
  );
});
