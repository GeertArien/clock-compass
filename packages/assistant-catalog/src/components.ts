/**
 * The assistant's A2UI components as APIs only: a name plus a Zod schema, no
 * rendering. The web app attaches React views to these (apps/web/src/assistant);
 * the server validates model output against the same definitions.
 *
 * Layout and input primitives reuse the official v1.0 basic catalog's schemas.
 * The rest are Clock & Compass components. The app components look items up
 * by id in the app's own data, so the model never restates (and can never
 * misstate) a task, goal or habit: it only says which ones to show.
 */
import { z } from "zod";
import {
  ActionSchema,
  ButtonApi,
  CardApi,
  CheckRuleSchema,
  ColumnApi,
  DividerApi,
  DynamicStringListSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  ListApi,
  RowApi,
  TextApi,
  TextFieldApi,
  type ComponentApi,
} from "@a2ui/web_core/v1_0";

export { ButtonApi, CardApi, ColumnApi, DividerApi, ListApi, RowApi, TextApi, TextFieldApi };

export const TaskCardApi = {
  name: "TaskCard",
  schema: z
    .object({
      taskId: DynamicStringSchema.describe(
        "Id of an existing task. Renders the app's live task card for it.",
      ),
    })
    .strict()
    .describe("One existing task, with its quick actions, as the app shows it."),
} satisfies ComponentApi;

export const QuadrantBoardApi = {
  name: "QuadrantBoard",
  schema: z
    .object({
      taskIds: DynamicStringListSchema.optional().describe(
        "Ids of the tasks to place on the board. Omit to show every open task.",
      ),
    })
    .strict()
    .describe("The importance × urgency matrix (Q1–Q4) with live task cards."),
} satisfies ComponentApi;

export const GoalListApi = {
  name: "GoalList",
  schema: z
    .object({
      goalIds: DynamicStringListSchema.optional().describe(
        "Ids of the goals to show, in this order. Omit to show every active goal.",
      ),
    })
    .strict()
    .describe("Goals with their task completion and this week's habit momentum."),
} satisfies ComponentApi;

export const HabitCheckInApi = {
  name: "HabitCheckIn",
  schema: z
    .object({
      habitIds: DynamicStringListSchema.optional().describe(
        "Ids of the habits to list. Omit to list every habit.",
      ),
    })
    .strict()
    .describe("Today's habit check-ins, as on Clock · Today: tap to mark done."),
} satisfies ComponentApi;

/** One bar of a Chart: what `bars` must resolve to (checked when rendering). */
export const ChartBarsSchema = z
  .array(
    z
      .object({
        // The chart truncates long labels on screen; this only bounds the payload.
        label: z.string().min(1).max(200),
        value: z.number().finite().nonnegative(),
      })
      .strict(),
  )
  .min(1)
  .max(24);
export type ChartBar = z.infer<typeof ChartBarsSchema>[number];

export const ChartApi = {
  name: "Chart",
  schema: z
    .object({
      title: DynamicStringSchema.optional().describe("A short title above the bars."),
      bars: DynamicValueSchema.describe(
        "The bars: an array of {label, value} (1 to 24, values ≥ 0), literal or bound with @path.",
      ),
      unit: z.string().max(12).optional().describe('Unit after each value, e.g. "h" or "%".'),
      max: z
        .number()
        .positive()
        .optional()
        .describe("The value of a full-width bar. Defaults to the largest value."),
    })
    .strict()
    .describe("A simple horizontal bar chart, e.g. time per role or habits kept per week."),
} satisfies ComponentApi;

/**
 * A2UI's Action, except that an event's arguments may also be `null`. Several
 * actions use null for "none" (off the Clock, no due date, the Inbox), and
 * A2UI's own schema has no null literal, so a proposal that clears something
 * was refused before it was shown. The library passes null through when it
 * resolves an action, and still binds this as an Action (one of the union's
 * options is A2UI's own).
 */
const ConfirmActionSchema = z
  .union([
    z
      .object({
        event: z
          .object({
            name: z.string(),
            userMessage: DynamicStringSchema.optional(),
            context: z.record(z.string(), DynamicValueSchema.nullable()).optional(),
          })
          .strict(),
      })
      .strict(),
    ActionSchema,
  ])
  .describe("Sent when the user accepts. The only place a confirmable action may appear.");

export const ConfirmBarApi = {
  name: "ConfirmBar",
  schema: z
    .object({
      // web_core 0.15.0 still names the envelope key `checks`; see compat.ts.
      checks: z.array(CheckRuleSchema).optional(),
      confirmLabel: DynamicStringSchema.optional(),
      dismissLabel: DynamicStringSchema.optional(),
      confirm: ConfirmActionSchema,
      dismiss: ActionSchema.optional().describe("Sent when the user declines."),
    })
    .strict()
    .describe("The explicit accept/decline step every proposal ends with."),
} satisfies ComponentApi;

/** The layout and input primitives the assistant may use. */
export const PRIMITIVE_APIS = [
  TextApi,
  ColumnApi,
  RowApi,
  ListApi,
  CardApi,
  DividerApi,
  ButtonApi,
  TextFieldApi,
] as const;

/** The Clock & Compass components. */
export const APP_APIS = [
  TaskCardApi,
  QuadrantBoardApi,
  GoalListApi,
  HabitCheckInApi,
  ChartApi,
  ConfirmBarApi,
] as const;
