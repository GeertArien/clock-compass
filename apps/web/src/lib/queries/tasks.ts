import {
  MutationObserver,
  mutationOptions,
  queryOptions,
  useQuery,
  type MutationOptions,
  type QueryClient,
} from "@tanstack/react-query";
import {
  completeTask,
  createTask,
  deleteTask,
  listTaskOccurrences,
  listTaskPreviews,
  listTasks,
  reopenTask,
  skipTask,
  updateTask,
  type CreateTaskBody,
  type Task,
  type UpdateTaskBody,
} from "@clock-compass/web-client/api";
import { deriveQuadrant, errorMessage } from "@clock-compass/web-client/meta";
import {
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";
import { isoWeekMondayPlain, storedDay } from "@clock-compass/web-client/week";
import { queryClient } from "@/lib/query-client";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";
import { dropInFlight } from "./in-flight";
import { loadError } from "./load-error";
import { refreshGoals } from "./goals";
import { refreshProjects } from "./projects";

export { QUADRANT_META } from "@clock-compass/web-client/meta";

// In-flight edits per task: whatever order requests succeed or fail in, the
// shown task is the server-confirmed one plus the edits still pending, with
// the quadrant re-derived (it is never stored).
const edits = editsFor<Task>((t) => ({
  ...t,
  quadrant: deriveQuadrant(t.important, t.urgent),
}));

/**
 * Every task but skipped occurrences, "later" ones included (flagged by the
 * server); the screens filter and group them (quadrant, day, project…).
 */
export const tasksQuery = queryOptions({
  queryKey: ["tasks"],
  queryFn: async ({ client }) => {
    const before = edits(client).latestTicket;
    const tasks = await listTasks();
    // A full reload is the confirmed state: drop the in-flight bookkeeping,
    // unless an edit started meanwhile (its onMutate cancelled this request).
    if (edits(client).latestTicket === before) edits(client).reset();
    return tasks;
  },
});

const NO_TASKS: Task[] = [];

/**
 * The tasks shown now: no "later" occurrence of a recurring task (#105; the
 * server's flag, never a date comparison here). Module-level, so the query
 * keeps the filtered list until the data changes.
 */
const shownOnly = (tasks: Task[]): Task[] => tasks.filter((t) => !t.later);

/** The tasks shown now, or none until they've loaded (a stable empty list). */
export function useTasks(): Task[] {
  return useQuery({ ...tasksQuery, select: shownOnly }).data ?? NO_TASKS;
}

/** Every loaded task, "later" occurrences included (Clock · Week, "Later (n)", lookups by id). */
export function useAllTasks(): Task[] {
  return useQuery(tasksQuery).data ?? NO_TASKS;
}

/**
 * The tasks with their load state, for the screens that show the load error
 * and the first-load skeleton: `loading` is a fetch with nothing loaded yet, so
 * a background refresh never flashes the skeleton.
 */
export function useTasksQuery() {
  const query = useQuery({ ...tasksQuery, select: shownOnly });
  return {
    tasks: query.data ?? NO_TASKS,
    loading: query.isFetching && query.data === undefined,
    error: loadError(query, "Failed to load tasks"),
    retry: () => void query.refetch(),
  };
}

function cached(client: QueryClient): Task[] {
  return client.getQueryData(tasksQuery.queryKey) ?? [];
}

function write(client: QueryClient, update: (tasks: Task[]) => Task[]): void {
  client.setQueryData(tasksQuery.queryKey, (tasks) => update(tasks ?? []));
}

/** The tasks as shown now (for flows that act on a task they just created). */
export function currentTasks(client: QueryClient = queryClient): Task[] {
  return cached(client);
}

/** Reload the tasks (an AI intake or an import created some server-side). */
export async function reloadTasks(
  client: QueryClient = queryClient,
): Promise<void> {
  // A failure lands in the query's error state (the screens' banner), as load() did.
  await client.fetchQuery({ ...tasksQuery, staleTime: 0 }).catch(() => {});
}

/** Replace the task list outright, dropping in-flight bookkeeping (tests). */
export function replaceTasks(client: QueryClient, tasks: Task[]): void {
  edits(client).reset();
  client.setQueryData(tasksQuery.queryKey, tasks);
}

/** Previews of upcoming occurrences for one calendar range (#105 step 2; worked out by the server). */
export function previewsQuery(from: string, to: string) {
  return queryOptions({
    queryKey: ["task-previews", from, to],
    queryFn: () => listTaskPreviews(from, to),
  });
}

/** A recurring task's history: every occurrence of its series. */
export function occurrencesQuery(taskId: string) {
  return queryOptions({
    queryKey: ["task-occurrences", taskId],
    queryFn: () => listTaskOccurrences(taskId),
  });
}

/**
 * A recurring task changed on the server beyond the one task the response
 * carries (#105): completing or skipping created the next occurrence,
 * reopening may have removed it, deleting ended the series. Reload the list,
 * and let the previews and histories refetch.
 */
function seriesMoved(client: QueryClient): void {
  void reloadTasks(client);
  void client.invalidateQueries({ queryKey: ["task-previews"] });
  void client.invalidateQueries({ queryKey: ["task-occurrences"] });
}

const repeats = (task: Pick<Task, "seriesId">) => !!task.seriesId;

/** Goal/project tallies are derived server-side: reload the ones a change touched. */
function refreshTallies(
  client: QueryClient,
  goals: boolean,
  projects: boolean,
): void {
  if (goals) void refreshGoals(client);
  if (projects) void refreshProjects(client);
}

/** The toast for a new task that shows later (#105). */
export const LATER_ADDED =
  "Task added. It shows later, under “Later” in Projects.";

/** Add a task: a placeholder shows at once (last), replaced by the created task. */
export const addTask = mutationOptions({
  mutationKey: ["tasks", "add"],
  mutationFn: (body: CreateTaskBody) => createTask(body),
  onMutate: async (body, { client }) => {
    // A list request already in flight may predate this write: drop it (sent again after).
    await dropInFlight(client, tasksQuery.queryKey);
    const now = new Date().toISOString();
    const important = body.important ?? false;
    const urgent = body.urgent ?? false;
    const temp: Task = {
      id: `temp_${now}`,
      title: body.title,
      notes: body.notes ?? null,
      important,
      urgent,
      quadrant: deriveQuadrant(important, urgent),
      status: "TODO",
      proactivity: body.proactivity ?? null,
      isBigRock: false,
      plannedWeek: null,
      dueDate: body.dueDate ?? null,
      completedAt: null,
      scheduledDay: body.scheduledDay ? storedDay(body.scheduledDay) : null,
      scheduledTime: body.scheduledTime ?? null,
      goalId: body.goalId ?? null,
      projectId: body.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    write(client, (tasks) => [...tasks, temp]);
    return { tempId: temp.id };
  },
  onSuccess: (created, body, ctx, { client }) => {
    write(client, (tasks) =>
      tasks.map((t) => (t.id === ctx.tempId ? created : t)),
    );
    // A "later" occurrence is in no open list: say where it went, or it seems to vanish.
    toast.success(created.later ? LATER_ADDED : "Task added");
    refreshTallies(client, !!body.goalId, !!body.projectId);
    if (repeats(created))
      void client.invalidateQueries({ queryKey: ["task-previews"] });
  },
  onError: (err, _body, ctx, { client }) => {
    if (ctx) write(client, (tasks) => withoutId(tasks, ctx.tempId));
    toast.error(errorMessage(err));
  },
});

/** One optimistic edit: what to show at once, the request, and which tallies it moves. */
export interface TaskEdit {
  task: Task;
  optimistic: Partial<Task>;
  request: () => Promise<Task>;
  affectsGoals?: boolean;
  affectsProjects?: boolean;
  /** It changes a recurring task's series (the next occurrence, the rule): reload after. */
  affectsSeries?: boolean;
}

/**
 * Edit a task optimistically, then reconcile. Overlapping edits settle in any
 * order: a failure drops only its own patch, and an older response can't
 * overwrite a newer one. A task no longer shown is left alone (no request).
 */
export const editTask = mutationOptions({
  mutationKey: ["tasks", "edit"],
  mutationFn: async (edit: TaskEdit, { client }): Promise<Task | null> =>
    cached(client).some((t) => t.id === edit.task.id) ? edit.request() : null,
  onMutate: async (edit, { client }) => {
    // A list request already in flight may predate this write: drop it (sent again after).
    await dropInFlight(client, tasksQuery.queryKey);
    const current = cached(client).find((t) => t.id === edit.task.id);
    if (!current) return undefined;
    const { item, ticket } = edits(client).apply(current, edit.optimistic);
    write(client, (tasks) => replaceById(tasks, item));
    return { ticket };
  },
  onSuccess: (updated, edit, ctx, { client }) => {
    if (!ctx || !updated) return;
    write(client, (tasks) =>
      replaceById(
        tasks,
        edits(client).succeed(edit.task.id, ctx.ticket, updated),
      ),
    );
    refreshTallies(client, !!edit.affectsGoals, !!edit.affectsProjects);
    // Any edit of an occurrence can move its previews (its day, time, title).
    if (edit.affectsSeries) seriesMoved(client);
    else if (repeats(updated))
      void client.invalidateQueries({ queryKey: ["task-previews"] });
  },
  onError: (err, edit, ctx, { client }) => {
    // Drop only this call's patch; edits still in flight or confirmed stay.
    const shown = ctx
      ? edits(client).fail(edit.task.id, ctx.ticket)
      : undefined;
    if (shown) write(client, (tasks) => replaceById(tasks, shown));
    toast.error(errorMessage(err));
  },
});

/** The edits a task supports, as variables for editTask. */
export const taskEdits = {
  /** Move a task between quadrants by toggling importance/urgency. */
  setFlags(
    task: Task,
    flags: { important?: boolean; urgent?: boolean },
  ): TaskEdit {
    const important = flags.important ?? task.important;
    const urgent = flags.urgent ?? task.urgent;
    return {
      task,
      optimistic: { ...flags, quadrant: deriveQuadrant(important, urgent) },
      request: () => updateTask(task.id, flags),
    };
  },
  toggleComplete(task: Task): TaskEdit {
    const toDone = task.status !== "DONE";
    return {
      task,
      optimistic: {
        status: toDone ? "DONE" : "TODO",
        completedAt: toDone ? new Date().toISOString() : null,
      },
      request: () => (toDone ? completeTask(task.id) : reopenTask(task.id)),
      affectsGoals: true,
      affectsProjects: !!task.projectId,
      affectsSeries: repeats(task),
    };
  },
  toggleBigRock(task: Task): TaskEdit {
    const next = !task.isBigRock;
    // The week it was pinned in, as a plain Monday (#112).
    const plannedWeek = next ? isoWeekMondayPlain() : null;
    return {
      task,
      optimistic: { isBigRock: next, plannedWeek },
      request: () => updateTask(task.id, { isBigRock: next, plannedWeek }),
    };
  },
  /** Habit 1: tag a task influence (actionable) vs concern, or clear it. */
  setProactivity(task: Task, value: Task["proactivity"]): TaskEdit {
    return {
      task,
      optimistic: { proactivity: value },
      request: () => updateTask(task.id, { proactivity: value }),
    };
  },
  /** Link a task to a goal (Habit 2), or unlink with null. */
  setGoal(task: Task, goalId: string | null): TaskEdit {
    return {
      task,
      optimistic: { goalId },
      request: () => updateTask(task.id, { goalId }),
      affectsGoals: true,
    };
  },
  /** Move a task into a project, or back to the Inbox with null. */
  setProject(task: Task, projectId: string | null): TaskEdit {
    // Both the old and new project's tallies shift, so always refresh.
    return {
      task,
      optimistic: { projectId },
      request: () => updateTask(task.id, { projectId }),
      affectsProjects: true,
    };
  },
  /**
   * The Clock lens: place a task on a day, `YYYY-MM-DD` (null unschedules and
   * clears the time). Sent as the plain date; shown at once in the form the
   * server answers (#136).
   */
  setScheduledDay(task: Task, scheduledDay: string | null): TaskEdit {
    const body = scheduledDay
      ? { scheduledDay }
      : { scheduledDay: null, scheduledTime: null };
    const optimistic = scheduledDay ? { scheduledDay: storedDay(scheduledDay) } : body;
    return { task, optimistic, request: () => updateTask(task.id, body) };
  },
  /** Set or clear the optional time within the scheduled day. */
  setScheduledTime(task: Task, scheduledTime: string | null): TaskEdit {
    return {
      task,
      optimistic: { scheduledTime },
      request: () => updateTask(task.id, { scheduledTime }),
    };
  },
  /** Full edit from the task form sheet. */
  update(task: Task, body: UpdateTaskBody): TaskEdit {
    const important = body.important ?? task.important;
    const urgent = body.urgent ?? task.urgent;
    // The form can move a task between projects (or in/out of one), so refresh
    // when either the current or the target project is involved.
    const affectsProjects =
      !!task.projectId || ("projectId" in body && !!body.projectId);
    return {
      task,
      optimistic: {
        ...body,
        quadrant: deriveQuadrant(important, urgent),
      } as Partial<Task>,
      request: () => updateTask(task.id, body),
      affectsGoals: true,
      affectsProjects,
      affectsSeries: repeats(task) || "recurrence" in body,
    };
  },
};

/** Delete a task; a failure puts it back in place. */
export const removeTask = mutationOptions({
  mutationKey: ["tasks", "remove"],
  mutationFn: (task: Task) => deleteTask(task.id),
  onMutate: async (task, { client }) => {
    // A list request already in flight may predate this write: drop it (sent again after).
    await dropInFlight(client, tasksQuery.queryKey);
    const tasks = cached(client);
    const index = tasks.findIndex((t) => t.id === task.id);
    const removed = tasks[index] ?? task;
    write(client, (list) => withoutId(list, task.id));
    // With an edit in flight, `removed` carries a patch that may yet fail.
    return { removed, index, edited: edits(client).inFlight(task.id) };
  },
  onSuccess: (_data, task, _ctx, { client }) => {
    toast.success("Task deleted");
    refreshTallies(client, !!task.goalId, !!task.projectId);
    if (repeats(task)) seriesMoved(client);
  },
  onError: (err, task, ctx, { client }) => {
    if (ctx) {
      const back =
        (ctx.edited ? edits(client).shown(task.id) : undefined) ?? ctx.removed;
      write(client, (tasks) => restoreAt(tasks, back, ctx.index));
    }
    toast.error(errorMessage(err));
  },
});

/**
 * Skip the open occurrence of a repeating task (#105): it leaves the list at
 * once; the server archives it and creates the next one, which the reload
 * brings in. A failure puts it back.
 */
export const skipOccurrence = mutationOptions({
  mutationKey: ["tasks", "skip"],
  mutationFn: (task: Task) => skipTask(task.id),
  onMutate: async (task, { client }) => {
    await dropInFlight(client, tasksQuery.queryKey);
    const tasks = cached(client);
    const index = tasks.findIndex((t) => t.id === task.id);
    write(client, (list) => withoutId(list, task.id));
    return { removed: tasks[index] ?? task, index };
  },
  onSuccess: (_data, task, _ctx, { client }) => {
    toast.success("Skipped: the next one is on the calendar");
    refreshTallies(client, !!task.goalId, !!task.projectId);
    seriesMoved(client);
  },
  onError: (err, _task, ctx, { client }) => {
    if (ctx) write(client, (tasks) => restoreAt(tasks, ctx.removed, ctx.index));
    toast.error(errorMessage(err));
  },
});

/**
 * Run a mutation on the app's query client, with its own observer, the way
 * useMutation would. Task cards are many and memoised, so they call these
 * plain functions rather than each mounting mutation hooks; the side effects
 * live in the mutation options, so they run even after a screen unmounts.
 * Resolves when the write settles; a failure has already rolled back and
 * shown its toast, so it never rejects (as the store's methods didn't).
 */
function run<TData, TVars, TCtx>(
  options: MutationOptions<TData, Error, TVars, TCtx>,
  vars: TVars,
): Promise<void> {
  return new MutationObserver(queryClient, options).mutate(vars).then(
    () => {},
    () => {},
  );
}

/** The task writes, named as the store's methods were. */
export const taskWrites = {
  add: (body: CreateTaskBody) => run(addTask, body),
  remove: (task: Task) => run(removeTask, task),
  skip: (task: Task) => run(skipOccurrence, task),
  setFlags: (task: Task, flags: { important?: boolean; urgent?: boolean }) =>
    run(editTask, taskEdits.setFlags(task, flags)),
  toggleComplete: (task: Task) => run(editTask, taskEdits.toggleComplete(task)),
  toggleBigRock: (task: Task) => run(editTask, taskEdits.toggleBigRock(task)),
  setProactivity: (task: Task, value: Task["proactivity"]) =>
    run(editTask, taskEdits.setProactivity(task, value)),
  setGoal: (task: Task, goalId: string | null) =>
    run(editTask, taskEdits.setGoal(task, goalId)),
  setProject: (task: Task, projectId: string | null) =>
    run(editTask, taskEdits.setProject(task, projectId)),
  setScheduledDay: (task: Task, day: string | null) =>
    run(editTask, taskEdits.setScheduledDay(task, day)),
  setScheduledTime: (task: Task, time: string | null) =>
    run(editTask, taskEdits.setScheduledTime(task, time)),
  update: (task: Task, body: UpdateTaskBody) =>
    run(editTask, taskEdits.update(task, body)),
};
