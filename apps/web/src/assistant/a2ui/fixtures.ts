/**
 * Hand-written A2UI 1.0 payloads (issue #62, step 1), written against the
 * FINAL v1.0 schemas: `"version": "1.0"`, `{"@path": …}` bindings,
 * `{"@call": …}` function calls and the `@checks` envelope key.
 */
import specExampleJsonl from "./spec-example.jsonl?raw";
import { CC_CATALOG_ID } from "./catalog";
import type { A2uiMessage } from "./compat";

/** The "Example Stream" from the v1.0 protocol spec, verbatim (contact form). */
export const specExample: A2uiMessage[] = specExampleJsonl
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as A2uiMessage);

/**
 * "Plan my week around my big rocks": a proposal to accept or decline, built
 * from our catalog. Layout primitives, one live `TaskCard` per rock (the real
 * app component, looked up by id), a bound `TextField` with a check, and a
 * `ConfirmBar` that stays disabled until the check passes.
 */
export function weekPlan(taskIds: string[], week: string, surfaceId = "week_plan"): A2uiMessage[] {
  const required = { "@call": "required", args: { value: { "@path": "/note" } } };
  return [
    { version: "1.0", createSurface: { surfaceId, catalogId: CC_CATALOG_ID } },
    {
      version: "1.0",
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Column", children: ["title", "summary", "rocks", "note", "confirm"] },
          { id: "title", component: "Text", text: "### Your week, big rocks first" },
          {
            id: "summary",
            component: "Text",
            variant: "caption",
            text: {
              "@call": "formatString",
              args: { value: "${/count} rocks proposed for ${/week}. Edit any of them before you accept." },
            },
          },
          { id: "rocks", component: "List", children: { componentId: "rock", path: "/rocks" } },
          { id: "rock", component: "TaskCard", taskId: { "@path": "id" } },
          {
            id: "note",
            component: "TextField",
            label: "Intention for the week",
            value: { "@path": "/note" },
            "@checks": [{ condition: required, message: "Add an intention before you accept the plan." }],
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
            "@checks": [{ condition: required, message: "Intention is required." }],
          },
        ],
      },
    },
    {
      version: "1.0",
      updateDataModel: {
        surfaceId,
        value: { week, count: taskIds.length, note: "", rocks: taskIds.map((id) => ({ id })) },
      },
    },
  ];
}
