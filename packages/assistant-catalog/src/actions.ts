/**
 * Confirmable actions as data (issue #62, owner decision B).
 *
 * Every write the assistant can propose is described here: its name, the
 * kind of item it touches, and a Zod schema for its arguments. Whoever
 * carries an action out (the web app's client mutations today, a server-side
 * executor for an MCP App later) validates it with `parseAction` first.
 *
 * Two rules make actions safe to repeat:
 * - Each action states a target state ("done: true"), never a toggle, so
 *   applying it to an item already in that state changes nothing.
 * - Each confirmed action has a key (`actionKey`): its surface, name and
 *   canonical arguments. Surface ids are unique per proposal (the server
 *   issues them), so an executor that records applied keys can refuse a
 *   repeat, whatever caused it (a double tap, a remount, a reload).
 *
 * A confirmable action may only be sent from a ConfirmBar's `confirm`
 * (enforced by `validatePayload`), so nothing is written without an explicit
 * accept. `describe` gives the app's own wording of a resolved action (from
 * the items looked up by id), so the confirm step can show what will really
 * happen, whatever the model wrote around it.
 *
 * What the schemas cannot check, the executor must: that the ids exist, and
 * for `setBigRock` / `acceptWeekPlan` that the tasks are Quadrant II.
 *
 * Big rocks follow the app's one rule (#98): a rock is a pinned task until it
 * is unpinned. `acceptWeekPlan` therefore replaces the whole set: it pins the
 * plan's tasks and unpins every other pinned task, and says so.
 */
import { z } from "zod";

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

/** The kind of item an action touches, for display and for the executor. */
export type ActionTarget = "task" | "habit" | "week" | "intention";

/** Looks up an item's display name by kind and id (the executor's data). */
export type NameLookup = (kind: "task" | "habit", id: string) => string | undefined;

/** What describing an action may look up in the app's data. */
export interface ActionLookup {
  name: NameLookup;
  /** The ids of the tasks pinned as big rocks now (not archived). */
  pinnedTaskIds: () => readonly string[];
}

/** The four renewal dimensions (Habit 7), as the API names them. */
export const RENEWAL_DIMENSIONS = ["PHYSICAL", "MENTAL", "SOCIAL_EMOTIONAL", "SPIRITUAL"] as const;
const DIMENSION_LABELS: Record<(typeof RENEWAL_DIMENSIONS)[number], string> = {
  PHYSICAL: "physical",
  MENTAL: "mental",
  SOCIAL_EMOTIONAL: "social/emotional",
  SPIRITUAL: "spiritual",
};
/** Longest intention the assistant may propose. */
export const MAX_INTENTION = 280;

export interface ActionDefinition<Args extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  target: ActionTarget;
  /** One line for the model: what the action does, as a target state. */
  summary: string;
  args: Args;
  /** The id of the item touched, for keys and display. */
  targetId: (args: z.infer<Args>) => string;
  /** The app's own wording of this resolved action, for the confirm step. */
  describe: (args: z.infer<Args>, lookup: ActionLookup) => string;
}

const quoted = (lookup: ActionLookup, kind: "task" | "habit", id: string) => {
  const found = lookup.name(kind, id);
  return found === undefined ? `a ${kind} that no longer exists` : `“${found}”`;
};

function define<Args extends z.ZodTypeAny>(def: ActionDefinition<Args>): ActionDefinition<Args> {
  return def;
}

export const ACTIONS = {
  setTaskDone: define({
    name: "setTaskDone",
    target: "task",
    summary: "Mark a task done (done: true) or open (done: false).",
    args: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        done: z.boolean().describe("true to complete, false to reopen."),
      })
      .strict(),
    targetId: (a) => a.taskId,
    describe: (a, lookup) => `${a.done ? "Mark" : "Reopen"} ${quoted(lookup, "task", a.taskId)}${a.done ? " done" : ""}`,
  }),
  scheduleTask: define({
    name: "scheduleTask",
    target: "task",
    summary:
      "Put a task on a day in the Clock, at a time or at no particular time (time left out = no time), or take it off (day: null).",
    args: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        day: IsoDate.nullable().describe("YYYY-MM-DD, or null to unschedule."),
        time: HhMm.nullable()
          .default(null)
          .describe("HH:MM on that day; null or left out for no particular time."),
      })
      .strict()
      .refine((a) => a.day !== null || a.time === null, { message: "a time needs a day", path: ["time"] }),
    targetId: (a) => a.taskId,
    describe: (a, lookup) =>
      a.day === null
        ? `Take ${quoted(lookup, "task", a.taskId)} off the Clock`
        : `Schedule ${quoted(lookup, "task", a.taskId)} on ${a.day}${a.time ? ` at ${a.time}` : ""}`,
  }),
  setBigRock: define({
    name: "setBigRock",
    target: "task",
    summary: "Pin a Quadrant II task as a big rock (bigRock: true), or unpin it. A rock stays pinned until it is unpinned.",
    args: z
      .object({
        taskId: Id.describe("Id of an existing Q2 task (important, not urgent)."),
        bigRock: z.boolean().describe("true to pin, false to unpin."),
      })
      .strict(),
    targetId: (a) => a.taskId,
    describe: (a, lookup) =>
      `${a.bigRock ? "Pin" : "Unpin"} ${quoted(lookup, "task", a.taskId)} as a big rock`,
  }),
  setHabitDoneToday: define({
    name: "setHabitDoneToday",
    target: "habit",
    summary: "Check a habit off for today (done: true), or undo today's check-off.",
    args: z
      .object({
        habitId: Id.describe("Id of an existing habit."),
        done: z.boolean().describe("true to check off today, false to undo."),
      })
      .strict(),
    targetId: (a) => a.habitId,
    describe: (a, lookup) =>
      `${a.done ? "Check off" : "Undo today's check-off of"} ${quoted(lookup, "habit", a.habitId)}${a.done ? " for today" : ""}`,
  }),
  acceptWeekPlan: define({
    name: "acceptWeekPlan",
    target: "week",
    summary:
      "Make exactly these Quadrant II tasks the big rocks for the week: they are pinned, and every other pinned task is unpinned.",
    args: z
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
    targetId: (a) => a.weekStart,
    describe: (a, lookup) => {
      const plan = new Set(a.taskIds);
      const unpinned = lookup.pinnedTaskIds().filter((id) => !plan.has(id));
      const rocks = `Make ${a.taskIds.map((id) => quoted(lookup, "task", id)).join(", ")} the big rocks for the week of ${a.weekStart}`;
      return unpinned.length
        ? `${rocks}, and unpin ${unpinned.map((id) => quoted(lookup, "task", id)).join(", ")}`
        : rocks;
    },
  }),
  setIntention: define({
    name: "setIntention",
    target: "intention",
    summary:
      "Set this week's intention for one renewal dimension (Sharpen the Saw). It replaces the current one; it cannot clear it.",
    args: z
      .object({
        dimension: z.enum(RENEWAL_DIMENSIONS).describe("PHYSICAL, MENTAL, SOCIAL_EMOTIONAL or SPIRITUAL."),
        text: z
          .string()
          .trim()
          .min(1, "an intention cannot be empty")
          .max(MAX_INTENTION)
          .describe(`The intention, one short sentence (at most ${MAX_INTENTION} characters).`),
      })
      .strict(),
    targetId: (a) => a.dimension,
    describe: (a) => `Set this week's ${DIMENSION_LABELS[a.dimension]} intention to “${a.text}”`,
  }),
} as const;

export type ActionName = keyof typeof ACTIONS;
export type ActionArgs<N extends ActionName> = z.infer<(typeof ACTIONS)[N]["args"]>;

export function isConfirmableAction(name: string): name is ActionName {
  return Object.hasOwn(ACTIONS, name);
}

/** What a renderer sends when a component's action fires (the A2UI action event). */
export interface ActionEvent {
  name: string;
  surfaceId: string;
  context?: Record<string, unknown>;
}

export type ParsedAction =
  | {
      kind: "write";
      name: ActionName;
      args: Record<string, unknown>;
      key: string;
      targetId: string;
      /** The app's wording of this action, given the app's data. */
      describe: (lookup: ActionLookup) => string;
    }
  | { kind: "message"; name: string }
  | { kind: "invalid"; name: string; error: string };

/**
 * Classifies an action event: a confirmable write with valid arguments (and
 * its key), a plain conversational event (e.g. a "Not now"), or an invalid
 * write that must not run.
 */
export function parseAction(event: ActionEvent): ParsedAction {
  if (!isConfirmableAction(event.name)) return { kind: "message", name: event.name };
  const def = ACTIONS[event.name] as unknown as ActionDefinition;
  const result = def.args.safeParse(event.context ?? {});
  if (!result.success) {
    const error = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return { kind: "invalid", name: event.name, error };
  }
  const args = result.data as Record<string, unknown>;
  return {
    kind: "write",
    name: event.name,
    args,
    targetId: def.targetId(args),
    key: actionKey(event.surfaceId, event.name, args),
    describe: (lookup) => def.describe(args, lookup),
  };
}

/** JSON with object keys sorted, so equal arguments give equal keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The idempotency key of a confirmed action: surface, name and canonical
 * arguments, JSON-encoded so no surface id or name can run into the next part.
 */
export function actionKey(surfaceId: string, name: string, args: Record<string, unknown>): string {
  return `[${JSON.stringify(surfaceId)},${JSON.stringify(name)},${canonical(args)}]`;
}

/** The actions as text for the system prompt: name, summary and arguments. */
export function describeActions(): string {
  return Object.values(ACTIONS)
    .map((def) => {
      const shape = argShape(def.args);
      const args = Object.entries(shape)
        .map(([key, schema]) => `    - ${key}${schema.isOptional() ? " (optional)" : ""}: ${schema.description ?? ""}`)
        .join("\n");
      return `- ${def.name} (${def.target}): ${def.summary}\n${args}`;
    })
    .join("\n");
}

function argShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  return s instanceof z.ZodObject ? (s.shape as Record<string, z.ZodTypeAny>) : {};
}
