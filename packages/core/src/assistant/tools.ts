/**
 * The assistant's read-only tools (issue #62, step 3).
 *
 * Each tool is a thin call into an existing service, the same services
 * `packages/mcp` wraps, so there is no business logic here. What a tool adds
 * is the data policy: it declares the category it reads, and it builds its
 * result from an explicit allow-list of fields (never by spreading a service
 * object), leaving out what the policy switches off. No tool writes anything;
 * writes come later as confirmed actions (step 6), never as model tools.
 */
import { z } from "zod/v4";
import type { GoalStatus, ProjectStatus } from "@prisma/client";
import type { GoalService } from "../services/goal-service.js";
import type { MissionService } from "../services/mission-service.js";
import type { PeopleService, PersonOverview } from "../services/people-service.js";
import type { ProjectService } from "../services/project-service.js";
import type { RenewalService } from "../services/renewal-service.js";
import type { RoleService } from "../services/role-service.js";
import type { TaskService, TaskWithQuadrant } from "../services/task-service.js";
import type { ToolSpec } from "../ai/provider.js";
import type { DataCategory, DataPolicy } from "./data-policy.js";

/** The services the tools read from (a subset of what the MCP adapter wraps). */
export interface AssistantServices {
  tasks: TaskService;
  goals: GoalService;
  projects: ProjectService;
  roles: RoleService;
  mission: MissionService;
  people: PeopleService;
  renewal: RenewalService;
}

export interface ToolContext {
  services: AssistantServices;
  policy: DataPolicy;
  now: Date;
  /** The user's IANA time zone (e.g. "Europe/Brussels"): days are theirs, not the server's. */
  timeZone: string;
  /** Called when a tool's service fails; the model only gets a generic error. */
  onToolError?: (tool: string, error: unknown) => void;
}

export interface AssistantTool<Input = unknown> {
  name: string;
  description: string;
  /** The data category this tool reads; it is not offered when that is off. */
  category: DataCategory;
  input: z.ZodType<Input>;
  run(input: Input, context: ToolContext): Promise<unknown>;
}

function tool<Input>(definition: AssistantTool<Input>): AssistantTool {
  return definition as unknown as AssistantTool;
}

const NO_INPUT = z.object({}).strict();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** A date entered as a plain date (due date, target date): stored as UTC midnight. */
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * An instant as a calendar day (YYYY-MM-DD) in the user's time zone. The Clock
 * stores a scheduled day as the browser's local midnight, so its UTC date is
 * the day before for anyone east of UTC.
 */
export function localDay(d: Date | null | undefined, timeZone: string): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export { isTimeZone } from "../domain/zoned.js";

/** A task for the model: what it is and where it stands. */
/** A recurring task's rule in words, for the model: "every year", "every 2 weeks after completion" (#105). */
function repeatsWords(task: TaskWithQuadrant): string | null {
  const r = task.recurrence;
  if (!r?.active) return null;
  const unit = r.unit.toLowerCase();
  const every = r.every === 1 ? `every ${unit}` : `every ${r.every} ${unit}s`;
  const from = r.from === "COMPLETION" ? " after completion" : "";
  const lead = r.leadDays === null ? "" : `, shown ${r.leadDays} days before it is due`;
  return `${every}${from}${lead}`;
}

function taskView(task: TaskWithQuadrant, timeZone: string, policy: DataPolicy) {
  return {
    id: task.id,
    title: task.title,
    ...(policy.taskNotes ? { notes: task.notes } : {}),
    quadrant: task.quadrant,
    important: task.important,
    urgent: task.urgent,
    status: task.status,
    proactivity: task.proactivity,
    isBigRock: task.isBigRock,
    dueDate: day(task.dueDate),
    scheduledDay: localDay(task.scheduledDay, timeZone),
    scheduledTime: task.scheduledTime,
    goalId: task.goalId,
    projectId: task.projectId,
    completedAt: iso(task.completedAt),
    // Recurrence (#105): how it repeats, and whether it is a "later"
    // occurrence (not open work yet: it shows from `showFrom`).
    repeats: repeatsWords(task),
    later: task.later,
    showFrom: day(task.showFrom),
  };
}

/** Consecutive met periods at the end of a hit/miss history (oldest first). */
function trailingStreak(history: boolean[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i]; i--) streak++;
  return streak;
}

/**
 * A person for the model, by the policy: names, relationship type and
 * commitments always (category "people"); the bank-account balance only with
 * "ebaBalance"; free-text notes on the person only with "personNotes"; the
 * recent bank-account entries with their notes only with "ebaEntryNotes".
 */
export function personView(person: PersonOverview, policy: DataPolicy) {
  return {
    id: person.id,
    name: person.name,
    relationship: person.relationship,
    commitments: person.commitments.map((c) => ({
      id: c.id,
      title: c.title,
      cadence: { unit: c.cadenceUnit, every: c.cadenceValue },
      status: c.status,
      lastOccurredAt: c.lastOccurredAt,
      nextDueAt: c.nextDueAt,
      /** Met (true) or missed (false) in each of the last periods, oldest first. */
      history: c.history,
      currentStreak: trailingStreak(c.history),
    })),
    ...(policy.ebaBalance ? { emotionalBankAccountBalance: person.balance } : {}),
    ...(policy.personNotes ? { notes: person.notes } : {}),
    ...(policy.ebaEntryNotes
      ? {
          recentBankAccountEntries: person.ledger.map((e) => ({
            kind: e.kind,
            note: e.note,
            occurredAt: e.occurredAt,
          })),
        }
      : {}),
  };
}

const QUADRANT = z.enum(["Q1", "Q2", "Q3", "Q4"]);

export const READ_TOOLS: AssistantTool[] = [
  tool({
    name: "list_tasks",
    description:
      "List tasks with their quadrant (Q1 urgent+important, Q2 important, Q3 urgent, Q4 neither), status, schedule, links and how they repeat. Filter by status, quadrant, goal or project. Occurrences of a repeating task that show later (not open work yet) are left out unless includeLater is true.",
    category: "tasks",
    input: z
      .object({
        status: z.enum(["TODO", "DONE", "ARCHIVED"]).optional().describe("Default: TODO (open tasks)."),
        quadrant: QUADRANT.optional(),
        goalId: z.string().optional(),
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
        includeLater: z
          .boolean()
          .optional()
          .describe("Also list occurrences that show later (marked later: true, with showFrom). Default false."),
      })
      .strict(),
    async run(input, { services, now, timeZone, policy }) {
      const status = input.status ?? "TODO";
      // "Later" occurrences of a recurring task are not open work yet (#105),
      // unless asked for ("what comes up next month?").
      const tasks = await services.tasks.list(
        {
          status,
          shown: status !== "ARCHIVED" && !input.includeLater,
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
        { now, timeZone },
      );
      const shown = input.quadrant ? tasks.filter((t) => t.quadrant === input.quadrant) : tasks;
      return { total: shown.length, tasks: shown.slice(0, input.limit ?? 50).map((t) => taskView(t, timeZone, policy)) };
    },
  }),
  tool({
    name: "big_rocks_this_week",
    description:
      "This week's big rocks, as Clock · Today shows them: the tasks pinned as big rocks, done ones included.",
    category: "tasks",
    input: NO_INPUT,
    async run(_input, { services, now, timeZone, policy }) {
      return (await services.tasks.bigRocks({ now, timeZone })).map((t) => taskView(t, timeZone, policy));
    },
  }),
  tool({
    name: "list_goals",
    description: "List goals with their role, status, target date and progress (share of their tasks done).",
    category: "goalsAndProjects",
    input: z
      .object({ status: z.enum(["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"]).optional() })
      .strict(),
    async run(input, { services }) {
      const goals = await services.goals.list(input.status as GoalStatus | undefined);
      return goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        status: g.status,
        targetDate: day(g.targetDate),
        roleId: g.roleId,
        progress: g.progress,
      }));
    },
  }),
  tool({
    name: "list_projects",
    description: "List projects (multi-step outcomes) with their goal, status and progress.",
    category: "goalsAndProjects",
    input: z.object({ status: z.enum(["ACTIVE", "SOMEDAY", "DONE"]).optional() }).strict(),
    async run(input, { services }) {
      const projects = await services.projects.list(input.status as ProjectStatus | undefined);
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        goalId: p.goalId,
        progress: p.progress,
      }));
    },
  }),
  tool({
    name: "list_roles",
    description: "The roles the user lives by (Parent, Professional…), in their order. Goals link to roles.",
    category: "goalsAndProjects",
    input: NO_INPUT,
    async run(_input, { services, policy }) {
      const roles = await services.roles.list();
      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        // A role's mission line is mission text: shown only with "mission" on.
        ...(policy.mission ? { mission: r.mission } : {}),
      }));
    },
  }),
  tool({
    name: "get_mission",
    description: "The user's personal mission statement.",
    category: "mission",
    input: NO_INPUT,
    async run(_input, { services }) {
      const mission = await services.mission.getActive();
      return mission ? { content: mission.content, updatedAt: iso(mission.updatedAt) } : null;
    },
  }),
  tool({
    name: "list_people",
    description:
      "The people who matter, with relationship type and recurring commitments (status: ON_TRACK, DUE_SOON or OVERDUE; met/missed history; current streak), and the emotional-bank-account balance when shared.",
    category: "people",
    input: NO_INPUT,
    async run(_input, { services, policy, now }) {
      return (await services.people.overview(now)).map((p) => personView(p, policy));
    },
  }),
  tool({
    name: "overdue_commitments",
    description: "Relationship commitments that are overdue, with the person's name.",
    category: "people",
    input: NO_INPUT,
    async run(_input, { services, now }) {
      return (await services.people.overdue(now)).map((o) => ({
        personId: o.personId,
        personName: o.personName,
        commitmentId: o.commitmentId,
        title: o.title,
        lastOccurredAt: o.lastOccurredAt,
      }));
    },
  }),
  tool({
    name: "list_habits",
    description:
      "Habits (recurring renewal) with their dimension, weekly target, this week's check-offs, whether done today, and the week streak.",
    category: "habitsAndRenewal",
    input: NO_INPUT,
    async run(_input, { services, now, timeZone }) {
      return (await services.renewal.listHabits({ now, timeZone })).map((h) => ({
        id: h.id,
        name: h.name,
        dimension: h.dimension,
        goalId: h.goalId,
        targetPerWeek: h.targetPerWeek,
        doneThisWeek: h.doneThisWeek,
        markedToday: h.markedToday,
        weekDays: h.weekDays,
        streak: h.streak,
      }));
    },
  }),
  tool({
    name: "renewal_summary",
    description:
      "This week's renewal per dimension (physical, mental, social/emotional, spiritual): habit check-offs against target, one-off activities, and the week's intention (null when none is set).",
    category: "habitsAndRenewal",
    input: NO_INPUT,
    async run(_input, { services, now, timeZone }) {
      const clock = { now, timeZone };
      const [summary, intentions] = await Promise.all([services.renewal.summary(clock), services.renewal.intentions(clock)]);
      const intentionOf = new Map(intentions.map((i) => [i.dimension, i.text]));
      return summary.map((d) => ({
        dimension: d.dimension,
        habitsDone: d.habitsDone,
        habitsTarget: d.habitsTarget,
        oneOffs: d.oneOffs,
        total: d.total,
        intention: intentionOf.get(d.dimension) ?? null,
      }));
    },
  }),
];

/** The tools the policy allows, as the model sees them. */
export function toolSpecs(tools: AssistantTool[], policy: DataPolicy): ToolSpec[] {
  return tools
    .filter((t) => policy[t.category])
    .map((t) => {
      const { $schema: _ignored, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
      return { name: t.name, description: t.description, inputSchema: schema };
    });
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Runs one tool call from the model. Unknown tools, switched-off categories
 * and invalid arguments are reported back to the model as errors (it can
 * correct itself); a service failure is reported the same way, without
 * internals.
 */
export async function runTool(
  tools: AssistantTool[],
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolOutcome> {
  const found = tools.find((t) => t.name === name);
  if (!found) return { ok: false, error: `Unknown tool "${name}".` };
  if (!context.policy[found.category]) {
    return { ok: false, error: `"${name}" reads data the user has not shared with the assistant.` };
  }
  const parsed = found.input.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid arguments for "${name}": ${parsed.error.issues
        .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ")}`,
    };
  }
  try {
    return { ok: true, result: await found.run(parsed.data, context) };
  } catch (err) {
    context.onToolError?.(name, err);
    return { ok: false, error: `"${name}" failed. Try again or answer without it.` };
  }
}
