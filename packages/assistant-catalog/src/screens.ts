/**
 * The screen tools of the MCP App (issue #118): purpose-built screens an
 * outside host's model can show, built and validated on the server from the
 * catalog's components, drawn in the host by the app's own renderer.
 *
 * Declared like the reads (`reads.ts`): plain data, read-only, with the data
 * categories they need. Step 1 has one screen, `showWeek`; the others
 * (`showMatrix`, `showHabits`, `showPeople`, `proposeChanges`) come in steps 2
 * and 3, after the owner has tried step 1 in Claude Desktop.
 */
import { z } from "zod";
import type { DataCategory } from "./data-categories";
import type { ReadHints } from "./reads";

export interface ScreenDeclaration<Input extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  summary: string;
  input: Input;
  categories: readonly DataCategory[];
  hints: ReadHints;
}

/** A real calendar date that is a Monday, YYYY-MM-DD. */
const Monday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCDay() === 1;
  }, "a Monday");

export const SCREENS = {
  showWeek: {
    name: "showWeek",
    summary:
      "Show the user's week as a card in the chat: this week's big rocks (done or not) and the tasks scheduled on each day, Monday to Sunday. " +
      "Use it when the user asks how their week looks. The card is drawn for the user; you get a one-line summary.",
    input: z.object({ week: Monday.optional().describe("Monday of the week to show. Default: this week.") }).strict(),
    categories: ["tasks"],
    hints: Object.freeze({ readOnlyHint: true }),
  },
} as const satisfies Record<string, ScreenDeclaration>;

export type ScreenName = keyof typeof SCREENS;
export const SCREEN_LIST: readonly ScreenDeclaration[] = Object.values(SCREENS) as unknown as ScreenDeclaration[];

/** The page every screen tool points to (MCP Apps `ui://` resource). */
export const SCREEN_RESOURCE_URI = "ui://clock-compass/screen";
