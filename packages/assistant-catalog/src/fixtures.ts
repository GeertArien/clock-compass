/**
 * Hand-written A2UI 1.0 payloads, one per catalog component (issue #62), used
 * by the tests here and by the web app's dev-only preview. Written against
 * the FINAL v1.0 schemas: `"version": "1.0"`, `{"@path": …}` bindings,
 * `{"@call": …}` function calls and the `@checks` envelope key.
 */
import { CC_CATALOG_ID } from "./catalog";
import type { A2uiMessage } from "./compat";

type Component = Record<string, unknown>;

function surface(surfaceId: string, components: Component[], data?: Record<string, unknown>): A2uiMessage[] {
  return [
    { version: "1.0", createSurface: { surfaceId, catalogId: CC_CATALOG_ID } },
    { version: "1.0", updateComponents: { surfaceId, components } },
    ...(data ? [{ version: "1.0", updateDataModel: { surfaceId, value: data } }] : []),
  ];
}

/**
 * "Plan my week around my big rocks": a proposal to accept or decline. Live
 * TaskCards from a list template, a bound TextField with a check, and a
 * ConfirmBar whose confirm is the `acceptWeekPlan` action.
 */
export function weekPlan(taskIds: string[], weekStart: string, surfaceId = "week_plan"): A2uiMessage[] {
  const required = { "@call": "required", args: { value: { "@path": "/intention" } } };
  return surface(
    surfaceId,
    [
      { id: "root", component: "Column", children: ["title", "summary", "rocks", "intention", "confirm"] },
      { id: "title", component: "Text", text: "### Your week, big rocks first" },
      {
        id: "summary",
        component: "Text",
        variant: "caption",
        text: {
          "@call": "formatString",
          args: { value: "${/count} rocks proposed for the week of ${/weekStart}. Edit any of them before you accept." },
        },
      },
      { id: "rocks", component: "List", children: { componentId: "rock", path: "/rocks" } },
      { id: "rock", component: "TaskCard", taskId: { "@path": "id" } },
      {
        id: "intention",
        component: "TextField",
        label: "Intention for the week",
        value: { "@path": "/intention" },
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
            context: {
              weekStart: { "@path": "/weekStart" },
              taskIds: { "@path": "/taskIds" },
              intention: { "@path": "/intention" },
            },
          },
        },
        dismiss: { event: { name: "dismissWeekPlan" } },
        "@checks": [{ condition: required, message: "Intention is required." }],
      },
    ],
    {
      weekStart,
      count: taskIds.length,
      intention: "",
      taskIds,
      rocks: taskIds.map((id) => ({ id })),
    },
  );
}

/** "Where do my open tasks stand?": the matrix, all open tasks or a chosen few. */
export function matrixView(taskIds?: string[], surfaceId = "matrix"): A2uiMessage[] {
  return surface(surfaceId, [
    { id: "root", component: "Column", children: ["title", "board"] },
    { id: "title", component: "Text", text: "### Your open tasks by quadrant" },
    { id: "board", component: "QuadrantBoard", ...(taskIds ? { taskIds } : {}) },
  ]);
}

/** "How are my goals going?": goal progress plus a chart bound to the data model. */
export function goalsReview(
  goalIds: string[] | undefined,
  bars: { label: string; value: number }[],
  surfaceId = "goals_review",
): A2uiMessage[] {
  return surface(
    surfaceId,
    [
      { id: "root", component: "Column", children: ["title", "goals", "divider", "chart"] },
      { id: "title", component: "Text", text: "### Goals this month" },
      { id: "goals", component: "GoalList", ...(goalIds ? { goalIds } : {}) },
      { id: "divider", component: "Divider" },
      { id: "chart", component: "Chart", title: "Tasks done per goal", bars: { "@path": "/bars" }, unit: "" },
    ],
    { bars },
  );
}

/** "Which habits are left today?": the check-in list. */
export function habitCheckIn(habitIds?: string[], surfaceId = "habits"): A2uiMessage[] {
  return surface(surfaceId, [
    { id: "root", component: "Column", children: ["title", "habits"] },
    { id: "title", component: "Text", text: "### Today's check-ins" },
    { id: "habits", component: "HabitCheckIn", ...(habitIds ? { habitIds } : {}) },
  ]);
}

/** A one-task proposal: schedule it, confirmed with a ConfirmBar. */
export function scheduleProposal(taskId: string, day: string, surfaceId = "schedule"): A2uiMessage[] {
  return surface(
    surfaceId,
    [
      { id: "root", component: "Column", children: ["title", "task", "confirm"] },
      { id: "title", component: "Text", text: `Put this on ${day}?` },
      { id: "task", component: "TaskCard", taskId: { "@path": "/taskId" } },
      {
        id: "confirm",
        component: "ConfirmBar",
        confirmLabel: "Schedule",
        confirm: {
          event: {
            name: "scheduleTask",
            context: { taskId: { "@path": "/taskId" }, day: { "@path": "/day" } },
          },
        },
      },
    ],
    { taskId, day },
  );
}
