import type { CadenceUnit, Prisma, ProactivityTag, RepeatFrom, Task, TaskSeries, TaskSource, TaskStatus } from "@prisma/client";
import { dayAtUtc, isPlainDate, isoWeekStart, serverZone } from "../domain/week.js";
import { scheduledDayOf, storedScheduledDay } from "../domain/scheduled-day.js";
import { deriveQuadrant, type Quadrant } from "../domain/quadrant.js";
import { zonedDay } from "../domain/zoned.js";
import {
  nextOccurrenceDates,
  nextSlot,
  showFromFor,
  upcomingOccurrences,
  daysBetween,
  type OccurrenceDates,
  type RecurrenceRule,
} from "../domain/recurrence.js";
import type { TaskRecord, TaskRepository } from "../repositories/task-repository.js";

/** A recurrence as callers give it: every `every` `unit`s, counted from the schedule or from completion. */
export interface RecurrenceInput {
  unit: CadenceUnit;
  every?: number;
  from?: RepeatFrom;
  /** "Show from" this many days before the due date; null or left out = no "show from". */
  leadDays?: number | null;
}

/** A task's recurrence as the API returns it (null when it does not repeat). */
export interface RecurrenceView {
  unit: CadenceUnit;
  every: number;
  from: RepeatFrom;
  leadDays: number | null;
  /** False once it stopped repeating. */
  active: boolean;
}

export interface CreateTaskInput {
  /** Chosen by the caller (an idempotent create, #109); left out = generated. */
  id?: string;
  title: string;
  notes?: string;
  important?: boolean;
  urgent?: boolean;
  dueDate?: Date | null;
  goalId?: string | null;
  projectId?: string | null;
  proactivity?: ProactivityTag | null;
  /** A plain date at UTC midnight (#136); anything else is refused. */
  scheduledDay?: Date | null;
  scheduledTime?: string | null;
  /** Repeat this task (#105): it needs a due date or a scheduled day. */
  recurrence?: RecurrenceInput | null;
  /** Import provenance (Todoist CSV / AI intake); defaults to MANUAL. */
  source?: TaskSource;
  externalPriority?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  important?: boolean;
  urgent?: boolean;
  dueDate?: Date | null;
  goalId?: string | null;
  projectId?: string | null;
  isBigRock?: boolean;
  plannedWeek?: Date | null;
  proactivity?: ProactivityTag | null;
  /** The Clock lens: which day this happens (independent of quadrant). */
  scheduledDay?: Date | null;
  /** Optional "HH:MM" within the scheduled day. */
  scheduledTime?: string | null;
  /**
   * Repeat from now on (a new rule counted from this occurrence), or null to
   * stop repeating. Left out: this occurrence only.
   */
  recurrence?: RecurrenceInput | null;
}

/** Filters for listing tasks. */
export interface TaskFilter {
  /** A status; left out = every status but ARCHIVED (skipped occurrences). */
  status?: TaskStatus;
  /** A specific goal's tasks, or `null` for tasks not linked to any goal. */
  goalId?: string | null;
  /** A specific project's tasks, or `null` for the Inbox (no project). */
  projectId?: string | null;
  proactivity?: ProactivityTag;
  /** Only tasks that are shown now: not "later" occurrences, not skipped ones. */
  shown?: boolean;
}

/** When and where: the caller's time zone (whose "today"; scheduled days are plain dates, #136) and now. */
export interface TaskClock {
  timeZone?: string;
  now?: Date;
}

/**
 * A task as the API and the UI consume it: its derived quadrant, whether it
 * is a "later" occurrence (its "show from" date has not come), and its
 * series' rule. None of these is stored on the task.
 */
export type TaskWithQuadrant = Task & {
  quadrant: Quadrant;
  later: boolean;
  recurrence: RecurrenceView | null;
};

/**
 * An upcoming occurrence of a recurring task, for the calendar only (#105
 * step 2): worked out from the series' rule, never stored, not a task. It
 * becomes a real task only when the open occurrence is completed or skipped.
 */
export interface TaskPreview {
  seriesId: string;
  /** The open occurrence it would follow (the series' current task). */
  taskId: string;
  title: string;
  /** The calendar day it sits on (YYYY-MM-DD, in the caller's zone). */
  day: string;
  dueDate: string | null;
  scheduledTime: string | null;
  /** Counted from completion: the date if the open one is completed on its day. */
  approximate: boolean;
}

/** The longest range previews are worked out for, in days (a calendar week is 7). */
export const MAX_PREVIEW_RANGE_DAYS = 62;

/** Why a recurrence change cannot be made (the routes answer 400 or 422 with it). */
export class TaskRuleError extends Error {
  constructor(
    readonly status: 400 | 422,
    message: string,
  ) {
    super(message);
    this.name = "TaskRuleError";
  }
}

/** Today as the server sees it: in its own zone, `TZ` (#112). */
export const serverToday = (now: Date = new Date()) => zonedDay(now, serverZone());

const plain = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const atUtcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

function recurrenceView(series: TaskSeries | null): RecurrenceView | null {
  if (!series) return null;
  return {
    unit: series.cadenceUnit,
    every: series.cadenceValue,
    from: series.from,
    leadDays: series.leadDays,
    active: series.endedAt === null,
  };
}

function derive(task: TaskRecord, today: string): TaskWithQuadrant {
  const { series, ...rest } = task;
  const showFrom = plain(task.showFrom);
  return {
    ...rest,
    quadrant: deriveQuadrant(task),
    later: task.status === "TODO" && showFrom !== null && showFrom > today,
    recurrence: recurrenceView(series),
  };
}

const ruleOf = (series: TaskSeries): RecurrenceRule => ({
  unit: series.cadenceUnit,
  every: series.cadenceValue,
  from: series.from,
  anchorDate: plain(series.anchorDate)!,
  leadDays: series.leadDays,
});

/**
 * An occurrence's dates as plain days. `timeZone` only reads a scheduled day
 * still in its old form (#136, legacy until #137).
 */
function datesOf(task: Task, timeZone: string): OccurrenceDates {
  const due = plain(task.dueDate);
  const scheduledDay = scheduledDayOf(task.scheduledDay, timeZone);
  return {
    slot: plain(task.slotDate) ?? due ?? scheduledDay ?? "",
    due,
    scheduledDay,
    scheduledTime: task.scheduledTime,
    showFrom: plain(task.showFrom),
  };
}

/** The fields an occurrence carries over to the next one (#105, decision 8). */
const CARRIED = ["title", "notes", "important", "urgent", "proactivity", "goalId", "projectId"] as const;

function validRecurrence(input: RecurrenceInput): void {
  const every = input.every ?? 1;
  if (!Number.isInteger(every) || every < 1 || every > 999) throw new TaskRuleError(400, "every must be a whole number from 1 to 999");
  const lead = input.leadDays;
  if (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) {
    throw new TaskRuleError(400, "leadDays must be a whole number from 0 to 365");
  }
}

const NEEDS_A_DATE = "A repeating task needs a due date or a scheduled day.";

/**
 * A scheduled day is a plain date (#136): the calendar date at UTC midnight.
 * Anything else is refused, so no caller can store a moment again.
 */
function plainScheduledDay(day: Date | null | undefined): void {
  if (day && !isPlainDate(day)) throw new TaskRuleError(400, "scheduledDay must be a plain date (YYYY-MM-DD).");
}

/** A task as progress sees it: its status and, for an occurrence, its "show from" date. */
export interface ProgressTaskRef {
  status: TaskStatus;
  showFrom?: Date | null;
}

/**
 * What counts toward a goal's or project's progress (#105): done tasks, and
 * open tasks that are shown now. A skipped occurrence (ARCHIVED) or a "later"
 * one never counts, so a goal with a yearly task can reach 100%.
 */
export function progressCounts(tasks: Iterable<ProgressTaskRef>, today: string = serverToday()) {
  let total = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.status === "ARCHIVED") continue;
    if (t.status === "TODO" && t.showFrom && plain(t.showFrom)! > today) continue;
    total++;
    if (t.status === "DONE") done++;
  }
  return { total, done, ratio: total ? done / total : 0 };
}

/** Group a list of tasks by their derived quadrant (handy for the matrix UI). */
export function groupByQuadrant(
  tasks: TaskWithQuadrant[],
): Record<Quadrant, TaskWithQuadrant[]> {
  const groups: Record<Quadrant, TaskWithQuadrant[]> = {
    Q1: [],
    Q2: [],
    Q3: [],
    Q4: [],
  };
  for (const task of tasks) groups[task.quadrant].push(task);
  return groups;
}

const isUniqueViolation = (err: unknown) => (err as { code?: unknown }).code === "P2002";

/**
 * Business logic for tasks. Holds no ORM calls of its own — it depends only on
 * the TaskRepository interface, so it is trivially unit-testable with a fake.
 *
 * Recurring tasks (#105): an occurrence belongs to a series (the rule). There
 * is at most one open occurrence; completing or skipping it creates the next
 * one, here and only here, whichever way it was completed (the app, the REST
 * route, MCP, the assistant). `previousId` is unique, so an occurrence has at
 * most one successor whatever arrives twice.
 */
export class TaskService {
  constructor(private readonly tasks: TaskRepository) {}

  /** Today for this caller: in its zone when it has one, else the server's (#112). */
  private today(clock: TaskClock = {}): string {
    return zonedDay(clock.now ?? new Date(), clock.timeZone ?? serverZone());
  }

  async create(input: CreateTaskInput, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    plainScheduledDay(input.scheduledDay);
    const data: Prisma.TaskCreateInput = {
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      notes: input.notes,
      important: input.important ?? false,
      urgent: input.urgent ?? false,
      dueDate: input.dueDate ?? null,
      proactivity: input.proactivity ?? null,
      scheduledDay: input.scheduledDay ?? null,
      scheduledTime: input.scheduledTime ?? null,
      ...(input.source ? { source: input.source } : {}),
      ...(input.externalPriority != null
        ? { externalPriority: input.externalPriority }
        : {}),
      ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
      ...(input.projectId ? { project: { connect: { id: input.projectId } } } : {}),
    };
    if (!input.recurrence) return derive(await this.tasks.create(data), this.today(clock));
    const recurrence = input.recurrence;
    validRecurrence(recurrence);
    const slot = plain(input.dueDate ?? null) ?? plain(input.scheduledDay ?? null);
    if (!slot) throw new TaskRuleError(400, NEEDS_A_DATE);
    return this.tasks.transaction(async (repo) => {
      const series = await repo.createSeries({
        cadenceUnit: recurrence.unit,
        cadenceValue: recurrence.every ?? 1,
        from: recurrence.from ?? "SCHEDULE",
        anchorDate: atUtcMidnight(slot),
        leadDays: recurrence.leadDays ?? null,
      });
      const showFrom = showFromFor(ruleOf(series), slot);
      const task = await repo.create({
        ...data,
        series: { connect: { id: series.id } },
        slotDate: atUtcMidnight(slot),
        showFrom: showFrom ? atUtcMidnight(showFrom) : null,
      });
      return derive(task, this.today(clock));
    });
  }

  async get(id: string, clock: TaskClock = {}): Promise<TaskWithQuadrant | null> {
    const task = await this.tasks.findById(id);
    return task ? derive(task, this.today(clock)) : null;
  }

  /** List tasks with optional filters (status, goal, influence/concern, shown now). */
  async list(filter: TaskFilter = {}, clock: TaskClock = {}): Promise<TaskWithQuadrant[]> {
    const where: Prisma.TaskWhereInput = { status: filter.status ?? { not: "ARCHIVED" } };
    if (filter.goalId !== undefined) where.goalId = filter.goalId;
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.proactivity) where.proactivity = filter.proactivity;
    const today = this.today(clock);
    const tasks = (await this.tasks.findMany(where)).map((t) => derive(t, today));
    return filter.shown ? tasks.filter((t) => !t.later && t.status !== "ARCHIVED") : tasks;
  }

  /**
   * Previews of the occurrences that follow each open occurrence, for the
   * days `from`..`to` (plain dates in the caller's zone, at most
   * MAX_PREVIEW_RANGE_DAYS apart). A series that ended has none; nor does
   * one whose open occurrence is gone (deleted, or completed and its next
   * one not yet made).
   */
  async previews(from: string, to: string, clock: TaskClock = {}): Promise<TaskPreview[]> {
    const span = daysBetween(from, to);
    if (!Number.isFinite(span) || span < 0) throw new TaskRuleError(400, "to must be on or after from");
    if (span >= MAX_PREVIEW_RANGE_DAYS) {
      throw new TaskRuleError(400, `The range can be at most ${MAX_PREVIEW_RANGE_DAYS} days`);
    }
    const timeZone = clock.timeZone ?? serverZone();
    const today = this.today(clock);
    const open = await this.tasks.findMany({ status: "TODO" });
    const previews: TaskPreview[] = [];
    for (const task of open) {
      if (!task.series || task.series.endedAt) continue;
      const dates = datesOf(task, timeZone);
      if (!dates.slot) continue;
      for (const up of upcomingOccurrences(ruleOf(task.series), dates, today, from, to)) {
        previews.push({
          seriesId: task.series.id,
          taskId: task.id,
          title: task.title,
          day: up.day,
          dueDate: up.due ? atUtcMidnight(up.due).toISOString() : null,
          scheduledTime: up.scheduledTime,
          approximate: up.approximate,
        });
      }
    }
    return previews.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
  }

  /** Every occurrence of a series (the history: done, skipped and open), oldest first. */
  async occurrences(seriesId: string, clock: TaskClock = {}): Promise<TaskWithQuadrant[]> {
    const today = this.today(clock);
    const all = await this.tasks.findMany({ seriesId });
    return all
      .map((t) => derive(t, today))
      .sort((a, b) => (plain(a.slotDate) ?? "").localeCompare(plain(b.slotDate) ?? ""));
  }

  /**
   * Partial update. Importance/urgency edits move a task between quadrants
   * (the quadrant itself is never stored — it is always re-derived).
   *
   * For an occurrence of a recurring task, an edit without `recurrence`
   * changes this occurrence only (moving this year's due date does not move
   * next year's). `recurrence` changes the rule from this occurrence on;
   * `recurrence: null` stops repeating.
   */
  async update(id: string, input: UpdateTaskInput, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    plainScheduledDay(input.scheduledDay);
    const data: Prisma.TaskUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.important !== undefined) data.important = input.important;
    if (input.urgent !== undefined) data.urgent = input.urgent;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate;
    if (input.isBigRock !== undefined) data.isBigRock = input.isBigRock;
    if (input.plannedWeek !== undefined) data.plannedWeek = input.plannedWeek;
    if (input.proactivity !== undefined) data.proactivity = input.proactivity;
    if (input.scheduledDay !== undefined) data.scheduledDay = input.scheduledDay;
    if (input.scheduledTime !== undefined) data.scheduledTime = input.scheduledTime;
    if (input.goalId !== undefined) {
      data.goal = input.goalId
        ? { connect: { id: input.goalId } }
        : { disconnect: true };
    }
    if (input.projectId !== undefined) {
      data.project = input.projectId
        ? { connect: { id: input.projectId } }
        : { disconnect: true };
    }
    if (input.recurrence === undefined && input.dueDate === undefined) {
      return derive(await this.tasks.update(id, data), this.today(clock));
    }
    const timeZone = clock.timeZone ?? serverZone();
    return this.tasks.transaction(async (repo) => {
      const current = await repo.findById(id);
      if (!current) return derive(await repo.update(id, data), this.today(clock)); // the repository's "not found"
      const due = input.dueDate !== undefined ? plain(input.dueDate) : plain(current.dueDate);
      const scheduled =
        input.scheduledDay !== undefined ? plain(input.scheduledDay) : scheduledDayOf(current.scheduledDay, timeZone);
      const series = current.series;
      if (input.recurrence === null) {
        // Stop repeating: the series ends, this occurrence stays as a plain open task.
        if (series && !series.endedAt) await repo.updateSeries(series.id, { endedAt: clock.now ?? new Date() });
        data.showFrom = null;
      } else if (input.recurrence) {
        validRecurrence(input.recurrence);
        const slot = due ?? scheduled;
        if (!slot) throw new TaskRuleError(400, NEEDS_A_DATE);
        const rule = {
          cadenceUnit: input.recurrence.unit,
          cadenceValue: input.recurrence.every ?? 1,
          from: input.recurrence.from ?? "SCHEDULE",
          anchorDate: atUtcMidnight(slot),
          leadDays: input.recurrence.leadDays ?? null,
        };
        // From now on: the rule is counted from this occurrence.
        const next = series
          ? await repo.updateSeries(series.id, { ...rule, endedAt: null })
          : await repo.createSeries(rule);
        if (!series) data.series = { connect: { id: next.id } };
        data.slotDate = atUtcMidnight(slot);
        const showFrom = showFromFor(ruleOf(next), slot);
        data.showFrom = showFrom ? atUtcMidnight(showFrom) : null;
      } else if (series && !series.endedAt && series.leadDays !== null) {
        // This occurrence's due date moved: "show from" follows it; the slot does not.
        const base = due ?? plain(current.slotDate);
        const showFrom = base ? showFromFor(ruleOf(series), base) : null;
        data.showFrom = showFrom ? atUtcMidnight(showFrom) : null;
      }
      const updated = await repo.update(id, data);
      // A rule set on an occurrence that is already done (or skipped) starts
      // now: its next occurrence is created here, since nothing will complete
      // it again ("I did this a few weeks ago; it should come back every year").
      if (input.recurrence && updated.status !== "TODO") {
        const on = updated.completedAt ?? clock.now ?? new Date();
        await this.ensureNext(repo, updated, zonedDay(on, timeZone), { ...clock, timeZone });
      }
      return derive(updated, this.today(clock));
    });
  }

  /**
   * Habit 3: "what are my big rocks?" One rule everywhere (owner decision on
   * #98), the one the app's rocks jar shows: every pinned task (`isBigRock`)
   * until it is unpinned, done ones included, archived ones not. No week or
   * quadrant filter: `plannedWeek` only records when the rock was pinned and
   * is never compared, so the server's and the browser's time zones cannot
   * disagree. Callers that want the open rocks filter on status.
   */
  async bigRocks(clock: TaskClock = {}): Promise<TaskWithQuadrant[]> {
    const tasks = await this.tasks.findMany({ isBigRock: true, status: { not: "ARCHIVED" } });
    const today = this.today(clock);
    return tasks.map((t) => derive(t, today));
  }

  /**
   * Pin (or unpin) a task as a big rock. Pinning records the week it was
   * pinned in `plannedWeek`: the Monday of the caller's today (the server's
   * without a zone), as a plain date (#112). Nothing compares against it
   * (see `bigRocks`). Unpinning clears it.
   */
  async setBigRock(id: string, isBigRock: boolean, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    return this.update(id, {
      isBigRock,
      plannedWeek: isBigRock ? dayAtUtc(isoWeekStart(this.today(clock))) : null,
    });
  }

  /**
   * Make these tasks the open big rocks, in one transaction: pin the ones not
   * pinned yet (recording `plannedWeek`) and unpin every other open rock.
   * Finished rocks stay pinned (#120): the jar keeps showing what was done
   * this week, by the rule of #98 (pinned until unpinned). Tasks already in
   * the wanted state are
   * left alone, so repeating it changes nothing. Returns how many changed.
   * Checks (Quadrant II, still open) are the caller's: see the
   * `acceptWeekPlan` operation.
   */
  async replaceBigRocks(taskIds: readonly string[], plannedWeek: Date): Promise<number> {
    const plan = new Set(taskIds);
    const pinned = await this.tasks.findMany({ isBigRock: true, status: { not: "ARCHIVED" } });
    const pinnedIds = new Set(pinned.map((t) => t.id));
    const changes = [
      ...taskIds
        .filter((id) => !pinnedIds.has(id))
        .map((id) => ({ id, data: { isBigRock: true, plannedWeek } })),
      ...pinned
        .filter((t) => !plan.has(t.id) && t.status === "TODO")
        .map((t) => ({ id: t.id, data: { isBigRock: false, plannedWeek: null } })),
    ];
    if (changes.length) await this.tasks.updateEach(changes);
    return changes.length;
  }

  /**
   * Mark a task done, as a target state: a task already done is left as it
   * is (`completedAt` is not stamped again). For an occurrence of a series
   * that still repeats, this creates the next occurrence, once.
   */
  async complete(id: string, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    const now = clock.now ?? new Date();
    const timeZone = clock.timeZone ?? serverZone();
    try {
      return await this.tasks.transaction(async (repo) => {
        const task = await repo.findById(id);
        if (!task) return derive(await repo.update(id, { status: "DONE", completedAt: now }), this.today(clock));
        if (task.status === "DONE") return derive(task, this.today(clock));
        const done = await repo.update(id, { status: "DONE", completedAt: now });
        await this.ensureNext(repo, done, zonedDay(now, timeZone), { ...clock, timeZone });
        return derive(done, this.today(clock));
      });
    } catch (err) {
      // The same completion arrived twice at once: the other one made the next occurrence.
      if (isUniqueViolation(err)) return (await this.get(id, clock))!;
      throw err;
    }
  }

  /**
   * Reopen a completed (or skipped) task, as a target state: an open task is
   * left as it is. If the next occurrence it led to is still exactly as it
   * was created (open, not pinned, every field as generated), it is removed,
   * so an accidental tick undoes cleanly; a changed one stays.
   */
  async reopen(id: string, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    const timeZone = clock.timeZone ?? serverZone();
    return this.tasks.transaction(async (repo) => {
      const task = await repo.findById(id);
      if (!task) return derive(await repo.update(id, { status: "TODO", completedAt: null }), this.today(clock));
      if (task.status === "TODO") return derive(task, this.today(clock));
      const next = task.series ? await repo.findByPreviousId(task.id) : null;
      if (next && task.series && this.untouched(task, task.series, next, timeZone)) await repo.delete(next.id);
      return derive(await repo.update(id, { status: "TODO", completedAt: null }), this.today(clock));
    });
  }

  /**
   * Skip this occurrence: it becomes ARCHIVED (not done, out of every list)
   * and the next occurrence is created, from today.
   */
  async skip(id: string, clock: TaskClock = {}): Promise<TaskWithQuadrant> {
    const now = clock.now ?? new Date();
    const timeZone = clock.timeZone ?? serverZone();
    try {
      return await this.tasks.transaction(async (repo) => {
        const task = await repo.findById(id);
        if (!task) return derive(await repo.update(id, { status: "ARCHIVED" }), this.today(clock));
        if (task.status === "ARCHIVED") return derive(task, this.today(clock));
        if (task.status !== "TODO" || !task.series || task.series.endedAt) {
          throw new TaskRuleError(422, "Only the open occurrence of a repeating task can be skipped.");
        }
        const skipped = await repo.update(id, { status: "ARCHIVED" });
        await this.ensureNext(repo, skipped, zonedDay(now, timeZone), { ...clock, timeZone });
        return derive(skipped, this.today(clock));
      });
    } catch (err) {
      if (isUniqueViolation(err)) return (await this.get(id, clock))!;
      throw err;
    }
  }

  /**
   * Delete a task. Deleting the open occurrence of a series ends the series
   * (nothing comes after it); done and skipped occurrences stay as history.
   */
  async remove(id: string, clock: TaskClock = {}): Promise<void> {
    await this.tasks.transaction(async (repo) => {
      const task = await repo.findById(id);
      if (task?.status === "TODO" && task.series && !task.series.endedAt) {
        await repo.updateSeries(task.series.id, { endedAt: clock.now ?? new Date() });
      }
      await repo.delete(id);
    });
  }

  /** The fields the occurrence after `task` gets for this slot. */
  private nextFields(task: Task, series: TaskSeries, slot: string, timeZone: string) {
    const dates = nextOccurrenceDates(ruleOf(series), datesOf(task, timeZone), slot);
    return {
      dueDate: dates.due ? atUtcMidnight(dates.due) : null,
      scheduledDay: dates.scheduledDay ? storedScheduledDay(dates.scheduledDay) : null,
      scheduledTime: dates.scheduledTime,
      slotDate: atUtcMidnight(dates.slot),
      showFrom: dates.showFrom ? atUtcMidnight(dates.showFrom) : null,
    };
  }

  /** Creates the occurrence after `task`, unless its series ended or one exists already. */
  private async ensureNext(repo: TaskRepository, task: TaskRecord, completedOn: string, clock: TaskClock & { timeZone: string }) {
    const series = task.series;
    if (!series || series.endedAt) return;
    if (await repo.findByPreviousId(task.id)) return;
    const current = datesOf(task, clock.timeZone);
    if (!current.slot) return;
    const slot = nextSlot(ruleOf(series), current.slot, completedOn, this.today(clock));
    const fields = this.nextFields(task, series, slot, clock.timeZone);
    await repo.create({
      title: task.title,
      notes: task.notes,
      important: task.important,
      urgent: task.urgent,
      proactivity: task.proactivity,
      ...(task.goalId ? { goal: { connect: { id: task.goalId } } } : {}),
      ...(task.projectId ? { project: { connect: { id: task.projectId } } } : {}),
      ...fields,
      series: { connect: { id: series.id } },
      previous: { connect: { id: task.id } },
    });
  }

  /**
   * Whether the occurrence after `task` is still exactly what the service
   * made: open, not pinned, the carried fields equal, and its dates the ones
   * its own slot gives. Content, not timestamps.
   */
  private untouched(task: Task, series: TaskSeries, next: Task, timeZone: string): boolean {
    if (next.status !== "TODO" || next.isBigRock || !next.slotDate) return false;
    if (!CARRIED.every((key) => (next[key] ?? null) === (task[key] ?? null))) return false;
    const expected = this.nextFields(task, series, plain(next.slotDate)!, timeZone);
    const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
    // As days, not instants: an occurrence made before #136 holds the old form.
    return (
      same(next.dueDate, expected.dueDate) &&
      scheduledDayOf(next.scheduledDay, timeZone) === scheduledDayOf(expected.scheduledDay, timeZone) &&
      (next.scheduledTime ?? null) === expected.scheduledTime &&
      same(next.showFrom, expected.showFrom)
    );
  }
}
