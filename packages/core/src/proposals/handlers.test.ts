import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROPOSABLE, operation, validatePayload } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY, type DataPolicy } from "../assistant/data-policy.js";
import { EBA_NOTE, PERSON_NOTE, fakeServices } from "../assistant/test-fakes.js";
import { TaskService } from "../services/task-service.js";
import { FakeTaskRepository } from "../services/fake-task-repository.js";
import { runRead, type ReadServices } from "../reads/handlers.js";
import type { OperationServices } from "../operations/handlers.js";
import {
  EXPIRED,
  NOT_PROPOSED,
  NOT_SHARED,
  PROOF_LIFETIME_MS,
  SPENT_FULL,
  createProposalSigner,
  createSpentProofs,
  runProposeChanges,
  runProposedOperation,
  writeRefusal,
} from "./handlers.js";

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
        "2. Create the task “File taxes”, important, due 2027-04-01. " +
        "The user may edit a task change in its card before confirming: you are told the final values where the host passes them on; otherwise read the task again (list_tasks) before relying on a value you proposed.",
    );
    expect(outcome.changes.map((c) => c.tool)).toEqual(["update_task", "create_task"]);
    expect(outcome.changes[0]!.taskChanges).toEqual([{ taskId: "t3", set: { scheduledDay: "2026-11-26", scheduledTime: "10:00" } }]);
    // The key of a create is the server's; a target-state change needs none.
    expect(outcome.changes[0]!.arguments).not.toHaveProperty("idempotencyKey");
    expect(outcome.changes[1]!.arguments).toMatchObject({ title: "File taxes", idempotencyKey: "proposal-0f1e2d3c-fixed", proposal: expect.any(String) });
    expect(outcome.changes[1]).toMatchObject({ createsTitle: "File taxes", touches: ["tasks"] });
    // The card of the updated task is drawn from the result's own reads; the new task's from its draft.
    const json = JSON.stringify(outcome.messages);
    expect(json).toContain('"taskId":"t3"');
    expect(json).toContain('"taskId":"draft-c1"');
    expect(outcome.changes[1]!.draft).toMatchObject({ id: "draft-c1", title: "File taxes", quadrant: "Q2", dueDate: "2027-04-01" });
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
    // A note on something new is allowed with its switch off (the default for
    // bank-account notes): the model sends it, nothing stored is revealed.
    const noted = await propose([{ operation: "addEbaEntry", input: { personId: "p1", kind: "DEPOSIT", note: "Read together" } }]);
    expect(noted).toMatchObject({ ok: true });
    if (noted.ok) {
      expect(noted.changes[0]!.sentence).toContain("Read together");
      expect(JSON.stringify(noted)).not.toContain(EBA_NOTE);
    }
    expect(await propose([{ operation: "createTask", input: { title: "Dig", notes: "by the shed" } }], off("taskNotes"))).toMatchObject({ ok: true });
    // Replacing a task's notes the model may not read is refused: the old text could not be shown.
    expect(await propose([{ operation: "updateTask", input: { taskId: "t1", notes: "new" } }], off("taskNotes"))).toMatchObject({
      ok: false,
      error: "Nothing was shown. 1. updateTask: Notes on tasks are not shared with AI: leave them out.",
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
    const update = operation("updateTask");
    // A note on a new task is allowed with task notes off; replacing one is not.
    expect(writeRefusal(create, { title: "x", notes: "y" }, { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBeNull();
    expect(writeRefusal(update, { taskId: "t1", title: "x" }, { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBeNull();
    expect(writeRefusal(update, { taskId: "t1", notes: "y" }, { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBe(
      "Notes on tasks are not shared with AI: leave them out.",
    );
    expect(writeRefusal(update, { taskId: "t1", notes: "y" }, { ...DEFAULT_DATA_POLICY, tasks: false, taskNotes: false })).toBe(
      "This changes data the user has not shared with AI.",
    );
  });
});

// --- #159: an editable card, guard option A ------------------------------------------

/** The fake reads over real task services in memory, with goal g1 and project pr1 to link to. */
function writeServices() {
  const fake = fakeServices();
  const goals = { ...fake.goals, get: async (id: string) => (await fake.goals.list()).find((g) => g.id === id) ?? null };
  const projects = { ...fake.projects, get: async (id: string) => (await fake.projects.list()).find((p) => p.id === id) ?? null };
  return { ...fake, tasks: new TaskService(new FakeTaskRepository()), goals, projects } as unknown as ReadServices & OperationServices;
}

describe("editing a proposed task in the card (#159, option A)", () => {
  const writeCtx = (c = ctx) => ({ policy: c.policy, now: c.now, timeZone: c.timeZone, signer: c.signer });

  // A fresh id per call, as in a real server: each create has a key (and so a proof) of its own.
  let n = 0;
  const fresh = () => `id-${++n}-0000-0000`;
  async function shown(services: ReadServices & OperationServices, change: { operation: string; input: Record<string, unknown> }, c = { ...ctx, signer: createProposalSigner(Buffer.alloc(32, 9)) }) {
    const outcome = await runProposeChanges({ changes: [change] }, services, { ...c, randomId: fresh });
    if (!outcome.ok) throw new Error(outcome.error);
    return { change: outcome.changes[0]!, outcome, c };
  }
  const confirm = (services: OperationServices, name: string, args: Record<string, unknown>, c: typeof ctx) =>
    runProposedOperation(name, args, services, writeCtx(c));

  it("a new task gets a draft card in the read tools' shape, with the goals and projects for its pickers", async () => {
    const services = writeServices();
    const { change, outcome } = await shown(services, { operation: "createTask", input: { title: "File taxes", important: true, dueDate: "2027-04-01" } });
    expect(change.draft).toEqual({
      id: "draft-c0",
      title: "File taxes",
      quadrant: "Q2",
      important: true,
      urgent: false,
      status: "TODO",
      proactivity: null,
      isBigRock: false,
      dueDate: "2027-04-01",
      scheduledDay: null,
      scheduledTime: null,
      goalId: null,
      projectId: null,
      completedAt: null,
      repeat: null,
      later: false,
      showFrom: null,
    });
    expect(JSON.stringify(outcome.messages)).toContain('"taskId":"draft-c0"');
    expect(outcome.reads.map((r) => r.name)).toEqual(["getCompass"]);
    expect(outcome.summary).toContain("The user may edit a task change in its card before confirming");
    // With goals and projects off, no compass travels.
    const { outcome: dark } = await shown(services, { operation: "createTask", input: { title: "File taxes" } }, { ...off("goalsAndProjects"), signer });
    expect(dark.reads).toEqual([]);
  });

  it("an update carries the task as the server's sentence compared it", async () => {
    const { change } = await shown(fakeServices() as unknown as ReadServices & OperationServices, { operation: "updateTask", input: { taskId: "t3", urgent: false } });
    expect(change.current).toMatchObject({ title: "Call the plumber", urgent: true, notes: null });
    // Its notes travel only when the change replaces them, and only as far as the sentence quotes them.
    const { change: notes } = await shown(fakeServices() as unknown as ReadServices & OperationServices, { operation: "updateTask", input: { taskId: "t3", notes: "Also the tap" } });
    expect(notes.current).toMatchObject({ notes: "Ask about the boiler too" });
    expect(notes.sentence).toContain("replace its notes “Ask about the boiler too” with “Also the tap”");
  });

  it("accepts the shown change with its open fields edited to valid values, and answers with the task as list_tasks shows it", async () => {
    const services = writeServices();
    const { change, c } = await shown(services, { operation: "createTask", input: { title: "File taxes", important: true, notes: "Box 3" } });
    const edited = { ...change.arguments, title: "File the taxes", urgent: true, dueDate: "2027-04-02", scheduledDay: "2027-03-30", scheduledTime: "09:00", projectId: "pr1", goalId: "g1", proactivity: "INFLUENCE" };
    const outcome = await confirm(services, "createTask", edited, c);
    if (!outcome.ok) throw new Error(outcome.error);
    const result = outcome.result as { changed: number; id: string; tasks: Record<string, unknown>[] };
    expect(result).toMatchObject({ changed: 1 });
    const made = await services.tasks.get(result.id);
    expect(made).toMatchObject({ title: "File the taxes", urgent: true, projectId: "pr1", goalId: "g1", proactivity: "INFLUENCE", scheduledTime: "09:00", notes: "Box 3" });
    // The read tools' own view, without notes.
    const read = await runRead("listTasks", {}, services, ctx);
    const listed = ((read as { result: { tasks: Record<string, unknown>[] } }).result.tasks.find((t) => t.id === result.id)!);
    const { notes: _notes, ...withoutNotes } = listed;
    expect(result.tasks).toEqual([withoutNotes]);
    expect(JSON.stringify(result)).not.toContain("Box 3");
  });

  it("the task in the answer follows the data switches, as list_tasks does (goals and projects off)", async () => {
    const services = writeServices();
    const dark = { ...off("goalsAndProjects"), signer: createProposalSigner(Buffer.alloc(32, 3)) };
    const made = await services.tasks.create({ title: "Old title", important: true, urgent: false, goalId: "g1", projectId: "pr1" });
    const { change } = await shown(services, { operation: "updateTask", input: { taskId: made.id, title: "New title" } }, dark);
    const outcome = await confirm(services, "updateTask", change.arguments, dark);
    if (!outcome.ok) throw new Error(outcome.error);
    const read = (await runRead("listTasks", {}, services, dark)) as { result: { tasks: Record<string, unknown>[] } };
    const { notes: _n, ...listed } = read.result.tasks.find((t) => t.id === made.id)!;
    expect((outcome.result as { tasks: unknown[] }).tasks).toEqual([listed]);
    // And no goal or project title travels with it.
    expect(JSON.stringify(outcome.result)).not.toMatch(/Grow our own vegetables|Garden makeover/);
  });

  it("refuses a changed closed field, another item, another operation and another key", async () => {
    const services = writeServices();
    const made = await services.tasks.create({ title: "Call the plumber", important: true, urgent: false, notes: "Boiler" });
    const { change, c } = await shown(services, { operation: "updateTask", input: { taskId: made.id, urgent: true, notes: "Boiler and tap" } });
    const other = await services.tasks.create({ title: "Other", important: false, urgent: false });
    const refused = async (name: string, args: Record<string, unknown>) =>
      expect(await confirm(services, name, args, c), JSON.stringify(args)).toEqual({ ok: false, error: NOT_PROPOSED });
    await refused("updateTask", { ...change.arguments, taskId: other.id });
    await refused("updateTask", { ...change.arguments, notes: "Something else" });
    await refused("updateTask", { ...change.arguments, repeat: { unit: "WEEK" }, dueDate: "2027-01-01" });
    const { notes: _notes, ...withoutNotes } = change.arguments;
    await refused("updateTask", withoutNotes);
    await refused("createTask", { title: "x", proposal: change.arguments.proposal });
    await refused("setTaskDone", { taskId: made.id, done: true, proposal: change.arguments.proposal });
    const { change: create, c: c2 } = await shown(services, { operation: "createTask", input: { title: "File taxes" } });
    expect(await confirm(services, "createTask", { ...create.arguments, idempotencyKey: "model-chosen-key-1" }, c2)).toEqual({ ok: false, error: NOT_PROPOSED });
    expect(await confirm(services, "createTask", { ...create.arguments, notes: "added" }, c2)).toEqual({ ok: false, error: NOT_PROPOSED });
    // An operation that cannot be edited still needs its exact input.
    const { change: done, c: c3 } = await shown(services, { operation: "setTaskDone", input: { taskId: made.id, done: true } });
    expect(await confirm(services, "setTaskDone", { ...done.arguments, done: false }, c3)).toEqual({ ok: false, error: NOT_PROPOSED });
    expect((await services.tasks.get(made.id))).toMatchObject({ notes: "Boiler", urgent: false, status: "TODO" });
    expect((await services.tasks.list({})).map((t) => t.title).sort()).toEqual(["Call the plumber", "Other"]);
  });

  it("refuses open fields edited to invalid values with the operation's own reason, and the proof stays usable", async () => {
    const services = writeServices();
    const made = await services.tasks.create({ title: "Call the plumber", important: true, urgent: false });
    const { change, c } = await shown(services, { operation: "updateTask", input: { taskId: made.id, urgent: true } });
    expect(await confirm(services, "updateTask", { ...change.arguments, projectId: "nope" }, c)).toEqual({ ok: false, error: "That project no longer exists." });
    expect(await confirm(services, "updateTask", { ...change.arguments, scheduledDay: null, scheduledTime: "09:00" }, c)).toEqual({
      ok: false,
      error: "This cannot be saved: a time needs a day.",
    });
    expect(await confirm(services, "updateTask", { ...change.arguments, title: "  " }, c)).toEqual({ ok: false, error: "This cannot be saved: a task needs a title." });
    expect((await services.tasks.get(made.id))?.urgent).toBe(false);
    // A refused write did not spend the proof.
    expect(await confirm(services, "updateTask", { ...change.arguments, projectId: "pr1" }, c)).toMatchObject({ ok: true, result: { changed: 1 } });
    expect(await services.tasks.get(made.id)).toMatchObject({ urgent: true, projectId: "pr1" });
  });

  it("applies the data switches to edited values: a project chosen while goals and projects are off is refused", async () => {
    const services = writeServices();
    const { change, c } = await shown(services, { operation: "createTask", input: { title: "File taxes" } });
    const dark = { ...c, policy: { ...DEFAULT_DATA_POLICY, goalsAndProjects: false } };
    expect(await confirm(services, "createTask", { ...change.arguments, projectId: "pr1" }, dark)).toEqual({ ok: false, error: NOT_SHARED });
    expect(await services.tasks.list({})).toEqual([]);
  });

  it("accepts a proof once: a second use answers the first result and writes nothing", async () => {
    const services = writeServices();
    const made = await services.tasks.create({ title: "Call the plumber", important: true, urgent: false });
    const { change, c } = await shown(services, { operation: "updateTask", input: { taskId: made.id, title: "Call the plumber today" } });
    const first = await confirm(services, "updateTask", change.arguments, c);
    expect(first).toMatchObject({ ok: true, result: { changed: 1 } });
    const again = await confirm(services, "updateTask", { ...change.arguments, title: "Something else" }, c);
    expect(again).toEqual({ ok: true, result: { ...(first as { result: object }).result, changed: 0 } });
    expect((await services.tasks.get(made.id))?.title).toBe("Call the plumber today");
  });

  it("a create edited twice and confirmed twice makes one task", async () => {
    const services = writeServices();
    const { change, c } = await shown(services, { operation: "createTask", input: { title: "File taxes" } });
    const [a, b] = await Promise.all([
      confirm(services, "createTask", { ...change.arguments, title: "File taxes now" }, c),
      confirm(services, "createTask", { ...change.arguments, title: "File taxes later" }, c),
    ]);
    expect(a).toMatchObject({ ok: true, result: { changed: 1 } });
    expect(b).toMatchObject({ ok: true, result: { changed: 0, id: (a as { result: { id: string } }).result.id } });
    expect((await services.tasks.list({})).map((t) => t.title)).toEqual(["File taxes now"]);
  });

  it("refuses a proof after 24 hours, and one dated ahead of the server's clock", async () => {
    const services = writeServices();
    const { change, c } = await shown(services, { operation: "createTask", input: { title: "File taxes" } });
    const at = (ms: number) => ({ ...c, now: new Date(ctx.now.getTime() + ms) });
    expect(await confirm(services, "createTask", change.arguments, at(PROOF_LIFETIME_MS + 1000))).toEqual({ ok: false, error: EXPIRED });
    expect(await confirm(services, "createTask", change.arguments, at(-10 * 60 * 1000))).toEqual({ ok: false, error: NOT_PROPOSED });
    expect(await services.tasks.list({})).toEqual([]);
    expect(await confirm(services, "createTask", change.arguments, at(PROOF_LIFETIME_MS - 1000))).toMatchObject({ ok: true });
  });

  it("a full spent list refuses a new Confirm until the oldest expire, and never forgets a proof early", async () => {
    const services = writeServices();
    const small = { ...ctx, signer: createProposalSigner(Buffer.alloc(32, 4), createSpentProofs(1)) };
    const one = await shown(services, { operation: "createTask", input: { title: "One" } }, small);
    const two = await shown(services, { operation: "createTask", input: { title: "Two" } }, small);
    expect(await confirm(services, "createTask", one.change.arguments, small)).toMatchObject({ ok: true });
    expect(await confirm(services, "createTask", two.change.arguments, small)).toEqual({ ok: false, error: SPENT_FULL });
    // The first stays spent while it lives.
    expect(await confirm(services, "createTask", one.change.arguments, small)).toMatchObject({ ok: true, result: { changed: 0 } });
    expect(small.signer.spent.size).toBe(1);
    // A proof shown later than the first one expired: the list has room again.
    const next = { ...small, now: new Date(ctx.now.getTime() + PROOF_LIFETIME_MS + 1000) };
    const three = await shown(services, { operation: "createTask", input: { title: "Three" } }, next);
    expect(await confirm(services, "createTask", three.change.arguments, next)).toMatchObject({ ok: true, result: { changed: 1 } });
    expect((await services.tasks.list({})).map((t) => t.title).sort()).toEqual(["One", "Three"]);
  });
});
