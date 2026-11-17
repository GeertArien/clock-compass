/**
 * Candidate C: our own catalog on the official protocol core.
 *
 * A catalog entry is an API (name + Zod schema) with no renderer attached, so
 * the same definitions can validate model output on the server later. The
 * layout primitives reuse the official basic catalog's schemas; `TaskCard` and
 * `ConfirmBar` are ours.
 */
import { z } from "zod";
import {
  ActionSchema,
  BASIC_FUNCTIONS,
  ButtonApi,
  CardApi,
  Catalog,
  CheckBoxApi,
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
import { CC_CATALOG_ID } from "../fixtures";

const TaskCardApi: ComponentApi = {
  name: "TaskCard",
  schema: z
    .object({
      taskId: DynamicStringSchema.describe("Id of an existing task to show as a live card."),
    })
    .strict(),
};

const ConfirmBarApi: ComponentApi = {
  name: "ConfirmBar",
  schema: z
    .object({
      // web_core 0.15.0 still names the envelope key `checks`; see fixtures.ts.
      checks: z.array(CheckRuleSchema).optional(),
      confirmLabel: DynamicStringSchema.optional(),
      dismissLabel: DynamicStringSchema.optional(),
      confirm: ActionSchema.describe("Dispatched when the user accepts."),
      dismiss: ActionSchema.optional(),
    })
    .strict(),
};

const FUNCTIONS = new Set(["required", "regex", "email", "formatString", "formatDate"]);

// Built from the API objects rather than derived from the official
// `basicCatalog`, which would bundle its Lit elements with it.
export const ccCatalog = new Catalog<ComponentApi>(
  CC_CATALOG_ID,
  "1.0",
  [TextApi, ColumnApi, RowApi, ListApi, CardApi, DividerApi, ButtonApi, TextFieldApi, CheckBoxApi, TaskCardApi, ConfirmBarApi],
  BASIC_FUNCTIONS.filter((f) => FUNCTIONS.has(f.name)),
  { instructions: "Use TaskCard for any existing task. End every proposal with a ConfirmBar." },
);
