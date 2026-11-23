/**
 * The handlers of the operation registry (issue #109): for each operation
 * declared in `@clock-compass/assistant-catalog` (`operations.ts`), the call
 * into the service layer that carries it out. No business logic of its own
 * beyond deciding, for the target-state operations, whether anything needs to
 * change; the declaration's `refs` and `check` are run here against the
 * server's own data before anything is written.
 *
 * `runOperation` is the one entry point, used by the REST endpoint
 * (`POST /api/operations/{name}`) and the MCP adapter alike.
 */
import {
  checkOperation,
  isOperation,
  operation,
  zodErrorText,
  type CheckData,
  type OperationInput,
  type OperationName,
} from "@clock-compass/assistant-catalog";
import { createHash } from "node:crypto";
import { zonedDay, zonedMidnight } from "../domain/zoned.js";
import type { GoalService } from "../services/goal-service.js";
import type { MissionService } from "../services/mission-service.js";
import type { PeopleService } from "../services/people-service.js";
import type { ProjectService } from "../services/project-service.js";
import type { RenewalService } from "../services/renewal-service.js";
import type { TaskService, TaskWithQuadrant, UpdateTaskInput } from "../services/task-service.js";

export interface OperationServices {
  tasks: TaskService;
  goals: GoalService;
  projects: ProjectService;
  people: PeopleService;
  renewal: RenewalService;
  mission: MissionService;
}

export interface OperationContext {
  /** The caller's IANA time zone: a day ("2026-11-23") is its local midnight. */
  timeZone: string;
  now: Date;
  /**
   * The caller's idempotency key (the endpoint's `Idempotency-Key`). An
   * operation that creates derives the new item's id from it, so a repeat
   * with the same key finds the item made the first time.
   */
  idempotencyKey?: string;
}

/** What a create reports: the item's id, and whether this call made it (1) or found it (0). */
export interface Created extends Changed {
  id: string;
}

/** The id a create with this idempotency key gives its item: the same key, the same id. */
export function idFromKey(key: string): string {
  return `k${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/** A plain date as stored by the task form: UTC midnight of that day. */
const plainDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Why an operation was not run. `status` follows HTTP: 400 for input the
 * schema refuses, 404 for an unknown operation, 422 for input that is valid
 * but cannot be carried out with the data as it is (an item that no longer
 * exists, a rock that is not Quadrant II).
 */
export class OperationError extends Error {
  constructor(
    readonly status: 400 | 404 | 422,
    message: string,
  ) {
    super(message);
    this.name = "OperationError";
  }
}

/** What a target-state operation reports: how many items it changed (0 when already so). */
export interface Changed {
  changed: number;
}

type Handler<N extends OperationName> = (
  input: OperationInput<N>,
  services: OperationServices,
  context: OperationContext,
) => Promise<unknown>;

/** Runs the declaration's checks on this data; refuses with 422 when one fails. */
function requireCheck(name: OperationName, input: unknown, data: CheckData): void {
  const refused = checkOperation(operation(name), input, data);
  if (refused) throw new OperationError(422, refused);
}

/** The task with this id as check data (missing when it does not exist). */
async function taskData(services: OperationServices, ...ids: string[]): Promise<{ tasks: TaskWithQuadrant[] }> {
  const found = await Promise.all(ids.map((id) => services.tasks.get(id)));
  return { tasks: found.filter((t) => t !== null) };
}

/** The goal and project an input names, as check data (missing when they do not exist). */
async function linkData(
  services: OperationServices,
  input: { goalId?: string | null; projectId?: string | null },
): Promise<CheckData> {
  const [goal, project] = await Promise.all([
    input.goalId ? services.goals.get(input.goalId) : null,
    input.projectId ? services.projects.get(input.projectId) : null,
  ]);
  return { goals: goal ? [goal] : [], projects: project ? [project] : [] };
}

async function habitData(services: OperationServices, now: Date): Promise<CheckData> {
  return { habits: await services.renewal.listHabits(now) };
}

/** The task an operation names, once the declaration's checks passed on it. */
async function checkedTask(name: OperationName, input: { taskId: string }, services: OperationServices) {
  const data = await taskData(services, input.taskId);
  requireCheck(name, input, data);
  return data.tasks[0]!;
}

const toDate = (iso: string | null | undefined) =>
  iso === undefined ? undefined : iso === null ? null : new Date(iso);

const HANDLERS: { [N in OperationName]: Handler<N> } = {
  // --- The assistant's actions: target states, safe to repeat ------------------
  async setTaskDone(input, services): Promise<Changed> {
    const { taskId, done } = input;
    const task = await checkedTask("setTaskDone", input, services);
    if ((task.status === "DONE") === done) return { changed: 0 };
    await (done ? services.tasks.complete(taskId) : services.tasks.reopen(taskId));
    return { changed: 1 };
  },

  async scheduleTask(input, services, { timeZone }): Promise<Changed> {
    const { taskId, day, time } = input;
    const task = await checkedTask("scheduleTask", input, services);
    const wantedTime = day === null ? null : time;
    const sameDay =
      day === null ? task.scheduledDay === null : !!task.scheduledDay && zonedDay(task.scheduledDay, timeZone) === day;
    if (sameDay && (task.scheduledTime ?? null) === wantedTime) return { changed: 0 };
    await services.tasks.update(taskId, {
      scheduledDay: day === null ? null : zonedMidnight(day, timeZone),
      scheduledTime: wantedTime,
    });
    return { changed: 1 };
  },

  async setBigRock(input, services, { now }): Promise<Changed> {
    const task = await checkedTask("setBigRock", input, services);
    if (task.isBigRock === input.bigRock) return { changed: 0 };
    await services.tasks.setBigRock(input.taskId, input.bigRock, now);
    return { changed: 1 };
  },

  async setHabitDoneToday(input, services, { now }): Promise<Changed> {
    requireCheck("setHabitDoneToday", input, await habitData(services, now));
    const { changed } = await services.renewal.setMark(input.habitId, now, input.done, now);
    return { changed: changed ? 1 : 0 };
  },

  async createTask(input, services, { timeZone, idempotencyKey }): Promise<Created> {
    requireCheck("createTask", input, await linkData(services, input));
    const id = idempotencyKey ? idFromKey(idempotencyKey) : undefined;
    if (id) {
      const existing = await services.tasks.get(id);
      if (existing) return { changed: 0, id };
    }
    const fields = {
      title: input.title,
      notes: input.notes || undefined,
      important: input.important ?? false,
      urgent: input.urgent ?? false,
      proactivity: input.proactivity ?? null,
      dueDate: input.dueDate ? plainDate(input.dueDate) : null,
      scheduledDay: input.scheduledDay ? zonedMidnight(input.scheduledDay, timeZone) : null,
      scheduledTime: input.scheduledTime ?? null,
      projectId: input.projectId ?? null,
      goalId: input.goalId ?? null,
    };
    try {
      const task = await services.tasks.create({ ...fields, ...(id ? { id } : {}) });
      return { changed: 1, id: task.id };
    } catch (err) {
      // Two requests with the same key at once: the second finds the first's task.
      if (id && (err as { code?: unknown }).code === "P2002" && (await services.tasks.get(id))) return { changed: 0, id };
      throw err;
    }
  },

  async updateTask(input, services, { timeZone }): Promise<Changed> {
    const found = await taskData(services, input.taskId);
    requireCheck("updateTask", input, { ...found, ...(await linkData(services, input)) });
    const task = found.tasks[0]!;
    const patch: UpdateTaskInput = {};
    const day = (d: Date | null) => (d ? zonedDay(d, timeZone) : null);
    const plain = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    if (input.title !== undefined && input.title !== task.title) patch.title = input.title;
    if (input.notes !== undefined && (input.notes || null) !== (task.notes || null)) patch.notes = input.notes || null;
    if (input.important !== undefined && input.important !== task.important) patch.important = input.important;
    if (input.urgent !== undefined && input.urgent !== task.urgent) patch.urgent = input.urgent;
    if (input.proactivity !== undefined && input.proactivity !== task.proactivity) patch.proactivity = input.proactivity;
    if (input.dueDate !== undefined && input.dueDate !== plain(task.dueDate)) {
      patch.dueDate = input.dueDate ? plainDate(input.dueDate) : null;
    }
    if (input.scheduledDay !== undefined && input.scheduledDay !== day(task.scheduledDay)) {
      patch.scheduledDay = input.scheduledDay ? zonedMidnight(input.scheduledDay, timeZone) : null;
    }
    // Off the Clock means no time either; otherwise a time given is set.
    const wantedTime = input.scheduledDay === null ? null : input.scheduledTime;
    if (wantedTime !== undefined && wantedTime !== (task.scheduledTime ?? null)) patch.scheduledTime = wantedTime;
    if (input.projectId !== undefined && input.projectId !== task.projectId) patch.projectId = input.projectId;
    if (input.goalId !== undefined && input.goalId !== task.goalId) patch.goalId = input.goalId;
    if (Object.keys(patch).length === 0) return { changed: 0 };
    await services.tasks.update(input.taskId, patch);
    return { changed: 1 };
  },

  async acceptWeekPlan(input, services, { timeZone }): Promise<Changed> {
    requireCheck("acceptWeekPlan", input, { tasks: await services.tasks.list() });
    const changed = await services.tasks.replaceBigRocks(input.taskIds, zonedMidnight(input.weekStart, timeZone));
    return { changed };
  },

  async setIntention({ dimension, text }, services, { now }): Promise<Changed> {
    const current = (await services.renewal.intentions(now)).find((i) => i.dimension === dimension);
    if (current?.text === text) return { changed: 0 };
    await services.renewal.setIntention(dimension, text, now);
    return { changed: 1 };
  },

  // --- The MCP adapter's write tools: as they were before the registry ---------
  async create_task({ dueDate, ...rest }, services) {
    return services.tasks.create({ ...rest, dueDate: toDate(dueDate) });
  },

  async update_task({ id, dueDate, scheduledDay, isBigRock, ...rest }, services) {
    if (isBigRock !== undefined) await services.tasks.setBigRock(id, isBigRock);
    return services.tasks.update(id, { ...rest, dueDate: toDate(dueDate), scheduledDay: toDate(scheduledDay) });
  },

  async complete_task({ id }, services) {
    return services.tasks.complete(id);
  },

  async reopen_task({ id }, services) {
    return services.tasks.reopen(id);
  },

  async delete_task({ id }, services) {
    await services.tasks.remove(id);
    return { deleted: id };
  },

  async set_mission({ content }, services) {
    if (!content.trim()) throw new OperationError(422, "Mission statement cannot be empty.");
    return services.mission.set(content);
  },

  async create_goal({ targetDate, ...rest }, services) {
    return services.goals.create({ ...rest, targetDate: toDate(targetDate) ?? undefined });
  },

  async create_project(input, services) {
    return services.projects.create(input);
  },

  async log_commitment_occurrence({ commitmentId, ...opts }, services) {
    await services.people.logOccurrence(commitmentId, opts);
    return { logged: commitmentId };
  },

  async add_eba_entry({ personId, kind, note }, services) {
    // The entry as stored, note included: an operation's own result is not
    // filtered (owner decision on #109, section 9). Notes are kept from the
    // AI provider where a result would go to the model, not here.
    return services.people.addEbaEntry(personId, kind, note);
  },

  async toggle_habit({ habitId, day }, services, { now }) {
    try {
      return await services.renewal.toggleMark(habitId, day ? new Date(day) : now);
    } catch (err) {
      // A rule of the service, not a fault: refuse in its own words (as the MCP tool always did).
      if (err instanceof Error && err.message === "Cannot mark a future day") throw new OperationError(422, err.message);
      throw err;
    }
  },

  async log_renewal_activity(input, services) {
    return services.renewal.logActivity(input);
  },

  async set_weekly_intention({ dimension, text }, services) {
    await services.renewal.setIntention(dimension, text);
    return { dimension, text };
  },
};

/**
 * Validates `input` with the operation's schema and runs it. Throws an
 * OperationError for an unknown operation, invalid input or a failed check;
 * other errors (a missing record, the database) pass through.
 */
export async function runOperation(
  name: string,
  input: unknown,
  services: OperationServices,
  context: OperationContext,
): Promise<unknown> {
  if (!isOperation(name)) throw new OperationError(404, `There is no operation "${name}".`);
  const parsed = operation(name).input.safeParse(input ?? {});
  if (!parsed.success) throw new OperationError(400, zodErrorText(parsed.error));
  const handler = HANDLERS[name] as Handler<OperationName>;
  return handler(parsed.data as never, services, context);
}
