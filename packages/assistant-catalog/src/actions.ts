/**
 * Confirmable actions as data (issue #62, owner decision B).
 *
 * The writes the assistant can propose are the operations of the registry
 * (`operations.ts`, issue #109) marked `assistant: "propose"`: their name, the
 * kind of item they touch, a Zod schema for their arguments and the app's
 * wording. The app validates an action event with `parseAction` before it
 * shows or runs it, and the server validates it again when it runs.
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
 * What the schemas cannot check, `checkOperation` does with the app's or the
 * server's data: that the ids exist, and for `setBigRock` / `acceptWeekPlan`
 * that the tasks are Quadrant II.
 *
 * Big rocks follow the app's one rule (#98): a rock is a pinned task until it
 * is unpinned. `acceptWeekPlan` therefore replaces the open set: it pins the
 * plan's tasks and unpins every other open rock, and says so. Finished rocks
 * stay pinned, so the jar keeps what was done this week (#120).
 */
import { z } from "zod";
import { type CategoryFilter } from "./data-categories";
import {
  LEGACY_ACTION_NAMES,
  OPERATIONS,
  inputShape,
  operation,
  operationSentence,
  zodErrorText,
  type ActionLookup,
  type OperationDeclaration,
  type TaskChange,
} from "./operations";

export {
  MAX_INTENTION,
  RENEWAL_DIMENSIONS,
  type ActionLookup,
  type ActionTarget,
  type NamedKind,
  type NameLookup,
} from "./operations";

/** The operation names the assistant may propose. */
type ProposableName = {
  [K in keyof typeof OPERATIONS]: (typeof OPERATIONS)[K]["assistant"] extends "propose" ? K : never;
}[keyof typeof OPERATIONS];

/** The assistant's actions: the registry's operations it may propose, in registry order. */
export const ACTIONS = Object.fromEntries(
  Object.entries(OPERATIONS).filter(([, def]) => def.assistant === "propose"),
) as { [K in ProposableName]: (typeof OPERATIONS)[K] };

export type ActionDefinition = OperationDeclaration;

export type ActionName = keyof typeof ACTIONS;
export type ActionArgs<N extends ActionName> = z.infer<(typeof ACTIONS)[N]["input"]>;

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
      /** The tasks it changes and what it sets on each (#145). */
      taskChanges: (lookup: ActionLookup) => TaskChange[];
    }
  | { kind: "message"; name: string }
  | { kind: "invalid"; name: string; error: string };

/**
 * Classifies an action event: a confirmable write with valid arguments (and
 * its key), a plain conversational event (e.g. a "Not now"), or an invalid
 * write that must not run.
 */
export function parseAction(event: ActionEvent): ParsedAction {
  // A proposal stored under a name from before #109 step 3 still parses.
  const name = Object.hasOwn(LEGACY_ACTION_NAMES, event.name) ? LEGACY_ACTION_NAMES[event.name]! : event.name;
  if (!isConfirmableAction(name)) return { kind: "message", name: event.name };
  const def = operation(name);
  const result = def.input.safeParse(event.context ?? {});
  if (!result.success) return { kind: "invalid", name, error: zodErrorText(result.error) };
  const args = result.data as Record<string, unknown>;
  return {
    kind: "write",
    name,
    args,
    targetId: def.targetId?.(args) ?? "",
    // Keyed by the name as stored, so a proposal applied before the rename
    // keeps its key (and is still refused as already applied).
    key: actionKey(event.surfaceId, event.name, args),
    describe: (lookup) => operationSentence(def, args, lookup),
    taskChanges: (lookup) => def.taskChanges?.(args, lookup) ?? [],
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

/**
 * The actions as text for the system prompt: name, summary and arguments of
 * every operation the assistant may propose whose data category is on.
 */
export function describeActions(categories: CategoryFilter = {}): string {
  return (Object.values(ACTIONS) as unknown as OperationDeclaration[])
    .filter((def) => categories[def.category] !== false)
    .map((def) => {
      const args = Object.entries(inputShape(def.input))
        .map(([key, schema]) => `    - ${key}${schema.isOptional() ? " (optional)" : ""}: ${schema.description ?? ""}`)
        .join("\n");
      return `- ${def.name} (${def.target}): ${def.summary}\n${args}`;
    })
    .join("\n");
}
