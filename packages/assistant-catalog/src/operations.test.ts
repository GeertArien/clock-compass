import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTIONS, describeActions } from "./actions";
import { DATA_CATEGORIES } from "./data-categories";
import {
  LEGACY_ACTION_NAMES,
  OPERATIONS,
  OPERATION_LIST,
  checkOperation,
  mcpToolName,
  operation,
  operationSentence,
  type ActionLookup,
  type OperationName,
} from "./operations";

const lookup: ActionLookup = { name: () => "Plan the garden", pinnedTaskIds: () => [] };

/** A valid input for each operation, to exercise its sentence. */
const SAMPLES: Record<keyof typeof OPERATIONS, Record<string, unknown>> = {
  setTaskDone: { taskId: "t1", done: true },
  scheduleTask: { taskId: "t1", day: "2026-11-23" },
  setBigRock: { taskId: "t1", bigRock: true },
  setHabitDone: { habitId: "h1", done: true },
  acceptWeekPlan: { weekStart: "2026-11-23", taskIds: ["t1"] },
  setIntention: { dimension: "MENTAL", text: "Read daily" },
  createTask: { title: "Buitenkraan afsluiten" },
  updateTask: { taskId: "t1", urgent: true },
  deleteTask: { taskId: "t1" },
  setMission: { text: "Live by what matters." },
  createGoal: { title: "Run a marathon" },
  createProject: { name: "Launch the newsletter" },
  logCommitmentOccurrence: { commitmentId: "c1" },
  addEbaEntry: { personId: "p1", kind: "DEPOSIT" },
  logRenewalActivity: { dimension: "PHYSICAL", title: "Long hike" },
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
    expect(operationSentence(operation("createGoal"), { title: "Run a marathon" }, lookup)).toBe("Create a goal: title “Run a marathon”");
  });

  it("marks deleting destructive, and never lets the assistant propose it", () => {
    expect(OPERATIONS.deleteTask.hints.destructiveHint).toBe(true);
    for (const op of OPERATION_LIST.filter((o) => o.name.startsWith("delete"))) expect(op.assistant).toBe("never");
  });

  it("is one set (#109 step 3): every operation is an MCP tool, and the assistant proposes the eight it did", () => {
    expect(Object.keys(ACTIONS)).toEqual([
      "setTaskDone",
      "scheduleTask",
      "setBigRock",
      "setHabitDone",
      "acceptWeekPlan",
      "setIntention",
      "createTask",
      "updateTask",
    ]);
    for (const op of OPERATION_LIST) expect(op.mcp, op.name).toBe(true);
    expect(OPERATION_LIST.filter((o) => o.assistant === "never").map((o) => o.name)).toEqual([
      "deleteTask",
      "setMission",
      "createGoal",
      "createProject",
      "logCommitmentOccurrence",
      "addEbaEntry",
      "logRenewalActivity",
    ]);
  });

  it("derives each MCP tool name from the operation's name, never by hand", () => {
    expect(mcpToolName("setTaskDone")).toBe("set_task_done");
    expect(mcpToolName("logCommitmentOccurrence")).toBe("log_commitment_occurrence");
    const names = OPERATION_LIST.map((o) => mcpToolName(o.name));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("gives every create the means to happen once, and marks only those as not safe to repeat", () => {
    for (const op of OPERATION_LIST) expect(op.hints.idempotentHint, op.name).toBe(!op.creates);
  });

  it("maps the assistant's old action names to the operations that replaced them", () => {
    expect(LEGACY_ACTION_NAMES).toEqual({ setHabitDoneToday: "setHabitDone" });
    for (const name of Object.keys(LEGACY_ACTION_NAMES)) expect(Object.hasOwn(OPERATIONS, name)).toBe(false);
  });
});

describe("the action list in the prompt", () => {
  it("is pinned word for word: a change to what the model reads shows up here (describe-actions.txt)", () => {
    const pinned = readFileSync(new URL("./describe-actions.txt", import.meta.url), "utf8");
    expect(describeActions()).toBe(pinned.trimEnd());
  });

  it("never lists an operation the assistant may not propose", () => {
    for (const op of OPERATION_LIST.filter((o) => o.assistant === "never")) {
      expect(describeActions()).not.toMatch(new RegExp(`^- ${op.name} `, "m"));
    }
  });

  it("leaves out the operations whose data category is switched off", () => {
    const text = describeActions({ tasks: false });
    expect(text).toMatch(/^- setHabitDone /m);
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
    expect(checkOperation(operation("setHabitDone"), { habitId: "h1", done: true }, { habits: [] })).toBe("That habit no longer exists.");
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c1", personId: "p9" }, { commitments: [{ id: "c1" }], people: [] })).toBe(
      "That person no longer exists.",
    );
    expect(checkOperation(operation("createGoal"), { title: "x", roleId: "r9" }, { roles: [] })).toBe("That role no longer exists.");
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
    ).toBe(
      "Create the task “Plan the garden”, important and urgent, in your influence, on 2026-11-24 at 07:30, for the goal “Een warm huis”, with the notes “Seeds first”",
    );
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

  it("shows the notes it sets, replaces or clears: in full when short, their start and length when long", () => {
    const long = `Vóór de eerste vorst;\nhoofdkraan in de kelder. ${"x".repeat(300)}`;
    const created = say("createTask", { title: "Kraan", notes: long });
    expect(created).toMatch(/^Create the task “Kraan”, with the notes “Vóór de eerste vorst; hoofdkraan in de kelder\. x+…” \(\d+ characters\)$/);
    expect(created).toContain(`(${long.length} characters)`);
    const withNotes: ActionLookup = { ...lookup, task: (id) => (id === "t1" ? { ...current, notes: "Hoofdkraan in de kelder" } : undefined) };
    const sayWith = (input: Record<string, unknown>) => operationSentence(operation("updateTask"), operation("updateTask").input.parse(input), withNotes);
    expect(sayWith({ taskId: "t1", notes: "Ook de buitenkraan" })).toBe(
      "Change “Buitenkraan afsluiten”: replace its notes “Hoofdkraan in de kelder” with “Ook de buitenkraan”",
    );
    expect(sayWith({ taskId: "t1", notes: null })).toBe("Change “Buitenkraan afsluiten”: clear its notes (“Hoofdkraan in de kelder”)");
    expect(say("updateTask", { taskId: "t1", notes: "Eerst de hoofdkraan" })).toBe(
      "Change “Buitenkraan afsluiten”: set its notes to “Eerst de hoofdkraan”",
    );
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

describe("setHabitDone and setIntention (#109 step 3)", () => {
  const withNow: ActionLookup = {
    name: () => "Morning run",
    pinnedTaskIds: () => [],
    intention: (d) => (d === "MENTAL" ? "Read daily" : undefined),
  };
  const say = (name: OperationName, input: Record<string, unknown>) => operationSentence(operation(name), operation(name).input.parse(input), withNow);

  it("names the day a habit is checked off for, today when left out", () => {
    expect(say("setHabitDone", { habitId: "h1", done: true })).toBe("Check off “Morning run” for today");
    expect(say("setHabitDone", { habitId: "h1", done: false, day: "2026-11-22" })).toBe("Undo the check-off of “Morning run” for 2026-11-22");
    expect(operation("setHabitDone").input.safeParse({ habitId: "h1", done: true, day: "2026-11-31" }).success).toBe(false);
  });

  it("clears an intention with null, showing what is cleared; an empty text is refused", () => {
    expect(say("setIntention", { dimension: "MENTAL", text: null })).toBe("Clear this week's mental intention (“Read daily”)");
    expect(say("setIntention", { dimension: "PHYSICAL", text: null })).toBe("Clear this week's physical intention");
    expect(say("setIntention", { dimension: "MENTAL", text: "Read at night" })).toBe(
      "Set this week's mental intention to “Read at night” (was “Read daily”)",
    );
    expect(operation("setIntention").input.safeParse({ dimension: "MENTAL", text: "  " }).success).toBe(false);
  });
});
