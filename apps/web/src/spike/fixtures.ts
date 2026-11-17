/**
 * Hand-written A2UI 1.0 fixtures for the renderer spike (issue #62, step 1).
 *
 * Both are written against the FINAL v1.0 schemas (`specification/v1_0/json`):
 * `"version": "1.0"`, `{"@path": …}` data bindings, `{"@call": …}` function
 * calls and the `@checks` envelope key.
 */
import specExampleJsonl from "./spec-example.jsonl?raw";

export type A2uiMessage = Record<string, unknown>;

export const CC_CATALOG_ID = "clock-compass:assistant/v1";
export const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/** The "Example Stream" from the v1.0 protocol spec, verbatim (contact form). */
export const specExample: A2uiMessage[] = specExampleJsonl
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as A2uiMessage);

/**
 * "Plan my week around my big rocks" — a proposed plan to accept or reject,
 * built from our own catalog: layout primitives plus `TaskCard` (the real app
 * component, looked up by id so it stays live) and `ConfirmBar`.
 */
export const weekPlan: A2uiMessage[] = [
  {
    version: "1.0",
    createSurface: { surfaceId: "week_plan", catalogId: CC_CATALOG_ID },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "week_plan",
      components: [
        {
          id: "root",
          component: "Column",
          children: ["title", "summary", "rocks", "note", "confirm"],
        },
        { id: "title", component: "Text", text: "## Your week, big rocks first" },
        {
          id: "summary",
          component: "Text",
          variant: "caption",
          text: {
            "@call": "formatString",
            args: { value: "${/count} rocks proposed for ${/week}. Toggle or edit any of them." },
          },
        },
        {
          id: "rocks",
          component: "List",
          children: { componentId: "rock", path: "/rocks" },
        },
        { id: "rock", component: "TaskCard", taskId: { "@path": "id" } },
        {
          id: "note",
          component: "TextField",
          label: "Intention for the week",
          placeholder: "One line you want to remember on Friday",
          value: { "@path": "/note" },
          "@checks": [
            {
              condition: { "@call": "required", args: { value: { "@path": "/note" } } },
              message: "Add an intention before accepting the plan.",
            },
          ],
        },
        {
          id: "confirm",
          component: "ConfirmBar",
          confirmLabel: "Accept plan",
          dismissLabel: "Not now",
          confirm: {
            event: {
              name: "acceptWeekPlan",
              userMessage: "Accepted the proposed week",
              context: { week: { "@path": "/week" }, note: { "@path": "/note" } },
            },
          },
          dismiss: { event: { name: "dismissWeekPlan" } },
          "@checks": [
            {
              condition: { "@call": "required", args: { value: { "@path": "/note" } } },
              message: "Intention is required.",
            },
          ],
        },
      ],
    },
  },
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "week_plan",
      value: {
        week: "2026-W47",
        count: 3,
        note: "",
        rocks: [{ id: "task_rock_1" }, { id: "task_rock_2" }, { id: "task_rock_3" }],
      },
    },
  },
];

/**
 * Rewrites a v1.0 payload into the pre-release draft dialect, for libraries
 * published before the final schemas. `full` also strips the `@` from data
 * bindings and function calls (svelte-a2ui 0.2.0); without it only the
 * envelope mixin keys are un-prefixed (@a2ui/web_core 0.15.0).
 */
export function toDraftDialect(messages: A2uiMessage[], full: boolean): A2uiMessage[] {
  const rename: Record<string, string> = {
    "@checks": "checks",
    "@accessibility": "accessibility",
    "@catalogId": "catalogId",
    "@metadata": "metadata",
    ...(full ? { "@path": "path", "@call": "call" } : {}),
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [rename[k] ?? k, walk(v)]),
      );
    }
    return value;
  };
  return messages.map((m) => {
    const out = walk(m) as A2uiMessage;
    if (full) out.version = "v1.0";
    return out;
  });
}
