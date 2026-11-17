/**
 * Hand-written A2UI 1.0 fixtures for the renderer spike (issue #62, step 1).
 *
 * Both are written against the FINAL v1.0 schemas (`specification/v1_0/json`):
 * `"version": "1.0"`, `{"@path": …}` data bindings, `{"@call": …}` function
 * calls and the `@checks` envelope key.
 */
import specExampleJsonl from "./spec-example.jsonl?raw";
import type { A2uiMessage } from "./core/compat";

export const CC_CATALOG_ID = "clock-compass:assistant/v1";

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
