import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  updateTask,
  type CreateTaskBody,
  type Task,
  type UpdateTaskBody,
} from "@clock-compass/web-client/api";
import { deriveQuadrant, errorMessage } from "@clock-compass/web-client/meta";
import {
  OptimisticEdits,
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";
import { startOfIsoWeekIso } from "@clock-compass/web-client/week";
import { Store } from "./store";
import { toast } from "./toast";
import { goalsStore } from "./goals";
import { projectsStore } from "./projects";

export { QUADRANT_META } from "@clock-compass/web-client/meta";

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
}

/**
 * Tasks with optimistic updates: local state changes immediately, the API call
 * follows, and a failure rolls back and surfaces a toast. Changes that affect
 * goal or project progress refresh those stores.
 */
export class TasksStore extends Store<TasksState> {
  // In-flight edits per task: whatever order requests succeed or fail in, the
  // shown task is the server-confirmed one plus the edits still pending, with
  // the quadrant re-derived (it is never stored).
  readonly #edits = new OptimisticEdits<Task>((t) => ({
    ...t,
    quadrant: deriveQuadrant(t.important, t.urgent),
  }));

  constructor() {
    super({ tasks: [], loading: false, error: null });
  }

  /** Replace the task list outright (tests and the capture flow's reload). */
  setTasks(tasks: Task[]): void {
    this.#edits.reset();
    this.setState({ tasks });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const tasks = await listTasks();
      this.#edits.reset();
      this.setState({ tasks });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load tasks") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Optimistically patch one task, run the request, reconcile or roll back. */
  async #edit(
    id: string,
    optimistic: Partial<Task>,
    request: () => Promise<Task>,
    opts: { affectsGoals?: boolean; affectsProjects?: boolean } = {},
  ): Promise<void> {
    const current = this.state.tasks.find((t) => t.id === id);
    if (!current) return;
    const { item, ticket } = this.#edits.apply(current, optimistic);
    this.setState({ tasks: replaceById(this.state.tasks, item) });
    try {
      const updated = await request();
      this.setState({ tasks: replaceById(this.state.tasks, this.#edits.succeed(id, ticket, updated)) });
      // Goal/project progress counts are derived server-side, so a change to a
      // task's membership or completion means their tallies need a reload.
      if (opts.affectsGoals) void goalsStore.refresh();
      if (opts.affectsProjects) void projectsStore.refresh();
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.#edits.fail(id, ticket);
      if (shown) this.setState({ tasks: replaceById(this.state.tasks, shown) });
      toast.error(errorMessage(err));
    }
  }


  async add(body: CreateTaskBody): Promise<void> {
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
      scheduledDay: body.scheduledDay ?? null,
      scheduledTime: body.scheduledTime ?? null,
      goalId: body.goalId ?? null,
      projectId: body.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.setState({ tasks: [...this.state.tasks, temp] });
    try {
      const created = await createTask(body);
      this.setState({ tasks: this.state.tasks.map((t) => (t.id === temp.id ? created : t)) });
      toast.success("Task added");
      if (body.goalId) void goalsStore.refresh();
      if (body.projectId) void projectsStore.refresh();
    } catch (err) {
      this.setState({ tasks: withoutId(this.state.tasks, temp.id) });
      toast.error(errorMessage(err));
    }
  }

  /** Move a task between quadrants by toggling importance/urgency. */
  setFlags(task: Task, flags: { important?: boolean; urgent?: boolean }): Promise<void> {
    const important = flags.important ?? task.important;
    const urgent = flags.urgent ?? task.urgent;
    return this.#edit(task.id, { ...flags, quadrant: deriveQuadrant(important, urgent) }, () =>
      updateTask(task.id, flags),
    );
  }

  toggleComplete(task: Task): Promise<void> {
    const toDone = task.status !== "DONE";
    return this.#edit(
      task.id,
      { status: toDone ? "DONE" : "TODO", completedAt: toDone ? new Date().toISOString() : null },
      () => (toDone ? completeTask(task.id) : reopenTask(task.id)),
      { affectsGoals: true, affectsProjects: !!task.projectId },
    );
  }

  toggleBigRock(task: Task): Promise<void> {
    const next = !task.isBigRock;
    const plannedWeek = next ? startOfIsoWeekIso() : null;
    return this.#edit(task.id, { isBigRock: next, plannedWeek }, () =>
      updateTask(task.id, { isBigRock: next, plannedWeek }),
    );
  }

  /** Habit 1: tag a task influence (actionable) vs concern, or clear it. */
  setProactivity(task: Task, value: Task["proactivity"]): Promise<void> {
    return this.#edit(task.id, { proactivity: value }, () =>
      updateTask(task.id, { proactivity: value }),
    );
  }

  /** Link a task to a goal (Habit 2), or unlink with null. */
  setGoal(task: Task, goalId: string | null): Promise<void> {
    return this.#edit(task.id, { goalId }, () => updateTask(task.id, { goalId }), {
      affectsGoals: true,
    });
  }

  /** Move a task into a project, or back to the Inbox with null. */
  setProject(task: Task, projectId: string | null): Promise<void> {
    // Both the old and new project's tallies shift, so always refresh.
    return this.#edit(task.id, { projectId }, () => updateTask(task.id, { projectId }), {
      affectsProjects: true,
    });
  }

  /** The Clock lens: place a task on a day (null unschedules and clears the time). */
  setScheduledDay(task: Task, scheduledDay: string | null): Promise<void> {
    const body = scheduledDay ? { scheduledDay } : { scheduledDay: null, scheduledTime: null };
    return this.#edit(task.id, body, () => updateTask(task.id, body));
  }

  /** Set or clear the optional time within the scheduled day. */
  setScheduledTime(task: Task, scheduledTime: string | null): Promise<void> {
    return this.#edit(task.id, { scheduledTime }, () => updateTask(task.id, { scheduledTime }));
  }

  /** Full edit from the task form sheet. */
  update(task: Task, body: UpdateTaskBody): Promise<void> {
    const important = body.important ?? task.important;
    const urgent = body.urgent ?? task.urgent;
    // The form can move a task between projects (or in/out of one), so refresh
    // when either the current or the target project is involved.
    const affectsProjects = !!task.projectId || ("projectId" in body && !!body.projectId);
    return this.#edit(
      task.id,
      { ...body, quadrant: deriveQuadrant(important, urgent) } as Partial<Task>,
      () => updateTask(task.id, body),
      { affectsGoals: true, affectsProjects },
    );
  }

  async remove(task: Task): Promise<void> {
    const index = this.state.tasks.findIndex((t) => t.id === task.id);
    const removed = this.state.tasks[index] ?? task;
    // With an edit in flight, `removed` carries a patch that may yet fail.
    const edited = this.#edits.inFlight(task.id);
    this.setState({ tasks: withoutId(this.state.tasks, task.id) });
    try {
      await deleteTask(task.id);
      toast.success("Task deleted");
      if (task.goalId) void goalsStore.refresh();
      if (task.projectId) void projectsStore.refresh();
    } catch (err) {
      const back = (edited ? this.#edits.shown(task.id) : undefined) ?? removed;
      this.setState({ tasks: restoreAt(this.state.tasks, back, index) });
      toast.error(errorMessage(err));
    }
  }
}

export const tasksStore = new TasksStore();
