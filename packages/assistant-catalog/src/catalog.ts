/**
 * The assistant catalog as APIs only, payload validation, and the catalog's
 * description for the system prompt.
 */
import {
  BASIC_FUNCTIONS,
  Catalog,
  MessageProcessor,
  STRICT_VALIDATION,
  type ComponentApi,
} from "@a2ui/web_core/v1_0";
import { describeActions, isConfirmableAction } from "./actions";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";
import { APP_APIS, PRIMITIVE_APIS } from "./components";

export const CC_CATALOG_ID = "clock-compass:assistant/v1";

/** The functions bindings and checks may call. */
const FUNCTION_NAMES = new Set(["required", "regex", "email", "formatString", "formatDate"]);
export const CATALOG_FUNCTIONS = BASIC_FUNCTIONS.filter((f) => FUNCTION_NAMES.has(f.name));

export const CATALOG_INSTRUCTIONS = [
  "Show existing items by id with TaskCard, QuadrantBoard, GoalList and HabitCheckIn; never restate their details in Text.",
  "Use Chart for numbers you computed from tool results.",
  "A confirmable action may only be the `confirm` of a ConfirmBar; end every proposal with one.",
].join(" ");

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

/**
 * Validates a complete A2UI 1.0 payload (all messages of a response) the way
 * the server must before passing it on (issue #62, decision 3):
 * - strict protocol and catalog validation by the official core (known
 *   components and functions, schema-valid props, a root, no dangling or
 *   orphaned references);
 * - a confirmable action appears only as a ConfirmBar's `confirm`.
 * Action arguments are bound to the data model, so they are checked when the
 * action is sent (`parseAction`), not here.
 */
export function validatePayload(messages: A2uiMessage[]): ValidationResult {
  const errors: string[] = [];
  const processor = new MessageProcessor<ComponentApi>([ccApiCatalog], undefined, {
    validationConfig: STRICT_VALIDATION,
  });
  try {
    processor.processMessages(acceptFinalEnvelopeKeys(messages) as never);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  errors.push(...unconfirmedWrites(messages));
  return errors.length ? { ok: false, errors } : { ok: true };
}

type RawComponent = Record<string, unknown> & { id?: unknown; component?: unknown };

/** Confirmable actions placed anywhere other than a ConfirmBar's `confirm`. */
function unconfirmedWrites(messages: A2uiMessage[]): string[] {
  const errors: string[] = [];
  for (const message of messages) {
    const holder = (message.updateComponents ?? message.createSurface) as
      | { components?: RawComponent[] }
      | undefined;
    for (const component of holder?.components ?? []) {
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
  }
  return errors;
}

/** Every `{event: {name}}` action name inside a prop value. */
function eventNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(eventNames);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own =
    record.event && typeof record.event === "object" && typeof (record.event as { name?: unknown }).name === "string"
      ? [(record.event as { name: string }).name]
      : [];
  return [...own, ...Object.values(record).flatMap(eventNames)];
}

/**
 * The catalog for the system prompt: the official catalog document (JSON
 * schemas of every component and function, as `Catalog.toJson` writes it),
 * the usage instructions, and the confirmable actions.
 */
export function describeCatalog(): string {
  return [
    `A2UI catalog "${CC_CATALOG_ID}" (protocol 1.0):`,
    JSON.stringify(ccApiCatalog.toJson()),
    "",
    `Instructions: ${CATALOG_INSTRUCTIONS}`,
    "",
    "Confirmable actions (send as a ConfirmBar's confirm event; context = the arguments):",
    describeActions(),
  ].join("\n");
}
