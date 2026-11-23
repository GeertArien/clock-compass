import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTIONS, describeActions } from "./actions";
import { DATA_CATEGORIES } from "./data-categories";
import { OPERATIONS, OPERATION_LIST, checkOperation, operation, operationSentence, type ActionLookup, type OperationName } from "./operations";

const lookup: ActionLookup = { name: () => "Plan the garden", pinnedTaskIds: () => [] };

/** A valid input for each operation, to exercise its sentence. */
const SAMPLES: Record<keyof typeof OPERATIONS, Record<string, unknown>> = {
  setTaskDone: { taskId: "t1", done: true },
  scheduleTask: { taskId: "t1", day: "2026-11-23" },
  setBigRock: { taskId: "t1", bigRock: true },
  setHabitDoneToday: { habitId: "h1", done: true },
  acceptWeekPlan: { weekStart: "2026-11-23", taskIds: ["t1"] },
  setIntention: { dimension: "MENTAL", text: "Read daily" },
  create_task: { title: "File taxes", important: true },
  update_task: { id: "t1", urgent: false },
  complete_task: { id: "t1" },
  reopen_task: { id: "t1" },
  delete_task: { id: "t1" },
  set_mission: { content: "Live by what matters." },
  create_goal: { title: "Run a marathon" },
  create_project: { name: "Launch the newsletter" },
  log_commitment_occurrence: { commitmentId: "c1" },
  add_eba_entry: { personId: "p1", kind: "DEPOSIT" },
  toggle_habit: { habitId: "h1" },
  log_renewal_activity: { dimension: "PHYSICAL", title: "Long hike" },
  set_weekly_intention: { dimension: "MENTAL", text: "" },
};

describe("the operation registry", () => {
  it("declares every operation under its own name with a strict schema, write hints, a data category and what it touches", () => {
    for (const [key, op] of Object.entries(OPERATIONS)) {
      expect(op.name).toBe(key);
      expect(op.input).toBeInstanceOf(z.ZodType);
      expect(op.input.safeParse({ ...SAMPLES[op.name as OperationName], unexpected: 1 }).success, `${op.name} is strict`).toBe(false);
      expect(op.hints).toEqual({ readOnlyHint: false, destructiveHint: expect.any(Boolean), idempotentHint: expect.any(Boolean) });
      expect(DATA_CATEGORIES).toContain(op.category);
      expect(op.touches.length).toBeGreaterThan(0);
      expect(op.summary.length).toBeGreaterThan(0);
    }
  });

  it("has a confirm sentence for every operation: its own wording, or the title and the fields set", () => {
    for (const op of OPERATION_LIST) {
      const input = op.input.parse(SAMPLES[op.name as OperationName]);
      expect(operationSentence(op, input, lookup).length, op.name).toBeGreaterThan(0);
    }
    expect(operationSentence(operation("create_goal"), { title: "Run a marathon" }, lookup)).toBe("Create a goal: title “Run a marathon”");
    expect(operationSentence(operation("complete_task"), {}, lookup)).toBe("Complete a task");
  });

  it("marks deleting destructive, and never lets the assistant propose it", () => {
    expect(OPERATIONS.delete_task.hints.destructiveHint).toBe(true);
    for (const op of OPERATION_LIST.filter((o) => o.name.startsWith("delete"))) expect(op.assistant).toBe("never");
  });

  it("lets the assistant propose exactly its six actions, which no MCP tool duplicates", () => {
    expect(Object.keys(ACTIONS)).toEqual(["setTaskDone", "scheduleTask", "setBigRock", "setHabitDoneToday", "acceptWeekPlan", "setIntention"]);
    for (const op of OPERATION_LIST) expect(op.assistant === "propose").toBe(!op.mcp);
  });
});

describe("the action list in the prompt", () => {
  it("is the same text as before the registry (#109)", () => {
    expect(describeActions()).toBe(readFileSync(new URL("./describe-actions-before-109.txt", import.meta.url), "utf8"));
  });

  it("never lists an operation the assistant may not propose", () => {
    for (const op of OPERATION_LIST.filter((o) => o.assistant === "never")) {
      expect(describeActions()).not.toMatch(new RegExp(`^- ${op.name} `, "m"));
    }
  });

  it("leaves out the operations whose data category is switched off", () => {
    const text = describeActions({ tasks: false });
    expect(text).toMatch(/^- setHabitDoneToday /m);
    expect(text).toMatch(/^- setIntention /m);
    expect(text).not.toMatch(/setTaskDone|scheduleTask|setBigRock|acceptWeekPlan/);
    expect(describeActions({ tasks: false, habitsAndRenewal: false })).toBe("");
  });
});

describe("checkOperation", () => {
  it("refuses an archived or missing item, and checks only the data it is given", () => {
    const tasks = [{ id: "t1", title: "Old", status: "ARCHIVED", important: true, urgent: false }];
    expect(checkOperation(operation("setTaskDone"), { taskId: "t1", done: true }, { tasks })).toBe("That task no longer exists.");
    expect(checkOperation(operation("setTaskDone"), { taskId: "t1", done: true }, {})).toBeNull();
    expect(checkOperation(operation("setHabitDoneToday"), { habitId: "h1", done: true }, { habits: [] })).toBe("That habit no longer exists.");
  });
});
