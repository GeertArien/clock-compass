/**
 * The read tools (issue #117): every read the app offers to a model, declared
 * once, next to the write operations of `operations.ts`.
 *
 * The in-app assistant and the MCP adapter both offer exactly these, under
 * the name `mcpToolName` derives from `name` (listTasks → list_tasks), with
 * the same input schema and the same data rules. A declaration is plain data,
 * importable in the browser; the code that answers it (a thin call into the
 * services plus an explicit list of fields) lives with the services in
 * `@clock-compass/core` (`reads/handlers.ts`).
 *
 * `categories` are the data categories a read needs (`data-categories.ts`).
 * A read is offered when at least one of them is on; a section of its answer
 * whose category is off is left out, and the answer says so.
 */
import { z } from "zod";
import type { DataCategory } from "./data-categories";

const Id = z.string().min(1).max(64);

/** MCP's standard annotation for a read. */
export interface ReadHints {
  readonly readOnlyHint: true;
}

export interface ReadDeclaration<Input extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** What the model reads about it: what it returns and how to filter. */
  summary: string;
  input: Input;
  categories: readonly DataCategory[];
  hints: ReadHints;
}

const READ: ReadHints = Object.freeze({ readOnlyHint: true });

function read<Input extends z.ZodTypeAny>(def: Omit<ReadDeclaration<Input>, "hints">): ReadDeclaration<Input> {
  return { ...def, hints: READ };
}

/** Most tasks `listTasks` answers with at once. */
export const MAX_READ_TASKS = 200;
export const DEFAULT_READ_TASKS = 50;

export const READS = {
  listTasks: read({
    name: "listTasks",
    summary:
      "List tasks with their quadrant (Q1 urgent+important, Q2 important, Q3 urgent, Q4 neither), status, schedule, links and how they repeat. " +
      "Filter by status, quadrant, goal, project, inbox (no project), big rock, or words in the title. " +
      "The answer has `total`, `counts` per quadrant (the matrix at a glance) and `nextOffset` to read the next page (null at the end). " +
      "Occurrences of a repeating task that show later (not open work yet) are left out unless includeLater is true.",
    input: z
      .object({
        status: z.enum(["TODO", "DONE", "ARCHIVED"]).optional().describe("Default: TODO (open tasks)."),
        quadrant: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
        goalId: Id.optional(),
        projectId: Id.optional(),
        inbox: z.boolean().optional().describe("Only tasks in no project."),
        bigRock: z.boolean().optional().describe("Only tasks pinned as big rocks (true) or only the others (false)."),
        titleContains: z.string().trim().min(1).max(200).optional().describe("Words the title contains (any case)."),
        includeLater: z
          .boolean()
          .optional()
          .describe("Also list occurrences that show later (marked later: true, with showFrom). Default false."),
        limit: z.number().int().min(1).max(MAX_READ_TASKS).optional().describe(`Default ${DEFAULT_READ_TASKS}.`),
        offset: z.number().int().min(0).optional().describe("Skip this many (from nextOffset). Default 0."),
      })
      .strict(),
    categories: ["tasks"],
  }),
  bigRocksThisWeek: read({
    name: "bigRocksThisWeek",
    summary: "This week's big rocks, as Clock · Today shows them: the tasks pinned as big rocks, done ones included.",
    input: z.object({}).strict(),
    categories: ["tasks"],
  }),
  getCompass: read({
    name: "getCompass",
    summary:
      "The user's mission statement, roles (with their mission lines), goals with role, status, target date and progress (share of their tasks done), " +
      "and projects with goal, status and progress. Filter goals and projects by status. A part the user has not shared is listed in `notShared`.",
    input: z
      .object({
        goalStatus: z.enum(["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"]).optional(),
        projectStatus: z.enum(["ACTIVE", "SOMEDAY", "DONE"]).optional(),
      })
      .strict(),
    categories: ["mission", "goalsAndProjects"],
  }),
  listPeople: read({
    name: "listPeople",
    summary:
      "The people who matter, with relationship type and recurring commitments (status ON_TRACK, DUE_SOON or OVERDUE; last done and next due; " +
      "met/missed history; current streak), and the emotional-bank-account balance when shared. " +
      "Pass status OVERDUE (or DUE_SOON) to list only the commitments that are behind, with their person.",
    input: z.object({ status: z.enum(["OVERDUE", "DUE_SOON"]).optional() }).strict(),
    categories: ["people"],
  }),
  listHabits: read({
    name: "listHabits",
    summary:
      "Habits (recurring renewal) with their dimension, goal, weekly target, this week's check-offs (Monday to Sunday), whether done today, and the week streak.",
    input: z.object({}).strict(),
    categories: ["habitsAndRenewal"],
  }),
  renewalOverview: read({
    name: "renewalOverview",
    summary:
      "This week's renewal per dimension (physical, mental, social/emotional, spiritual): habit check-offs against target, one-off activities, " +
      "and the week's intention (null when none is set). " +
      "Pass includeTrends for the last 12 weeks: this week against last, the longest streak, goal momentum and a day-by-day heatmap.",
    input: z.object({ includeTrends: z.boolean().optional().describe("Default false.") }).strict(),
    categories: ["habitsAndRenewal"],
  }),
} as const;

export type ReadName = keyof typeof READS;
export type ReadInput<N extends ReadName> = z.infer<(typeof READS)[N]["input"]>;

export const READ_LIST: readonly ReadDeclaration[] = Object.values(READS) as unknown as ReadDeclaration[];

export function isRead(name: string): name is ReadName {
  return Object.prototype.hasOwnProperty.call(READS, name);
}
