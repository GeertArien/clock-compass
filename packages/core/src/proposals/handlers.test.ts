import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROPOSABLE, operation, validatePayload } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY, type DataPolicy } from "../assistant/data-policy.js";
import { EBA_NOTE, PERSON_NOTE, fakeServices } from "../assistant/test-fakes.js";
import { createProposalSigner, runProposeChanges, writeRefusal } from "./handlers.js";

// Friday 20 November 2026 in Brussels.
const signer = createProposalSigner(Buffer.alloc(32, 7));
const ctx = { policy: DEFAULT_DATA_POLICY, now: new Date("2026-11-20T09:00:00Z"), timeZone: "Europe/Brussels", signer, randomId: () => "0f1e2d3c-fixed" };
const off = (category: keyof DataPolicy) => ({ ...ctx, policy: { ...DEFAULT_DATA_POLICY, [category]: false } });
const propose = (changes: { operation: string; input: Record<string, unknown> }[], c = ctx) => runProposeChanges({ changes }, fakeServices(), c);

/** The page test's proposal: a task moved to Thursday, and a new task. */
const FIXTURE_CHANGES = [
  { operation: "updateTask", input: { taskId: "t3", scheduledDay: "2026-11-26", scheduledTime: "10:00" } },
  { operation: "createTask", input: { title: "File taxes", important: true, dueDate: "2027-04-01" } },
];

describe("what may be proposed (#118, step 3)", () => {
  it("is the assistant's proposable operations: never a delete, keys, import, export, push or AI settings", () => {
    const names = PROPOSABLE.map((op) => op.name);
    expect(names).not.toContain("deleteTask");
    for (const name of names) {
      expect(operation(name as never).assistant).toBe("propose");
      expect(name).not.toMatch(/delete|remove|apikey|key|import|export|push|subscription|setting|provider/i);
    }
  });
});

describe("runProposeChanges (#118, step 3)", () => {
  it("shows each change with the app's sentence, its card as after Confirm, and a bar; writes nothing", async () => {
    const outcome = await propose(FIXTURE_CHANGES);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(validatePayload(outcome.messages)).toEqual({ ok: true });
    expect(outcome.summary).toBe(
      "Shown to the user to confirm; nothing changes until they press Confirm on a card: " +
        "1. Change “Call the plumber”: on 2026-11-26 at 10:00 (was not on the Clock). " +
        "2. Create the task “File taxes”, important, due 2027-04-01.",
    );
    expect(outcome.changes.map((c) => c.tool)).toEqual(["update_task", "create_task"]);
    expect(outcome.changes[0]!.taskChanges).toEqual([{ taskId: "t3", set: { scheduledDay: "2026-11-26", scheduledTime: "10:00" } }]);
    // The key of a create is the server's; a target-state change needs none.
    expect(outcome.changes[0]!.arguments).not.toHaveProperty("idempotencyKey");
    expect(outcome.changes[1]!.arguments).toMatchObject({ title: "File taxes", idempotencyKey: "proposal-0f1e2d3c-fixed", proposal: expect.any(String) });
    expect(outcome.changes[1]).toMatchObject({ createsTitle: "File taxes", touches: ["tasks"] });
    // The card of the updated task is drawn from the result's own reads; the new task has none.
    const json = JSON.stringify(outcome.messages);
    expect(json).toContain('"taskId":"t3"');
    expect(outcome.reads.map((r) => r.name)).toEqual(["listTasks", "getCompass"]);
    // A card shows no notes: t3's notes do not travel, though task notes are shared.
    expect(JSON.stringify(outcome)).not.toContain("Ask about the boiler too");
  });

  it("builds exactly the page test's fixture (apps/web/src/mcp-app/proposal-result.fixture.json)", async () => {
    const outcome = await propose(FIXTURE_CHANGES);
    if (!outcome.ok) throw new Error(outcome.error);
    const fixture = JSON.parse(readFileSync(new URL("../../../../apps/web/src/mcp-app/proposal-result.fixture.json", import.meta.url), "utf8"));
    expect(fixture).toEqual({
      content: [{ type: "text", text: outcome.summary }],
      structuredContent: { messages: outcome.messages, reads: outcome.reads, changes: outcome.changes },
    });
  });

  it("refuses what may not be proposed and failed checks with the reason, and shows the rest", async () => {
    const outcome = await propose([
      { operation: "deleteTask", input: { taskId: "t1" } },
      { operation: "setBigRock", input: { taskId: "t3", bigRock: true } },
      { operation: "setHabitDone", input: { habitId: "h1", done: true, day: "2026-11-21" } },
      { operation: "scheduleTask", input: { taskId: "nope", day: "2026-11-23" } },
      { operation: "set_habit_done", input: { habitId: "h1", done: true } },
    ]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.changes.map((c) => c.sentence)).toEqual(["Check off “Morning run” for today"]);
    expect(outcome.summary).toContain("Not shown: 1. deleteTask: this cannot be proposed");
    expect(outcome.summary).toContain("2. setBigRock: “Call the plumber” is not in Quadrant II");
    expect(outcome.summary).toContain("3. setHabitDone: That day is still to come");
    expect(outcome.summary).toContain("4. scheduleTask: That task no longer exists.");
    // No task cards: no task reads travel.
    expect(outcome.reads).toEqual([]);
  });

  it("refuses invalid input to the tool itself and nothing shown at all", async () => {
    expect(await runProposeChanges({ changes: [] }, fakeServices(), ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid arguments/) });
    expect(await propose([{ operation: "deleteTask", input: { taskId: "t1" } }])).toMatchObject({ ok: false, error: expect.stringMatching(/^Nothing was shown\./) });
  });

  it("follows the data switches: the change's own category, the items it names, and notes behind their own switch", async () => {
    expect(await propose([{ operation: "setTaskDone", input: { taskId: "t1", done: true } }], off("tasks"))).toMatchObject({ ok: false });
    // A goal the model may not read cannot be named in a change either.
    expect(await propose([{ operation: "createTask", input: { title: "Dig", goalId: "g1" } }], off("goalsAndProjects"))).toMatchObject({
      ok: false,
      error: "Nothing was shown. 1. createTask: This changes data the user has not shared with AI.",
    });
    // Bank-account notes are off by default; the entry itself may be proposed without one.
    expect(await propose([{ operation: "addEbaEntry", input: { personId: "p1", kind: "DEPOSIT", note: "Read together" } }])).toMatchObject({
      ok: false,
      error: "Nothing was shown. 1. addEbaEntry: Notes on emotional-bank-account entries are not shared with AI: leave them out.",
    });
    const entry = await propose([{ operation: "addEbaEntry", input: { personId: "p1", kind: "DEPOSIT" } }]);
    expect(entry).toMatchObject({ ok: true, changes: [{ sentence: "Add a deposit for Sam" }] });
  });

  it("never lets the notes on people or on bank-account entries out, whatever is proposed about them", async () => {
    const outcome = await propose([
      { operation: "logCommitmentOccurrence", input: { commitmentId: "c1", personId: "p1" } },
      { operation: "addEbaEntry", input: { personId: "p1", kind: "DEPOSIT" } },
    ]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.changes).toHaveLength(2);
    const json = JSON.stringify(outcome);
    expect(json).not.toContain(PERSON_NOTE);
    expect(json).not.toContain(EBA_NOTE);
  });
});

describe("writeRefusal", () => {
  it("names a note's switch when only that is off, and otherwise says the data is not shared", () => {
    const create = operation("createTask");
    expect(writeRefusal(create, { title: "x" }, { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBeNull();
    expect(writeRefusal(create, { title: "x", notes: "y" }, { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBe(
      "Notes on tasks are not shared with AI: leave them out.",
    );
    expect(writeRefusal(create, { title: "x", notes: "y" }, { ...DEFAULT_DATA_POLICY, tasks: false, taskNotes: false })).toBe(
      "This changes data the user has not shared with AI.",
    );
  });
});
