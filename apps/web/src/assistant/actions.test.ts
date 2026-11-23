import { describe, expect, it } from "vitest";
import { parseAction } from "@clock-compass/assistant-catalog";
import type { HabitView, RenewalDimension, Task } from "@clock-compass/web-client/api";
import { checkAction, executeAction, localMidnightIso, type ActionPorts, type TaskChange, type WriteAction } from "./actions";

const at = "2026-11-18T09:00:00.000Z";
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  notes: null,
  important: true,
  urgent: false,
  quadrant: "Q2",
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
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const habit = (id: string, markedToday: boolean): HabitView => ({
  id,
  name: "Morning run",
  dimension: "PHYSICAL",
  goalId: null,
  goalTitle: null,
  targetPerWeek: 3,
  weekDays: [false, false, false, false, false, false, false],
  doneThisWeek: 0,
  markedToday,
  streak: 0,
});

/** Fake ports over in-memory data, recording every write. */
function ports(
  tasks: Task[],
  options: { habits?: HabitView[]; intentions?: Partial<Record<RenewalDimension, string>>; failOn?: number } = {},
) {
  const writes: string[] = [];
  const write = async (what: string) => {
    if (options.failOn !== undefined && writes.length === options.failOn) throw new Error("Internal Server Error");
    writes.push(what);
  };
  const p: ActionPorts = {
    tasks: async () => tasks,
    habits: async () => options.habits ?? [],
    intentions: async () => options.intentions ?? {},
    setTaskDone: (t, done) => write(`done ${t.id} ${done}`),
    updateTask: (t, change: TaskChange) => write(`update ${t.id} ${JSON.stringify(change)}`),
    toggleHabitToday: (h) => write(`toggle ${h.id}`),
    setIntention: (d, text) => write(`intention ${d} ${text}`),
  };
  return { ports: p, writes };
}

function action(name: string, context: Record<string, unknown>): WriteAction {
  const parsed = parseAction({ name, surfaceId: "s-1", context });
  if (parsed.kind !== "write") throw new Error(JSON.stringify(parsed));
  return parsed;
}

describe("executeAction", () => {
  it("marks a task done, and leaves one already done alone (safe to repeat)", async () => {
    const open = ports([task("t1", "Plan the garden")]);
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), open.ports)).toEqual({ ok: true, changed: 1 });
    expect(open.writes).toEqual(["done t1 true"]);

    const done = ports([task("t1", "Plan the garden", { status: "DONE" })]);
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), done.ports)).toEqual({ ok: true, changed: 0 });
    expect(done.writes).toEqual([]);
  });

  it("schedules a day as the browser's local midnight, with or without a time, and unschedules", async () => {
    const { ports: p, writes } = ports([task("t1", "Plan the garden")]);
    await executeAction(action("scheduleTask", { taskId: "t1", day: "2026-11-23", time: "07:30" }), p);
    await executeAction(action("scheduleTask", { taskId: "t1", day: "2026-11-24" }), p);
    expect(writes).toEqual([
      `update t1 ${JSON.stringify({ scheduledDay: localMidnightIso("2026-11-23"), scheduledTime: "07:30" })}`,
      `update t1 ${JSON.stringify({ scheduledDay: localMidnightIso("2026-11-24"), scheduledTime: null })}`,
    ]);
    expect(new Date(localMidnightIso("2026-11-23")).getHours()).toBe(0);

    const scheduled = ports([task("t1", "x", { scheduledDay: localMidnightIso("2026-11-23"), scheduledTime: "07:30" })]);
    expect(await executeAction(action("scheduleTask", { taskId: "t1", day: "2026-11-23", time: "07:30" }), scheduled.ports)).toEqual({ ok: true, changed: 0 });
    await executeAction(action("scheduleTask", { taskId: "t1", day: null }), scheduled.ports);
    expect(scheduled.writes).toEqual([`update t1 ${JSON.stringify({ scheduledDay: null, scheduledTime: null })}`]);
  });

  it("pins only a Quadrant II task as a big rock", async () => {
    const { ports: p, writes } = ports([task("t1", "Plan the garden"), task("t2", "Reply to email", { important: false, urgent: true })]);
    expect(await executeAction(action("setBigRock", { taskId: "t1", bigRock: true }), p)).toEqual({ ok: true, changed: 1 });
    expect(writes[0]).toMatch(/^update t1 \{"isBigRock":true,"plannedWeek":"/);
    expect(await executeAction(action("setBigRock", { taskId: "t2", bigRock: true }), p)).toEqual({
      ok: false,
      error: "“Reply to email” is not in Quadrant II (important, not urgent), so it cannot be a big rock.",
    });
    expect(writes).toHaveLength(1);
  });

  it("checks a habit off only when it is not checked yet", async () => {
    const unchecked = ports([], { habits: [habit("h1", false)] });
    await executeAction(action("setHabitDoneToday", { habitId: "h1", done: true }), unchecked.ports);
    expect(unchecked.writes).toEqual(["toggle h1"]);
    const checked = ports([], { habits: [habit("h1", true)] });
    await executeAction(action("setHabitDoneToday", { habitId: "h1", done: true }), checked.ports);
    expect(checked.writes).toEqual([]);
  });

  it("accepts a week plan: pins the plan, unpins every other rock, and leaves the plan's pinned ones alone", async () => {
    const tasks = [
      task("t1", "Plan the garden"),
      task("t2", "Fix the fence", { isBigRock: true }),
      task("t3", "Old rock", { isBigRock: true, status: "DONE" }),
      task("t4", "Archived rock", { isBigRock: true, status: "ARCHIVED" }),
    ];
    const { ports: p, writes } = ports(tasks);
    expect(await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }), p)).toEqual({ ok: true, changed: 2 });
    expect(writes).toEqual([
      `update t1 ${JSON.stringify({ isBigRock: true, plannedWeek: localMidnightIso("2026-11-23") })}`,
      `update t3 ${JSON.stringify({ isBigRock: false, plannedWeek: null })}`,
    ]);
  });

  it("refuses a whole week plan, writing nothing, when one task cannot be a rock", async () => {
    for (const bad of [
      task("t2", "Urgent one", { urgent: true }),
      task("t2", "Done one", { status: "DONE" }),
    ]) {
      const { ports: p, writes } = ports([task("t1", "Plan the garden"), bad, task("t9", "Pinned", { isBigRock: true })]);
      const result = await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }), p);
      expect(result.ok).toBe(false);
      expect(writes).toEqual([]);
    }
    const missing = ports([task("t1", "Plan the garden")]);
    expect(await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "gone"] }), missing.ports)).toEqual({
      ok: false,
      error: "That task no longer exists.",
    });
  });

  it("says a week plan was only partly applied when the server fails part-way, and finishes it when confirmed again", async () => {
    const tasks = [task("t1", "A"), task("t2", "B")];
    const failing = ports(tasks, { failOn: 1 });
    const result = await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }), failing.ports);
    expect(result).toEqual({ ok: false, error: "Only part of this was done (Internal Server Error). Confirm again to finish it." });
    // The first pin landed; confirming again pins only what is left.
    tasks[0] = { ...tasks[0]!, isBigRock: true };
    const again = ports(tasks);
    expect(await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }), again.ports)).toEqual({ ok: true, changed: 1 });
    expect(again.writes).toEqual([`update t2 ${JSON.stringify({ isBigRock: true, plannedWeek: localMidnightIso("2026-11-23") })}`]);
  });

  it("sets this week's intention, and leaves the same text alone", async () => {
    const fresh = ports([], { intentions: { PHYSICAL: "Two runs" } });
    await executeAction(action("setIntention", { dimension: "PHYSICAL", text: "Three runs" }), fresh.ports);
    expect(fresh.writes).toEqual(["intention PHYSICAL Three runs"]);
    const same = ports([], { intentions: { PHYSICAL: "Three runs" } });
    await executeAction(action("setIntention", { dimension: "PHYSICAL", text: "Three runs" }), same.ports);
    expect(same.writes).toEqual([]);
  });

  it("reads each kind of data once per action, and decides from what it read", async () => {
    let reads = 0;
    const { ports: p, writes } = ports([task("t1", "A"), task("t2", "B"), task("t3", "Pinned", { isBigRock: true })]);
    const counted: ActionPorts = { ...p, tasks: async () => (reads++, p.tasks()) };
    await executeAction(action("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }), counted);
    expect(reads).toBe(1);
    expect(writes).toHaveLength(3);
  });

  it("reports a server failure without throwing", async () => {
    const { ports: p } = ports([task("t1", "Plan the garden")], { failOn: 0 });
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), p)).toEqual({
      ok: false,
      error: "This was not done: Internal Server Error.",
    });
  });
});

describe("checkAction: why a proposal cannot be done, before anyone presses it", () => {
  const data = {
    tasks: [task("t1", "Plan the garden"), task("t2", "Reply to email", { important: false, urgent: true }), task("t3", "Gone", { status: "ARCHIVED" })],
    habits: [habit("h1", false)],
  };
  it.each([
    ["setBigRock", { taskId: "t2", bigRock: true }, /not in Quadrant II/],
    ["setTaskDone", { taskId: "t3", done: true }, /no longer exists/],
    ["setHabitDoneToday", { habitId: "h9", done: true }, /habit no longer exists/],
    ["acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t2"] }, /not in Quadrant II/],
  ])("%s %j", (name, context, error) => {
    expect(checkAction(action(name, context), data)).toMatch(error);
  });

  it("passes what the app can do, including unpinning a task of any quadrant", () => {
    expect(checkAction(action("setBigRock", { taskId: "t1", bigRock: true }), data)).toBeNull();
    expect(checkAction(action("setBigRock", { taskId: "t2", bigRock: false }), data)).toBeNull();
    expect(checkAction(action("setIntention", { dimension: "MENTAL", text: "Read daily" }), data)).toBeNull();
  });
});
