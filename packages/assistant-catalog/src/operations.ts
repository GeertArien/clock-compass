/**
 * The operation registry (issue #109): every write the app offers to agents,
 * declared once.
 *
 * A declaration is plain data plus pure functions, importable in the browser:
 * - `name` and `summary` (for the model), `input` (a strict Zod schema);
 * - `hints`: MCP's standard tool annotations;
 * - `assistant`: whether the in-app assistant may propose it ("propose") or
 *   never ("never"); `mcp`: whether the MCP adapter offers it as a tool;
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
export type ActionTarget = "task" | "habit" | "week" | "intention";

/** Longest task title and notes the assistant may propose (the task form sets none; these keep a proposal readable). */
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_NOTES = 2000;

/** Looks up an item's display name by kind and id (the app's data). */
export type NameLookup = (kind: "task" | "habit" | "goal" | "project", id: string) => string | undefined;

/** A task as the confirm sentence of `updateTask` compares it: days as YYYY-MM-DD. */
export interface LookupTask {
  title: string;
  notes: string | null;
  important: boolean;
  urgent: boolean;
  proactivity: "INFLUENCE" | "CONCERN" | null;
  /** The due date (a plain date). */
  dueDate: string | null;
  /** The day it is scheduled on, in the user's time zone. */
  scheduledDay: string | null;
  scheduledTime: string | null;
  projectId: string | null;
  goalId: string | null;
}

/** What describing an operation may look up in the app's data. */
export interface ActionLookup {
  name: NameLookup;
  /** The ids of the tasks pinned as big rocks now (not archived). */
  pinnedTaskIds: () => readonly string[];
  /** A task as it is now, to name only what an edit changes (absent: unknown). */
  task?: (id: string) => LookupTask | undefined;
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
}

export type RefKind = "task" | "habit" | "goal" | "project";

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
   * Creates an item: not safe to repeat by itself. The endpoint makes it so
   * with an `Idempotency-Key` (the same key returns the item made the first
   * time), and the result carries the new item's `id`.
   */
  creates?: "task";
  /** Assistant actions: the kind of item touched, and its id (for keys and display). */
  target?: ActionTarget;
  targetId?: (input: z.infer<Input>) => string;
}

function define<Input extends z.ZodTypeAny, const Access extends "propose" | "never">(
  def: OperationDeclaration<Input, Access>,
): OperationDeclaration<Input, Access> {
  return def;
}

const quoted = (lookup: ActionLookup, kind: "task" | "habit" | "goal" | "project", id: string) => {
  const found = lookup.name(kind, id);
  return found === undefined ? `a ${kind} that no longer exists` : `“${found}”`;
};

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
const was = (before: string | undefined) => (before === undefined ? "" : ` (was ${before})`);

/** "Create the task “X”, important, due 2027-11-01, in the project “Y”". */
function describeCreate(a: z.infer<typeof CreateTaskInput>, lookup: ActionLookup): string {
  const parts = [
    ...flags(a.important, a.urgent),
    ...(a.proactivity ? [proactivityWords(a.proactivity)] : []),
    ...(a.dueDate ? [`due ${a.dueDate}`] : []),
    ...(a.scheduledDay ? [dayWords(a.scheduledDay, a.scheduledTime ?? null)] : []),
    ...(a.projectId ? [`in the project ${quoted(lookup, "project", a.projectId)}`] : []),
    ...(a.goalId ? [`for the goal ${quoted(lookup, "goal", a.goalId)}`] : []),
    ...(a.notes ? ["with notes"] : []),
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
    changes.push(a.notes ? "replace its notes" : "clear its notes");
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
  return changes.length ? `Change ${name}: ${changes.join(", ")}` : `Leave ${name} as it is (nothing would change)`;
}

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
  })
  .strict()
  .refine(timeNeedsDay, TIME_NEEDS_DAY);

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
    mcp: false,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `${a.done ? "Mark" : "Reopen"} ${quoted(lookup, "task", a.taskId)}${a.done ? " done" : ""}`,
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
    mcp: false,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    targetId: (a) => a.taskId,
    describe: (a, lookup) =>
      a.day === null
        ? `Take ${quoted(lookup, "task", a.taskId)} off the Clock`
        : `Schedule ${quoted(lookup, "task", a.taskId)} on ${a.day}${a.time ? ` at ${a.time}` : ""}`,
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
    mcp: false,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task" },
    check: (a, data) => {
      const task = findTask(data, a.taskId);
      return a.bigRock && task && !isQ2(task) ? notRock(task) : null;
    },
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `${a.bigRock ? "Pin" : "Unpin"} ${quoted(lookup, "task", a.taskId)} as a big rock`,
  }),
  setHabitDoneToday: define({
    name: "setHabitDoneToday",
    title: "Check a habit off for today",
    target: "habit",
    summary: "Check a habit off for today (done: true), or undo today's check-off.",
    input: z
      .object({
        habitId: Id.describe("Id of an existing habit."),
        done: z.boolean().describe("true to check off today, false to undo."),
      })
      .strict(),
    hints: hints(false, true),
    assistant: "propose",
    mcp: false,
    category: "habitsAndRenewal",
    touches: ["habits"],
    refs: { habitId: "habit" },
    targetId: (a) => a.habitId,
    describe: (a, lookup) =>
      `${a.done ? "Check off" : "Undo today's check-off of"} ${quoted(lookup, "habit", a.habitId)}${a.done ? " for today" : ""}`,
  }),
  acceptWeekPlan: define({
    name: "acceptWeekPlan",
    title: "Set the week's big rocks",
    target: "week",
    summary:
      "Make exactly these Quadrant II tasks the big rocks for the week: they are pinned, and every other pinned task is unpinned.",
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
    mcp: false,
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
  }),
  setIntention: define({
    name: "setIntention",
    title: "Set this week's intention",
    target: "intention",
    summary:
      "Set this week's intention for one renewal dimension (Sharpen the Saw). It replaces the current one; it cannot clear it.",
    input: z
      .object({
        dimension: DIMENSION.describe("PHYSICAL, MENTAL, SOCIAL_EMOTIONAL or SPIRITUAL."),
        text: z
          .string()
          .trim()
          .min(1, "an intention cannot be empty")
          .max(MAX_INTENTION)
          .describe(`The intention, one short sentence (at most ${MAX_INTENTION} characters).`),
      })
      .strict(),
    hints: hints(true, true),
    assistant: "propose",
    mcp: false,
    category: "habitsAndRenewal",
    touches: ["intentions"],
    targetId: (a) => a.dimension,
    describe: (a) => `Set this week's ${DIMENSION_LABELS[a.dimension]} intention to “${a.text}”`,
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
    mcp: false,
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
    mcp: false,
    category: "tasks",
    touches: ["tasks"],
    refs: { taskId: "task", projectId: "project", goalId: "goal" },
    targetId: (a) => a.taskId,
    describe: describeUpdate,
  }),

  // --- The MCP adapter's write tools (names and schemas unchanged) --------------
  create_task: define({
    name: "create_task",
    title: "Create a task",
    summary: "Create a task. Quadrant is derived from important × urgent.",
    input: z
      .object({
        title: z.string().min(1),
        notes: z.string().optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
        dueDate: z.string().datetime().optional(),
        goalId: z.string().optional(),
        projectId: z.string().optional(),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks", "goals", "projects"],
  }),
  update_task: define({
    name: "update_task",
    title: "Change a task",
    summary: "Partially update a task (flags, links, due date, schedule, big-rock pin).",
    input: z
      .object({
        id: z.string(),
        title: z.string().min(1).optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
        dueDate: z.string().datetime().nullable().optional(),
        goalId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        isBigRock: z.boolean().optional(),
        scheduledDay: z.string().datetime().nullable().optional(),
        scheduledTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
      })
      .strict(),
    hints: hints(true, true),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks", "goals", "projects"],
  }),
  complete_task: define({
    name: "complete_task",
    title: "Complete a task",
    summary: "Mark a task done.",
    input: z.object({ id: z.string() }).strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks", "goals", "projects"],
  }),
  reopen_task: define({
    name: "reopen_task",
    title: "Reopen a task",
    summary: "Reopen a completed task.",
    input: z.object({ id: z.string() }).strict(),
    hints: hints(false, true),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks", "goals", "projects"],
  }),
  delete_task: define({
    name: "delete_task",
    title: "Delete a task",
    summary: "Delete a task.",
    input: z.object({ id: z.string() }).strict(),
    hints: hints(true, true),
    assistant: "never",
    mcp: true,
    category: "tasks",
    touches: ["tasks", "goals", "projects"],
  }),
  set_mission: define({
    name: "set_mission",
    title: "Write the mission statement",
    summary: "Write the mission statement (previous versions are kept).",
    input: z.object({ content: z.string().min(1) }).strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "mission",
    touches: ["mission"],
  }),
  create_goal: define({
    name: "create_goal",
    title: "Create a goal",
    summary: "Create a goal (a durable outcome), optionally under a role.",
    input: z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        targetDate: z.string().datetime().optional(),
        roleId: z.string().optional(),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "goalsAndProjects",
    touches: ["goals"],
  }),
  create_project: define({
    name: "create_project",
    title: "Create a project",
    summary: "Create a project (a multi-step outcome), optionally serving a goal.",
    input: z.object({ name: z.string().min(1), goalId: z.string().optional() }).strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "goalsAndProjects",
    touches: ["projects", "goals"],
  }),
  log_commitment_occurrence: define({
    name: "log_commitment_occurrence",
    title: "Log a commitment occurrence",
    summary: "Log that a commitment happened (per-person tracking).",
    input: z
      .object({
        commitmentId: z.string(),
        personId: z.string().optional(),
        note: z.string().optional(),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "people",
    touches: ["people"],
  }),
  add_eba_entry: define({
    name: "add_eba_entry",
    title: "Add an emotional-bank-account entry",
    summary: "Log an emotional-bank-account deposit or withdrawal for a person.",
    input: z
      .object({
        personId: z.string(),
        kind: z.enum(["DEPOSIT", "WITHDRAWAL"]),
        note: z.string().optional(),
      })
      .strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "ebaBalance",
    touches: ["people"],
  }),
  toggle_habit: define({
    name: "toggle_habit",
    title: "Toggle a habit's check-off",
    summary: "Toggle a habit's check-off for a day (defaults to today; future days rejected).",
    input: z.object({ habitId: z.string(), day: z.string().datetime().optional() }).strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["habits"],
  }),
  log_renewal_activity: define({
    name: "log_renewal_activity",
    title: "Log a renewal activity",
    summary: "Log a one-off renewal activity (a retreat, a long hike) toward a dimension.",
    input: z.object({ dimension: DIMENSION, title: z.string().min(1), note: z.string().optional() }).strict(),
    hints: hints(false, false),
    assistant: "never",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["renewal"],
  }),
  set_weekly_intention: define({
    name: "set_weekly_intention",
    title: "Set or clear this week's intention",
    summary: "Set (or clear, with empty text) this week's intention for a dimension.",
    input: z.object({ dimension: DIMENSION, text: z.string() }).strict(),
    hints: hints(true, true),
    assistant: "never",
    mcp: true,
    category: "habitsAndRenewal",
    touches: ["intentions"],
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
};

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
      if (kind === "task" && data.tasks && !findTask(data, id)) return GONE.task;
      if (kind === "habit" && data.habits && !data.habits.some((h) => h.id === id)) return GONE.habit;
      if (kind === "goal" && data.goals && !data.goals.some((g) => g.id === id)) return GONE.goal;
      if (kind === "project" && data.projects && !data.projects.some((p) => p.id === id)) return GONE.project;
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
