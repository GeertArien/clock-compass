import { describe, expect, it } from "vitest";
import { FakeTaskRepository } from "../services/fake-task-repository.js";
import { FakeHabitRepository } from "../services/fake-habit-repository.js";
import { TaskService } from "../services/task-service.js";
import { RenewalService } from "../services/renewal-service.js";
import { zonedMidnight } from "../domain/zoned.js";
import { OperationError, idFromKey, runOperation, type OperationContext, type OperationServices } from "./handlers.js";

/**
 * The handlers through the real task and renewal services over in-memory
 * repositories. The other services are stubs recording their calls: those
 * handlers only pass the input on, as the MCP adapter did before (#109).
 */
function setup() {
  const taskRepo = new FakeTaskRepository();
  const habitRepo = new FakeHabitRepository();
  const calls: unknown[][] = [];
  const record =
    (name: string, result: unknown = {}) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const services = {
    tasks: new TaskService(taskRepo),
    renewal: new RenewalService(habitRepo),
    goals: { create: record("goals.create"), get: async (id: string) => (id === "g1" ? { id } : null) },
    projects: { create: record("projects.create"), get: async (id: string) => (id === "p1" ? { id } : null) },
    mission: { set: record("mission.set") },
    people: {
      logOccurrence: record("people.logOccurrence", undefined),
      addEbaEntry: record("people.addEbaEntry", { id: "e1", personId: "p1", kind: "DEPOSIT", note: "private" }),
    },
  } as unknown as OperationServices;
  return { services, taskRepo, calls };
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

  it("scheduleTask stores the day as midnight in the caller's time zone, and repeating changes nothing", async () => {
    const { services } = setup();
    const t = await services.tasks.create({ title: "Call the plumber" });
    const ny = { timeZone: "America/New_York", now };
    expect(await run(services, "scheduleTask", { taskId: t.id, day: "2026-11-24", time: "07:30" }, ny)).toEqual({ changed: 1 });
    const stored = await services.tasks.get(t.id);
    expect(stored?.scheduledDay?.toISOString()).toBe("2026-11-24T05:00:00.000Z");
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

  it("setHabitDoneToday sets the check-off without reading it first: twice is one mark", async () => {
    const { services } = setup();
    const h = await services.renewal.createHabit({ name: "Morning run" });
    expect(await run(services, "setHabitDoneToday", { habitId: h.id, done: true })).toEqual({ changed: 1 });
    expect(await run(services, "setHabitDoneToday", { habitId: h.id, done: true })).toEqual({ changed: 0 });
    expect((await services.renewal.listHabits(now))[0]?.markedToday).toBe(true);
    expect(await run(services, "setHabitDoneToday", { habitId: h.id, done: false })).toEqual({ changed: 1 });
    expect(await run(services, "setHabitDoneToday", { habitId: h.id, done: false })).toEqual({ changed: 0 });
    expect((await services.renewal.listHabits(now))[0]?.markedToday).toBe(false);
    expect(await refusal(run(services, "setHabitDoneToday", { habitId: "gone", done: true }))).toEqual({
      status: 422,
      message: "That habit no longer exists.",
    });
  });

  it("acceptWeekPlan pins the plan and unpins every other rock in one call, leaving archived ones alone", async () => {
    const { services, taskRepo } = setup();
    const a = await services.tasks.create({ title: "Plan the garden", important: true });
    const b = await services.tasks.create({ title: "Fix the fence", important: true });
    const old = await services.tasks.create({ title: "Old rock", important: true });
    const archived = await services.tasks.create({ title: "Archived rock", important: true });
    await services.tasks.setBigRock(b.id, true);
    await services.tasks.setBigRock(old.id, true);
    await taskRepo.update(old.id, { status: "DONE" });
    await services.tasks.setBigRock(archived.id, true);
    await taskRepo.update(archived.id, { status: "ARCHIVED" });

    const input = { weekStart: "2026-11-23", taskIds: [a.id, b.id] };
    expect(await run(services, "acceptWeekPlan", input)).toEqual({ changed: 2 });
    expect((await services.tasks.get(a.id))?.plannedWeek?.toISOString()).toBe(zonedMidnight("2026-11-23", "Europe/Brussels").toISOString());
    expect((await services.tasks.bigRocks()).map((t) => t.title).sort()).toEqual(["Fix the fence", "Plan the garden"]);
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

  it("setIntention replaces this week's intention, and the same text changes nothing", async () => {
    const { services } = setup();
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: "  Three runs " })).toEqual({ changed: 1 });
    expect(await run(services, "setIntention", { dimension: "PHYSICAL", text: "Three runs" })).toEqual({ changed: 0 });
    expect(await services.renewal.intentions(now)).toEqual([{ dimension: "PHYSICAL", text: "Three runs" }]);
    expect(await refusal(run(services, "setIntention", { dimension: "PHYSICAL", text: "  " }))).toMatchObject({ status: 400 });
  });
});

describe("the MCP adapter's write tools", () => {
  it("create_task and update_task pass dates on as Dates, as before", async () => {
    const { services } = setup();
    const created = (await run(services, "create_task", { title: "File taxes", important: true, dueDate: "2027-04-01T00:00:00.000Z" })) as {
      id: string;
      dueDate: Date;
    };
    expect(created.dueDate).toEqual(new Date("2027-04-01T00:00:00.000Z"));
    const updated = (await run(services, "update_task", { id: created.id, isBigRock: true, dueDate: null })) as {
      isBigRock: boolean;
      dueDate: Date | null;
    };
    expect(updated).toMatchObject({ isBigRock: true, dueDate: null });
    expect(await run(services, "delete_task", { id: created.id })).toEqual({ deleted: created.id });
  });

  it("add_eba_entry returns the entry as stored, note included (owner decision on #109, section 9)", async () => {
    const { services, calls } = setup();
    expect(await run(services, "add_eba_entry", { personId: "p1", kind: "DEPOSIT", note: "private" })).toEqual({
      id: "e1",
      personId: "p1",
      kind: "DEPOSIT",
      note: "private",
    });
    expect(calls).toEqual([["people.addEbaEntry", "p1", "DEPOSIT", "private"]]);
  });

  it("the other tools hand their input to the service", async () => {
    const { services, calls } = setup();
    expect(await run(services, "log_commitment_occurrence", { commitmentId: "c1", personId: "p1" })).toEqual({ logged: "c1" });
    await run(services, "create_goal", { title: "Run a marathon", targetDate: "2027-05-01T00:00:00.000Z" });
    await run(services, "create_project", { name: "Launch the newsletter" });
    await run(services, "set_mission", { content: "Live by what matters." });
    expect(calls).toEqual([
      ["people.logOccurrence", "c1", { personId: "p1" }],
      ["goals.create", { title: "Run a marathon", targetDate: new Date("2027-05-01T00:00:00.000Z") }],
      ["projects.create", { name: "Launch the newsletter" }],
      ["mission.set", "Live by what matters."],
    ]);
    expect(await refusal(run(services, "set_mission", { content: "   " }))).toMatchObject({ status: 422 });
    expect(await run(services, "set_weekly_intention", { dimension: "MENTAL", text: "" })).toEqual({ dimension: "MENTAL", text: "" });
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
    expect(task?.scheduledDay?.toISOString()).toBe("2026-11-23T23:00:00.000Z");
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
