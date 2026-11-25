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
    expect(operationSentence(operation("createGoal"), { title: "Run a marathon" }, lookup)).toBe("Create the goal “Run a marathon”");
    // An operation without its own wording falls back to its title and fields.
    expect(operationSentence({ ...operation("createGoal"), describe: undefined }, { title: "Run a marathon" }, lookup)).toBe(
      "Create a goal: title “Run a marathon”",
    );
  });

  it("marks deleting destructive, and never lets the assistant propose it", () => {
    expect(OPERATIONS.deleteTask.hints.destructiveHint).toBe(true);
    for (const op of OPERATION_LIST.filter((o) => o.name.startsWith("delete"))) expect(op.assistant).toBe("never");
  });

  it("is one set: every operation is an MCP tool, and the assistant proposes all but deleting (#109 step 4)", () => {
    expect(Object.keys(ACTIONS)).toEqual([
      "setTaskDone",
      "scheduleTask",
      "setBigRock",
      "setHabitDone",
      "acceptWeekPlan",
      "setIntention",
      "createTask",
      "updateTask",
      "setMission",
      "createGoal",
      "createProject",
      "logCommitmentOccurrence",
      "addEbaEntry",
      "logRenewalActivity",
    ]);
    for (const op of OPERATION_LIST) expect(op.mcp, op.name).toBe(true);
    expect(OPERATION_LIST.filter((o) => o.assistant === "never").map((o) => o.name)).toEqual(["deleteTask"]);
    // Every action names the kind of item it touches, for keys and display.
    for (const op of Object.values(ACTIONS)) expect((op as { target?: string }).target, op.name).toBeTruthy();
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
    // Each of the five further actions goes with its own category (#109 step 4).
    const off = (category: string, name: string) => {
      expect(describeActions()).toMatch(new RegExp(`^- ${name} `, "m"));
      expect(describeActions({ [category]: false })).not.toMatch(new RegExp(`^- ${name} `, "m"));
    };
    off("mission", "setMission");
    off("goalsAndProjects", "createGoal");
    off("goalsAndProjects", "createProject");
    off("people", "logCommitmentOccurrence");
    off("ebaBalance", "addEbaEntry");
    off("habitsAndRenewal", "logRenewalActivity");
    expect(
      describeActions({ tasks: false, habitsAndRenewal: false, mission: false, goalsAndProjects: false, people: false, ebaBalance: false }),
    ).toBe("");
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

describe("repeat on createTask and updateTask (#105 step 3)", () => {
  const names: Record<string, string> = { t1: "Buitenkraan afsluiten" };
  const base = {
    title: "Buitenkraan afsluiten",
    notes: null,
    important: true,
    urgent: false,
    proactivity: null,
    dueDate: "2027-11-01",
    scheduledDay: null,
    scheduledTime: null,
    projectId: null,
    goalId: null,
  } as const;
  const lookupWith = (repeat: unknown): ActionLookup => ({
    name: (_kind, id) => names[id],
    pinnedTaskIds: () => [],
    task: (id) => (id === "t1" ? ({ ...base, repeat } as never) : undefined),
  });
  const say = (name: OperationName, input: Record<string, unknown>, lookup: ActionLookup = lookupWith(null)) =>
    operationSentence(operation(name), operation(name).input.parse(input), lookup);
  const yearly = { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21 };

  it("names the rule and the day it shows from when a task is created", () => {
    expect(say("createTask", { title: "Buitenkraan afsluiten", important: true, dueDate: "2027-11-01", repeat: { unit: "YEAR", leadDays: 21 } })).toBe(
      "Create the task “Buitenkraan afsluiten”, important, due 2027-11-01, repeating every year (shown from 2027-10-11)",
    );
    expect(say("createTask", { title: "Haircut", scheduledDay: "2026-11-27", repeat: { unit: "WEEK", every: 6, from: "COMPLETION" } })).toBe(
      "Create the task “Haircut”, on 2026-11-27, repeating every 6 weeks after completion",
    );
  });

  it("names a change of rule with what it was, and only when it changes", () => {
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "YEAR", leadDays: 21 } })).toBe(
      "Change “Buitenkraan afsluiten”: repeating every year (shown from 2027-10-11) (was not repeating)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: null }, lookupWith(yearly))).toBe("Change “Buitenkraan afsluiten”: stop repeating (was every year)");
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "MONTH", leadDays: 21 } }, lookupWith(yearly))).toBe(
      "Change “Buitenkraan afsluiten”: repeating every month (shown from 2027-10-11) (was every year)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "YEAR", leadDays: 21 } }, lookupWith(yearly))).toBe(
      "Leave “Buitenkraan afsluiten” as it is (nothing would change)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: null })).toBe("Leave “Buitenkraan afsluiten” as it is (nothing would change)");
  });

  it("says when 'show from' changes with the rule, on both sides (review of #123)", () => {
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "YEAR", every: 2 } }, lookupWith(yearly))).toBe(
      "Change “Buitenkraan afsluiten”: repeating every 2 years, shown at once (was every year, shown 21 days before it is due)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "YEAR", leadDays: 7 } }, lookupWith(yearly))).toBe(
      "Change “Buitenkraan afsluiten”: repeating every year (shown from 2027-10-25) (was every year, shown 21 days before it is due)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: { unit: "YEAR", leadDays: 21 } }, lookupWith({ ...yearly, leadDays: null }))).toBe(
      "Change “Buitenkraan afsluiten”: repeating every year (shown from 2027-10-11) (was every year, shown at once)",
    );
    expect(say("updateTask", { taskId: "t1", repeat: null }, lookupWith(yearly))).toBe("Change “Buitenkraan afsluiten”: stop repeating (was every year)");
  });

  it("counts 'show from' back from the scheduled day when there is no due date", () => {
    expect(say("createTask", { title: "Haircut", scheduledDay: "2026-11-28", repeat: { unit: "WEEK", every: 2, from: "COMPLETION", leadDays: 2 } })).toBe(
      "Create the task “Haircut”, on 2026-11-28, repeating every 2 weeks after completion (shown from 2026-11-26)",
    );
  });

  it("refuses a repeating task with no date to repeat, and a rule out of range", () => {
    const fails = (name: OperationName, input: Record<string, unknown>) => operation(name).input.safeParse(input).success === false;
    expect(fails("createTask", { title: "Someday", repeat: { unit: "WEEK" } })).toBe(true);
    expect(fails("createTask", { title: "x", dueDate: "2027-01-01", repeat: { unit: "WEEK", every: 0 } })).toBe(true);
    expect(fails("createTask", { title: "x", dueDate: "2027-01-01", repeat: { unit: "FORTNIGHT" } })).toBe(true);
    expect(fails("createTask", { title: "x", dueDate: "2027-01-01", repeat: { unit: "WEEK", leadDays: 400 } })).toBe(true);
    expect(fails("createTask", { title: "x", dueDate: "2027-01-01", repeat: { unit: "WEEK", extra: 1 } })).toBe(true);
    expect(fails("updateTask", { taskId: "t1", repeat: null })).toBe(false);
  });
});

describe("the five further actions (#109 step 4)", () => {
  const names: Record<string, string> = { c1: "Weekly call", p1: "Mum", p2: "Noor", r1: "Self", g1: "Run a half marathon" };
  const lookup = (mission?: string): ActionLookup => ({
    name: (_kind, id) => names[id],
    pinnedTaskIds: () => [],
    mission: () => mission,
  });
  const say = (name: OperationName, input: Record<string, unknown>, l: ActionLookup = lookup()) =>
    operationSentence(operation(name), operation(name).input.parse(input), l);

  it("says what is logged, with whom and on which day", () => {
    expect(say("logCommitmentOccurrence", { commitmentId: "c1", personId: "p1" })).toBe("Log “Weekly call” with Mum as done today");
    expect(say("logCommitmentOccurrence", { commitmentId: "c1", day: "2026-11-23", note: "Long one" })).toBe(
      "Log “Weekly call” as done on 2026-11-23, with the note “Long one”",
    );
    expect(say("logRenewalActivity", { dimension: "PHYSICAL", title: "Long hike" })).toBe("Log the physical renewal activity “Long hike” today");
    expect(say("logRenewalActivity", { dimension: "SPIRITUAL", title: "Retreat", day: "2026-11-22" })).toBe(
      "Log the spiritual renewal activity “Retreat” on 2026-11-22",
    );
  });

  it("names what a goal, a project and a bank-account entry will hold", () => {
    expect(say("createGoal", { title: "Run a half marathon", roleId: "r1", targetDate: "2027-04-01" })).toBe(
      "Create the goal “Run a half marathon”, under the role “Self”, target 2027-04-01",
    );
    expect(say("createGoal", { title: "x", roleId: "r9" })).toBe("Create the goal “x”, under the role a role that no longer exists");
    expect(say("createProject", { name: "Launch the newsletter", goalId: "g1" })).toBe(
      "Create the project “Launch the newsletter”, for the goal “Run a half marathon”",
    );
    expect(say("addEbaEntry", { personId: "p2", kind: "DEPOSIT", note: "We baked together" })).toBe(
      "Add a deposit for Noor with the note “We baked together”",
    );
    expect(say("addEbaEntry", { personId: "p2", kind: "WITHDRAWAL" })).toBe("Add a withdrawal for Noor");
  });

  it("shows any stored text in full when short, its start and length when long", () => {
    const long = "x".repeat(450);
    expect(say("createGoal", { title: "Be present", description: long })).toMatch(/^Create the goal “Be present”, with the description “x+…” \(450 characters\)$/);
    expect(say("addEbaEntry", { personId: "p2", kind: "DEPOSIT", note: long })).toMatch(/\(450 characters\)$/);
  });

  it("shows the whole new mission statement, never shortened, and says the current one is kept", () => {
    const text = `Live by what matters. ${"Be present. ".repeat(40)}`.trim();
    expect(say("setMission", { text }, lookup("Old words"))).toBe(
      `Replace the mission statement with “${text}” (the current one is kept as an earlier version)`,
    );
    expect(say("setMission", { text: "First words" }, lookup(""))).toBe("Write the mission statement: “First words”");
    expect(say("setMission", { text: "Same" }, lookup("Same"))).toBe("Leave the mission statement as it is (nothing would change)");
  });

  it("refuses a person who is not part of the commitment, and a commitment, person or role that is gone", () => {
    const data = { commitments: [{ id: "c1", personIds: ["p1"] }], people: [{ id: "p1" }, { id: "p2" }], roles: [{ id: "r1" }] };
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c1", personId: "p2" }, data)).toBe(
      "That person is not part of that commitment.",
    );
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c1", personId: "p1" }, data)).toBeNull();
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c9" }, data)).toBe("That commitment no longer exists.");
    expect(checkOperation(operation("addEbaEntry"), { personId: "p9", kind: "DEPOSIT" }, data)).toBe("That person no longer exists.");
    expect(checkOperation(operation("createGoal"), { title: "x", roleId: "r9" }, data)).toBe("That role no longer exists.");
  });
});

describe("a day still to come is refused before a press (review of #124)", () => {
  it("for a logged commitment, a renewal activity and a habit check-off, against the caller's today", () => {
    const data = { today: "2026-11-24", commitments: [{ id: "c1", personIds: ["p1"] }], habits: [{ id: "h1" }] };
    const refusal = "That day is still to come; only today or an earlier day can be logged.";
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c1", day: "2026-12-25" }, data)).toBe(refusal);
    expect(checkOperation(operation("logRenewalActivity"), { dimension: "PHYSICAL", title: "x", day: "2026-11-25" }, data)).toBe(refusal);
    expect(checkOperation(operation("setHabitDone"), { habitId: "h1", done: true, day: "2026-11-25" }, data)).toBe(refusal);
    // Today and earlier days pass; without a today, days are not checked here.
    expect(checkOperation(operation("logCommitmentOccurrence"), { commitmentId: "c1", day: "2026-11-24" }, data)).toBeNull();
    expect(checkOperation(operation("setHabitDone"), { habitId: "h1", done: true, day: "2026-11-20" }, data)).toBeNull();
    expect(checkOperation(operation("logRenewalActivity"), { dimension: "PHYSICAL", title: "x", day: "2030-01-01" }, {})).toBeNull();
  });
});

describe("what a proposal changes on each task, next to its sentence (#145)", () => {
  const names: Record<string, string> = { t1: "Buitenkraan afsluiten", t2: "Plan the garden", t3: "Book the dentist", t4: "Write the yearly letter" };
  const lookup: ActionLookup = { name: (_kind, id) => names[id], pinnedTaskIds: () => ["t4", "t2"] };
  const both = (name: OperationName, input: Record<string, unknown>) => {
    const decl = operation(name);
    const args = decl.input.parse(input);
    return { sentence: operationSentence(decl, args, lookup), changes: decl.taskChanges?.(args, lookup) };
  };

  it("updateTask: the owner's yearly case, the same fields as the sentence", () => {
    const { sentence, changes } = both("updateTask", { taskId: "t1", urgent: false, dueDate: "2027-11-01", repeat: { unit: "YEAR", leadDays: 21 } });
    expect(sentence).toMatch(/not urgent, due 2027-11-01, repeating every year \(shown from 2027-10-11\)/);
    expect(changes).toEqual([
      { taskId: "t1", set: { urgent: false, dueDate: "2027-11-01", repeat: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21 } } },
    ]);
  });

  it("updateTask: a day taken off the Clock takes its time with it, as the sentence says", () => {
    const { sentence, changes } = both("updateTask", { taskId: "t1", scheduledDay: null });
    expect(sentence).toMatch(/not on the Clock/);
    expect(changes).toEqual([{ taskId: "t1", set: { scheduledDay: null, scheduledTime: null } }]);
    expect(both("updateTask", { taskId: "t1", repeat: null }).changes).toEqual([{ taskId: "t1", set: { repeat: null } }]);
  });

  it("scheduleTask, setTaskDone and setBigRock", () => {
    expect(both("scheduleTask", { taskId: "t1", day: "2026-11-26", time: "09:00" })).toEqual({
      sentence: "Schedule “Buitenkraan afsluiten” on 2026-11-26 at 09:00",
      changes: [{ taskId: "t1", set: { scheduledDay: "2026-11-26", scheduledTime: "09:00" } }],
    });
    expect(both("scheduleTask", { taskId: "t1", day: null }).changes).toEqual([{ taskId: "t1", set: { scheduledDay: null, scheduledTime: null } }]);
    expect(both("setTaskDone", { taskId: "t1", done: true })).toEqual({
      sentence: "Mark “Buitenkraan afsluiten” done",
      changes: [{ taskId: "t1", set: { done: true } }],
    });
    expect(both("setBigRock", { taskId: "t2", bigRock: false })).toEqual({
      sentence: "Unpin “Plan the garden” as a big rock",
      changes: [{ taskId: "t2", set: { bigRock: false } }],
    });
  });

  it("acceptWeekPlan: pins the plan and unpins the same rocks the sentence names", () => {
    const { sentence, changes } = both("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t2", "t3"] });
    expect(sentence).toBe(
      "Make “Plan the garden”, “Book the dentist” the big rocks for the week of 2026-11-23, and unpin “Write the yearly letter”",
    );
    expect(changes).toEqual([
      { taskId: "t2", set: { bigRock: true } },
      { taskId: "t3", set: { bigRock: true } },
      { taskId: "t4", set: { bigRock: false } },
    ]);
  });

  it("createTask changes no existing task; operations on other things name no task", () => {
    for (const name of ["createTask", "setHabitDone", "setIntention", "setMission"] as const) {
      expect(operation(name).taskChanges).toBeUndefined();
    }
  });
});
