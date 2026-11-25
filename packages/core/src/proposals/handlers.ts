/**
 * Proposals in an outside MCP host (issue #118, step 3), on the server.
 *
 * - `runProposeChanges` is the `propose_changes` tool: it checks each change
 *   the host's model proposes against the server's own data (the same
 *   declaration `refs` and `check` the app runs before Confirm, under the
 *   data switches), and builds the screen the page shows: each change with
 *   the app's own sentence, its task cards as they would be after Confirm,
 *   and a ConfirmBar. It writes nothing.
 * - Each change shown carries the exact arguments the page sends back on
 *   Confirm: the input, the idempotency key of a create (made here, so the
 *   same tool result always carries the same key and a second press after a
 *   redraw finds the item made the first time), and `proposal`, the server's
 *   proof that it showed exactly this change: an HMAC over the operation,
 *   its input and its key.
 * - `runProposedOperation` is the write in the MCP App: refused without that
 *   proof or with any other change, refused when a data category it touches
 *   is switched off, and otherwise run through `runOperation`, which checks
 *   again with the data as it is now.
 *
 * The signing secret lives in memory, one per process: a proposal shown
 * before the server restarted cannot be confirmed after it (the user asks
 * again). No secret is stored and no schema is needed.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  MAX_READ_TASKS,
  PROPOSAL_ARGUMENT,
  PROPOSED_CHANGE_EVENT,
  DISMISSED_CHANGE_EVENT,
  PROPOSE_CHANGES,
  RENEWAL_DIMENSIONS,
  canonicalJson,
  checkOperation,
  mcpToolName,
  operationSentence,
  proposableOperation,
  writeCategories,
  zodErrorText,
  type A2uiMessage,
  type ActionLookup,
  type CheckData,
  type DataCategory,
  type LookupTask,
  type NamedKind,
  type OperationDeclaration,
  type OperationName,
  type TaskChange,
  type Touches,
} from "@clock-compass/assistant-catalog";
import { renderSurface } from "../assistant/render.js";
import type { DataPolicy } from "../assistant/data-policy.js";
import { zonedDay } from "../domain/zoned.js";
import { scheduledDayOf } from "../domain/scheduled-day.js";
import { runRead, type ReadContext, type ReadServices } from "../reads/handlers.js";
import { OperationError, runOperation, type OperationServices } from "../operations/handlers.js";
import type { ScreenRead } from "../screens/handlers.js";

// --- The proof -----------------------------------------------------------------

/** Signs and checks the proof that a change was shown. */
export interface ProposalSigner {
  sign(payload: string): string;
  verify(payload: string, proof: string): boolean;
}

/** A signer with its own secret (random unless given: tests pass one). */
export function createProposalSigner(secret: Buffer = randomBytes(32)): ProposalSigner {
  const mac = (payload: string) => createHmac("sha256", secret).update(payload).digest();
  return {
    sign: (payload) => mac(payload).toString("base64url"),
    verify(payload, proof) {
      const given = Buffer.from(proof, "base64url");
      const wanted = mac(payload);
      return given.length === wanted.length && timingSafeEqual(given, wanted);
    },
  };
}

let processSigner: ProposalSigner | undefined;
/** This process's signer: one secret per process, shared by every MCP session in it. */
export function processProposalSigner(): ProposalSigner {
  processSigner ??= createProposalSigner();
  return processSigner;
}

/** What the proof covers: the operation, its input (parsed, canonical) and its key. */
const proofPayload = (name: string, input: unknown, key: string | undefined) =>
  JSON.stringify(["clock-compass/proposal/v1", name, canonicalJson(input), key ?? null]);

// --- The data switches on a write ------------------------------------------------

export const NOT_SHARED = "This changes data the user has not shared with AI.";

/** The free-text categories with a switch of their own, as a refusal names them. */
const NOTE_WORDS: Partial<Record<DataCategory, string>> = {
  taskNotes: "Notes on tasks",
  ebaEntryNotes: "Notes on emotional-bank-account entries",
};

/**
 * Why the switches refuse this write (null: allowed). Every category it
 * touches must be on; when only a note's own switch is off, the refusal says
 * so, so the change can be made without the note.
 */
export function writeRefusal(decl: OperationDeclaration, input: Record<string, unknown>, policy: DataPolicy): string | null {
  const off = writeCategories(decl, input).filter((c) => !policy[c]);
  if (off.length === 0) return null;
  const notes = off.map((c) => NOTE_WORDS[c]);
  if (notes.every(Boolean)) return `${notes.join(" and ")} are not shared with AI: leave them out.`;
  return NOT_SHARED;
}

// --- propose_changes -----------------------------------------------------------------

/** One change the page shows, with what it needs to show and confirm it. */
export interface ProposedChange {
  /** Names the change in its ConfirmBar's events ("c0", "c1", …). */
  id: string;
  operation: OperationName;
  /** The MCP tool the page calls on Confirm. */
  tool: string;
  /** The app's own sentence for the change. */
  sentence: string;
  /** Exactly what the page sends on Confirm: the input, the create's key, the proof. */
  arguments: Record<string, unknown>;
  /** The tasks it changes and what it sets on each (the cards show them as after Confirm). */
  taskChanges: TaskChange[];
  /** What the page reads again after Confirm. */
  touches: readonly Touches[];
  /** A create: the title of what it makes, for "Done: created …" before any read. */
  createsTitle?: string;
}

export type ProposalOutcome =
  | {
      ok: true;
      summary: string;
      messages: A2uiMessage[];
      reads: ScreenRead[];
      changes: ProposedChange[];
    }
  | { ok: false; error: string };

export interface ProposalContext extends ReadContext {
  signer: ProposalSigner;
  /** A fresh random id, for keys and the surface (default: a UUID; tests pass a fixed one). */
  randomId?: () => string;
}

/** The server's data a set of changes is checked against and described with. */
interface Loaded {
  check: CheckData;
  lookup: ActionLookup;
}

async function load(categories: Set<DataCategory>, services: ReadServices, ctx: ReadContext): Promise<Loaded> {
  const clock = { now: ctx.now, timeZone: ctx.timeZone };
  const want = (c: DataCategory) => categories.has(c) && ctx.policy[c];
  const people = want("people") || want("ebaBalance");
  const [tasks, goals, projects, roles, overview, habits, intentions, mission] = await Promise.all([
    want("tasks") ? services.tasks.list({}, clock) : undefined,
    want("goalsAndProjects") ? services.goals.list() : undefined,
    want("goalsAndProjects") ? services.projects.list() : undefined,
    want("goalsAndProjects") ? services.roles.list() : undefined,
    people ? services.people.overview(ctx.now) : undefined,
    want("habitsAndRenewal") ? services.renewal.listHabits(clock) : undefined,
    want("habitsAndRenewal") ? services.renewal.intentions(clock) : undefined,
    want("mission") ? services.mission.getActive() : undefined,
  ]);
  const commitments = overview?.flatMap((p) => p.commitments.map((c) => ({ id: c.id, title: c.title, personId: p.id })));

  const check: CheckData = {
    today: zonedDay(ctx.now, ctx.timeZone),
    ...(tasks ? { tasks } : {}),
    ...(goals ? { goals } : {}),
    ...(projects ? { projects } : {}),
    ...(roles ? { roles } : {}),
    ...(habits ? { habits } : {}),
    ...(overview ? { people: overview } : {}),
    ...(commitments
      ? {
          commitments: [...new Set(commitments.map((c) => c.id))].map((id) => ({
            id,
            personIds: commitments.filter((c) => c.id === id).map((c) => c.personId),
          })),
        }
      : {}),
  };

  const names: Record<NamedKind, (id: string) => string | undefined> = {
    task: (id) => tasks?.find((t) => t.id === id)?.title,
    habit: (id) => habits?.find((h) => h.id === id)?.name,
    goal: (id) => goals?.find((g) => g.id === id)?.title,
    project: (id) => projects?.find((p) => p.id === id)?.name,
    role: (id) => roles?.find((r) => r.id === id)?.name,
    person: (id) => overview?.find((p) => p.id === id)?.name,
    commitment: (id) => commitments?.find((c) => c.id === id)?.title,
  };
  const plain = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const lookup: ActionLookup = {
    name: (kind, id) => names[kind](id),
    pinnedTaskIds: () => (tasks ?? []).filter((t) => t.isBigRock && t.status === "TODO").map((t) => t.id),
    task: (id) => {
      const t = tasks?.find((task) => task.id === id && task.status !== "ARCHIVED");
      if (!t) return undefined;
      const rule = t.recurrence?.active ? t.recurrence : null;
      const found: LookupTask = {
        title: t.title,
        // Quoted in a sentence only when task notes are shared.
        notes: ctx.policy.taskNotes ? t.notes : null,
        important: t.important,
        urgent: t.urgent,
        proactivity: t.proactivity,
        dueDate: plain(t.dueDate),
        scheduledDay: scheduledDayOf(t.scheduledDay),
        scheduledTime: t.scheduledTime,
        projectId: t.projectId,
        goalId: t.goalId,
        repeat: rule ? { unit: rule.unit, every: rule.every, from: rule.from, leadDays: rule.leadDays } : null,
      };
      return found;
    },
    ...(mission !== undefined ? { mission: () => mission?.content ?? "" } : {}),
    ...(intentions
      ? {
          intention: (dimension: (typeof RENEWAL_DIMENSIONS)[number]) =>
            intentions.find((i) => i.dimension === dimension)?.text || undefined,
        }
      : {}),
  };
  return { check, lookup };
}

interface Candidate {
  decl: OperationDeclaration;
  input: Record<string, unknown>;
}

/**
 * The `propose_changes` tool: shows the changes it can, refuses the others
 * with the reason, writes nothing.
 */
export async function runProposeChanges(args: unknown, services: ReadServices, ctx: ProposalContext): Promise<ProposalOutcome> {
  const newId = ctx.randomId ?? randomUUID;
  const parsed = PROPOSE_CHANGES.input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments: ${zodErrorText(parsed.error)}` };
  const { changes } = parsed.data as { changes: { operation: string; input: Record<string, unknown> }[] };

  // 1. Which operation, valid input, the switches.
  const refused: string[] = [];
  const candidates: (Candidate & { n: number })[] = [];
  changes.forEach((change, i) => {
    const n = i + 1;
    const decl = proposableOperation(change.operation);
    if (!decl) return void refused.push(`${n}. ${change.operation}: this cannot be proposed (only the operations listed in propose_changes can).`);
    const input = decl.input.safeParse(change.input);
    if (!input.success) return void refused.push(`${n}. ${decl.name}: ${zodErrorText(input.error)}`);
    const data = input.data as Record<string, unknown>;
    const off = writeRefusal(decl, data, ctx.policy);
    if (off) return void refused.push(`${n}. ${decl.name}: ${off}`);
    candidates.push({ decl, input: data, n });
  });

  // 2. Checked against the server's own data, as the app checks before Confirm.
  let loaded: Loaded;
  try {
    const categories = new Set(candidates.flatMap((c) => writeCategories(c.decl, c.input)));
    loaded = await load(categories, services, ctx);
  } catch (err) {
    ctx.onError?.(PROPOSE_CHANGES.name, err);
    return { ok: false, error: "Checking those changes failed. Try again." };
  }
  const shown: ProposedChange[] = [];
  for (const { decl, input, n } of candidates) {
    const why = checkOperation(decl, input, loaded.check);
    if (why) {
      refused.push(`${n}. ${decl.name}: ${why}`);
      continue;
    }
    const key = decl.creates ? `proposal-${newId()}` : undefined;
    const proof = ctx.signer.sign(proofPayload(decl.name, input, key));
    const title = typeof input.title === "string" ? input.title : undefined;
    shown.push({
      id: `c${shown.length}`,
      operation: decl.name as OperationName,
      tool: mcpToolName(decl.name),
      sentence: operationSentence(decl, input, loaded.lookup),
      arguments: { ...input, ...(key ? { idempotencyKey: key } : {}), [PROPOSAL_ARGUMENT]: proof },
      taskChanges: decl.taskChanges?.(input, loaded.lookup) ?? [],
      touches: decl.touches,
      ...(decl.creates && title ? { createsTitle: title } : {}),
    });
  }
  if (shown.length === 0) return { ok: false, error: `Nothing was shown. ${refused.join(" ")}` };

  // 3. The screen: per change, its task cards (as after Confirm) and its bar.
  let reads: ScreenRead[] = [];
  let listed = new Set<string>();
  const cardTasks = new Set(shown.flatMap((c) => c.taskChanges.map((t) => t.taskId)));
  if (cardTasks.size && ctx.policy.tasks) {
    const taskArgs = { limit: MAX_READ_TASKS };
    const read = await runRead("listTasks", taskArgs, services, ctx);
    if (read.ok) {
      const result = read.result as { tasks: ({ id: string } & Record<string, unknown>)[] };
      // A card shows no notes, so none travel to the page, whatever the switch says.
      const tasks = result.tasks.map(({ notes: _notes, ...t }) => t);
      listed = new Set(tasks.map((t) => t.id).filter((id) => cardTasks.has(id)));
      reads = [{ name: "listTasks", args: taskArgs, result: { ...result, tasks } }];
      if (listed.size && ctx.policy.goalsAndProjects) {
        const compass = await runRead("getCompass", {}, services, ctx);
        if (compass.ok) {
          const { goals, projects } = compass.result as { goals?: unknown[]; projects?: unknown[] };
          reads.push({ name: "getCompass", args: {}, result: { goals: goals ?? [], projects: projects ?? [] } });
        }
      }
    }
  }
  if (!listed.size) reads = [];

  const components: Record<string, unknown>[] = [
    { id: "root", component: "Column", children: ["title", ...shown.map((c) => `change_${c.id}`)], align: "stretch" },
    { id: "title", component: "Text", text: shown.length === 1 ? "## Proposed change" : `## ${shown.length} proposed changes` },
  ];
  for (const change of shown) {
    const cards = [...new Set(change.taskChanges.map((t) => t.taskId))].filter((id) => listed.has(id));
    components.push(
      { id: `change_${change.id}`, component: "Card", child: `column_${change.id}` },
      { id: `column_${change.id}`, component: "Column", children: [...cards.map((_, j) => `task_${change.id}_${j}`), `bar_${change.id}`], align: "stretch" },
      ...cards.map((taskId, j) => ({ id: `task_${change.id}_${j}`, component: "TaskCard", taskId })),
      {
        id: `bar_${change.id}`,
        component: "ConfirmBar",
        confirm: { event: { name: PROPOSED_CHANGE_EVENT, context: { change: change.id } } },
        dismiss: { event: { name: DISMISSED_CHANGE_EVENT, context: { change: change.id } } },
      },
    );
  }
  const rendered = renderSurface({ surfaceId: "proposal", components }, { idSuffix: newId().slice(0, 8), confirmations: true });
  if (!rendered.ok) return { ok: false, error: `The proposal could not be drawn: ${rendered.errors.join("; ")}` };

  const words = shown.map((c, i) => `${i + 1}. ${c.sentence}.`);
  const summary = [
    `Shown to the user to confirm; nothing changes until they press Confirm on a card:`,
    ...words,
    ...(refused.length ? ["Not shown:", ...refused] : []),
  ].join(" ");
  return { ok: true, summary, messages: rendered.messages, reads, changes: shown };
}

// --- The write, from a press in the page ---------------------------------------------

export const NOT_PROPOSED =
  "Only a change shown by propose_changes and confirmed on its card can be made. This one was not shown, or the app has restarted since: propose it again.";

export interface ProposedOperationContext {
  policy: DataPolicy;
  timeZone: string;
  now: Date;
  signer: ProposalSigner;
}

export type ProposedOperationOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Runs one write in the MCP App: only a change `propose_changes` showed, with
 * the input, key and proof it showed, and only while every data category it
 * touches is switched on.
 */
export async function runProposedOperation(
  name: string,
  args: Record<string, unknown>,
  services: OperationServices,
  ctx: ProposedOperationContext,
): Promise<ProposedOperationOutcome> {
  const decl = proposableOperation(name);
  if (!decl || decl.name !== name) return { ok: false, error: NOT_PROPOSED };
  const { [PROPOSAL_ARGUMENT]: proof, idempotencyKey, ...raw } = args;
  if (typeof proof !== "string" || (idempotencyKey !== undefined && typeof idempotencyKey !== "string")) return { ok: false, error: NOT_PROPOSED };
  const parsed = decl.input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: NOT_PROPOSED };
  const input = parsed.data as Record<string, unknown>;
  if (!ctx.signer.verify(proofPayload(decl.name, input, idempotencyKey), proof)) return { ok: false, error: NOT_PROPOSED };
  // The switches as they are now: one switched off since it was shown refuses it.
  const off = writeRefusal(decl, input, ctx.policy);
  if (off) return { ok: false, error: off };
  try {
    return { ok: true, result: await runOperation(decl.name, input, services, { timeZone: ctx.timeZone, now: ctx.now, idempotencyKey }) };
  } catch (err) {
    if (err instanceof OperationError) return { ok: false, error: err.message };
    throw err;
  }
}
