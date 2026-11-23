/**
 * Carries out a confirmed action (issue #62, step 6; owner decision B: the
 * write path is the app's own client mutations, not server write tools).
 *
 * - Everything is checked before anything is written: the items exist, rocks
 *   are Quadrant II, a week plan's tasks are open. A refused action changes
 *   nothing.
 * - Actions state a target ("done: true"), so an item already in that state
 *   is left alone: confirming twice, or after a reload, is harmless.
 * - A day ("YYYY-MM-DD") is stored as the browser's local midnight, as the
 *   Clock stores it.
 *
 * The data and mutations come in through ActionPorts, so this is tested
 * without React or a server (actions.test.ts); `live-ports.ts` binds them to
 * the app's queries.
 */
import type { ActionArgs, ParsedAction } from "@clock-compass/assistant-catalog";
import type { HabitView, RenewalDimension, Task } from "@clock-compass/web-client/api";
import { isSameLocalDay, startOfIsoWeekIso } from "@clock-compass/web-client/week";

export type WriteAction = Extract<ParsedAction, { kind: "write" }>;

/** The task fields the executor changes through the app's task edit. */
export interface TaskChange {
  scheduledDay?: string | null;
  scheduledTime?: string | null;
  isBigRock?: boolean;
  plannedWeek?: string | null;
}

export interface ActionPorts {
  tasks(): Promise<Task[]>;
  habits(): Promise<HabitView[]>;
  intentions(): Promise<Partial<Record<RenewalDimension, string>>>;
  /** Each write resolves when the server confirmed it, and rejects when it failed. */
  setTaskDone(task: Task, done: boolean): Promise<void>;
  updateTask(task: Task, change: TaskChange): Promise<void>;
  toggleHabitToday(habit: HabitView): Promise<void>;
  setIntention(dimension: RenewalDimension, text: string): Promise<void>;
}

export type ActionResult = { ok: true; changed: number } | { ok: false; error: string };

/** "2026-11-23" as the browser's local midnight, the way the Clock stores a day. */
export function localMidnightIso(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
}

const isQ2 = (task: Task) => task.important && !task.urgent;

class Refused extends Error {}

function findTask(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id && t.status !== "ARCHIVED");
  if (!task) throw new Refused("That task no longer exists.");
  return task;
}

function requireRock(task: Task): void {
  if (!isQ2(task)) throw new Refused(`“${task.title}” is not in Quadrant II (important, not urgent), so it cannot be a big rock.`);
}

/** The app's data an action is checked against. */
export interface ActionData {
  tasks: Task[];
  habits: HabitView[];
}

/**
 * Why the app cannot carry out an action, or null when it can: the items
 * exist, rocks are Quadrant II, a plan's tasks are open. Runs before every
 * write, and before the bar is shown, so a proposal that cannot be done says
 * so before anyone presses it.
 */
export function checkAction(action: WriteAction, data: ActionData): string | null {
  try {
    switch (action.name) {
      case "setTaskDone":
      case "scheduleTask":
        findTask(data.tasks, (action.args as { taskId: string }).taskId);
        break;
      case "setBigRock": {
        const a = action.args as ActionArgs<"setBigRock">;
        const task = findTask(data.tasks, a.taskId);
        if (a.bigRock) requireRock(task);
        break;
      }
      case "setHabitDoneToday":
        if (!data.habits.some((h) => h.id === (action.args as ActionArgs<"setHabitDoneToday">).habitId)) {
          throw new Refused("That habit no longer exists.");
        }
        break;
      case "acceptWeekPlan":
        for (const id of (action.args as ActionArgs<"acceptWeekPlan">).taskIds) {
          const task = findTask(data.tasks, id);
          requireRock(task);
          if (task.status !== "TODO") throw new Refused(`“${task.title}” is already done, so it cannot be one of the week's rocks.`);
        }
        break;
      case "setIntention":
        break;
    }
    return null;
  } catch (err) {
    if (err instanceof Refused) return err.message;
    throw err;
  }
}

/** Runs one parsed, confirmed action. Never throws: failures come back as a result. */
export async function executeAction(action: WriteAction, ports: ActionPorts): Promise<ActionResult> {
  let changed = 0;
  try {
    // Read once, and decide from what was read: the check and the write see
    // the same data, and it is the server's (see live-ports.ts).
    const onHabits = action.name === "setHabitDoneToday";
    const onTasks = !onHabits && action.name !== "setIntention";
    const tasks = onTasks ? await ports.tasks() : [];
    const habits = onHabits ? await ports.habits() : [];
    const refused = checkAction(action, { tasks, habits });
    if (refused) return { ok: false, error: refused };
    switch (action.name) {
      case "setTaskDone": {
        const a = action.args as ActionArgs<"setTaskDone">;
        const task = findTask(tasks, a.taskId);
        if ((task.status === "DONE") !== a.done) {
          await ports.setTaskDone(task, a.done);
          changed++;
        }
        break;
      }
      case "scheduleTask": {
        const a = action.args as ActionArgs<"scheduleTask">;
        const task = findTask(tasks, a.taskId);
        const time = a.day === null ? null : (a.time ?? null);
        const sameDay =
          a.day === null ? task.scheduledDay === null : isSameLocalDay(task.scheduledDay, new Date(localMidnightIso(a.day)));
        if (!sameDay || (task.scheduledTime ?? null) !== time) {
          await ports.updateTask(task, { scheduledDay: a.day === null ? null : localMidnightIso(a.day), scheduledTime: time });
          changed++;
        }
        break;
      }
      case "setBigRock": {
        const a = action.args as ActionArgs<"setBigRock">;
        const task = findTask(tasks, a.taskId);
        if (task.isBigRock !== a.bigRock) {
          await ports.updateTask(task, {
            isBigRock: a.bigRock,
            plannedWeek: a.bigRock ? startOfIsoWeekIso() : null,
          });
          changed++;
        }
        break;
      }
      case "setHabitDoneToday": {
        const a = action.args as ActionArgs<"setHabitDoneToday">;
        const habit = habits.find((h) => h.id === a.habitId);
        if (!habit) throw new Refused("That habit no longer exists.");
        if (habit.markedToday !== a.done) {
          await ports.toggleHabitToday(habit);
          changed++;
        }
        break;
      }
      case "acceptWeekPlan": {
        const a = action.args as ActionArgs<"acceptWeekPlan">;
        const plan = a.taskIds.map((id) => findTask(tasks, id));
        const inPlan = new Set(a.taskIds);
        const plannedWeek = localMidnightIso(a.weekStart);
        // Pin the plan first, then unpin the rest: a failure part-way leaves
        // more rocks than planned, never fewer.
        for (const task of plan.filter((t) => !t.isBigRock)) {
          await ports.updateTask(task, { isBigRock: true, plannedWeek });
          changed++;
        }
        for (const task of tasks.filter((t) => t.isBigRock && t.status !== "ARCHIVED" && !inPlan.has(t.id))) {
          await ports.updateTask(task, { isBigRock: false, plannedWeek: null });
          changed++;
        }
        break;
      }
      case "setIntention": {
        const a = action.args as ActionArgs<"setIntention">;
        if ((await ports.intentions())[a.dimension] !== a.text) {
          await ports.setIntention(a.dimension, a.text);
          changed++;
        }
        break;
      }
    }
    return { ok: true, changed };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    const reason = err instanceof Error && err.message ? err.message : "the server did not accept it";
    return {
      ok: false,
      error: changed > 0 ? `Only part of this was done (${reason}). Confirm again to finish it.` : `This was not done: ${reason}.`,
    };
  }
}

