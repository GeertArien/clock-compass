/**
 * The operation registry (issue #109): every write the app offers to agents,
 * declared once.
 *
 * A declaration is plain data plus pure functions, importable in the browser:
 * - `name` and `summary` (for the model), `input` (a strict Zod schema);
 * - `hints`: MCP's standard tool annotations;
 * - `assistant`: whether the in-app assistant may propose it ("propose") or
 *   never ("never"); `mcp`: whether the MCP adapter offers it as a tool,
 *   under the name `mcpToolName` derives from `name` (one set, #109 step 3:
 *   every operation exists once, in one shape, for both);
 * - `category`: the data category it writes (`data-categories.ts`). An
 *   operation whose category is switched off is not offered to the model;
 * - `touches`: what the app refreshes after it ran;
 * - `describe`: the app's own sentence for the confirm step. Without one,
 *   `operationSentence` falls back to the title and the fields being set;
 * - `refs` and `check`: what must hold before it runs (the items it names
 *   exist; rocks are Quadrant II). The app checks a proposal with them before
 *   anyone presses Confirm, and the server checks again with its own data.
 *
 * The code that carries an operation out (its handler, a call into the
 * service layer) lives with the services in `@clock-compass/core`
 * (`operations/handlers.ts`), and the server exposes each one as
 * `POST /api/operations/{name}`.
 *
 * Hints follow the MCP definitions: `destructiveHint` marks an operation that
 * deletes something or overwrites text the user wrote; flags, pins and dates
 * can be set back, so they are not destructive. `idempotentHint` marks one
 * that changes nothing more when repeated with the same input.
 */
import { z } from "zod";
import type { DataCategory } from "./data-categories";

const Id = z.string().min(1).max(64);
/** A real calendar date as YYYY-MM-DD (2026-02-31 and 2026-13-45 are not). */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "a real calendar date");
/** The Monday of an ISO week, as YYYY-MM-DD. */
const IsoMonday = IsoDate.refine((s) => new Date(`${s}T00:00:00Z`).getUTCDay() === 1, "a Monday");
const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time as HH:MM");

/** The four renewal dimensions (Habit 7), as the API names them. */
export const RENEWAL_DIMENSIONS = ["PHYSICAL", "MENTAL", "SOCIAL_EMOTIONAL", "SPIRITUAL"] as const;
const DIMENSION_LABELS: Record<(typeof RENEWAL_DIMENSIONS)[number], string> = {
  PHYSICAL: "physical",
  MENTAL: "mental",
  SOCIAL_EMOTIONAL: "social/emotional",
  SPIRITUAL: "spiritual",
};
const DIMENSION = z.enum(RENEWAL_DIMENSIONS);
/** Longest intention the assistant may propose. */
export const MAX_INTENTION = 280;

/** The kind of item an assistant action touches, for display and for keys. */
export type ActionTarget =
  | "task"
  | "habit"
  | "week"
  | "intention"
  | "goal"
  | "project"
  | "commitment"
  | "person"
  | "activity"
  | "mission";

/** The kinds of item a confirm sentence names. */
export type NamedKind = "task" | "habit" | "goal" | "project" | "person" | "commitment" | "role";

/** Longest mission statement an operation may write. */
export const MAX_MISSION = 10_000;

/** Longest task title and notes the assistant may propose (the task form sets none; these keep a proposal readable). */
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_NOTES = 2000;

/** Looks up an item's display name by kind and id (the app's data). */
export type NameLookup = (kind: NamedKind, id: string) => string | undefined;

/** A task as the confirm sentence of `updateTask` compares it: days as YYYY-MM-DD. */
export interface LookupTask {
  title: string;
  notes: string | null;
  important: boolean;
  urgent: boolean;
  proactivity: "INFLUENCE" | "CONCERN" | null;
  /** The due date (a plain date). */
  dueDate: string | null;
  /** The day it is scheduled on, a plain date (the same in every zone, #136). */
  scheduledDay: string | null;
  scheduledTime: string | null;
  projectId: string | null;
  goalId: string | null;
  /** Its rule when it repeats (absent: unknown; null: does not repeat). */
  repeat?: RepeatRule | null;
}

/** A recurring task's rule, as the operations take it and the confirm sentence names it (#105). */
export interface RepeatRule {
  unit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  every: number;
  from: "SCHEDULE" | "COMPLETION";
  leadDays: number | null;
}

/** What an operation would set on one task (fields left out stay as they are). */
export interface TaskChange {
  taskId: string;
  set: Partial<LookupTask> & { done?: boolean; bigRock?: boolean };
}

/** What describing an operation may look up in the app's data. */
export interface ActionLookup {
  name: NameLookup;
  /** The ids of the open tasks pinned as big rocks now (the ones a week plan may unpin). */
  pinnedTaskIds: () => readonly string[];
  /** A task as it is now, to name only what an edit changes (absent: unknown). */
  task?: (id: string) => LookupTask | undefined;
  /** The mission statement as it is now (absent: unknown; "" when there is none). */
  mission?: () => string | undefined;
  /** This week's intention for a dimension as it is now (absent: unknown). */
  intention?: (dimension: (typeof RENEWAL_DIMENSIONS)[number]) => string | undefined;
}

/** What the app refreshes after an operation ran. */
export type Touches = "tasks" | "goals" | "projects" | "people" | "habits" | "intentions" | "renewal" | "mission";

/** MCP's standard tool annotations, for a write. */
export interface WriteHints {
  readonly readOnlyHint: false;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
}

/** The fields of a task a check needs (the app's and the server's tasks both fit). */
export interface CheckTask {
  id: string;
  title: string;
  status: string;
  important: boolean;
  urgent: boolean;
}

/**
 * The data an operation is checked against. A kind left out is not checked
 * here (the server checks it again with its own data).
 */
export interface CheckData {
  tasks?: readonly CheckTask[];
  habits?: readonly { id: string }[];
  goals?: readonly { id: string }[];
  projects?: readonly { id: string }[];
  roles?: readonly { id: string }[];
  people?: readonly { id: string }[];
  /** Today as a plain day in the caller's zone (absent: days are not checked here). */
  today?: string;
  /** Commitments, with the people linked to each (absent: not checked). */
  commitments?: readonly { id: string; personIds?: readonly string[] }[];
}

export type RefKind = "task" | "habit" | "goal" | "project" | "role" | "person" | "commitment";

/** What an operation that creates makes (its result carries the new item's `id`). */
export type CreatedKind = "task" | "goal" | "project" | "occurrence" | "ebaEntry" | "activity";

export interface OperationDeclaration<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Access extends "propose" | "never" = "propose" | "never",
> {
  name: string;
  /** A short name for the fallback sentence ("Create a goal"). */
  title: string;
  /** One line for the model: what the operation does, as a target state where possible. */
  summary: string;
  input: Input;
  hints: WriteHints;
  assistant: Access;
  /** Offered as a tool by the MCP adapter (under this name). */
  mcp: boolean;
  category: DataCategory;
  touches: readonly Touches[];
  /** Arguments naming items that must exist (an id, or a list of ids). */
  refs?: Readonly<Record<string, RefKind>>;
  /** Why it cannot be done with this data, beyond the refs, or null. */
  check?: (input: z.infer<Input>, data: CheckData) => string | null;
  /** The app's own wording of this operation, for the confirm step. */
  describe?: (input: z.infer<Input>, lookup: ActionLookup) => string;
  /**
   * The tasks this operation changes and what it sets on each (#145): the
   * proposal's card shows the task as it would be after Confirm. Written next
   * to `describe`, from the same arguments, so the two cannot disagree.
   */
  taskChanges?: (input: z.infer<Input>, lookup: ActionLookup) => TaskChange[];
  /**
   * Creates an item: not safe to repeat by itself. The endpoint makes it so
   * with an `Idempotency-Key`, and MCP with an `idempotencyKey` argument (the
   * same key returns the item made the first time); the result carries the
   * new item's `id`.
   */
  creates?: CreatedKind;
  /** Assistant actions: the kind of item touched, and its id (for keys and display). */
  target?: ActionTarget;
  targetId?: (input: z.infer<Input>) => string;
}

function define<Input extends z.ZodTypeAny, const Access extends "propose" | "never">(
  def: OperationDeclaration<Input, Access>,
): OperationDeclaration<Input, Access> {
  return def;
}

const quoted = (lookup: ActionLookup, kind: NamedKind, id: string) => {
  const found = lookup.name(kind, id);
  return found === undefined ? `a ${kind} that no longer exists` : `“${found}”`;
};

/** Logging or checking off a day that is still to come is refused, before a press and on the server. */
export const DAY_TO_COME = "That day is still to come; only today or an earlier day can be logged.";
const dayToCome = (day: string | undefined, data: CheckData) => (day && data.today && day > data.today ? DAY_TO_COME : null);

const isQ2 = (task: CheckTask) => task.important && !task.urgent;
const notRock = (task: CheckTask) =>
  `“${task.title}” is not in Quadrant II (important, not urgent), so it cannot be a big rock.`;
const findTask = (data: CheckData, id: string) =>
  data.tasks?.find((t) => t.id === id && t.status !== "ARCHIVED");


const PROACTIVITY = z.enum(["INFLUENCE", "CONCERN"]);
const TaskTitle = z
  .string()
  .trim()
  .min(1, "a task needs a title")
  .max(MAX_TASK_TITLE)
  .describe(`The task's title (at most ${MAX_TASK_TITLE} characters).`);
const TaskNotes = z.string().trim().max(MAX_TASK_NOTES);
const timeNeedsDay = (a: { scheduledDay?: string | null; scheduledTime?: string | null }) =>
  a.scheduledTime == null || a.scheduledDay != null;
const TIME_NEEDS_DAY = { message: "a time needs a day", path: ["scheduledTime"] };

/** "important", "urgent", "important and urgent", or none (for the sentence). */
function flags(important?: boolean, urgent?: boolean): string[] {
  if (important && urgent) return ["important and urgent"];
  return [important ? "important" : "", urgent ? "urgent" : ""].filter(Boolean);
}
const proactivityWords = (p: "INFLUENCE" | "CONCERN" | null) =>
  p === "INFLUENCE" ? "in your influence" : p === "CONCERN" ? "a concern" : "neither influence nor concern";
const dayWords = (day: string | null, time: string | null) =>
  day === null ? "not on the Clock" : `on ${day}${time ? ` at ${time}` : ""}`;
/** Longest stretch of notes quoted in full in a confirm sentence. */
export const NOTES_IN_SENTENCE = 200;

/**
 * Notes as the confirm sentence quotes them: in full up to NOTES_IN_SENTENCE
 * characters (line breaks shown as spaces), otherwise their start and their
 * length, so nobody confirms text they have not been shown at all.
 */
function excerpt(notes: string): string {
  const flat = notes.trim().replace(/\s+/g, " ");
  if (flat.length <= NOTES_IN_SENTENCE) return `“${flat}”`;
  return `“${flat.slice(0, NOTES_IN_SENTENCE).trimEnd()}…” (${notes.trim().length} characters)`;
}
const was = (before: string | undefined) => (before === undefined ? "" : ` (was ${before})`);

const UNIT_WORDS = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" } as const;

/** A repeat argument with its defaults filled in (every 1, from the schedule, no "show from"). */
export function repeatRule(r: z.infer<typeof RepeatInput>): RepeatRule {
  return { unit: r.unit, every: r.every ?? 1, from: r.from ?? "SCHEDULE", leadDays: r.leadDays ?? null };
}

const sameRepeat = (a: RepeatRule | null, b: RepeatRule | null) =>
  a === b || (!!a && !!b && a.unit === b.unit && a.every === b.every && a.from === b.from && a.leadDays === b.leadDays);

/** "every year", "every 2 weeks after completion". */
function ruleWords(r: RepeatRule): string {
  const every = r.every === 1 ? `every ${UNIT_WORDS[r.unit]}` : `every ${r.every} ${UNIT_WORDS[r.unit]}s`;
  return r.from === "COMPLETION" ? `${every} after completion` : every;
}

/** A plain date moved by `n` days. */
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "repeating every year (shown from 2027-10-11)": with the date when the due date is known. */
function repeatWords(r: RepeatRule, due: string | null): string {
  if (r.leadDays === null) return `repeating ${ruleWords(r)}`;
  const shown = due ? `shown from ${addDays(due, -r.leadDays)}` : `shown ${r.leadDays} days before it is due`;
  return `repeating ${ruleWords(r)} (${shown})`;
}

/** "Create the task “X”, important, due 2027-11-01, in the project “Y”". */
function describeCreate(a: z.infer<typeof CreateTaskInput>, lookup: ActionLookup): string {
  const parts = [
    ...flags(a.important, a.urgent),
    ...(a.proactivity ? [proactivityWords(a.proactivity)] : []),
    ...(a.dueDate ? [`due ${a.dueDate}`] : []),
    ...(a.scheduledDay ? [dayWords(a.scheduledDay, a.scheduledTime ?? null)] : []),
    ...(a.projectId ? [`in the project ${quoted(lookup, "project", a.projectId)}`] : []),
    ...(a.goalId ? [`for the goal ${quoted(lookup, "goal", a.goalId)}`] : []),
    ...(a.repeat ? [repeatWords(repeatRule(a.repeat), a.dueDate ?? a.scheduledDay ?? null)] : []),
    ...(a.notes ? [`with the notes ${excerpt(a.notes)}`] : []),
  ];
  return [`Create the task “${a.title}”`, ...parts].join(", ");
}

/** Names only what changes, with the old value where it helps. */
function describeUpdate(a: z.infer<typeof UpdateTaskInput>, lookup: ActionLookup): string {
  const now = lookup.task?.(a.taskId);
  const name = quoted(lookup, "task", a.taskId);
  const differs = <K extends keyof LookupTask>(key: K, value: LookupTask[K] | undefined) =>
    value !== undefined && (!now || now[key] !== value);
  const project = (id: string | null) => (id ? `the project ${quoted(lookup, "project", id)}` : "no project");
  const goal = (id: string | null) => (id ? `the goal ${quoted(lookup, "goal", id)}` : "no goal");
  const changes: string[] = [];
  if (differs("title", a.title)) changes.push(`rename it to “${a.title}”`);
  if (a.notes !== undefined && (!now || (now.notes ?? "") !== (a.notes ?? ""))) {
    const before = now?.notes ? excerpt(now.notes) : undefined;
    if (!a.notes) changes.push(before ? `clear its notes (${before})` : "clear its notes");
    else changes.push(before ? `replace its notes ${before} with ${excerpt(a.notes)}` : `set its notes to ${excerpt(a.notes)}`);
  }
  if (differs("important", a.important)) changes.push(a.important ? "important" : "not important");
  if (differs("urgent", a.urgent)) changes.push(a.urgent ? "urgent" : "not urgent");
  if (differs("proactivity", a.proactivity)) {
    changes.push(proactivityWords(a.proactivity ?? null) + was(now ? proactivityWords(now.proactivity) : undefined));
  }
  if (differs("dueDate", a.dueDate)) {
    changes.push((a.dueDate ? `due ${a.dueDate}` : "no due date") + was(now ? (now.dueDate ?? "no due date") : undefined));
  }
  if (a.scheduledDay !== undefined || a.scheduledTime !== undefined) {
    const day = a.scheduledDay === undefined ? (now?.scheduledDay ?? null) : a.scheduledDay;
    const time = day === null ? null : a.scheduledTime === undefined ? (now?.scheduledTime ?? null) : a.scheduledTime;
    if (!now || now.scheduledDay !== day || (now.scheduledTime ?? null) !== time) {
      changes.push(dayWords(day, time) + was(now ? dayWords(now.scheduledDay, now.scheduledTime) : undefined));
    }
  }
  if (differs("projectId", a.projectId)) {
    changes.push(`in ${project(a.projectId ?? null)}` + was(now ? project(now.projectId) : undefined));
  }
  if (differs("goalId", a.goalId)) changes.push(`for ${goal(a.goalId ?? null)}` + was(now ? goal(now.goalId) : undefined));
  if (a.repeat !== undefined) {
    const wanted = a.repeat === null ? null : repeatRule(a.repeat);
    const before = now?.repeat;
    if (before === undefined || !sameRepeat(wanted, before)) {
      // "Show from" counts back from the due date, or the scheduled day when there is none.
      const due = a.dueDate !== undefined ? a.dueDate : (now?.dueDate ?? null);
      const day = a.scheduledDay !== undefined ? a.scheduledDay : (now?.scheduledDay ?? null);
      // When "show from" changes with the rule, say so on both sides: a rule
      // given without leadDays drops it, and the task then shows at once.
      const leadOf = (r: RepeatRule) => (r.leadDays === null ? "shown at once" : `shown ${r.leadDays} days before it is due`);
      const leadChanges = !!wanted && !!before && wanted.leadDays !== before.leadDays;
      const was =
        before === undefined
          ? ""
          : before === null
            ? " (was not repeating)"
            : ` (was ${ruleWords(before)}${leadChanges ? `, ${leadOf(before)}` : ""})`;
      const next = wanted
        ? repeatWords(wanted, due ?? day) + (leadChanges && wanted.leadDays === null ? ", shown at once" : "")
        : "stop repeating";
      changes.push(next + was);
    }
  }
  return changes.length ? `Change ${name}: ${changes.join(", ")}` : `Leave ${name} as it is (nothing would change)`;
}

/** updateTask's fields as a change; a day cleared clears its time too. */
function updateChanges(a: z.infer<typeof UpdateTaskInput>): TaskChange[] {
  const { taskId, repeat, ...fields } = a;
  const set: TaskChange["set"] = { ...fields };
  if (a.scheduledDay === null) set.scheduledTime = null;
  if (repeat !== undefined) set.repeat = repeat === null ? null : repeatRule(repeat);
  return [{ taskId, set }];
}

const RepeatInput = z
  .object({
    unit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"]).describe("DAY, WEEK, MONTH or YEAR."),
    every: z.number().int().min(1).max(999).optional().describe("Every this many units; left out = 1."),
    from: z
      .enum(["SCHEDULE", "COMPLETION"])
      .optional()
      .describe("SCHEDULE (the default): fixed dates, e.g. every 1 November. COMPLETION: counted from the day it is done."),
    leadDays: z
      .number()
      .int()
      .min(0)
      .max(365)
      .nullable()
      .optional()
      .describe("Show it only this many days before it is due (e.g. 21 for a yearly task); left out or null = shown as soon as it is created."),
  })
  .strict();
const needsDate = (a: { repeat?: unknown; dueDate?: string | null; scheduledDay?: string | null }) =>
  !a.repeat || !!a.dueDate || !!a.scheduledDay;
const REPEAT_NEEDS_DATE = { message: "a repeating task needs a due date or a scheduled day", path: ["repeat"] };

const CreateTaskInput = z
  .object({
    title: TaskTitle,
    notes: TaskNotes.optional().describe(`Notes (at most ${MAX_TASK_NOTES} characters).`),
    important: z.boolean().optional().describe("Important (Habit 3); left out = not important."),
    urgent: z.boolean().optional().describe("Urgent; left out = not urgent."),
    proactivity: PROACTIVITY.optional().describe("INFLUENCE (actionable) or CONCERN (not in your control); left out = neither."),
    dueDate: IsoDate.optional().describe("Due date, YYYY-MM-DD."),
    scheduledDay: IsoDate.optional().describe("Day to do it in the Clock, YYYY-MM-DD."),
    scheduledTime: HhMm.optional().describe("HH:MM on that day (needs scheduledDay)."),
    projectId: Id.optional().describe("Id of an existing project."),
    goalId: Id.optional().describe("Id of an existing goal."),
    repeat: RepeatInput.optional().describe(
      "Repeat the task: when it is done, the next one is created. { unit: DAY|WEEK|MONTH|YEAR, every?: number (default 1), from?: SCHEDULE (fixed dates, the default) or COMPLETION (counted from the day it is done), leadDays?: show it only this many days before it is due, e.g. 21 for yearly }. Needs a due date or a scheduled day.",
    ),
  })
  .strict()
  .refine(timeNeedsDay, TIME_NEEDS_DAY)
  .refine(needsDate, REPEAT_NEEDS_DATE);

const UpdateTaskInput = z
  .object({
    taskId: Id.describe("Id of an existing task."),
    title: TaskTitle.optional(),
    notes: TaskNotes.nullable().optional().describe("New notes, or null to clear them."),
    important: z.boolean().optional().describe("Important (true) or not (false)."),
    urgent: z.boolean().optional().describe("Urgent (true) or not (false)."),
    proactivity: PROACTIVITY.nullable().optional().describe("INFLUENCE, CONCERN, or null for neither."),
    dueDate: IsoDate.nullable().optional().describe("YYYY-MM-DD, or null for no due date."),
    scheduledDay: IsoDate.nullable().optional().describe("YYYY-MM-DD, or null to take it off the Clock (and clear its time)."),
    scheduledTime: HhMm.nullable()
      .optional()
      .describe("HH:MM, or null for no particular time; a new time needs scheduledDay in the same change."),
    projectId: Id.nullable().optional().describe("Id of an existing project, or null for the Inbox."),
    goalId: Id.nullable().optional().describe("Id of an existing goal, or null for none."),
    repeat: RepeatInput.nullable()
      .optional()
      .describe(
        "Repeat from this occurrence on: { unit: DAY|WEEK|MONTH|YEAR, every?: number (default 1), from?: SCHEDULE (fixed dates, the default) or COMPLETION (counted from the day it is done), leadDays?: show it only this many days before it is due, e.g. 21 for yearly }; or null to stop repeating; left out = unchanged. Give the whole rule: a leadDays left out is removed. The task needs a due date or a scheduled day.",
      ),
  })
  .strict()
  .refine((a) => Object.keys(a).some((k) => k !== "taskId"), "name at least one field to change")
  .refine(timeNeedsDay, TIME_NEEDS_DAY);

const hints = (destructiveHint: boolean, idempotentHint: boolean): WriteHints => ({
  readOnlyHint: false,
  destructiveHint,
  idempotentHint,
});

export const OPERATIONS = {
  // --- The assistant's actions (issue #62; names and arguments unchanged) ------
  setTaskDone: define({
    name: "setTaskDone",
    title: "Mark a task done or open",
    target: "task",
    summary: "Mark a task done (done: true) or open (done: false).",
    input: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        done: z.boolean().describe("true to complete, false to reopen."),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `${a.done ? "Mark" : "Reopen"} ${quoted(lookup, "task", a.taskId)}${a.done ? " done" : ""}`,
    taskChanges: (a) => [{ taskId: a.taskId, set: { done: a.done } }],
  }),
  scheduleTask: define({
    name: "scheduleTask",
    title: "Schedule a task",
    target: "task",
    summary:
      "Put a task on a day in the Clock, at a time or at no particular time (time left out = no time), or take it off (day: null).",
    input: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        day: IsoDate.nullable().describe("YYYY-MM-DD, or null to unschedule."),
        time: HhMm.nullable()
          .default(null)
          .describe("HH:MM on that day; null or left out for no particular time."),
      })
      .strict()
      .refine((a) => a.day !== null || a.time === null, { message: "a time needs a day", path: ["time"] }),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    targetId: (a) => a.taskId,
    describe: (a, lookup) =>
      a.day === null
        ? `Take ${quoted(lookup, "task", a.taskId)} off the Clock`
        : `Schedule ${quoted(lookup, "task", a.taskId)} on ${a.day}${a.time ? ` at ${a.time}` : ""}`,
    taskChanges: (a) => [{ taskId: a.taskId, set: { scheduledDay: a.day, scheduledTime: a.time } }],
  }),
  setBigRock: define({
    name: "setBigRock",
    title: "Pin or unpin a big rock",
    target: "task",
    summary: "Pin a Quadrant II task as a big rock (bigRock: true), or unpin it. A rock stays pinned until it is unpinned.",
    input: z
      .object({
        taskId: Id.describe("Id of an existing Q2 task (important, not urgent)."),
        bigRock: z.boolean().describe("true to pin, false to unpin."),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    check: (a, data) => {
      const task = findTask(data, a.taskId);
      return a.bigRock && task && !isQ2(task) ? notRock(task) : null;
    },
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `${a.bigRock ? "Pin" : "Unpin"} ${quoted(lookup, "task", a.taskId)} as a big rock`,
    taskChanges: (a) => [{ taskId: a.taskId, set: { bigRock: a.bigRock } }],
  }),
  setHabitDone: define({
    name: "setHabitDone",
    title: "Check a habit off",
    target: "habit",
    summary:
      "Check a habit off for a day (done: true), or undo that day's check-off (done: false). The day defaults to today; a future day is refused.",
    input: z
      .object({
        habitId: Id.describe("Id of an existing habit."),
        done: z.boolean().describe("true to check off, false to undo."),
        day: IsoDate.optional().describe("YYYY-MM-DD, today or earlier; left out = today."),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["habits"],
    refs: { habitId: "habit" },
    check: (a, data) => dayToCome(a.day, data),
    targetId: (a) => a.habitId,
    describe: (a, lookup) => {
      const when = a.day ? `for ${a.day}` : "for today";
      return a.done
        ? `Check off ${quoted(lookup, "habit", a.habitId)} ${when}`
        : `Undo the check-off of ${quoted(lookup, "habit", a.habitId)} ${when}`;
    },
  }),
  acceptWeekPlan: define({
    name: "acceptWeekPlan",
    title: "Set the week's big rocks",
    target: "week",
    summary:
      "Make exactly these Quadrant II tasks the open big rocks for the week: they are pinned, and every other open rock is unpinned. Rocks already done stay pinned.",
    input: z
      .object({
        weekStart: IsoMonday.describe("Monday of the ISO week, YYYY-MM-DD."),
        taskIds: z
          .array(Id)
          .min(1)
          .max(7)
          .refine((ids) => new Set(ids).size === ids.length, "no task twice")
          .describe("The big rocks, 1 to 7 distinct task ids (Q2 tasks)."),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskIds: "task" },
    check: (a, data) => {
      for (const id of a.taskIds) {
        const task = findTask(data, id);
        if (!task) continue;
        if (!isQ2(task)) return notRock(task);
        if (task.status !== "TODO") return `“${task.title}” is already done, so it cannot be one of the week's rocks.`;
      }
      return null;
    },
    targetId: (a) => a.weekStart,
    describe: (a, lookup) => {
      const plan = new Set(a.taskIds);
      const unpinned = lookup.pinnedTaskIds().filter((id) => !plan.has(id));
      const rocks = `Make ${a.taskIds.map((id) => quoted(lookup, "task", id)).join(", ")} the big rocks for the week of ${a.weekStart}`;
      return unpinned.length ? `${rocks}, and unpin ${unpinned.map((id) => quoted(lookup, "task", id)).join(", ")}` : rocks;
    },
    taskChanges: (a, lookup) => {
      const plan = new Set(a.taskIds);
      return [
        ...a.taskIds.map((taskId) => ({ taskId, set: { bigRock: true } })),
        ...lookup.pinnedTaskIds().filter((id) => !plan.has(id)).map((taskId) => ({ taskId, set: { bigRock: false } })),
      ];
    },
  }),
  setIntention: define({
    name: "setIntention",
    title: "Set this week's intention",
    target: "intention",
    summary:
      "Set this week's intention for one renewal dimension (Sharpen the Saw), replacing the current one, or clear it (text: null).",
    input: z
      .object({
        dimension: DIMENSION.describe("PHYSICAL, MENTAL, SOCIAL_EMOTIONAL or SPIRITUAL."),
        text: z
          .string()
          .trim()
          .min(1, "an intention cannot be empty (null clears it)")
          .max(MAX_INTENTION)
          .nullable()
          .describe(`The intention, one short sentence (at most ${MAX_INTENTION} characters), or null to clear it.`),
      })
      .strict(),
    hints: hints(true, true),
    assistant: "propose",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["intentions"],
    targetId: (a) => a.dimension,
    describe: (a, lookup) => {
      const label = DIMENSION_LABELS[a.dimension];
      const now = lookup.intention?.(a.dimension);
      if (a.text === null) return now ? `Clear this week's ${label} intention (“${now}”)` : `Clear this week's ${label} intention`;
      return `Set this week's ${label} intention to “${a.text}”` + (now && now !== a.text ? ` (was “${now}”)` : "");
    },
  }),

  createTask: define({
    name: "createTask",
    title: "Create a task",
    target: "task",
    creates: "task",
    summary:
      "Create a new task with these details (only the title is required). Confirming the same proposal again does not make a second task.",
    input: CreateTaskInput,
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { projectId: "project", goalId: "goal" },
    targetId: (a) => a.title,
    describe: describeCreate,
  }),
  updateTask: define({
    name: "updateTask",
    title: "Change a task",
    target: "task",
    summary:
      "Set the given fields of an existing task to these values (fields left out stay as they are; null clears a field).",
    input: UpdateTaskInput,
    hints: hints(true, true),
    assistant: "propose",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task", projectId: "project", goalId: "goal" },
    targetId: (a) => a.taskId,
    describe: describeUpdate,
    taskChanges: updateChanges,
  }),

  // --- Proposed by the assistant since #109 step 4 (owner decision), except --------
  // --- deleteTask, which it never proposes.
  deleteTask: define({
    name: "deleteTask",
    title: "Delete a task",
    target: "task",
    summary:
      "Delete a task. Deleting the open occurrence of a repeating task ends the series. A task already gone changes nothing.",
    input: z.object({ taskId: Id.describe("Id of the task.") }).strict(),
    hints: hints(true, true),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks"],
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `Delete ${quoted(lookup, "task", a.taskId)}`,
  }),
  setMission: define({
    name: "setMission",
    title: "Write the mission statement",
    target: "mission",
    summary:
      "Make this the personal mission statement (the current one is kept as an earlier version). The same text as now changes nothing.",
    input: z
      .object({
        text: z
          .string()
          .trim()
          .min(1, "a mission statement cannot be empty")
          .max(MAX_MISSION)
          .describe(`The whole mission statement, as the user wants it (at most ${MAX_MISSION} characters).`),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: true,
    category: "mission",
    touches: ["mission"],
    targetId: () => "mission",
    // The whole text, never shortened: it is what the user is asked to adopt.
    describe: (a, lookup) => {
      const now = lookup.mission?.();
      if (now === a.text) return "Leave the mission statement as it is (nothing would change)";
      if (now === "") return `Write the mission statement: “${a.text}”`;
      return `Replace the mission statement with “${a.text}” (the current one is kept as an earlier version)`;
    },
  }),
  createGoal: define({
    name: "createGoal",
    title: "Create a goal",
    target: "goal",
    creates: "goal",
    summary: "Create a goal (a durable outcome), optionally under a role and with a target date.",
    input: z
      .object({
        title: z.string().trim().min(1, "a goal needs a title").max(MAX_TASK_TITLE).describe("The goal's title."),
        description: z.string().trim().max(MAX_TASK_NOTES).optional().describe("What it means, in a few lines."),
        targetDate: IsoDate.optional().describe("Target date, YYYY-MM-DD."),
        roleId: Id.optional().describe("Id of an existing role (see list_roles)."),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "goalsAndProjects",
    touches: ["goals"],
    refs: { roleId: "role" },
    targetId: (a) => a.title,
    describe: (a, lookup) =>
      [
        `Create the goal “${a.title}”`,
        ...(a.roleId ? [`under the role ${quoted(lookup, "role", a.roleId)}`] : []),
        ...(a.targetDate ? [`target ${a.targetDate}`] : []),
        ...(a.description ? [`with the description ${excerpt(a.description)}`] : []),
      ].join(", "),
  }),
  createProject: define({
    name: "createProject",
    title: "Create a project",
    target: "project",
    creates: "project",
    summary: "Create a project (a multi-step outcome), optionally serving a goal.",
    input: z
      .object({
        name: z.string().trim().min(1, "a project needs a name").max(MAX_TASK_TITLE).describe("The project's name."),
        goalId: Id.optional().describe("Id of an existing goal."),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "goalsAndProjects",
    touches: ["projects", "goals"],
    refs: { goalId: "goal" },
    targetId: (a) => a.name,
    describe: (a, lookup) =>
      `Create the project “${a.name}”` + (a.goalId ? `, for the goal ${quoted(lookup, "goal", a.goalId)}` : ""),
  }),
  logCommitmentOccurrence: define({
    name: "logCommitmentOccurrence",
    title: "Log a commitment occurrence",
    target: "commitment",
    creates: "occurrence",
    summary:
      "Log that a recurring relationship commitment happened (today, or an earlier day), with one of its people (per-person tracking) or for the commitment as a whole.",
    input: z
      .object({
        commitmentId: Id.describe("Id of an existing commitment (see list_people)."),
        personId: Id.optional().describe("Id of the person it was with, one linked to that commitment; left out = the commitment as a whole."),
        day: IsoDate.optional().describe("YYYY-MM-DD, today or earlier; left out = today."),
        note: z.string().trim().max(MAX_TASK_NOTES).optional().describe("A short note."),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "people",
    touches: ["people"],
    refs: { commitmentId: "commitment", personId: "person" },
    check: (a, data) => {
      if (dayToCome(a.day, data)) return DAY_TO_COME;
      const commitment = data.commitments?.find((c) => c.id === a.commitmentId);
      return a.personId && commitment?.personIds && !commitment.personIds.includes(a.personId)
        ? "That person is not part of that commitment."
        : null;
    },
    targetId: (a) => a.commitmentId,
    describe: (a, lookup) =>
      `Log ${quoted(lookup, "commitment", a.commitmentId)}` +
      (a.personId ? ` with ${lookup.name("person", a.personId) ?? "a person who no longer exists"}` : "") +
      ` as done ${a.day ? `on ${a.day}` : "today"}` +
      (a.note ? `, with the note ${excerpt(a.note)}` : ""),
  }),
  addEbaEntry: define({
    name: "addEbaEntry",
    title: "Add an emotional-bank-account entry",
    target: "person",
    creates: "ebaEntry",
    summary: "Log an emotional-bank-account deposit or withdrawal for a person.",
    input: z
      .object({
        personId: Id.describe("Id of an existing person."),
        kind: z.enum(["DEPOSIT", "WITHDRAWAL"]).describe("DEPOSIT or WITHDRAWAL."),
        note: z.string().trim().max(MAX_TASK_NOTES).optional().describe("What happened, in the user's words."),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "ebaBalance",
    touches: ["people"],
    refs: { personId: "person" },
    targetId: (a) => a.personId,
    describe: (a, lookup) =>
      `Add a ${a.kind === "DEPOSIT" ? "deposit" : "withdrawal"} for ${lookup.name("person", a.personId) ?? "a person who no longer exists"}` +
      (a.note ? ` with the note ${excerpt(a.note)}` : ""),
  }),
  logRenewalActivity: define({
    name: "logRenewalActivity",
    title: "Log a renewal activity",
    target: "activity",
    creates: "activity",
    summary: "Log a one-off renewal activity (a retreat, a long hike) toward a dimension, today or on an earlier day.",
    input: z
      .object({
        dimension: DIMENSION.describe("PHYSICAL, MENTAL, SOCIAL_EMOTIONAL or SPIRITUAL."),
        title: z.string().trim().min(1, "an activity needs a title").max(MAX_TASK_TITLE).describe("What it was."),
        day: IsoDate.optional().describe("YYYY-MM-DD, today or earlier; left out = today."),
        note: z.string().trim().max(MAX_TASK_NOTES).optional().describe("A short note."),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "propose",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["renewal"],
    check: (a, data) => dayToCome(a.day, data),
    targetId: (a) => a.title,
    describe: (a) =>
      `Log the ${DIMENSION_LABELS[a.dimension]} renewal activity “${a.title}”` +
      (a.day ? ` on ${a.day}` : " today") +
      (a.note ? `, with the note ${excerpt(a.note)}` : ""),
  }),
} as const;

export type OperationName = keyof typeof OPERATIONS;
export type OperationInput<N extends OperationName> = z.infer<(typeof OPERATIONS)[N]["input"]>;

export function isOperation(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}

/** Every declaration, in registry order, typed loosely for generic code. */
export const OPERATION_LIST: readonly OperationDeclaration[] = Object.values(OPERATIONS) as unknown as OperationDeclaration[];

export function operation(name: OperationName): OperationDeclaration {
  return OPERATIONS[name] as unknown as OperationDeclaration;
}

/**
 * The MCP tool name of an operation, by rule: camelCase to snake_case
 * (`setTaskDone` → `set_task_done`). Never written by hand.
 */
export function mcpToolName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The object shape of an operation's input (its fields), whatever refinements wrap it. */
export function inputShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  return s instanceof z.ZodObject ? (s.shape as Record<string, z.ZodTypeAny>) : {};
}

/** A Zod error as one line: "path: message; …". */
export function zodErrorText(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

const GONE: Record<RefKind, string> = {
  task: "That task no longer exists.",
  habit: "That habit no longer exists.",
  goal: "That goal no longer exists.",
  project: "That project no longer exists.",
  role: "That role no longer exists.",
  person: "That person no longer exists.",
  commitment: "That commitment no longer exists.",
};
const LISTS = { habit: "habits", goal: "goals", project: "projects", role: "roles", person: "people", commitment: "commitments" } as const;

/**
 * Why an operation with this (parsed) input cannot be done with this data, or
 * null: every item it names exists (an archived task does not), then its own
 * check. Runs in the app before a proposal is shown and pressed, and on the
 * server before the handler writes.
 */
export function checkOperation(decl: OperationDeclaration, input: unknown, data: CheckData): string | null {
  const args = input as Record<string, unknown>;
  for (const [arg, kind] of Object.entries(decl.refs ?? {})) {
    const value = args[arg];
    const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    for (const id of ids as string[]) {
      if (kind === "task") {
        if (data.tasks && !findTask(data, id)) return GONE.task;
        continue;
      }
      const list = data[LISTS[kind]];
      if (list && !list.some((item) => item.id === id)) return GONE[kind];
    }
  }
  return decl.check?.(input, data) ?? null;
}

function fieldValue(value: unknown): string {
  if (typeof value === "string") return `“${value}”`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null) return "none";
  return JSON.stringify(value);
}

/**
 * The confirm sentence: the operation's own wording, or else its title and the
 * fields that will be set ("Create a goal: title “Run a marathon”").
 */
export function operationSentence(decl: OperationDeclaration, input: unknown, lookup: ActionLookup): string {
  if (decl.describe) return decl.describe(input, lookup);
  const fields = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} ${fieldValue(v)}`);
  return fields.length ? `${decl.title}: ${fields.join(", ")}` : decl.title;
}
