/**
 * The assistant's A2UI catalog: component APIs only (a name plus a Zod
 * schema), no React. Kept framework-neutral so the server can validate model
 * output against the same definitions later (issue #62, decision 3), and so
 * the tests can run on the protocol core without React.
 *
 * Layout primitives reuse the official v1.0 basic catalog's schemas; their
 * React views are ours (`components.tsx`). `TaskCard` and `ConfirmBar` are
 * Clock & Compass components.
 */
import { z } from "zod";
import {
  ActionSchema,
  BASIC_FUNCTIONS,
  ButtonApi,
  CardApi,
  Catalog,
  CheckRuleSchema,
  ColumnApi,
  DividerApi,
  DynamicStringSchema,
  ListApi,
  RowApi,
  TextApi,
  TextFieldApi,
  type ComponentApi,
} from "@a2ui/web_core/v1_0";

export { ButtonApi, CardApi, ColumnApi, DividerApi, ListApi, RowApi, TextApi, TextFieldApi };

export const CC_CATALOG_ID = "clock-compass:assistant/v1";

export const TaskCardApi = {
  name: "TaskCard",
  schema: z
    .object({
      taskId: DynamicStringSchema.describe(
        "Id of an existing task. Renders the app's live task card for it.",
      ),
    })
    .strict(),
} satisfies ComponentApi;

export const ConfirmBarApi = {
  name: "ConfirmBar",
  schema: z
    .object({
      // web_core 0.15.0 still names the envelope key `checks`; see compat.ts.
      checks: z.array(CheckRuleSchema).optional(),
      confirmLabel: DynamicStringSchema.optional(),
      dismissLabel: DynamicStringSchema.optional(),
      confirm: ActionSchema.describe("Sent when the user accepts."),
      dismiss: ActionSchema.optional().describe("Sent when the user declines."),
    })
    .strict(),
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

/** The functions bindings and checks may call. */
const FUNCTION_NAMES = new Set(["required", "regex", "email", "formatString", "formatDate"]);
export const CATALOG_FUNCTIONS = BASIC_FUNCTIONS.filter((f) => FUNCTION_NAMES.has(f.name));

export const CATALOG_INSTRUCTIONS =
  "Use TaskCard for any existing task. End every proposal with a ConfirmBar.";

/** The catalog as APIs only: what validates a payload without rendering it. */
export const ccApiCatalog = new Catalog<ComponentApi>(
  CC_CATALOG_ID,
  "1.0",
  [...PRIMITIVE_APIS, TaskCardApi, ConfirmBarApi],
  CATALOG_FUNCTIONS,
  { instructions: CATALOG_INSTRUCTIONS },
);
