/**
 * Proposals in an outside MCP host (issue #118, step 3): the host's model
 * proposes changes with `proposeChanges`, the MCP App page shows each with
 * the app's own sentence and a Confirm button, and only a press on Confirm
 * writes. Declared here, next to the screens, as plain data importable in
 * the browser; the server's side lives in `@clock-compass/core`
 * (`proposals/handlers.ts`).
 *
 * What may be proposed is the registry's operations the in-app assistant may
 * propose and MCP offers (`PROPOSABLE`): never a delete, and none of API
 * keys, import, export, push subscriptions or the AI settings (none of those
 * is an operation at all).
 */
import { z } from "zod";
import { describeActions } from "./actions";
import type { DataCategory } from "./data-categories";
import { OPERATION_LIST, mcpToolName, type OperationDeclaration, type RefKind } from "./operations";
import type { ReadHints } from "./reads";

/** The operations a host's model may propose, in registry order. */
export const PROPOSABLE: readonly OperationDeclaration[] = OPERATION_LIST.filter((op) => op.assistant === "propose" && op.mcp);

/** The proposable operation a model named, by its registry name (setTaskDone) or its tool name (set_task_done). */
export function proposableOperation(name: string): OperationDeclaration | undefined {
  return PROPOSABLE.find((op) => op.name === name || mcpToolName(op.name) === name);
}

/** Most changes one `proposeChanges` shows. */
export const MAX_PROPOSED_CHANGES = 10;

/** The data category of the items each kind of reference names. */
const REF_CATEGORY: Record<RefKind, DataCategory> = {
  task: "tasks",
  habit: "habitsAndRenewal",
  goal: "goalsAndProjects",
  project: "goalsAndProjects",
  role: "goalsAndProjects",
  person: "people",
  commitment: "people",
};

/**
 * Free-text fields that replace stored text with a switch of its own: such a
 * write is refused when that switch is off, because the sentence cannot quote
 * the old text and the user could not see what would be lost. Owner decision
 * (#118, 25 November 2026): a note on something NEW is always allowed, as in
 * the app's own assistant (`notes` on createTask, `note` on addEbaEntry); the
 * switches are about what AI may read, and a note the AI sends reveals
 * nothing stored. (No operation writes the notes on a person.)
 */
const FIELD_CATEGORY: Readonly<Record<string, Readonly<Record<string, DataCategory>>>> = {
  updateTask: { notes: "taskNotes" },
};

/**
 * Every data category a write with this input touches: its own, that of each
 * item it names, and that of each free-text field it sets with a switch of
 * its own. Over MCP a write is refused when any of them is switched off, as
 * a read of the same data would be.
 */
export function writeCategories(decl: OperationDeclaration, input: Record<string, unknown>): DataCategory[] {
  const found = new Set<DataCategory>([decl.category]);
  for (const [arg, kind] of Object.entries(decl.refs ?? {})) {
    const value = input[arg];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) found.add(REF_CATEGORY[kind]);
  }
  for (const [field, category] of Object.entries(FIELD_CATEGORY[decl.name] ?? {})) {
    const value = input[field];
    if (value !== undefined && value !== null && value !== "") found.add(category);
  }
  return [...found];
}

/** The confirm and "Not now" events of a proposal's ConfirmBar in the page; `change` names the change. */
export const PROPOSED_CHANGE_EVENT = "confirmProposedChange";
export const DISMISSED_CHANGE_EVENT = "dismissProposedChange";

/**
 * The argument a write takes in the MCP App: the server's proof that
 * `proposeChanges` showed exactly this change. The page sends it back
 * untouched; without it, or with any other change, the write is refused.
 */
export const PROPOSAL_ARGUMENT = "proposal";

export interface ProposalDeclaration {
  name: "proposeChanges";
  summary: string;
  input: z.ZodTypeAny;
  hints: ReadHints;
}

const Change = z
  .object({
    operation: z.string().min(1).max(64).describe("The operation's name, e.g. scheduleTask (or schedule_task)."),
    input: z.record(z.string(), z.unknown()).describe("The operation's arguments, as listed below."),
  })
  .strict();

export const PROPOSE_CHANGES: ProposalDeclaration = {
  name: "proposeChanges",
  summary: [
    "Propose changes to the user's data. Nothing is written by this tool: each change is shown to the user as a card with the app's own sentence and a Confirm button, and only the user's press on Confirm makes it. " +
      "You cannot make changes any other way. Read the data first (ids come from the read tools), then propose; never assume a change was made until the user confirms. " +
      `One item per change, at most ${MAX_PROPOSED_CHANGES} changes at once. Days as YYYY-MM-DD. ` +
      "You may never propose deleting anything, nor anything about API keys, import, export, notifications or the AI settings. " +
      "A change the app refuses (an item that does not exist, data the user has not shared with AI, a rock that is not Quadrant II) comes back with the reason and is not shown. " +
      "You get the changes shown in words. " +
      "The user may edit a proposed createTask or updateTask in its card before confirming (the title, the flags, influence or concern, the dates, the project, the goal), so read the task again (list_tasks) before relying on any value you proposed.",
    "",
    "The operations (name, then its arguments):",
    describeActions(),
  ].join("\n"),
  input: z
    .object({
      changes: z.array(Change).min(1).max(MAX_PROPOSED_CHANGES).describe("The changes to propose, each { operation, input }."),
    })
    .strict(),
  hints: Object.freeze({ readOnlyHint: true }),
};

