/**
 * A task card inside an unconfirmed proposal (#145): the task as it will be
 * after Confirm, and which parts change.
 *
 * The changes come from the catalog's `taskChanges`, read from the same
 * arguments as the confirm sentence (`describe`), so the card and the
 * sentence cannot disagree. Here they are only applied to the live task.
 * React-free; tested against the official core in proposal.test.ts.
 */
import { ComponentContext, type SurfaceModel } from "@a2ui/web_core/v1_0";
import type { TaskChange } from "@clock-compass/assistant-catalog";
import type { Quadrant, Task } from "@clock-compass/web-client/api";
import { storedDay } from "@clock-compass/web-client/week";
import type { ProposedPart } from "@/components/TaskCard";
import { readConfirmEvent } from "./confirm";

export type TaskSet = TaskChange["set"];

/** What a card needs to know about a confirmable action in its surface. */
export interface ProposalHost {
  /** The tasks the action would change, and its key; null when it is not a write. */
  taskChanges(event: { name: string; surfaceId: string; context?: Record<string, unknown> }):
    | { key: string; changes: TaskChange[] }
    | null;
  /** Where the action stands: a proposal applied, running or declined is no longer pending. */
  stateOf(key: string): { status: string } | undefined;
}

const QUADRANT: Record<string, Quadrant> = { "11": "Q1", "10": "Q2", "01": "Q3", "00": "Q4" };
const plainOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The task as it would be after Confirm, and the parts that change. Whether
 * it would then show only later is the server's to decide, so `later` is
 * left as it is; a changed "show from" date is marked and shown instead.
 */
export function applyTaskChange(task: Task, set: TaskSet): { after: Task; changed: Set<ProposedPart> } {
  const changed = new Set<ProposedPart>();
  const after: Task = { ...task };
  const take = <K extends keyof Task>(key: K, value: Task[K] | undefined, part: ProposedPart) => {
    if (value === undefined || value === task[key]) return;
    after[key] = value;
    changed.add(part);
  };

  take("title", set.title, "title");
  if (set.done !== undefined) take("status", set.done ? "DONE" : "TODO", "done");
  take("important", set.important, "important");
  take("urgent", set.urgent, "urgent");
  after.quadrant = QUADRANT[`${after.important ? 1 : 0}${after.urgent ? 1 : 0}`]!;
  take("proactivity", set.proactivity, "proactivity");
  if (set.dueDate !== undefined && set.dueDate !== plainOf(task.dueDate)) {
    after.dueDate = set.dueDate === null ? null : storedDay(set.dueDate);
    changed.add("due");
  }
  if (set.scheduledDay !== undefined || set.scheduledTime !== undefined) {
    const day = set.scheduledDay !== undefined ? set.scheduledDay : plainOf(task.scheduledDay);
    const time = day === null ? null : set.scheduledTime !== undefined ? set.scheduledTime : task.scheduledTime;
    if (day !== plainOf(task.scheduledDay) || time !== task.scheduledTime) {
      after.scheduledDay = day === null ? null : storedDay(day);
      after.scheduledTime = time;
      changed.add("scheduled");
    }
  }
  take("projectId", set.projectId, "project");
  take("goalId", set.goalId, "goal");
  take("isBigRock", set.bigRock, "bigRock");
  if (set.repeat !== undefined) {
    const before = task.recurrence?.active ? task.recurrence : null;
    const same =
      before && set.repeat
        ? before.unit === set.repeat.unit &&
          before.every === set.repeat.every &&
          before.from === set.repeat.from &&
          before.leadDays === set.repeat.leadDays
        : before === set.repeat;
    if (!same) {
      after.recurrence = set.repeat ? { ...set.repeat, active: true } : before ? { ...before, active: false } : null;
      changed.add("repeat");
    }
    // "Show from" counts back from the due date, or the scheduled day when there is none.
    const slot = plainOf(after.dueDate) ?? plainOf(after.scheduledDay);
    const showFrom = set.repeat?.leadDays != null && slot ? storedDay(addDays(slot, -set.repeat.leadDays)) : null;
    if (showFrom !== (task.showFrom ?? null)) changed.add("showFrom");
    after.showFrom = showFrom;
  }
  return { after, changed };
}

/**
 * What the unconfirmed proposals in `surface` would set on `taskId`, read
 * from its ConfirmBars (their confirm events resolved against the data as it
 * is now, as each bar reads its own), or null when none would change it. A
 * proposal applied, running or declined is not pending (a failed one is). A bar that cannot be
 * read is left out: it shows its own error, and the card stays live.
 */
export function pendingTaskSet(surface: SurfaceModel<never>, host: ProposalHost, taskId: string): TaskSet | null {
  let found: TaskSet | null = null;
  for (const [id, model] of surface.componentsModel.entries) {
    if (model.type !== "ConfirmBar") continue;
    try {
      const event = readConfirmEvent(new ComponentContext(surface, id));
      const proposal = event ? host.taskChanges({ ...event, surfaceId: surface.id }) : null;
      if (!proposal) continue;
      // A failed Confirm leaves the bar open to try again: still pending.
      const status = host.stateOf(proposal.key)?.status;
      if (status && status !== "failed") continue;
      const change = proposal.changes.find((c) => c.taskId === taskId);
      if (change) found = Object.assign({}, found, change.set);
    } catch {
      continue;
    }
  }
  return found;
}
