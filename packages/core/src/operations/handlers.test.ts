import { describe, expect, it } from "vitest";
import { FakeTaskRepository } from "../services/fake-task-repository.js";
import { FakeHabitRepository } from "../services/fake-habit-repository.js";
import { TaskService } from "../services/task-service.js";
import { RenewalService } from "../services/renewal-service.js";
import { OperationError, idFromKey, runOperation, type OperationContext, type OperationServices } from "./handlers.js";

/**
 * The handlers through the real task and renewal services over in-memory
 * repositories. The other services are small in-memory stand-ins that record
 * their calls: those handlers check, create once and pass the input on.
 */
function setup() {
  const taskRepo = new FakeTaskRepository();
  const habitRepo = new FakeHabitRepository();
  const calls: unknown[][] = [];
  let seq = 0;
  /** An in-memory store for one kind: get by id, and a recorded create that takes a chosen id. */
  function store(kind: string, seed: string[] = []) {
    const items = new Map<string, Record<string, unknown>>(seed.map((id) => [id, { id }]));
    return {
      items,
      get: async (id: string) => items.get(id) ?? null,
      add: (args: unknown[], fields: Record<string, unknown>) => {
        calls.push([`${kind}.create`, ...args]);
        const id = (fields.id as string | undefined) ?? `${kind}_${++seq}`;
        if (items.has(id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const item = { ...fields, id };
        items.set(id, item);
        return item;
      },
    };
  }
  const goals = store("goals", ["g1"]);
  const projects = store("projects", ["p1"]);
  const roles = store("roles", ["r1"]);
  const persons = store("people", ["person1", "person2"]);
  const logs = store("occurrences");
  const eba = store("eba");
  let mission: string | null = null;
  const services = {
    tasks: new TaskService(taskRepo),
    renewal: new RenewalService(habitRepo),
    goals: { get: goals.get, create: async (input: Record<string, unknown>) => goals.add([input], input) },
    projects: { get: projects.get, create: async (input: Record<string, unknown>) => projects.add([input], input) },
    roles: { get: roles.get },
    mission: {
      getActive: async () => (mission === null ? null : { content: mission }),
      set: async (content: string) => {
        calls.push(["mission.set", content]);
        mission = content;
        return { content };
      },
    },
    people: {
      getPerson: persons.get,
      // "c1" is with person1 only.
      commitmentPeople: async (id: string) => (id === "c1" ? ["person1"] : null),
      getOccurrence: logs.get,
      logOccurrence: async (commitmentId: string, opts: Record<string, unknown>) => logs.add([commitmentId, opts], opts),
      getEbaEntry: eba.get,
      addEbaEntry: async (personId: string, kind: string, note: string | null, id?: string) =>
        eba.add([personId, kind, note, id], { id, personId, kind, note }),
    },
  } as unknown as OperationServices;
  return { services, taskRepo, calls, goals };
}

const now = new Date("2026-11-23T10:00:00Z");
const ctx = { timeZone: "Europe/Brussels", now };
const run = (s: OperationServices, name: string, input: unknown, context: OperationContext = ctx) => runOperation(name, input, s, context);

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof OperationError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("runOperation", () => {
  it("refuses an unknown operation (404) and invalid input (400), naming the field", async () => {
    const { services } = setup();
    expect(await refusal(run(services, "dropTables", {}))).toEqual({ status: 404, message: 'There is no operation "dropTables".' });
    expect(await refusal(run(services, "setTaskDone", { taskId: "t1" }))).toMatchObject({ status: 400, message: expect.stringContaining("done") });
    expect(await refusal(run(services, "setTaskDone", { taskId: "t1", done: true, extra: 1 }))).toMatchObject({ status: 400 });
    expect(await refusal(run(services, "scheduleTask", { taskId: "t1", day: "2026-02-31" }))).toMatchObject({
      status: 400,
      message: "day: a real calendar date",
    });
  });
});

describe("the assistant's actions: target states, safe to repeat", () => {
  it("setTaskDone completes once, reopens, and refuses a task that is gone or archived", async () => {
    const { services, taskRepo } = setup();
    const t = await services.tasks.create({ title: "Plan the garden" });
    expect(await run(services, "setTaskDone", { taskId: t.id, done: true })).toEqual({ changed: 1 });
    expect(await run(services, "setTaskDone", { taskId: t.id, done: true })).toEqual({ changed: 0 });
    expect((await services.tasks.get(t.id))?.status).toBe("DONE");
    expect(await run(services, "setTaskDone", { taskId: t.id, done: false })).toEqual({ changed: 1 });
    expect(await refusal(run(services, "setTaskDone", { taskId: "gone", done: true }))).toEqual({
      status: 422,
      message: "That task no longer exists.",
    });
    const archived = await services.tasks.create({ title: "Old" });
    await taskRepo.update(archived.id, { status: "ARCHIVED" });
    expect(await refusal(run(services, "setTaskDone", { taskId: archived.id, done: true }))).toMatchObject({ status: 422 });
  });

  it("scheduleTask stores the day as a plain date in any zone (#136), and repeating changes nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Call the plumber" });
    const ny = { timeZone: "America/New_York", now };
    expect(await run(services, "scheduleTask", { taskId: t.id, day: "2026-11-24", time: "07:30" }, ny)).toEqual({ changed: 1 });
    const stored = await services.tasks.get(t.id);
    expect(stored?.scheduledDay?.toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(stored?.scheduledTime).toBe("07:30");
    expect(await run(services, "scheduleTask", { taskId: t.id, day: "2026-11-24", time: "07:30" }, ny)).toEqual({ changed: 0 });
    // Leaving the time out means no particular time.
    expect(await run(services, "scheduleTask", { taskId: t.id, day: "2026-11-24" }, ny)).toEqual({ changed: 1 });
    expect((await services.tasks.get(t.id))?.scheduledTime).toBeNull();
    expect(await run(services, "scheduleTask", { taskId: t.id, day: null }, ny)).toEqual({ changed: 1 });
    expect((await services.tasks.get(t.id))?.scheduledDay).toBeNull();
    expect(await refusal(run(services, "scheduleTask", { taskId: t.id, day: null, time: "07:30" }))).toMatchObject({
      status: 400,
      message: "time: a time needs a day",
    });
  });

  it("setBigRock pins only a Quadrant II task, and unpins one of any quadrant", async () => {
    const { services } = setup();
    const q2 = await services.tasks.create({ title: "Plan the garden", important: true });
    const q3 = await services.tasks.create({ title: "Reply to email", urgent: true });
    expect(await run(services, "setBigRock", { taskId: q2.id, bigRock: true })).toEqual({ changed: 1 });
    expect(await run(services, "setBigRock", { taskId: q2.id, bigRock: true })).toEqual({ changed: 0 });
    expect(await refusal(run(services, "setBigRock", { taskId: q3.id, bigRock: true }))).toEqual({
      status: 422,
      message: "“Reply to email” is not in Quadrant II (important, not urgent), so it cannot be a big rock.",
    });
    expect((await services.tasks.get(q3.id))?.isBigRock).toBe(false);
    expect(await run(services, "setBigRock", { taskId: q3.id, bigRock: false })).toEqual({ changed: 0 });
  });

  it("setHabitDone sets the check-off without reading it first: twice is one mark", async () => {
    const { services } = setup();
    const h = await services.renewal.createHabit({ name: "Morning run" });
    expect(await run(services, "setHabitDone", { habitId: h.id, done: true })).toEqual({ changed: 1 });
    expect(await run(services, "setHabitDone", { habitId: h.id, done: true })).toEqual({ changed: 0 });
    expect((await services.renewal.listHabits(ctx))[0]?.markedToday).toBe(true);
    expect(await run(services, "setHabitDone", { habitId: h.id, done: false })).toEqual({ changed: 1 });
    expect(await run(services, "setHabitDone", { habitId: h.id, done: false })).toEqual({ changed: 0 });
    expect((await services.renewal.listHabits(ctx))[0]?.markedToday).toBe(false);
    expect(await refusal(run(services, "setHabitDone", { habitId: "gone", done: true }))).toEqual({
      status: 422,
      message: "That habit no longer exists.",
    });
  });

  it("setHabitDone marks an earlier day, and refuses a day still to come before writing", async () => {
    const { services } = setup();
    const h = await services.renewal.createHabit({ name: "Morning run" });
    expect(await run(services, "setHabitDone", { habitId: h.id, done: true, day: "2026-11-21" })).toEqual({ changed: 1 });
    expect(await run(services, "setHabitDone", { habitId: h.id, done: true, day: "2026-11-21" })).toEqual({ changed: 0 });
    expect((await services.renewal.listHabits(ctx))[0]?.markedToday).toBe(false);
    expect(await refusal(run(services, "setHabitDone", { habitId: h.id, done: true, day: "2026-11-25" }))).toEqual({
      status: 422,
      message: "That day is still to come; only today or an earlier day can be logged.",
    });
  });

  it("acceptWeekPlan pins the plan and unpins every other open rock in one call; done and archived rocks stay pinned (#120)", async () => {
    const { services, taskRepo } = setup();
    const a = await services.tasks.create({ title: "Plan the garden", important: true });
    const b = await services.tasks.create({ title: "Fix the fence", important: true });
    const open = await services.tasks.create({ title: "Open rock", important: true });
    const old = await services.tasks.create({ title: "Old rock", important: true });
    const archived = await services.tasks.create({ title: "Archived rock", important: true });
    await services.tasks.setBigRock(b.id, true);
    await services.tasks.setBigRock(open.id, true);
    await services.tasks.setBigRock(old.id, true);
    await taskRepo.update(old.id, { status: "DONE" });
    await services.tasks.setBigRock(archived.id, true);
    await taskRepo.update(archived.id, { status: "ARCHIVED" });

    const input = { weekStart: "2026-11-23", taskIds: [a.id, b.id] };
    expect(await run(services, "acceptWeekPlan", input)).toEqual({ changed: 2 });
    expect((await services.tasks.get(a.id))?.plannedWeek?.toISOString()).toBe("2026-11-23T00:00:00.000Z"); // a plain Monday (#112)
    // Pinned "Plan the garden", unpinned "Open rock"; the done "Old rock" stays in the jar.
    expect((await services.tasks.bigRocks()).map((t) => t.title).sort()).toEqual(["Fix the fence", "Old rock", "Plan the garden"]);
    expect((await services.tasks.get(open.id))?.isBigRock).toBe(false);
    expect((await services.tasks.get(archived.id))?.isBigRock).toBe(true);
    expect(await run(services, "acceptWeekPlan", input)).toEqual({ changed: 0 });
  });

  it("acceptWeekPlan refuses the whole plan, writing nothing, when one task cannot be a rock", async () => {
    const { services } = setup();
    const a = await services.tasks.create({ title: "Plan the garden", important: true });
    const urgent = await services.tasks.create({ title: "Urgent one", important: true, urgent: true });
    const pinned = await services.tasks.create({ title: "Pinned", important: true });
    await services.tasks.setBigRock(pinned.id, true);
    expect(await refusal(run(services, "acceptWeekPlan", { weekStart: "2026-11-23", taskIds: [a.id, urgent.id] }))).toMatchObject({
      status: 422,
      message: expect.stringMatching(/not in Quadrant II/),
    });
    expect(await refusal(run(services, "acceptWeekPlan", { weekStart: "2026-11-23", taskIds: [a.id, "gone"] }))).toEqual({
      status: 422,
      message: "That task no longer exists.",
    });
    expect((await services.tasks.bigRocks()).map((t) => t.id)).toEqual([pinned.id]);
  });

  it("setIntention replaces this week's intention, clears it with null, and the same state changes nothing", async () => {
    const { services } = setup();
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: "  Three runs " })).toEqual({ changed: 1 });
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: "Three runs" })).toEqual({ changed: 0 });
    expect(await services.renewal.intentions(ctx)).toEqual([{ dimension: "PHYSICAL", text: "Three runs" }]);
    expect(await refusal(run(services, "setIntention", { dimension: "PHYSICAL", text: "  " }))).toMatchObject({ status: 400 });
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: null })).toEqual({ changed: 1 });
    expect(await services.renewal.intentions(ctx)).toEqual([]);
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: null })).toEqual({ changed: 0 });
  });
});

describe("the further actions (#109 steps 3 and 4)", () => {
  it("deleteTask deletes once; a task already gone changes nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "File taxes" });
    expect(await run(services, "deleteTask", { taskId: t.id })).toEqual({ changed: 1 });
    expect(await services.tasks.get(t.id)).toBeNull();
    expect(await run(services, "deleteTask", { taskId: t.id })).toEqual({ changed: 0 });
  });

  it("setMission writes a new version only when the text differs", async () => {
    const { services, calls } = setup();
    expect(await run(services, "setMission", { text: " Live by what matters. " })).toEqual({ changed: 1 });
    expect(await run(services, "setMission", { text: "Live by what matters." })).toEqual({ changed: 0 });
    expect(calls).toEqual([["mission.set", "Live by what matters."]]);
    expect(await refusal(run(services, "setMission", { text: "   " }))).toMatchObject({ status: 400 });
  });

  it("createGoal and createProject: plain dates, links checked, once per key", async () => {
    const { services, calls } = setup();
    const keyed = { ...ctx, idempotencyKey: "goal-key-1" };
    const goal = await run(services, "createGoal", { title: "Run a marathon", targetDate: "2027-05-01", roleId: "r1" }, keyed);
    expect(goal).toEqual({ changed: 1, id: idFromKey("goal-key-1") });
    expect(await run(services, "createGoal", { title: "Run a marathon" }, keyed)).toEqual({ changed: 0, id: idFromKey("goal-key-1") });
    expect(calls).toEqual([
      ["goals.create", { id: idFromKey("goal-key-1"), title: "Run a marathon", description: undefined, targetDate: new Date("2027-05-01T00:00:00.000Z"), roleId: "r1" }],
    ]);
    expect(await refusal(run(services, "createGoal", { title: "x", roleId: "r9" }))).toEqual({ status: 422, message: "That role no longer exists." });
    expect(await refusal(run(services, "createGoal", { title: "x", targetDate: "2027-02-30" }))).toMatchObject({ status: 400 });
    expect(await run(services, "createProject", { name: "Launch the newsletter", goalId: "g1" })).toMatchObject({ changed: 1 });
    expect(await refusal(run(services, "createProject", { name: "x", goalId: "g9" }))).toEqual({ status: 422, message: "That goal no longer exists." });
  });

  it("logCommitmentOccurrence and addEbaEntry check the commitment and the person, and log once per key", async () => {
    const { services, calls } = setup();
    const keyed = { ...ctx, idempotencyKey: "log-key-1" };
    expect(await run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "person1", note: "Zoo" }, keyed)).toEqual({
      changed: 1,
      id: idFromKey("log-key-1"),
    });
    expect(await run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "person1", note: "Zoo" }, keyed)).toMatchObject({ changed: 0 });
    expect(await refusal(run(services, "logCommitmentOccurrence", { commitmentId: "c9" }))).toEqual({
      status: 422,
      message: "That commitment no longer exists.",
    });
    expect(await refusal(run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "nobody" }))).toEqual({
      status: 422,
      message: "That person no longer exists.",
    });
    expect(await run(services, "addEbaEntry", { personId: "person1", kind: "DEPOSIT", note: "Helped with homework" })).toMatchObject({ changed: 1 });
    expect(await refusal(run(services, "addEbaEntry", { personId: "nobody", kind: "DEPOSIT" }))).toEqual({
      status: 422,
      message: "That person no longer exists.",
    });
    expect(calls.map((c) => c[0])).toEqual(["occurrences.create", "eba.create"]);
  });

  it("logRenewalActivity logs once per key", async () => {
    const { services } = setup();
    const keyed = { ...ctx, idempotencyKey: "hike-key-1" };
    expect(await run(services, "logRenewalActivity", { dimension: "PHYSICAL", title: "Long hike" }, keyed)).toEqual({
      changed: 1,
      id: idFromKey("hike-key-1"),
    });
    expect(await run(services, "logRenewalActivity", { dimension: "PHYSICAL", title: "Long hike" }, keyed)).toMatchObject({ changed: 0 });
    expect((await services.renewal.recentActivities(new Date())).map((a) => a.title)).toEqual(["Long hike"]);
  });
});

describe("createTask: creating once (#109 section 6)", () => {
  const input = { title: "Buitenkraan afsluiten", important: true, dueDate: "2027-11-01", projectId: "p1", goalId: "g1" };

  it("creates the task with every field, days as the form and the Clock store them", async () => {
    const { services } = setup();
    const result = (await run(services, "createTask", { ...input, proactivity: "INFLUENCE", scheduledDay: "2026-11-24", scheduledTime: "07:30" })) as {
      changed: number;
      id: string;
    };
    expect(result.changed).toBe(1);
    const task = await services.tasks.get(result.id);
    expect(task).toMatchObject({
      title: "Buitenkraan afsluiten",
      important: true,
      urgent: false,
      proactivity: "INFLUENCE",
      projectId: "p1",
      goalId: "g1",
      scheduledTime: "07:30",
    });
    // A due date is a plain date (UTC midnight, as the task form stores it); a scheduled day is midnight in the caller's zone.
    expect(task?.dueDate?.toISOString()).toBe("2027-11-01T00:00:00.000Z");
    expect(task?.scheduledDay?.toISOString()).toBe("2026-11-24T00:00:00.000Z");
  });

  it("makes one task for one idempotency key, however often it is sent (a double press, a retry after a lost answer)", async () => {
    const { services } = setup();
    const keyed = { ...ctx, idempotencyKey: "proposal-1" };
    const first = (await run(services, "createTask", input, keyed)) as { changed: number; id: string };
    expect(first).toEqual({ changed: 1, id: idFromKey("proposal-1") });
    expect(await run(services, "createTask", input, keyed)).toEqual({ changed: 0, id: first.id });
    // Both at once: the second finds the first's task instead of failing.
    const [a, b] = await Promise.all([
      run(services, "createTask", { title: "Call mum" }, { ...ctx, idempotencyKey: "proposal-2" }),
      run(services, "createTask", { title: "Call mum" }, { ...ctx, idempotencyKey: "proposal-2" }),
    ]);
    expect([a, b].map((r) => (r as { changed: number }).changed).sort()).toEqual([0, 1]);
    expect((await services.tasks.list()).map((t) => t.title).sort()).toEqual(["Buitenkraan afsluiten", "Call mum"]);
    // Without a key (an MCP-style call), every call creates.
    await run(services, "createTask", { title: "Call mum" });
    expect((await services.tasks.list()).length).toBe(3);
  });

  it("refuses an empty title, an impossible date, a time without a day, and a missing project or goal", async () => {
    const { services } = setup();
    expect(await refusal(run(services, "createTask", { title: "  " }))).toMatchObject({ status: 400, message: "title: a task needs a title" });
    expect(await refusal(run(services, "createTask", { title: "Tax", dueDate: "2027-02-30" }))).toMatchObject({ status: 400 });
    expect(await refusal(run(services, "createTask", { title: "Tax", scheduledTime: "07:30" }))).toMatchObject({
      status: 400,
      message: "scheduledTime: a time needs a day",
    });
    expect(await refusal(run(services, "createTask", { title: "Tax", projectId: "p9" }))).toEqual({
      status: 422,
      message: "That project no longer exists.",
    });
    expect(await refusal(run(services, "createTask", { title: "Tax", goalId: "g9" }))).toEqual({ status: 422, message: "That goal no longer exists." });
    expect(await services.tasks.list()).toEqual([]);
  });
});

describe("updateTask: the fields named, as a target state", () => {
  it("changes only what differs, and repeating it changes nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Buitenkraan afsluiten", important: true, dueDate: new Date("2027-11-01T00:00:00.000Z") });
    const edit = { taskId: t.id, urgent: true, dueDate: "2027-11-08", projectId: "p1", proactivity: "CONCERN", scheduledDay: "2026-11-24", scheduledTime: "09:00" };
    expect(await run(services, "updateTask", edit)).toEqual({ changed: 1 });
    expect(await services.tasks.get(t.id)).toMatchObject({
      title: "Buitenkraan afsluiten",
      important: true,
      urgent: true,
      projectId: "p1",
      proactivity: "CONCERN",
      scheduledTime: "09:00",
    });
    expect((await services.tasks.get(t.id))?.dueDate?.toISOString()).toBe("2027-11-08T00:00:00.000Z");
    expect(await run(services, "updateTask", edit)).toEqual({ changed: 0 });
    // Off the Clock clears the time too; null clears a link and the due date.
    expect(await run(services, "updateTask", { taskId: t.id, scheduledDay: null, projectId: null, dueDate: null, title: " Kraan " })).toEqual({ changed: 1 });
    expect(await services.tasks.get(t.id)).toMatchObject({ title: "Kraan", scheduledDay: null, scheduledTime: null, projectId: null, dueDate: null });
  });

  it("refuses a task, project or goal that is gone, and an edit of nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Kraan" });
    expect(await refusal(run(services, "updateTask", { taskId: "gone", urgent: true }))).toEqual({ status: 422, message: "That task no longer exists." });
    expect(await refusal(run(services, "updateTask", { taskId: t.id, goalId: "g9" }))).toEqual({ status: 422, message: "That goal no longer exists." });
    expect(await refusal(run(services, "updateTask", { taskId: t.id }))).toMatchObject({ status: 400 });
  });
});

describe("completing a recurring task through the operations (#105)", () => {
  it("setTaskDone, from the assistant or MCP alike, makes one next occurrence however often it is sent", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Bins", dueDate: new Date("2026-11-23T00:00:00.000Z"), recurrence: { unit: "WEEK" } });
    expect(await run(services, "setTaskDone", { taskId: t.id, done: true })).toEqual({ changed: 1 });
    const done = await services.tasks.get(t.id);
    expect(await run(services, "setTaskDone", { taskId: t.id, done: true })).toEqual({ changed: 0 });
    const open = await services.tasks.list({ status: "TODO" });
    expect(open.map((x) => x.previousId)).toEqual([t.id]);
    // A target state: the completion time is not stamped again.
    expect((await services.tasks.get(t.id))?.completedAt).toEqual(done?.completedAt);
  });
});

describe("repeat on createTask and updateTask (#105 step 3)", () => {
  it("creates a repeating task: the rule, the slot and 'show from' as the app's form makes them", async () => {
    const { services } = setup();
    const result = (await run(services, "createTask", { title: "Buitenkraan afsluiten", important: true, dueDate: "2027-11-01", repeat: { unit: "YEAR", leadDays: 21 } })) as { id: string };
    const task = await services.tasks.get(result.id, { now });
    expect(task?.recurrence).toEqual({ unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true });
    expect(task?.showFrom?.toISOString()).toBe("2027-10-11T00:00:00.000Z");
    expect(task?.later).toBe(true);
  });

  it("sets, changes and stops a rule on an edit; the same rule again changes nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Bins", dueDate: new Date("2026-11-26T00:00:00.000Z") });
    expect(await run(services, "updateTask", { taskId: t.id, repeat: { unit: "WEEK" } })).toEqual({ changed: 1 });
    expect((await services.tasks.get(t.id))?.recurrence).toMatchObject({ unit: "WEEK", every: 1, active: true });
    expect(await run(services, "updateTask", { taskId: t.id, repeat: { unit: "WEEK", every: 1, from: "SCHEDULE" } })).toEqual({ changed: 0 });
    expect(await run(services, "updateTask", { taskId: t.id, repeat: { unit: "WEEK", every: 2 } })).toEqual({ changed: 1 });
    expect((await services.tasks.get(t.id))?.recurrence).toMatchObject({ every: 2 });
    expect(await run(services, "updateTask", { taskId: t.id, repeat: null })).toEqual({ changed: 1 });
    expect((await services.tasks.get(t.id))?.recurrence).toMatchObject({ active: false });
    expect(await run(services, "updateTask", { taskId: t.id, repeat: null })).toEqual({ changed: 0 });
  });

  it("refuses a rule for a task with no date, in the service's words (422); the schema refuses a create without one (400)", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Someday" });
    expect(await refusal(run(services, "updateTask", { taskId: t.id, repeat: { unit: "WEEK" } }))).toEqual({
      status: 422,
      message: "A repeating task needs a due date or a scheduled day.",
    });
    expect(await refusal(run(services, "createTask", { title: "Someday", repeat: { unit: "WEEK" } }))).toMatchObject({
      status: 400,
      message: "repeat: a repeating task needs a due date or a scheduled day",
    });
  });

  it("a repeating task created once per key, then completed twice: one next occurrence", async () => {
    const { services } = setup();
    const keyed = { ...ctx, idempotencyKey: "repeat-key-01" };
    const input = { title: "Bins", dueDate: "2026-11-23", repeat: { unit: "WEEK" } };
    const { id } = (await run(services, "createTask", input, keyed)) as { id: string };
    expect(await run(services, "createTask", input, keyed)).toEqual({ changed: 0, id });
    await run(services, "setTaskDone", { taskId: id, done: true });
    await run(services, "setTaskDone", { taskId: id, done: true });
    expect((await services.tasks.list({ status: "TODO" })).map((t) => t.previousId)).toEqual([id]);
  });
});

describe("the five further actions for the assistant (#109 step 4)", () => {
  it("logs a commitment for today now, for an earlier day at its midday in the caller's zone, never for a day to come", async () => {
    const { services, calls } = setup();
    await run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "person1" });
    await run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "person1", day: "2026-11-23" });
    await run(services, "logCommitmentOccurrence", { commitmentId: "c1", day: "2026-11-21" });
    expect(calls.map((c) => (c[2] as { occurredAt?: Date }).occurredAt?.toISOString())).toEqual([
      undefined,
      undefined,
      "2026-11-21T11:00:00.000Z",
    ]);
    // Today (23 Nov in Brussels) is "now"; tomorrow is refused.
    expect(await refusal(run(services, "logCommitmentOccurrence", { commitmentId: "c1", day: "2026-11-24" }))).toEqual({
      status: 422,
      message: "That day is still to come; only today or an earlier day can be logged.",
    });
  });

  it("refuses a person who is not linked to the commitment, in the app's words", async () => {
    const { services, calls } = setup();
    // person2 exists, but the commitment is with person1 only.
    expect(await refusal(run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "person2" }))).toEqual({
      status: 422,
      message: "That person is not part of that commitment.",
    });
    expect(await refusal(run(services, "logCommitmentOccurrence", { commitmentId: "c1", personId: "nobody" }))).toEqual({
      status: 422,
      message: "That person no longer exists.",
    });
    expect(calls).toEqual([]);
  });

  it("logs a renewal activity on an earlier day, and refuses a day to come", async () => {
    const { services } = setup();
    const { id } = (await run(services, "logRenewalActivity", { dimension: "PHYSICAL", title: "Long hike", day: "2026-11-22" })) as { id: string };
    expect((await services.renewal.getActivity(id))?.occurredAt.toISOString()).toBe("2026-11-22T11:00:00.000Z");
    expect(await refusal(run(services, "logRenewalActivity", { dimension: "PHYSICAL", title: "x", day: "2027-01-01" }))).toMatchObject({ status: 422 });
  });
});
