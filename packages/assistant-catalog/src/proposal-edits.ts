/**
 * Editing a proposed task change in the MCP App page before Confirm (#159).
 * Plain code, shared by the server (what the proof leaves open) and the page
 * (what it sends, what the card and the sentence show, what the model is told).
 *
 * Owner decisions on #159 (26 November 2026):
 * - only `createTask` and `updateTask` can be edited, and only in these
 *   fields: the title, important, urgent, influence or concern, the due date,
 *   the scheduled day and time, the project and the goal (the "eight fields":
 *   the day and its time count as one);
 * - the server's proof covers the operation, the item, the create's key and
 *   every other argument (the closed fields: notes, the repeat rule, the
 *   task's id), and names the open fields; each open field is checked on the
 *   write like any input (schema, refs, checks, data switches).
 * Nothing here removes data: an open field sets a value, and clearing one
 * (no due date, no project) is a value the task form can set too.
 */
import {
  dayWords,
  operation,
  proactivityWords,
  updateChangesNothing,
  type ActionLookup,
  type LookupTask,
  type TaskChange,
} from "./operations";

/** The fields a user may change in the card, in the order the card shows them. */
export const TASK_EDIT_FIELDS = [
  "title",
  "important",
  "urgent",
  "proactivity",
  "dueDate",
  "scheduledDay",
  "scheduledTime",
  "projectId",
  "goalId",
] as const;
export type TaskEditField = (typeof TASK_EDIT_FIELDS)[number];

/** The operations a user may edit in the card, with their open fields. */
const EDITABLE: Readonly<Record<string, readonly TaskEditField[]>> = {
  createTask: TASK_EDIT_FIELDS,
  updateTask: TASK_EDIT_FIELDS,
};

/** The open fields of an operation's proof: none for an operation that cannot be edited. */
export function editableFields(name: string): readonly TaskEditField[] {
  return EDITABLE[name] ?? [];
}

/** What the user set in the card, by field (left out: as proposed). */
export interface TaskEdits {
  title?: string;
  important?: boolean;
  urgent?: boolean;
  proactivity?: "INFLUENCE" | "CONCERN" | null;
  dueDate?: string | null;
  scheduledDay?: string | null;
  scheduledTime?: string | null;
  projectId?: string | null;
  goalId?: string | null;
}

/**
 * The write's input with the user's edits on top of the proposed input.
 * Fields that cannot be edited are taken as proposed. A create takes no null
 * (a cleared field is left out, which is the create's own "none"); a day
 * cleared clears its time.
 */
export function editedInput(name: string, proposed: Record<string, unknown>, edits: TaskEdits): Record<string, unknown> {
  const open = editableFields(name);
  const out: Record<string, unknown> = { ...proposed };
  for (const field of open) if (edits[field] !== undefined) out[field] = edits[field];
  if (edits.scheduledDay === null) out.scheduledTime = null;
  if (name === "createTask") {
    for (const field of open) if (out[field] === null) delete out[field];
    if (out.scheduledDay === undefined) delete out.scheduledTime;
  }
  return out;
}

/** A create's values for the fields it leaves out. */
const CREATE_DEFAULTS: Record<TaskEditField, unknown> = {
  title: "",
  important: false,
  urgent: false,
  proactivity: null,
  dueDate: null,
  scheduledDay: null,
  scheduledTime: null,
  projectId: null,
  goalId: null,
};

/**
 * What a field will be after Confirm: the input's value, else (an update)
 * the task's value now, else (a create) the create's default.
 */
export function valueAfter(name: string, input: Record<string, unknown>, field: TaskEditField, current?: LookupTask): unknown {
  if (field === "scheduledTime") {
    const day = valueAfter(name, input, "scheduledDay", current);
    if (day === null) return null;
  }
  if (input[field] !== undefined) return input[field];
  if (name === "updateTask") return current ? (current[field] ?? null) : undefined;
  return CREATE_DEFAULTS[field];
}

/** One change the user made to a proposal, by the fields the sentence names together. */
export interface OwnerChange {
  part: "title" | "important" | "urgent" | "proactivity" | "dueDate" | "scheduled" | "projectId" | "goalId";
  /** The value after Confirm, in words. */
  now: string;
  /** What the model proposed (or, for a field it left out of an update, what the task has), in words. */
  proposed: string;
}

/** A field's value as the model is told it. */
function words(part: OwnerChange["part"], value: (field: TaskEditField) => unknown, lookup: ActionLookup): string {
  const named = (kind: "project" | "goal", id: unknown) => {
    if (typeof id !== "string") return `no ${kind}`;
    const found = lookup.name(kind, id);
    return found === undefined ? `the ${kind} ${id}` : `the ${kind} “${found}” (id ${id})`;
  };
  switch (part) {
    case "title":
      return `the title “${String(value("title"))}”`;
    case "important":
      return value("important") ? "important" : "not important";
    case "urgent":
      return value("urgent") ? "urgent" : "not urgent";
    case "proactivity":
      return proactivityWords((value("proactivity") as "INFLUENCE" | "CONCERN" | null) ?? null);
    case "dueDate":
      return value("dueDate") ? `due ${String(value("dueDate"))}` : "no due date";
    case "scheduled":
      return dayWords((value("scheduledDay") as string | null) ?? null, (value("scheduledTime") as string | null) ?? null);
    case "projectId":
      return `in ${named("project", value("projectId"))}`;
    case "goalId":
      return `for ${named("goal", value("goalId"))}`;
  }
}

const PARTS: readonly { part: OwnerChange["part"]; fields: readonly TaskEditField[] }[] = [
  { part: "title", fields: ["title"] },
  { part: "important", fields: ["important"] },
  { part: "urgent", fields: ["urgent"] },
  { part: "proactivity", fields: ["proactivity"] },
  { part: "dueDate", fields: ["dueDate"] },
  { part: "scheduled", fields: ["scheduledDay", "scheduledTime"] },
  { part: "projectId", fields: ["projectId"] },
  { part: "goalId", fields: ["goalId"] },
];

/**
 * What the user changed compared with what the model proposed, with both
 * values in words: what the page tells the model after Confirm, so it does
 * not go on with the values it proposed.
 */
export function ownerChanges(
  name: string,
  proposed: Record<string, unknown>,
  final: Record<string, unknown>,
  lookup: ActionLookup,
): OwnerChange[] {
  if (editableFields(name).length === 0) return [];
  const current = typeof proposed.taskId === "string" ? lookup.task?.(proposed.taskId) : undefined;
  const before = (field: TaskEditField) => valueAfter(name, proposed, field, current);
  const after = (field: TaskEditField) => valueAfter(name, final, field, current);
  return PARTS.filter(({ fields }) => fields.some((f) => (before(f) ?? null) !== (after(f) ?? null))).map(({ part }) => ({
    part,
    now: words(part, after, lookup),
    proposed: words(part, before, lookup),
  }));
}

/** Why the card cannot be confirmed as edited (null: it can), in words for the user. */
export function editProblem(name: string, input: Record<string, unknown>, lookup: ActionLookup): string | null {
  if (editableFields(name).length === 0) return null;
  const decl = operation(name as "createTask");
  const parsed = decl.input.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "these values cannot be saved";
    return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
  }
  if (name === "updateTask" && updateChangesNothing(parsed.data as never, lookup)) return NOTHING_TO_CHANGE;
  return null;
}

/** Shown under a card whose edits leave the task as it is. */
export const NOTHING_TO_CHANGE = "Nothing would change: the task already has these values.";

/** A create's edits as a card change on its draft (only what the user changed). */
export function draftChange(draftId: string, edits: TaskEdits): TaskChange {
  const set: TaskChange["set"] = {};
  for (const field of TASK_EDIT_FIELDS) if (edits[field] !== undefined) (set as Record<string, unknown>)[field] = edits[field];
  if (edits.scheduledDay === null) set.scheduledTime = null;
  return { taskId: draftId, set };
}

/** The id of a proposed create's draft card: never an id the server gives a task. */
export const draftTaskId = (changeId: string) => `draft-${changeId}`;

