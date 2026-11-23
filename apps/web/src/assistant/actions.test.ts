import { describe, expect, it } from "vitest";
import { parseAction, type CheckData, type Touches } from "@clock-compass/assistant-catalog";
import { ApiError, type HabitView, type Task } from "@clock-compass/web-client/api";
import { checkAction, executeAction, type OperationPorts, type WriteAction } from "./actions";

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
const habit = (id: string): HabitView => ({
  id,
  name: "Morning run",
  dimension: "PHYSICAL",
  goalId: null,
  goalTitle: null,
  targetPerWeek: 3,
  weekDays: [false, false, false, false, false, false, false],
  doneThisWeek: 0,
  markedToday: false,
  streak: 0,
});

/**
 * Fake ports recording every call, in order. `answer` is what the server
 * returns (or throws) for a run.
 */
function ports(data: CheckData | undefined, answer: () => unknown = () => ({ changed: 1 })) {
  const calls: string[] = [];
  const p: OperationPorts = {
    data: () => {
      calls.push("data");
      return data;
    },
    run: async (name, input) => {
      calls.push(`run ${name} ${JSON.stringify(input)}`);
      return answer();
    },
    refresh: async (touches: readonly Touches[]) => {
      calls.push(`refresh ${touches.join(",")}`);
    },
  };
  return { ports: p, calls };
}

function action(name: string, context: Record<string, unknown>): WriteAction {
  const parsed = parseAction({ name, surfaceId: "s-1", context });
  if (parsed.kind !== "write") throw new Error(JSON.stringify(parsed));
  return parsed;
}

const data: CheckData = {
  tasks: [
    task("t1", "Plan the garden"),
    task("t2", "Reply to email", { important: false, urgent: true }),
    task("t3", "Gone", { status: "ARCHIVED" }),
    task("t4", "Done one", { status: "DONE" }),
  ],
  habits: [habit("h1")],
};

describe("executeAction: one executor for every operation", () => {
  it.each([
    ["setTaskDone", { taskId: "t1", done: true }, "tasks"],
    ["scheduleTask", { taskId: "t1", day: "2026-11-23", time: "07:30" }, "tasks"],
    ["setBigRock", { taskId: "t1", bigRock: true }, "tasks"],
    ["setHabitDoneToday", { habitId: "h1", done: true }, "habits"],
    ["acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1"] }, "tasks"],
    ["setIntention", { dimension: "PHYSICAL", text: "Three runs" }, "intentions"],
  ])("%s: checks, runs the operation with its arguments, then refreshes what it touches", async (name, context, touches) => {
    const { ports: p, calls } = ports(data);
    const parsed = action(name, context);
    expect(await executeAction(parsed, p)).toEqual({ ok: true, changed: 1 });
    expect(calls).toEqual(["data", `run ${name} ${JSON.stringify(parsed.args)}`, `refresh ${touches}`]);
  });

  it("sends a schedule without a time as no particular time (the schema's default)", async () => {
    const { ports: p, calls } = ports(data);
    await executeAction(action("scheduleTask", { taskId: "t1", day: "2026-11-24" }), p);
    expect(calls[1]).toBe(`run scheduleTask ${JSON.stringify({ taskId: "t1", day: "2026-11-24", time: null })}`);
  });

  it("checks a habit off without reading it first: the server sets a target state", async () => {
    // The only data used is what the app already shows; no read, no toggle.
    const { ports: p, calls } = ports({ habits: [habit("h1")] }, () => ({ changed: 0 }));
    expect(await executeAction(action("setHabitDoneToday", { habitId: "h1", done: true }), p)).toEqual({ ok: true, changed: 0 });
    expect(calls.filter((c) => c.startsWith("run"))).toEqual([`run setHabitDoneToday ${JSON.stringify({ habitId: "h1", done: true })}`]);
  });

  it.each([
    ["setTaskDone", { taskId: "t3", done: true }, "That task no longer exists."],
    ["setTaskDone", { taskId: "t9", done: true }, "That task no longer exists."],
    ["setHabitDoneToday", { habitId: "h9", done: true }, "That habit no longer exists."],
    ["setBigRock", { taskId: "t2", bigRock: true }, "“Reply to email” is not in Quadrant II (important, not urgent), so it cannot be a big rock."],
    ["acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "t4"] }, "“Done one” is already done, so it cannot be one of the week's rocks."],
    ["acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t1", "gone"] }, "That task no longer exists."],
  ])("%s %j is refused before anything is sent", async (name, context, error) => {
    const { ports: p, calls } = ports(data);
    expect(await executeAction(action(name, context), p)).toEqual({ ok: false, error });
    expect(calls).toEqual(["data"]);
  });

  it("passes on the server's refusal in its words when the app had nothing to check against", async () => {
    const { ports: p, calls } = ports(undefined, () => {
      throw new ApiError(422, "That task no longer exists.");
    });
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), p)).toEqual({
      ok: false,
      error: "That task no longer exists.",
    });
    expect(calls).not.toContain("refresh tasks");
  });

  it("reports a server failure without throwing, and refreshes nothing", async () => {
    const { ports: p, calls } = ports(data, () => {
      throw new ApiError(500, "Internal Server Error");
    });
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), p)).toEqual({
      ok: false,
      error: "This was not done: Internal Server Error.",
    });
    expect(calls.some((c) => c.startsWith("refresh"))).toBe(false);
  });

  it("counts the write as done when only the refresh afterwards fails", async () => {
    const { ports: p } = ports(data);
    const failingRefresh: OperationPorts = { ...p, refresh: () => Promise.reject(new Error("offline")) };
    expect(await executeAction(action("setTaskDone", { taskId: "t1", done: true }), failingRefresh)).toEqual({ ok: true, changed: 1 });
  });
});

describe("checkAction: why a proposal cannot be done, before anyone presses it", () => {
  it("passes what the app can do, including unpinning a task of any quadrant", () => {
    expect(checkAction(action("setBigRock", { taskId: "t1", bigRock: true }), data)).toBeNull();
    expect(checkAction(action("setBigRock", { taskId: "t2", bigRock: false }), data)).toBeNull();
    expect(checkAction(action("setIntention", { dimension: "MENTAL", text: "Read daily" }), data)).toBeNull();
  });

  it("checks only the kinds of data it has", () => {
    expect(checkAction(action("setTaskDone", { taskId: "t9", done: true }), { habits: [] })).toBeNull();
    expect(checkAction(action("setHabitDoneToday", { habitId: "h9", done: true }), { tasks: [] })).toBeNull();
  });
});
