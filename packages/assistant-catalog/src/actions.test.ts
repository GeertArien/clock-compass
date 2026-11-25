import { describe, expect, it } from "vitest";
import { ACTIONS, actionKey, describeActions, isConfirmableAction, parseAction } from "./actions";

describe("parseAction", () => {
  it("still parses a proposal stored as setHabitDoneToday (before #109 step 3), keyed as it was stored", () => {
    const parsed = parseAction({ name: "setHabitDoneToday", surfaceId: "s1", context: { habitId: "h1", done: true } });
    expect(parsed).toMatchObject({ kind: "write", name: "setHabitDone", args: { habitId: "h1", done: true } });
    if (parsed.kind !== "write") throw new Error("expected a write");
    expect(parsed.key).toBe(actionKey("s1", "setHabitDoneToday", { habitId: "h1", done: true }));
    expect(parsed.describe({ name: () => "Morning run", pinnedTaskIds: () => [] })).toBe("Check off “Morning run” for today");
  });

  it("returns a validated write with its target and key", () => {
    const parsed = parseAction({
      name: "setTaskDone",
      surfaceId: "s1",
      context: { taskId: "t1", done: true },
    });
    expect(parsed).toEqual({
      kind: "write",
      name: "setTaskDone",
      args: { taskId: "t1", done: true },
      targetId: "t1",
      key: '["s1","setTaskDone",{"done":true,"taskId":"t1"}]',
      describe: expect.any(Function),
      taskChanges: expect.any(Function),
    });
  });

  it("treats an event that is not a confirmable action as a message", () => {
    expect(parseAction({ name: "dismissWeekPlan", surfaceId: "s1" })).toEqual({
      kind: "message",
      name: "dismissWeekPlan",
    });
  });

  it.each([
    ["missing arguments", "setTaskDone", {}],
    ["a toggle instead of a target state", "setTaskDone", { taskId: "t1" }],
    ["an extra argument", "setBigRock", { taskId: "t1", bigRock: true, also: "delete" }],
    ["a malformed date", "scheduleTask", { taskId: "t1", day: "next friday" }],
    ["a time without a day", "scheduleTask", { taskId: "t1", day: null, time: "09:00" }],
    ["a month that does not exist", "scheduleTask", { taskId: "t1", day: "2026-13-45" }],
    ["a day that does not exist", "scheduleTask", { taskId: "t1", day: "2026-02-31" }],
    ["a time that does not exist", "scheduleTask", { taskId: "t1", day: "2026-11-21", time: "24:00" }],
    ["a week that does not start on Monday", "acceptWeekPlan", { weekStart: "2026-11-18", taskIds: ["1"] }],
    ["too many rocks", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["1", "2", "3", "4", "5", "6", "7", "8"] }],
    ["no rocks", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: [] }],
    ["the same rock twice", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["1", "1"] }],
    ["an intention (no place for it in the data model)", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["1"], intention: "x" }],
  ])("rejects %s", (_label, name, context) => {
    const parsed = parseAction({ name, surfaceId: "s1", context });
    expect(parsed.kind).toBe("invalid");
  });

  it("names why a date is wrong", () => {
    expect(parseAction({ name: "scheduleTask", surfaceId: "s", context: { taskId: "t", day: "2026-02-31" } })).toMatchObject({
      error: expect.stringMatching(/day: a real calendar date/),
    });
    expect(
      parseAction({ name: "acceptWeekPlan", surfaceId: "s", context: { weekStart: "2026-11-18", taskIds: ["t"] } }),
    ).toMatchObject({ error: expect.stringMatching(/weekStart: a Monday/) });
  });

  it("reads a scheduleTask without a time as no particular time, with one key for both spellings", () => {
    const omitted = parseAction({ name: "scheduleTask", surfaceId: "s", context: { taskId: "t", day: "2026-11-21" } });
    const explicit = parseAction({ name: "scheduleTask", surfaceId: "s", context: { taskId: "t", day: "2026-11-21", time: null } });
    expect(omitted).toMatchObject({ kind: "write", args: { time: null } });
    expect(omitted.kind === "write" && explicit.kind === "write" && omitted.key === explicit.key).toBe(true);
  });

  it("names the failing argument", () => {
    const parsed = parseAction({ name: "scheduleTask", surfaceId: "s1", context: { taskId: "t1", day: "tomorrow" } });
    expect(parsed).toMatchObject({ kind: "invalid", error: expect.stringMatching(/^day: a date as YYYY-MM-DD/) });
  });

  it("accepts every action's documented shape", () => {
    const valid: Record<string, Record<string, unknown>> = {
      setTaskDone: { taskId: "t1", done: false },
      scheduleTask: { taskId: "t1", day: "2026-11-21", time: "07:30" },
      setBigRock: { taskId: "t1", bigRock: true },
      setHabitDone: { habitId: "h1", done: true },
      setIntention: { dimension: "SPIRITUAL", text: "Ten quiet minutes each morning" },
      acceptWeekPlan: { weekStart: "2026-11-16", taskIds: ["t1", "t2"] },
      createTask: { title: "Buitenkraan afsluiten", important: true, dueDate: "2027-11-01", projectId: "p1" },
      updateTask: { taskId: "t1", urgent: true, scheduledDay: null },
      setMission: { text: "Live by what matters." },
      createGoal: { title: "Run a half marathon", roleId: "r1", targetDate: "2027-04-01" },
      createProject: { name: "Launch the newsletter", goalId: "g1" },
      logCommitmentOccurrence: { commitmentId: "c1", personId: "p1", day: "2026-11-23" },
      addEbaEntry: { personId: "p1", kind: "DEPOSIT", note: "We baked together" },
      logRenewalActivity: { dimension: "PHYSICAL", title: "Long hike", day: "2026-11-23" },
    };
    expect(Object.keys(valid).sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const [name, context] of Object.entries(valid)) {
      expect(parseAction({ name, surfaceId: "s", context }).kind, name).toBe("write");
    }
  });
});

describe("actionKey (safe to repeat)", () => {
  it("is the same for the same action however its arguments are ordered", () => {
    expect(actionKey("s1", "scheduleTask", { day: "2026-11-21", taskId: "t1" })).toBe(
      actionKey("s1", "scheduleTask", { taskId: "t1", day: "2026-11-21" }),
    );
  });

  it("differs by surface, name or arguments", () => {
    const base = actionKey("s1", "setTaskDone", { taskId: "t1", done: true });
    expect(actionKey("s2", "setTaskDone", { taskId: "t1", done: true })).not.toBe(base);
    expect(actionKey("s1", "setBigRock", { taskId: "t1", done: true })).not.toBe(base);
    expect(actionKey("s1", "setTaskDone", { taskId: "t1", done: false })).not.toBe(base);
  });

  it("cannot be forged by a separator in the surface id or name", () => {
    expect(actionKey("a|setTaskDone", "x", {})).not.toBe(actionKey("a", "setTaskDone|x", {}));
    expect(actionKey('a","b', "c", {})).not.toBe(actionKey("a", 'b","c', {}));
  });

  it("ignores undefined optional arguments", () => {
    expect(actionKey("s", "scheduleTask", { taskId: "t", day: "2026-11-21", time: undefined })).toBe(
      actionKey("s", "scheduleTask", { taskId: "t", day: "2026-11-21" }),
    );
  });
});

describe("describe: the app's own wording of a resolved action", () => {
  const names: Record<string, string> = { t1: "Call the plumber", t2: "Plan the garden", t3: "Fix the fence", h1: "Morning run" };
  const lookup = { name: (_kind: string, id: string) => names[id], pinnedTaskIds: () => ["t2", "t3"] };
  const say = (name: string, context: Record<string, unknown>) => {
    const parsed = parseAction({ name, surfaceId: "s", context });
    if (parsed.kind !== "write") throw new Error(`not a write: ${JSON.stringify(parsed)}`);
    return parsed.describe(lookup);
  };

  it.each([
    ["setTaskDone", { taskId: "t1", done: true }, "Mark “Call the plumber” done"],
    ["setTaskDone", { taskId: "t1", done: false }, "Reopen “Call the plumber”"],
    ["scheduleTask", { taskId: "t1", day: "2026-11-21", time: "07:30" }, "Schedule “Call the plumber” on 2026-11-21 at 07:30"],
    ["scheduleTask", { taskId: "t1", day: null }, "Take “Call the plumber” off the Clock"],
    ["setBigRock", { taskId: "t2", bigRock: true }, "Pin “Plan the garden” as a big rock"],
    ["setHabitDone", { habitId: "h1", done: true }, "Check off “Morning run” for today"],
    ["acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["t1", "t2"] }, "Make “Call the plumber”, “Plan the garden” the big rocks for the week of 2026-11-16, and unpin “Fix the fence”"],
    ["acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["t2", "t3"] }, "Make “Plan the garden”, “Fix the fence” the big rocks for the week of 2026-11-16"],
    ["setIntention", { dimension: "PHYSICAL", text: "  Three runs  " }, "Set this week's physical intention to “Three runs”"],
  ])("%s %j", (name, context, text) => {
    expect(say(name, context)).toBe(text);
  });

  it("refuses an empty intention or an unknown dimension: the assistant cannot clear an intention", () => {
    for (const context of [
      { dimension: "PHYSICAL", text: "   " },
      { dimension: "PHYSICAL" },
      { dimension: "EMOTIONAL", text: "x" },
      { dimension: "MENTAL", text: "x".repeat(281) },
    ]) {
      expect(parseAction({ name: "setIntention", surfaceId: "s", context }).kind, JSON.stringify(context)).toBe("invalid");
    }
  });

  it("says when an item no longer exists instead of trusting the model's words", () => {
    expect(say("setTaskDone", { taskId: "gone", done: true })).toBe("Mark a task that no longer exists done");
  });
});

describe("the action list", () => {
  it("is plain data: no toggles, every action states a target", () => {
    for (const name of Object.keys(ACTIONS)) expect(name).not.toMatch(/toggle/i);
    expect(isConfirmableAction("setTaskDone")).toBe(true);
    expect(isConfirmableAction("toString")).toBe(false);
  });

  it("describes each action and argument for the prompt", () => {
    const text = describeActions();
    expect(text).toContain("- scheduleTask (task): Put a task on a day");
    expect(text).toContain("    - time (optional): HH:MM on that day; null or left out for no particular time.");
    expect(text).toContain("every other open rock is unpinned. Rocks already done stay pinned.");
    expect(text).toContain("- setIntention (intention):");
  });
});
