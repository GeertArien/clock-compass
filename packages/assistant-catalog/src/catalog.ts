/**
 * The assistant catalog as APIs only, payload validation, and the catalog's
 * description for the system prompt.
 */
import {
  BASIC_FUNCTIONS,
  Catalog,
  MessageProcessor,
  STRICT_VALIDATION,
  V10_STANDARD_DEFS,
  type ComponentApi,
} from "@a2ui/web_core/v1_0";
import { describeActions, isConfirmableAction } from "./actions";
import type { CategoryFilter } from "./data-categories";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";
import { APP_APIS, PRIMITIVE_APIS } from "./components";

export const CC_CATALOG_ID = "clock-compass:assistant/v1";

/** The functions bindings and checks may call. */
const FUNCTION_NAMES = new Set(["required", "regex", "email", "formatString", "formatDate"]);
export const CATALOG_FUNCTIONS = BASIC_FUNCTIONS.filter((f) => FUNCTION_NAMES.has(f.name));

const SHOWING_INSTRUCTIONS = [
  "Show existing items by id with TaskCard, QuadrantBoard, GoalList and HabitCheckIn; never restate their details in Text.",
  "Use Chart for numbers you computed from tool results.",
];
export const CATALOG_INSTRUCTIONS = [
  ...SHOWING_INSTRUCTIONS,
  "A confirmable action may only be the `confirm` of a ConfirmBar; end every proposal with one.",
].join(" ");
/** The instructions for screens that only show information (no ConfirmBar yet). */
const READ_ONLY_INSTRUCTIONS = SHOWING_INSTRUCTIONS.join(" ");

/** Every component the assistant may use, as APIs. */
export const CATALOG_APIS = [...PRIMITIVE_APIS, ...APP_APIS] as const;

/** The catalog as APIs only: what validates a payload without rendering it. */
export const ccApiCatalog = new Catalog<ComponentApi>(
  CC_CATALOG_ID,
  "1.0",
  [...CATALOG_APIS],
  CATALOG_FUNCTIONS,
  { instructions: CATALOG_INSTRUCTIONS },
);

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates a complete A2UI 1.0 payload (all messages of a response) the way
 * the server must before passing it on (issue #62, decision 3). Model output
 * can have any shape, so this reports problems and never throws.
 * - strict protocol and catalog validation by the official core (known
 *   components and functions, schema-valid props, a root, no dangling or
 *   orphaned references);
 * - bindings and calls use the final `@path` / `@call` keys;
 * - a confirmable action appears only as a ConfirmBar's `confirm`.
 * Action arguments are bound to the data model, so they are checked when the
 * action is sent (`parseAction`), not here. The error messages name the
 * right spelling, so they can be fed back to the model for a retry.
 */
export function validatePayload(messages: unknown): ValidationResult {
  if (!Array.isArray(messages) || !messages.every(isRecord)) {
    return { ok: false, errors: ["A payload must be an array of message objects."] };
  }
  const errors: string[] = [];
  const processor = new MessageProcessor<ComponentApi>([ccApiCatalog], undefined, {
    validationConfig: STRICT_VALIDATION,
  });
  try {
    processor.processMessages(acceptFinalEnvelopeKeys(messages) as never);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  errors.push(...unconfirmedWrites(messages), ...preFinalBindings(messages));
  return errors.length ? { ok: false, errors } : { ok: true };
}

type RawComponent = Record<string, unknown> & { id?: unknown; component?: unknown };

/** The component objects of every message, skipping anything malformed. */
function componentsOf(messages: A2uiMessage[]): RawComponent[] {
  return messages.flatMap((message) => {
    const holder = message.updateComponents ?? message.createSurface;
    const components = isRecord(holder) ? holder.components : undefined;
    return Array.isArray(components) ? components.filter(isRecord) : [];
  });
}

const where = (component: RawComponent, prop: string) =>
  `${String(component.component)} "${String(component.id)}" ${prop}`;

/** Confirmable actions placed anywhere other than a ConfirmBar's `confirm`. */
function unconfirmedWrites(messages: A2uiMessage[]): string[] {
  const errors: string[] = [];
  for (const component of componentsOf(messages)) {
    for (const [prop, value] of Object.entries(component)) {
      for (const name of eventNames(value)) {
        if (!isConfirmableAction(name)) continue;
        if (component.component === "ConfirmBar" && prop === "confirm") continue;
        errors.push(
          `${String(component.component)} "${String(component.id)}" sends "${name}" from "${prop}"; ` +
            "a confirmable action may only be a ConfirmBar's confirm.",
        );
      }
    }
  }
  return errors;
}

/** Every `{event: {name}}` action name inside a prop value. */
function eventNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(eventNames);
  if (!isRecord(value)) return [];
  const event = value.event;
  const own = isRecord(event) && typeof event.name === "string" ? [event.name] : [];
  return [...own, ...Object.values(value).flatMap(eventNames)];
}

/**
 * Bindings and function calls written with the pre-final bare keys (`path`,
 * `call`). web_core 0.15.0's schemas accept both spellings, but its strict
 * function check and the renderer only read `@path` / `@call`, so a bare one
 * would reach a component unresolved (and crash it). A child template's `path`
 * (next to `componentId`) is final.
 */
function preFinalBindings(messages: A2uiMessage[]): string[] {
  const errors: string[] = [];
  const walk = (value: unknown, at: string): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, at));
    if (!isRecord(value)) return;
    if (typeof value.path === "string" && !("@path" in value) && !("componentId" in value)) {
      errors.push(`${at} binds with "path"; write {"@path": …}.`);
    }
    if (typeof value.call === "string" && !("@call" in value)) {
      errors.push(`${at} calls "${value.call}" with "call"; write {"@call": …}.`);
    }
    Object.values(value).forEach((v) => walk(v, at));
  };
  for (const component of componentsOf(messages)) {
    for (const [prop, value] of Object.entries(component)) walk(value, where(component, prop));
  }
  return errors;
}

/**
 * The prompt shows the final `@checks` envelope key only. web_core 0.15.0's
 * schemas still name it `checks` (compat.ts maps the final key back), so the
 * documents are rewritten here: one spelling for the model, the one the
 * fixtures and the spec use.
 */
function withFinalChecksKey(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withFinalChecksKey);
  if (!isRecord(node)) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      if (key === "properties" && isRecord(value) && "checks" in value) {
        const { checks, ...rest } = value;
        return [key, withFinalChecksKey({ ...rest, "@checks": checks })];
      }
      if (key === "required" && Array.isArray(value)) {
        return [key, value.map((v) => (v === "checks" ? "@checks" : v))];
      }
      return [key, withFinalChecksKey(value)];
    }),
  );
}

/**
 * The catalog for the system prompt: the official catalog document (JSON
 * schemas of every component and function, as `Catalog.toJson` writes it),
 * the shared definitions it refers to (bindings, function calls, child lists,
 * checks, actions), the usage instructions, and the confirmable actions.
 * With `confirmations: false` (until the app can carry out a confirmed
 * action) the ConfirmBar, its instruction and the action list are left out,
 * so the prompt never tells the model to use what the server refuses.
 * `categories` leaves out the actions whose data category is switched off.
 */
export function describeCatalog(options: { confirmations?: boolean; categories?: CategoryFilter } = {}): string {
  const confirmations = options.confirmations ?? true;
  const document = withFinalChecksKey(ccApiCatalog.toJson()) as {
    instructions?: string;
    components: Record<string, unknown>;
    $defs?: { anyComponent?: { oneOf?: { $ref?: string }[] } };
  };
  const instructions = confirmations ? CATALOG_INSTRUCTIONS : READ_ONLY_INSTRUCTIONS;
  if (confirmations) {
    // A bar that proposes a write always shows the app's own buttons
    // ("Confirm", "Not now"), so the model is not offered labels that would
    // never be shown (#109, section 10). The validator still accepts them.
    const bar = document.components.ConfirmBar as { properties?: Record<string, unknown> } | undefined;
    delete bar?.properties?.confirmLabel;
    delete bar?.properties?.dismissLabel;
  } else {
    delete document.components.ConfirmBar;
    document.instructions = instructions;
    const any = document.$defs?.anyComponent;
    if (any?.oneOf) any.oneOf = any.oneOf.filter((ref) => ref.$ref !== "#/components/ConfirmBar");
  }
  return [
    `A2UI catalog "${CC_CATALOG_ID}" (protocol 1.0):`,
    JSON.stringify(document),
    "",
    "Shared definitions (common_types.json), referenced above:",
    JSON.stringify(withFinalChecksKey({ $defs: V10_STANDARD_DEFS })),
    "",
    `Instructions: ${instructions}`,
    ...(confirmations
      ? ["", "Confirmable actions (send as a ConfirmBar's confirm event; context = the arguments):", describeActions(options.categories)]
      : []),
  ].join("\n");
}
