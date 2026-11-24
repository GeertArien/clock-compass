/**
 * The handlers of the operation registry (issue #109): for each operation
 * declared in `@clock-compass/assistant-catalog` (`operations.ts`), the call
 * into the service layer that carries it out. No business logic of its own
 * beyond deciding, for the target-state operations, whether anything needs to
 * change; the declaration's `refs` and `check` are run here against the
 * server's own data before anything is written.
 *
 * `runOperation` is the one entry point, used by the REST endpoint
 * (`POST /api/operations/{name}`) and the MCP adapter alike: one set of
 * operations, one shape each (#109 step 3).
 */
import {
  DAY_TO_COME,
  checkOperation,
  isOperation,
  operation,
  repeatRule,
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
import type { RoleService } from "../services/role-service.js";
import { TaskRuleError, type TaskService, type TaskWithQuadrant, type UpdateTaskInput } from "../services/task-service.js";

export interface OperationServices {
  tasks: TaskService;
  goals: GoalService;
  projects: ProjectService;
  people: PeopleService;
  renewal: RenewalService;
  mission: MissionService;
  roles: RoleService;
}

export interface OperationContext {
  /** The caller's IANA time zone: a day ("2026-11-23") is its local midnight. */
  timeZone: string;
  now: Date;
  /**
   * The caller's idempotency key (the endpoint's `Idempotency-Key`, MCP's
   * `idempotencyKey` argument). An operation that creates derives the new
   * item's id from it, so a repeat with the same key finds the item made the
   * first time.
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

const isUniqueViolation = (err: unknown) => (err as { code?: unknown }).code === "P2002";

/**
 * Creates an item once per idempotency key: its id is derived from the key,
 * so a repeat (a retry after a lost answer, a double press, the same request
 * from two places at once) finds the item made the first time.
 */
async function once(
  key: string | undefined,
  find: (id: string) => Promise<unknown>,
  make: (id: string | undefined) => Promise<{ id: string }>,
): Promise<Created> {
  const id = key ? idFromKey(key) : undefined;
  if (id && (await find(id))) return { changed: 0, id };
  try {
    return { changed: 1, id: (await make(id)).id };
  } catch (err) {
    // Two requests with the same key at once: the second finds the first's item.
    if (id && isUniqueViolation(err) && (await find(id))) return { changed: 0, id };
    throw err;
  }
}

/**
 * When a logged day happened: now for today (or no day), midday of an
 * earlier day in the caller's zone; a day still to come is refused.
 */
function loggedAt(day: string | undefined, { timeZone, now }: OperationContext): Date | undefined {
  if (!day || day === zonedDay(now, timeZone)) return undefined;
  if (day > zonedDay(now, timeZone)) throw new OperationError(422, DAY_TO_COME);
  return new Date(zonedMidnight(day, timeZone).getTime() + 12 * 60 * 60 * 1000);
}

/** A habit day as the renewal service reads it: noon UTC of that day, so the server's zone keeps the date (#112). */
const habitDay = (day: string) => new Date(`${day}T12:00:00.000Z`);

const HANDLERS: { [N in OperationName]: Handler<N> } = {
  // --- The assistant's actions: target states, safe to repeat ------------------
  async setTaskDone(input, services, clock): Promise<Changed> {
    const { taskId, done } = input;
    const task = await checkedTask("setTaskDone", input, services);
    if ((task.status === "DONE") === done) return { changed: 0 };
    await (done ? services.tasks.complete(taskId, clock) : services.tasks.reopen(taskId, clock));
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

  async setHabitDone(input, services, { now, timeZone }): Promise<Changed> {
    requireCheck("setHabitDone", input, { ...(await habitData(services, now)), today: zonedDay(now, timeZone) });
    try {
      const { changed } = await services.renewal.setMark(input.habitId, input.day ? habitDay(input.day) : now, input.done, now);
      return { changed: changed ? 1 : 0 };
    } catch (err) {
      // A rule of the service, not a fault: refuse in its own words.
      if (err instanceof Error && err.message === "Cannot mark a future day") throw new OperationError(422, err.message);
      throw err;
    }
  },

  async createTask(input, services, { timeZone, idempotencyKey }): Promise<Created> {
    requireCheck("createTask", input, await linkData(services, input));
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
      recurrence: input.repeat ? repeatRule(input.repeat) : null,
    };
    return once(
      idempotencyKey,
      (id) => services.tasks.get(id),
      (id) => services.tasks.create({ ...fields, ...(id ? { id } : {}) }, { timeZone }),
    );
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
    if (input.repeat !== undefined) {
      // A target state: the same rule (or "not repeating" again) changes nothing.
      const now = task.recurrence?.active ? task.recurrence : null;
      const wanted = input.repeat === null ? null : repeatRule(input.repeat);
      const same =
        wanted === null
          ? now === null
          : now !== null && now.unit === wanted.unit && now.every === wanted.every && now.from === wanted.from && now.leadDays === wanted.leadDays;
      if (!same) patch.recurrence = wanted;
    }
    if (Object.keys(patch).length === 0) return { changed: 0 };
    await services.tasks.update(input.taskId, patch, { timeZone });
    return { changed: 1 };
  },

  async acceptWeekPlan(input, services, { timeZone }): Promise<Changed> {
    requireCheck("acceptWeekPlan", input, { tasks: await services.tasks.list() });
    const changed = await services.tasks.replaceBigRocks(input.taskIds, zonedMidnight(input.weekStart, timeZone));
    return { changed };
  },

  async setIntention({ dimension, text }, services, { now }): Promise<Changed> {
    const current = (await services.renewal.intentions(now)).find((i) => i.dimension === dimension);
    if ((current?.text ?? null) === text) return { changed: 0 };
    // An empty text clears this week's intention (the service's rule).
    await services.renewal.setIntention(dimension, text ?? "", now);
    return { changed: 1 };
  },

  // --- Offered to MCP only (the assistant never proposes these yet) -----------
  async deleteTask({ taskId }, services, clock): Promise<Changed> {
    // A target state: a task already gone changes nothing.
    if (!(await services.tasks.get(taskId))) return { changed: 0 };
    await services.tasks.remove(taskId, clock);
    return { changed: 1 };
  },

  async setMission({ text }, services): Promise<Changed> {
    if ((await services.mission.getActive())?.content === text) return { changed: 0 };
    await services.mission.set(text);
    return { changed: 1 };
  },

  async createGoal(input, services, { idempotencyKey }): Promise<Created> {
    const role = input.roleId ? await services.roles.get(input.roleId) : null;
    requireCheck("createGoal", input, { roles: role ? [role] : [] });
    return once(
      idempotencyKey,
      (id) => services.goals.get(id),
      (id) =>
        services.goals.create({
          ...(id ? { id } : {}),
          title: input.title,
          description: input.description || undefined,
          targetDate: input.targetDate ? plainDate(input.targetDate) : null,
          roleId: input.roleId ?? null,
        }),
    );
  },

  async createProject(input, services, { idempotencyKey }): Promise<Created> {
    requireCheck("createProject", input, await linkData(services, input));
    return once(
      idempotencyKey,
      (id) => services.projects.get(id),
      (id) => services.projects.create({ ...(id ? { id } : {}), name: input.name, goalId: input.goalId ?? null }),
    );
  },

  async logCommitmentOccurrence(input, services, context): Promise<Created> {
    const { idempotencyKey } = context;
    const [personIds, person] = await Promise.all([
      services.people.commitmentPeople(input.commitmentId),
      input.personId ? services.people.getPerson(input.personId) : null,
    ]);
    requireCheck("logCommitmentOccurrence", input, {
      today: zonedDay(context.now, context.timeZone),
      commitments: personIds ? [{ id: input.commitmentId, personIds }] : [],
      people: person ? [person] : [],
    });
    const occurredAt = loggedAt(input.day, context);
    return once(
      idempotencyKey,
      (id) => services.people.getOccurrence(id),
      (id) =>
        services.people.logOccurrence(input.commitmentId, {
          ...(id ? { id } : {}),
          personId: input.personId ?? null,
          note: input.note || null,
          ...(occurredAt ? { occurredAt } : {}),
        }),
    );
  },

  async addEbaEntry(input, services, { idempotencyKey }): Promise<Created> {
    const person = await services.people.getPerson(input.personId);
    requireCheck("addEbaEntry", input, { people: person ? [person] : [] });
    return once(
      idempotencyKey,
      (id) => services.people.getEbaEntry(id),
      (id) => services.people.addEbaEntry(input.personId, input.kind, input.note || null, id),
    );
  },

  async logRenewalActivity(input, services, context): Promise<Created> {
    const { idempotencyKey } = context;
    requireCheck("logRenewalActivity", input, { today: zonedDay(context.now, context.timeZone) });
    const occurredAt = loggedAt(input.day, context);
    return once(
      idempotencyKey,
      (id) => services.renewal.getActivity(id),
      (id) =>
        services.renewal.logActivity({
          ...(id ? { id } : {}),
          dimension: input.dimension,
          title: input.title,
          note: input.note || null,
          ...(occurredAt ? { occurredAt } : {}),
        }),
    );
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
  try {
    return await handler(parsed.data as never, services, context);
  } catch (err) {
    // A task rule the service refuses with this data ("a repeating task needs
    // a due date or a scheduled day", skipping what does not repeat): in its
    // words. The schema has already checked the rule itself, so it is a 422.
    if (err instanceof TaskRuleError) throw new OperationError(422, err.message);
    throw err;
  }
}
