/**
 * Proposals in an outside MCP host (issue #118, step 3), on the server.
 *
 * - `runProposeChanges` is the `propose_changes` tool: it checks each change
 *   the host's model proposes against the server's own data (the same
 *   declaration `refs` and `check` the app runs before Confirm, under the
 *   data switches), and builds the screen the page shows: each change with
 *   the app's own sentence, its task cards as they would be after Confirm,
 *   and a ConfirmBar. It writes nothing.
 * - Each change shown carries the arguments the page sends back on Confirm:
 *   the input, the idempotency key of a create (made here, so the same tool
 *   result always carries the same key and a second press after a redraw
 *   finds the item made the first time), and `proposal`, the server's proof
 *   that it showed this change.
 * - The proof (v2, owner decision on #159, option A) is an HMAC over the
 *   operation, when it was made, a nonce, the create's key, every argument
 *   the user may NOT edit (the closed fields: for a task change, the task's
 *   id, its notes and its repeat rule), and the names of the fields the user
 *   may edit in the card (`editableFields`: none for most operations, so
 *   for them it covers the exact input, as before).
 * - `runProposedOperation` is the write in the MCP App: refused without a
 *   valid proof, with any closed field changed, after 24 hours, or when a
 *   data category it touches is switched off; the open fields are checked
 *   like any input (schema, the items they name, the operation's checks)
 *   by `runOperation`, with the data as it is now. A proof is accepted
 *   once: a second use answers with the first result and writes nothing.
 * - The write's answer carries the tasks it changed, built by the read
 *   tools' own `taskView` under the data switches (without notes), so the
 *   page redraws its cards from it with no second call through the host.
 *
 * The signing secret and the list of spent proofs live in memory, one per
 * process: a proposal shown before the server restarted cannot be confirmed
 * after it (the user asks again). Nothing is stored and no schema is needed.
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
  draftTaskId,
  editableFields,
  mcpToolName,
  operationSentence,
  proposableOperation,
  sentenceNotes,
  writeCategories,
  zodErrorText,
  type A2uiMessage,
  type ActionLookup,
  type CheckData,
  type DataCategory,
  type LookupTask,
  type NamedKind,
  type RepeatRule,
  type OperationDeclaration,
  type OperationName,
  type TaskChange,
  type Touches,
} from "@clock-compass/assistant-catalog";
import { renderSurface } from "../assistant/render.js";
import type { DataPolicy } from "../assistant/data-policy.js";
import { zonedDay } from "../domain/zoned.js";
import { scheduledDayOf } from "../domain/scheduled-day.js";
import { deriveQuadrant } from "../domain/quadrant.js";
import { runRead, taskView, type ReadContext, type ReadServices } from "../reads/handlers.js";
import { OperationError, runOperation, type OperationServices } from "../operations/handlers.js";
import type { ScreenRead } from "../screens/handlers.js";

// --- The proof -----------------------------------------------------------------

/** A proof is accepted for this long after the change was shown (owner decision on #159). */
export const PROOF_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** A proof made later than this ahead of the server's clock is refused (a clock set back). */
const PROOF_CLOCK_SLACK_MS = 5 * 60 * 1000;
/**
 * Most spent proofs remembered at once. A proof is remembered until it
 * expires (24 hours), so this is the most changes confirmed in one day; when
 * it is full, a new Confirm is refused (with SPENT_FULL) until the oldest
 * expire, rather than forgetting a proof that could then be used again.
 */
export const MAX_SPENT_PROOFS = 5000;

/** The proofs already used, with the outcome of their first use (in memory, with the secret). */
export interface SpentProofs {
  /**
   * Runs `write` for a proof not used yet and remembers its outcome until
   * `expiresAt`; for a proof already used (or in use), answers its first
   * outcome without running anything (`reused`). A failed write is
   * forgotten, so the user can confirm again. `full`: nothing was run.
   */
  use(
    id: string,
    expiresAt: number,
    now: number,
    write: () => Promise<ProposedOperationOutcome>,
  ): { reused: boolean; outcome: Promise<ProposedOperationOutcome> } | { full: true };
  readonly size: number;
}

export function createSpentProofs(max = MAX_SPENT_PROOFS): SpentProofs {
  const spent = new Map<string, { expiresAt: number; outcome: Promise<ProposedOperationOutcome> }>();
  return {
    use(id, expiresAt, now, write) {
      const first = spent.get(id);
      if (first) return { reused: true, outcome: first.outcome };
      for (const [key, entry] of spent) if (entry.expiresAt <= now) spent.delete(key);
      if (spent.size >= max) return { full: true };
      const forget = () => void (spent.get(id)?.outcome === outcome && spent.delete(id));
      const outcome = write().then(
        (result) => {
          if (!result.ok) forget();
          return result;
        },
        (err: unknown) => {
          forget();
          throw err;
        },
      );
      spent.set(id, { expiresAt, outcome });
      return { reused: false, outcome };
    },
    get size() {
      return spent.size;
    },
  };
}

/** Signs and checks the proof that a change was shown, and remembers the proofs used. */
export interface ProposalSigner {
  sign(payload: string): string;
  verify(payload: string, proof: string): boolean;
  readonly spent: SpentProofs;
}

/** A signer with its own secret (random unless given: tests pass one) and its own spent list. */
export function createProposalSigner(secret: Buffer = randomBytes(32), spent: SpentProofs = createSpentProofs()): ProposalSigner {
  const mac = (payload: string) => createHmac("sha256", secret).update(payload).digest();
  return {
    sign: (payload) => mac(payload).toString("base64url"),
    verify(payload, proof) {
      const given = Buffer.from(proof, "base64url");
      const wanted = mac(payload);
      return given.length === wanted.length && timingSafeEqual(given, wanted);
    },
    spent,
  };
}

let processSigner: ProposalSigner | undefined;
/** This process's signer: one secret per process, shared by every MCP session in it. */
export function processProposalSigner(): ProposalSigner {
  processSigner ??= createProposalSigner();
  return processSigner;
}

/** The input without the fields the user may edit: what the proof fixes. */
function closedPart(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const open = new Set<string>(editableFields(name));
  return Object.fromEntries(Object.entries(input).filter(([field]) => !open.has(field)));
}

/** What the proof covers (v2, #159): see the top of this file. */
const proofPayload = (name: string, issued: number, nonce: string, input: Record<string, unknown>, key: string | undefined) =>
  JSON.stringify(["clock-compass/proposal/v2", name, issued, nonce, key ?? null, canonicalJson(closedPart(name, input)), editableFields(name)]);

/** The proof as the page sends it back: "v2.<made, seconds, base 36>.<nonce>.<HMAC>". */
function issueProof(signer: ProposalSigner, name: string, input: Record<string, unknown>, key: string | undefined, now: Date, randomId: () => string): string {
  const issued = Math.floor(now.getTime() / 1000);
  const nonce = randomId().replace(/[^0-9A-Za-z]/g, "").slice(0, 16);
  return ["v2", issued.toString(36), nonce, signer.sign(proofPayload(name, issued, nonce, input, key))].join(".");
}

type ProofCheck = { ok: true; id: string; expiresAt: number } | { ok: false; error: string };

function checkProof(signer: ProposalSigner, proof: string, name: string, input: Record<string, unknown>, key: string | undefined, now: Date): ProofCheck {
  const [version, made, nonce, mac, ...rest] = proof.split(".");
  if (version !== "v2" || !made || !nonce || !mac || rest.length || !/^[0-9a-z]{1,11}$/.test(made)) return { ok: false, error: NOT_PROPOSED };
  const issued = parseInt(made, 36);
  if (!signer.verify(proofPayload(name, issued, nonce, input, key), mac)) return { ok: false, error: NOT_PROPOSED };
  const at = issued * 1000;
  if (at > now.getTime() + PROOF_CLOCK_SLACK_MS) return { ok: false, error: NOT_PROPOSED };
  if (now.getTime() - at > PROOF_LIFETIME_MS) return { ok: false, error: EXPIRED };
  return { ok: true, id: mac, expiresAt: at + PROOF_LIFETIME_MS };
}

// --- The data switches on a write ------------------------------------------------

export const NOT_SHARED = "This changes data the user has not shared with AI.";

/** The free-text categories with a switch of their own, as a refusal names them. */
const NOTE_WORDS: Partial<Record<DataCategory, string>> = {
  taskNotes: "Notes on tasks",
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
  /**
   * A createTask: the task as it would be made, in the read tools' shape,
   * under the placeholder id `draft-<change id>`, so the page draws it as
   * the app's own card (#159). Not a task: nothing is made before Confirm.
   */
  draft?: DraftTask;
  /**
   * An updateTask: the task as the server's sentence compared it, so the page
   * words an edited change exactly as the server would (#159). Its notes only
   * when the change replaces them, and then only what the sentence quotes.
   */
  current?: LookupTask;
}

/** A proposed new task as the read tools show a task (`taskView`, without notes). */
export interface DraftTask {
  id: string;
  title: string;
  quadrant: string;
  important: boolean;
  urgent: boolean;
  status: "TODO";
  proactivity: "INFLUENCE" | "CONCERN" | null;
  isBigRock: false;
  dueDate: string | null;
  scheduledDay: string | null;
  scheduledTime: string | null;
  goalId: string | null;
  projectId: string | null;
  completedAt: null;
  repeat: RepeatRule | null;
  later: boolean;
  showFrom: string | null;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The task a createTask would make, as a card draws it (the server works out the same on Confirm). */
function draftOf(id: string, input: Record<string, unknown>, today: string): DraftTask {
  const text = (field: string) => (typeof input[field] === "string" ? (input[field] as string) : null);
  const important = input.important === true;
  const urgent = input.urgent === true;
  const raw = input.repeat as { unit: RepeatRule["unit"]; every?: number; from?: RepeatRule["from"]; leadDays?: number | null } | undefined;
  const repeat: RepeatRule | null = raw ? { unit: raw.unit, every: raw.every ?? 1, from: raw.from ?? "SCHEDULE", leadDays: raw.leadDays ?? null } : null;
  const slot = text("dueDate") ?? text("scheduledDay");
  const showFrom = repeat?.leadDays != null && slot ? addDays(slot, -repeat.leadDays) : null;
  return {
    id,
    title: text("title") ?? "",
    quadrant: deriveQuadrant({ important, urgent }),
    important,
    urgent,
    status: "TODO",
    proactivity: (text("proactivity") as DraftTask["proactivity"]) ?? null,
    isBigRock: false,
    dueDate: text("dueDate"),
    scheduledDay: text("scheduledDay"),
    scheduledTime: text("scheduledTime"),
    goalId: text("goalId"),
    projectId: text("projectId"),
    completedAt: null,
    repeat,
    later: showFrom !== null && showFrom > today,
    showFrom,
  };
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
    const proof = issueProof(ctx.signer, decl.name, input, key, ctx.now, newId);
    const title = typeof input.title === "string" ? input.title : undefined;
    const id = `c${shown.length}`;
    const found = decl.name === "updateTask" ? loaded.lookup.task?.(input.taskId as string) : undefined;
    // The notes only when this change replaces them, and only what its sentence quotes.
    const current = found && { ...found, ...(input.notes !== undefined ? sentenceNotes(found.notes) : { notes: null }) };
    shown.push({
      id,
      operation: decl.name as OperationName,
      tool: mcpToolName(decl.name),
      sentence: operationSentence(decl, input, loaded.lookup),
      arguments: { ...input, ...(key ? { idempotencyKey: key } : {}), [PROPOSAL_ARGUMENT]: proof },
      taskChanges: decl.taskChanges?.(input, loaded.lookup) ?? [],
      touches: decl.touches,
      ...(decl.creates && title ? { createsTitle: title } : {}),
      ...(decl.name === "createTask" ? { draft: draftOf(draftTaskId(id), input, loaded.check.today!) } : {}),
      ...(current ? { current } : {}),
    });
  }
  if (shown.length === 0) return { ok: false, error: `Nothing was shown. ${refused.join(" ")}` };

  // 3. The screen: per change, its task cards (as after Confirm) and its bar.
  // A new task's card is drawn from its draft; the page needs the goals and
  // projects for every card (the names, and the pickers of an editable one).
  const reads: ScreenRead[] = [];
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
      if (listed.size) reads.push({ name: "listTasks", args: taskArgs, result: { ...result, tasks } });
    }
  }
  const drafts = shown.filter((c) => c.draft);
  if ((listed.size || drafts.length) && ctx.policy.goalsAndProjects) {
    const compass = await runRead("getCompass", {}, services, ctx);
    if (compass.ok) {
      const { goals, projects } = compass.result as { goals?: unknown[]; projects?: unknown[] };
      reads.push({ name: "getCompass", args: {}, result: { goals: goals ?? [], projects: projects ?? [] } });
    }
  }

  const components: Record<string, unknown>[] = [
    { id: "root", component: "Column", children: ["title", ...shown.map((c) => `change_${c.id}`)], align: "stretch" },
    { id: "title", component: "Text", text: shown.length === 1 ? "## Proposed change" : `## ${shown.length} proposed changes` },
  ];
  for (const change of shown) {
    const cards = change.draft ? [change.draft.id] : [...new Set(change.taskChanges.map((t) => t.taskId))].filter((id) => listed.has(id));
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
    ...(shown.some((c) => editableFields(c.operation).length)
      ? [
          "The user may edit a task change in its card before confirming: you are told the final values where the host passes them on; otherwise read the task again (list_tasks) before relying on a value you proposed.",
        ]
      : []),
  ].join(" ");
  return { ok: true, summary, messages: rendered.messages, reads, changes: shown };
}

// --- The write, from a press in the page ---------------------------------------------

// Read by the user, under the card whose Confirm they pressed: no tool names.
export const NOT_PROPOSED =
  "This change can no longer be confirmed here: it is not one the app showed, or the app has restarted since it was shown. Ask for it again.";
export const EXPIRED = "This change was shown more than a day ago and can no longer be confirmed here. Ask for it again.";
export const SPENT_FULL = "Too many changes were confirmed in the last day to confirm another now. Try again later.";

export interface ProposedOperationContext {
  policy: DataPolicy;
  timeZone: string;
  now: Date;
  signer: ProposalSigner;
}

export type ProposedOperationOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** The services a write in the page needs: the operations', and the tasks to answer with. */
export type ProposedOperationServices = OperationServices;

/**
 * Runs one write in the MCP App: only a change `propose_changes` showed, with
 * its closed fields, key and proof as shown and its open fields valid, within
 * a day of being shown, once, and only while every data category it touches
 * is switched on. The answer is the operation's result plus `tasks`: the
 * tasks it changed as `list_tasks` shows them, without notes.
 */
export async function runProposedOperation(
  name: string,
  args: Record<string, unknown>,
  services: ProposedOperationServices,
  ctx: ProposedOperationContext,
): Promise<ProposedOperationOutcome> {
  const decl = proposableOperation(name);
  if (!decl || decl.name !== name) return { ok: false, error: NOT_PROPOSED };
  const { [PROPOSAL_ARGUMENT]: proof, idempotencyKey, ...raw } = args;
  if (typeof proof !== "string" || (idempotencyKey !== undefined && typeof idempotencyKey !== "string")) return { ok: false, error: NOT_PROPOSED };
  const parsed = decl.input.safeParse(raw);
  if (!parsed.success) {
    // An edited field the operation refuses says why; anything else was not shown.
    return editableFields(decl.name).length ? { ok: false, error: `This cannot be saved: ${parsed.error.issues[0]?.message ?? "invalid values"}.` } : { ok: false, error: NOT_PROPOSED };
  }
  const input = parsed.data as Record<string, unknown>;
  const checked = checkProof(ctx.signer, proof, decl.name, input, idempotencyKey, ctx.now);
  if (!checked.ok) return checked;
  // The switches as they are now, on the values sent (edited ones too): one
  // switched off since it was shown refuses it.
  const off = writeRefusal(decl, input, ctx.policy);
  if (off) return { ok: false, error: off };

  const used = ctx.signer.spent.use(checked.id, checked.expiresAt, ctx.now.getTime(), () => write(decl, input, idempotencyKey, services, ctx));
  if ("full" in used) return { ok: false, error: SPENT_FULL };
  const outcome = await used.outcome;
  // A second use: the first result, and nothing written.
  if (used.reused && outcome.ok) return { ok: true, result: { ...(outcome.result as Record<string, unknown>), changed: 0 } };
  return outcome;
}

async function write(
  decl: OperationDeclaration,
  input: Record<string, unknown>,
  idempotencyKey: string | undefined,
  services: ProposedOperationServices,
  ctx: ProposedOperationContext,
): Promise<ProposedOperationOutcome> {
  const clock = { now: ctx.now, timeZone: ctx.timeZone };
  const tasksTouched = decl.touches.includes("tasks");
  // A week plan unpins the rocks it leaves out: they are among the tasks it changed.
  const pinnedBefore =
    tasksTouched && decl.name === "acceptWeekPlan"
      ? (await services.tasks.list({ status: "TODO" }, clock)).filter((t) => t.isBigRock).map((t) => t.id)
      : [];
  let result: unknown;
  try {
    result = await runOperation(decl.name, input, services, { timeZone: ctx.timeZone, now: ctx.now, idempotencyKey });
  } catch (err) {
    if (err instanceof OperationError) return { ok: false, error: err.message };
    throw err;
  }
  if (!tasksTouched) return { ok: true, result };
  const created = decl.creates === "task" ? (result as { id?: unknown }).id : undefined;
  const ids = new Set<string>([
    ...(typeof input.taskId === "string" ? [input.taskId] : []),
    ...(Array.isArray(input.taskIds) ? (input.taskIds as string[]) : []),
    ...(typeof created === "string" ? [created] : []),
    ...pinnedBefore,
  ]);
  const found = await Promise.all([...ids].map((id) => services.tasks.get(id, clock)));
  // The read tools' own view under the switches; a card shows no notes.
  const tasks = found.flatMap((t) => {
    if (!t) return [];
    const { notes: _notes, ...view } = taskView(t, ctx.timeZone, ctx.policy) as ReturnType<typeof taskView> & { notes?: unknown };
    return [view];
  });
  return { ok: true, result: { ...(result as Record<string, unknown>), tasks } };
}
