/**
 * The assistant's one presentation tool (issue #62, step 4): the model asks
 * for an interactive screen built from the app's own components by calling
 * `render_a2ui`. The server, not the client, decides whether the screen may be
 * shown: the arguments become a complete A2UI 1.0 surface that must pass the
 * catalog's `validatePayload`. Invalid output goes back to the model with the
 * errors so it can correct it; after MAX_RENDER_FAILURES the model is told to
 * answer in plain text (decision 3: fall back to plain text).
 *
 * The tool's name and argument shape (`surfaceId`, `components`, `data`) are
 * the ones the AG-UI A2UI middleware uses, so the model sees the familiar
 * shape and the two stay interchangeable.
 */
import { z } from "zod/v4";
import {
  CC_CATALOG_ID,
  describeCatalog,
  validatePayload,
  type A2uiMessage,
  type CategoryFilter,
} from "@clock-compass/assistant-catalog";
import type { ToolSpec } from "../ai/provider.js";

export const RENDER_TOOL_NAME = "render_a2ui";

/** Failed render attempts per run before the model must answer in plain text. */
export const MAX_RENDER_FAILURES = 2;

/** Longest render arguments accepted, in characters of JSON. */
const MAX_RENDER_ARGS = 100_000;

const RenderArgs = z
  .object({
    surfaceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "use 1-64 letters, digits, '_' or '-'"),
    components: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const RENDER_TOOL: ToolSpec = {
  name: RENDER_TOOL_NAME,
  description:
    "Show the user an interactive screen built from the app's components (the A2UI catalog in the system prompt). " +
    "One call is one surface: a flat list of components whose root has id \"root\", and an optional data model the components bind to with {\"@path\": …}. " +
    "Refer to tasks, goals and habits by their ids; the app fills in their live details. " +
    "The result says whether it was shown; when it was not, it lists what to fix.",
  inputSchema: {
    type: "object",
    properties: {
      surfaceId: { type: "string", description: "A short id for this screen, e.g. \"week_plan\"." },
      components: {
        type: "array",
        description: 'The A2UI 1.0 components, flat. The root component has id "root".',
        items: { type: "object" },
      },
      data: { type: "object", description: "The surface's data model, written at the root path." },
    },
    required: ["surfaceId", "components"],
    additionalProperties: false,
  },
};

export type RenderOutcome =
  | { ok: true; surfaceId: string; messages: A2uiMessage[] }
  | { ok: false; errors: string[] };

export interface RenderOptions {
  /**
   * Appended to the model's surface id, so every surface the server lets
   * through has an id of its own. The model picks short names like
   * "week_plan" and reuses them; a client cannot create the same surface
   * twice, and a confirmed action's key (step 6) relies on unique ids.
   */
  idSuffix?: string;
  /**
   * Allow ConfirmBar proposals. Off until the app can carry out a confirmed
   * action (step 6); until then screens show information only.
   */
  confirmations?: boolean;
  /** The data policy: actions whose category is off are not offered (issue #109). */
  categories?: CategoryFilter;
}

/**
 * Builds the surface the model asked for and validates it. Never throws:
 * model output can have any shape.
 */
export function renderSurface(args: unknown, options: RenderOptions = {}): RenderOutcome {
  let size: number;
  try {
    size = JSON.stringify(args ?? null).length;
  } catch {
    return { ok: false, errors: ["The arguments must be plain JSON."] };
  }
  if (size > MAX_RENDER_ARGS) {
    return { ok: false, errors: [`The screen is too large (${size} characters); show fewer items.`] };
  }
  const parsed = RenderArgs.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    };
  }
  const { components, data } = parsed.data;
  const suffix = options.idSuffix?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  const surfaceId = suffix ? `${parsed.data.surfaceId.slice(0, 63 - suffix.length)}-${suffix}` : parsed.data.surfaceId;
  if (!options.confirmations && components.some((c) => c.component === "ConfirmBar")) {
    return {
      ok: false,
      errors: ["ConfirmBar is not available yet: show the information only and say in text what you suggest."],
    };
  }
  const messages: A2uiMessage[] = [
    { version: "1.0", createSurface: { surfaceId, catalogId: CC_CATALOG_ID } },
    { version: "1.0", updateComponents: { surfaceId, components } },
    ...(data ? [{ version: "1.0", updateDataModel: { surfaceId, value: data } }] : []),
  ];
  const result = validatePayload(messages);
  return result.ok ? { ok: true, surfaceId, messages } : { ok: false, errors: result.errors };
}

/** How the model should use the render tool, with the catalog it may use. */
export function renderInstructions(options: RenderOptions = {}): string {
  return [
    `You can show an interactive screen by calling ${RENDER_TOOL_NAME}. Use one when it helps more than prose: a plan for the week, the matrix, goal progress, habits to check in, a comparison as a chart. Keep a short sentence of text with it; answer simple questions in plain text alone.`,
    "Read the data with the other tools first, and only show ids those tools returned.",
    options.confirmations
      ? "A proposal that would change something ends with a ConfirmBar; nothing changes until the user confirms it in the app."
      : "Screens show information only for now: do not use ConfirmBar or the confirmable actions; say in text what you suggest.",
    describeCatalog({ confirmations: !!options.confirmations, categories: options.categories }),
  ].join("\n");
}
