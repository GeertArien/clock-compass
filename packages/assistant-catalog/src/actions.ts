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
 * accept.
 */
import { z } from "zod";

const Id = z.string().min(1).max(64);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time as HH:MM");

/** The kind of item an action touches, for display and for the executor. */
export type ActionTarget = "task" | "habit" | "week";

export interface ActionDefinition<Args extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  target: ActionTarget;
  /** One line for the model and for the UI's "what will happen" text. */
  summary: string;
  args: Args;
  /** The id of the item touched, for keys and display. */
  targetId: (args: z.infer<Args>) => string;
}

function define<Args extends z.ZodTypeAny>(def: ActionDefinition<Args>): ActionDefinition<Args> {
  return def;
}

export const ACTIONS = {
  setTaskDone: define({
    name: "setTaskDone",
    target: "task",
    summary: "Mark a task done, or reopen it.",
    args: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        done: z.boolean().describe("true to complete, false to reopen."),
      })
      .strict(),
    targetId: (a) => a.taskId,
  }),
  scheduleTask: define({
    name: "scheduleTask",
    target: "task",
    summary: "Put a task on a day (and optionally a time) in the Clock, or take it off.",
    args: z
      .object({
        taskId: Id.describe("Id of an existing task."),
        day: IsoDate.nullable().describe("YYYY-MM-DD, or null to unschedule."),
        time: HhMm.nullable().optional().describe("HH:MM on that day, or null for any time."),
      })
      .strict()
      .refine((a) => a.day !== null || !a.time, { message: "a time needs a day" }),
    targetId: (a) => a.taskId,
  }),
  setBigRock: define({
    name: "setBigRock",
    target: "task",
    summary: "Pin a Quadrant II task as one of this week's big rocks, or unpin it.",
    args: z
      .object({
        taskId: Id.describe("Id of an existing Q2 task."),
        bigRock: z.boolean().describe("true to pin, false to unpin."),
      })
      .strict(),
    targetId: (a) => a.taskId,
  }),
  setHabitDoneToday: define({
    name: "setHabitDoneToday",
    target: "habit",
    summary: "Check a habit off for today, or undo today's check-off.",
    args: z
      .object({
        habitId: Id.describe("Id of an existing habit."),
        done: z.boolean().describe("true to check off today, false to undo."),
      })
      .strict(),
    targetId: (a) => a.habitId,
  }),
  acceptWeekPlan: define({
    name: "acceptWeekPlan",
    target: "week",
    summary: "Accept a week plan: pin its tasks as the week's big rocks and save the intention.",
    args: z
      .object({
        weekStart: IsoDate.describe("Monday of the ISO week, YYYY-MM-DD."),
        taskIds: z.array(Id).min(1).max(7).describe("The big rocks, 1 to 7 task ids."),
        intention: z.string().trim().max(280).optional().describe("One line for the week."),
      })
      .strict(),
    targetId: (a) => a.weekStart,
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
  | { kind: "write"; name: ActionName; args: Record<string, unknown>; key: string; targetId: string }
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

/** The idempotency key of a confirmed action: surface, name and canonical arguments. */
export function actionKey(surfaceId: string, name: string, args: Record<string, unknown>): string {
  return `${surfaceId}|${name}|${canonical(args)}`;
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
