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
  createTask: { title: "Buitenkraan afsluiten" },
  updateTask: { taskId: "t1", urgent: true },
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

  it("lets the assistant propose its actions (the six of #102, then create and edit a task), none of them an MCP tool", () => {
    expect(Object.keys(ACTIONS)).toEqual([
      "setTaskDone",
      "scheduleTask",
      "setBigRock",
      "setHabitDoneToday",
      "acceptWeekPlan",
      "setIntention",
      "createTask",
      "updateTask",
    ]);
    for (const op of OPERATION_LIST) expect(op.assistant === "propose").toBe(!op.mcp);
  });
});

describe("the action list in the prompt", () => {
  it("keeps the six actions word for word as before the registry (#109), then adds createTask and updateTask", () => {
    const before = readFileSync(new URL("./describe-actions-before-109.txt", import.meta.url), "utf8");
    const text = describeActions();
    expect(text.startsWith(`${before}\n- createTask (task): `)).toBe(true);
    expect(text).toMatch(/^- updateTask \(task\): /m);
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
    expect(text).not.toMatch(/setTaskDone|scheduleTask|setBigRock|acceptWeekPlan|createTask|updateTask/);
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

describe("createTask and updateTask (#109 step 2)", () => {
  const names: Record<string, string> = { t1: "Buitenkraan afsluiten", p1: "Huishouden", p2: "Tuin", g1: "Een warm huis" };
  const current = {
    title: "Buitenkraan afsluiten",
    notes: null,
    important: true,
    urgent: false,
    proactivity: null,
    dueDate: "2027-11-01",
    scheduledDay: null,
    scheduledTime: null,
    projectId: "p1",
    goalId: null,
  } as const;
  const lookup: ActionLookup = {
    name: (_kind, id) => names[id],
    pinnedTaskIds: () => [],
    task: (id) => (id === "t1" ? current : undefined),
  };
  const say = (name: OperationName, input: Record<string, unknown>) => operationSentence(operation(name), operation(name).input.parse(input), lookup);

  it("names everything a new task will have", () => {
    expect(say("createTask", { title: " Buitenkraan afsluiten ", important: true, dueDate: "2027-11-01", projectId: "p1" })).toBe(
      "Create the task “Buitenkraan afsluiten”, important, due 2027-11-01, in the project “Huishouden”",
    );
    expect(
      say("createTask", {
        title: "Plan the garden",
        important: true,
        urgent: true,
        proactivity: "INFLUENCE",
        scheduledDay: "2026-11-24",
        scheduledTime: "07:30",
        goalId: "g1",
        notes: "Seeds first",
      }),
    ).toBe("Create the task “Plan the garden”, important and urgent, in your influence, on 2026-11-24 at 07:30, for the goal “Een warm huis”, with notes");
    expect(say("createTask", { title: "Call mum" })).toBe("Create the task “Call mum”");
  });

  it("names only what an edit changes, with the old value where it helps", () => {
    expect(say("updateTask", { taskId: "t1", urgent: true, important: true, dueDate: "2027-11-08" })).toBe(
      "Change “Buitenkraan afsluiten”: urgent, due 2027-11-08 (was 2027-11-01)",
    );
    expect(say("updateTask", { taskId: "t1", projectId: "p2", scheduledDay: "2026-11-24", scheduledTime: "09:00" })).toBe(
      "Change “Buitenkraan afsluiten”: on 2026-11-24 at 09:00 (was not on the Clock), in the project “Tuin” (was the project “Huishouden”)",
    );
    expect(say("updateTask", { taskId: "t1", title: "Kraan afsluiten", projectId: null, dueDate: null })).toBe(
      "Change “Buitenkraan afsluiten”: rename it to “Kraan afsluiten”, no due date (was 2027-11-01), in no project (was the project “Huishouden”)",
    );
    expect(say("updateTask", { taskId: "t1", important: true })).toBe("Leave “Buitenkraan afsluiten” as it is (nothing would change)");
  });

  it("refuses what cannot be a task: an empty title, an impossible date, a time without a day, an edit of nothing", () => {
    const fails = (name: OperationName, input: Record<string, unknown>) => operation(name).input.safeParse(input).success === false;
    expect(fails("createTask", { title: "   " })).toBe(true);
    expect(fails("createTask", { title: "x".repeat(201) })).toBe(true);
    expect(fails("createTask", { title: "Tax", dueDate: "2027-02-30" })).toBe(true);
    expect(fails("createTask", { title: "Tax", scheduledTime: "07:30" })).toBe(true);
    expect(fails("updateTask", { taskId: "t1" })).toBe(true);
    expect(fails("updateTask", { taskId: "t1", scheduledDay: null, scheduledTime: "07:30" })).toBe(true);
    expect(fails("updateTask", { taskId: "t1", scheduledTime: "07:30" })).toBe(true);
  });

  it("refuses a project or goal that does not exist, before anyone presses", () => {
    const data = { projects: [{ id: "p1" }], goals: [{ id: "g1" }] };
    expect(checkOperation(operation("createTask"), { title: "x", projectId: "p9" }, data)).toBe("That project no longer exists.");
    expect(checkOperation(operation("createTask"), { title: "x", goalId: "g9" }, data)).toBe("That goal no longer exists.");
    expect(checkOperation(operation("createTask"), { title: "x", projectId: "p1", goalId: "g1" }, data)).toBeNull();
  });
});
