/**
 * The read tools' handlers (issue #117): one per declaration in
 * `@clock-compass/assistant-catalog`'s `reads.ts`, shared by the in-app
 * assistant and the MCP adapter.
 *
 * Each handler is a thin call into the services. What it adds is the data
 * policy and the shape a model needs:
 * - every answer is built from an explicit list of fields, never by spreading
 *   a service object, so a new column never reaches a model by accident;
 * - a category that is off removes its fields (and the read itself when all
 *   of its categories are off), whatever the caller asks for;
 * - days are plain dates (`YYYY-MM-DD`) in the caller's zone; real moments
 *   (completed at) stay ISO timestamps;
 * - derived values (quadrant, `later`, commitment status, streaks, progress)
 *   are worked out, never stored.
 *
 * The notes on a person and the notes of bank-account entries are their own
 * categories, off by default (owner decision on #117): with them off, no
 * read returns them.
 */
import type { GoalStatus, ProjectStatus } from "@prisma/client";
import {
  DEFAULT_READ_TASKS,
  READS,
  isRead,
  zodErrorText,
  type ReadInput,
  type ReadName,
} from "@clock-compass/assistant-catalog";
import type { GoalService } from "../services/goal-service.js";
import type { MissionService } from "../services/mission-service.js";
import type { PeopleService, PersonOverview } from "../services/people-service.js";
import type { ProjectService } from "../services/project-service.js";
import type { RenewalService } from "../services/renewal-service.js";
import type { RoleService } from "../services/role-service.js";
import type { TaskService, TaskWithQuadrant } from "../services/task-service.js";
import { scheduledDayOf } from "../domain/scheduled-day.js";
import { zonedDay } from "../domain/zoned.js";
import type { DataPolicy } from "../assistant/data-policy.js";

/** The services the reads call (a subset of what the adapters wrap). */
export interface ReadServices {
  tasks: Pick<TaskService, "list" | "bigRocks">;
  goals: Pick<GoalService, "list">;
  projects: Pick<ProjectService, "list">;
  roles: Pick<RoleService, "list">;
  mission: Pick<MissionService, "getActive">;
  people: Pick<PeopleService, "overview">;
  renewal: Pick<RenewalService, "listHabits" | "summary" | "intentions" | "trends">;
}

export interface ReadContext {
  policy: DataPolicy;
  now: Date;
  /** The caller's IANA zone (the assistant: the browser's; MCP: the server's). */
  timeZone: string;
  /** Called when a service fails; the caller only gets a generic error. */
  onError?: (read: string, error: unknown) => void;
}

export type ReadOutcome = { ok: true; result: unknown } | { ok: false; error: string };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** A date entered as a plain date (due date, target date): stored at UTC midnight. */
const plain = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** An instant (or ISO string) as the calendar day it falls on in `timeZone`. */
export function localDay(d: Date | string | null | undefined, timeZone: string): string | null {
  if (!d) return null;
  return zonedDay(typeof d === "string" ? new Date(d) : d, timeZone);
}

/** Whether a read may run: at least one of its categories is on. */
export function readAllowed(name: ReadName, policy: DataPolicy): boolean {
  return READS[name].categories.some((c) => policy[c]);
}

// --- Views -------------------------------------------------------------------

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

/** A task for the model: what it is, where it stands, and what an edit needs to name. */
export function taskView(task: TaskWithQuadrant, timeZone: string, policy: DataPolicy) {
  const r = task.recurrence?.active ? task.recurrence : null;
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
    dueDate: plain(task.dueDate),
    // A plain date (#136): the same day in every zone.
    scheduledDay: scheduledDayOf(task.scheduledDay),
    scheduledTime: task.scheduledTime,
    goalId: task.goalId,
    projectId: task.projectId,
    completedAt: iso(task.completedAt),
    // Recurrence (#105): the rule as the operations take it, in words, and
    // whether this is a "later" occurrence (not open work yet: it shows from
    // `showFrom`).
    repeat: r ? { unit: r.unit, every: r.every, from: r.from, leadDays: r.leadDays } : null,
    repeats: repeatsWords(task),
    later: task.later,
    showFrom: plain(task.showFrom),
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
 * commitments with status and streaks ("people"); the bank-account balance
 * ("ebaBalance"); the notes on the person ("personNotes", off by default);
 * the recent bank-account entries with their notes ("ebaEntryNotes", off by
 * default).
 */
export function personView(
  person: PersonOverview,
  policy: DataPolicy,
  timeZone: string,
  commitments: PersonOverview["commitments"] = person.commitments,
) {
  return {
    id: person.id,
    name: person.name,
    relationship: person.relationship,
    commitments: commitments.map((c) => ({
      id: c.id,
      title: c.title,
      cadence: { unit: c.cadenceUnit, every: c.cadenceValue },
      status: c.status,
      lastDone: localDay(c.lastOccurredAt, timeZone),
      nextDue: localDay(c.nextDueAt, timeZone),
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
            day: localDay(e.occurredAt, timeZone),
          })),
        }
      : {}),
  };
}

// --- Handlers ----------------------------------------------------------------

type Handler<N extends ReadName> = (input: ReadInput<N>, services: ReadServices, context: ReadContext) => Promise<unknown>;

const QUADRANTS = ["Q1", "Q2", "Q3", "Q4"] as const;

const HANDLERS: { [N in ReadName]: Handler<N> } = {
  async listTasks(input, services, { now, timeZone, policy }) {
    const status = input.status ?? "TODO";
    // "Later" occurrences of a recurring task are not open work yet (#105),
    // unless asked for ("what comes up next month?").
    const tasks = await services.tasks.list(
      {
        status,
        shown: status !== "ARCHIVED" && !input.includeLater,
        ...(input.goalId ? { goalId: input.goalId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : input.inbox ? { projectId: null } : {}),
      },
      { now, timeZone },
    );
    const words = input.titleContains?.toLowerCase();
    const matching = tasks.filter(
      (t) =>
        (input.bigRock === undefined || t.isBigRock === input.bigRock) &&
        (!words || t.title.toLowerCase().includes(words)),
    );
    // The matrix at a glance: every quadrant, before the quadrant filter.
    const counts = Object.fromEntries(QUADRANTS.map((q) => [q, matching.filter((t) => t.quadrant === q).length]));
    const shown = input.quadrant ? matching.filter((t) => t.quadrant === input.quadrant) : matching;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? DEFAULT_READ_TASKS;
    const page = shown.slice(offset, offset + limit);
    return {
      total: shown.length,
      counts,
      nextOffset: offset + page.length < shown.length ? offset + page.length : null,
      tasks: page.map((t) => taskView(t, timeZone, policy)),
    };
  },

  async bigRocksThisWeek(_input, services, { now, timeZone, policy }) {
    return (await services.tasks.bigRocks({ now, timeZone })).map((t) => taskView(t, timeZone, policy));
  },

  async getCompass(input, services, { policy }) {
    const notShared: string[] = [];
    if (!policy.mission) notShared.push("mission (and the mission lines of roles)");
    if (!policy.goalsAndProjects) notShared.push("roles, goals and projects");
    const [mission, roles, goals, projects] = await Promise.all([
      policy.mission ? services.mission.getActive() : null,
      policy.goalsAndProjects ? services.roles.list() : [],
      policy.goalsAndProjects ? services.goals.list(input.goalStatus as GoalStatus | undefined) : [],
      policy.goalsAndProjects ? services.projects.list(input.projectStatus as ProjectStatus | undefined) : [],
    ]);
    return {
      ...(policy.mission ? { mission: mission ? { content: mission.content, updatedAt: iso(mission.updatedAt) } : null } : {}),
      ...(policy.goalsAndProjects
        ? {
            roles: roles.map((r) => ({
              id: r.id,
              name: r.name,
              // A role's mission line is mission text: shown only with "mission" on.
              ...(policy.mission ? { mission: r.mission } : {}),
            })),
            goals: goals.map((g) => ({
              id: g.id,
              title: g.title,
              description: g.description,
              status: g.status,
              targetDate: plain(g.targetDate),
              roleId: g.roleId,
              progress: g.progress,
            })),
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              status: p.status,
              goalId: p.goalId,
              progress: p.progress,
            })),
          }
        : {}),
      notShared,
    };
  },

  async listPeople(input, services, { now, timeZone, policy }) {
    const people = await services.people.overview(now);
    if (!input.status) return people.map((p) => personView(p, policy, timeZone));
    return people
      .map((p) => ({ person: p, behind: p.commitments.filter((c) => c.status === input.status) }))
      .filter(({ behind }) => behind.length > 0)
      .map(({ person, behind }) => personView(person, policy, timeZone, behind));
  },

  async listHabits(_input, services, { now, timeZone }) {
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

  async renewalOverview(input, services, { now, timeZone, policy }) {
    const clock = { now, timeZone };
    const [summary, intentions, trends] = await Promise.all([
      services.renewal.summary(clock),
      services.renewal.intentions(clock),
      input.includeTrends ? services.renewal.trends(clock) : null,
    ]);
    const intentionOf = new Map(intentions.map((i) => [i.dimension, i.text]));
    return {
      thisWeek: summary.map((d) => ({
        dimension: d.dimension,
        habitsDone: d.habitsDone,
        habitsTarget: d.habitsTarget,
        oneOffs: d.oneOffs,
        total: d.total,
        intention: intentionOf.get(d.dimension) ?? null,
      })),
      ...(trends
        ? {
            trends: {
              thisWeek: trends.thisWeek,
              lastWeek: trends.lastWeek,
              longestStreak: trends.longestStreak,
              // Goal titles are goals data: shown only with "goalsAndProjects" on.
              ...(policy.goalsAndProjects ? { goalMomentum: trends.goalMomentum } : {}),
              /** 12 ISO weeks (oldest first) × Monday..Sunday of completions. */
              heatmap: trends.heatmap,
            },
          }
        : {}),
    };
  },
};

/**
 * Runs one read. An unknown read, a read whose categories are all off, and
 * invalid arguments are reported back as errors (a model can correct
 * itself); a service failure is reported the same way, without internals.
 */
export async function runRead(
  name: string,
  args: unknown,
  services: ReadServices,
  context: ReadContext,
): Promise<ReadOutcome> {
  if (!isRead(name)) return { ok: false, error: `Unknown read "${name}".` };
  if (!readAllowed(name, context.policy)) {
    return { ok: false, error: "This reads data the user has not shared with AI." };
  }
  const parsed = READS[name].input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments: ${zodErrorText(parsed.error)}` };
  try {
    const handler = HANDLERS[name] as Handler<ReadName>;
    return { ok: true, result: await handler(parsed.data as never, services, context) };
  } catch (err) {
    context.onError?.(name, err);
    return { ok: false, error: "Reading that failed. Try again or answer without it." };
  }
}
