import { describe, expect, it } from "vitest";
import { ACTIONS, actionKey, describeActions, isConfirmableAction, parseAction } from "./actions";

describe("parseAction", () => {
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
      key: 's1|setTaskDone|{"done":true,"taskId":"t1"}',
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
    ["too many rocks", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: ["1", "2", "3", "4", "5", "6", "7", "8"] }],
    ["no rocks", "acceptWeekPlan", { weekStart: "2026-11-16", taskIds: [] }],
  ])("rejects %s", (_label, name, context) => {
    const parsed = parseAction({ name, surfaceId: "s1", context });
    expect(parsed.kind).toBe("invalid");
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
      setHabitDoneToday: { habitId: "h1", done: true },
      acceptWeekPlan: { weekStart: "2026-11-16", taskIds: ["t1", "t2"], intention: "Be present" },
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

  it("ignores undefined optional arguments", () => {
    expect(actionKey("s", "scheduleTask", { taskId: "t", day: "2026-11-21", time: undefined })).toBe(
      actionKey("s", "scheduleTask", { taskId: "t", day: "2026-11-21" }),
    );
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
    expect(text).toContain("    - time (optional): HH:MM on that day, or null for any time.");
  });
});
