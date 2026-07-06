import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  updateTask,
  type CreateTaskBody,
  type Quadrant,
  type Task,
  type UpdateTaskBody,
} from "@/lib/api";
import { startOfIsoWeekIso } from "@/lib/week";
import { toast } from "@/lib/components/ui/toast";
import { goalsStore } from "./goals.svelte";
import { projectsStore } from "./projects.svelte";

function deriveQuadrant(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return "Q1";
  if (important) return "Q2";
  if (urgent) return "Q3";
  return "Q4";
}

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Reactive task store with optimistic updates: local state changes immediately,
 * the API call follows, and a failure rolls back and surfaces a toast.
 */
class TasksStore {
  tasks = $state<Task[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tasks = await listTasks();
    } catch (err) {
      this.error = message(err, "Failed to load tasks");
    } finally {
      this.loading = false;
    }
  }

  private patchLocal(id: string, partial: Partial<Task>): void {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, ...partial } : t));
  }

  /** Optimistically patch one task, run the request, reconcile or roll back. */
  private async edit(
    id: string,
    optimistic: Partial<Task>,
    request: () => Promise<Task>,
    opts: { affectsGoals?: boolean; affectsProjects?: boolean } = {},
  ): Promise<void> {
    const prev = this.tasks;
    this.patchLocal(id, optimistic);
    try {
      const updated = await request();
      this.tasks = this.tasks.map((t) => (t.id === updated.id ? updated : t));
      // Goal/project progress counts are derived server-side, so a change to a
      // task's membership or completion means their tallies need a reload.
      if (opts.affectsGoals) goalsStore.refresh();
      if (opts.affectsProjects) projectsStore.refresh();
    } catch (err) {
      this.tasks = prev;
      toast.error(message(err));
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
    const prev = this.tasks;
    this.tasks = [...prev, temp];
    try {
      const created = await createTask(body);
      this.tasks = this.tasks.map((t) => (t.id === temp.id ? created : t));
      toast.success("Task added");
      if (body.goalId) goalsStore.refresh();
      if (body.projectId) projectsStore.refresh();
    } catch (err) {
      this.tasks = prev;
      toast.error(message(err));
    }
  }

  /** Move a task between quadrants by toggling importance/urgency. */
  setFlags(task: Task, flags: { important?: boolean; urgent?: boolean }): Promise<void> {
    const important = flags.important ?? task.important;
    const urgent = flags.urgent ?? task.urgent;
    return this.edit(
      task.id,
      { ...flags, quadrant: deriveQuadrant(important, urgent) },
      () => updateTask(task.id, flags),
    );
  }

  toggleComplete(task: Task): Promise<void> {
    const toDone = task.status !== "DONE";
    return this.edit(
      task.id,
      { status: toDone ? "DONE" : "TODO", completedAt: toDone ? new Date().toISOString() : null },
      () => (toDone ? completeTask(task.id) : reopenTask(task.id)),
      { affectsGoals: true, affectsProjects: !!task.projectId },
    );
  }

  toggleBigRock(task: Task): Promise<void> {
    const next = !task.isBigRock;
    const plannedWeek = next ? startOfIsoWeekIso() : null;
    return this.edit(
      task.id,
      { isBigRock: next, plannedWeek },
      () => updateTask(task.id, { isBigRock: next, plannedWeek }),
    );
  }

  /** Habit 1: tag a task influence (actionable) vs concern, or clear it. */
  setProactivity(task: Task, value: Task["proactivity"]): Promise<void> {
    return this.edit(task.id, { proactivity: value }, () =>
      updateTask(task.id, { proactivity: value }),
    );
  }

  /** Link a task to a goal (Habit 2), or unlink with null. */
  setGoal(task: Task, goalId: string | null): Promise<void> {
    return this.edit(task.id, { goalId }, () => updateTask(task.id, { goalId }), {
      affectsGoals: true,
    });
  }

  /** Move a task into a project, or back to the Inbox with null. */
  setProject(task: Task, projectId: string | null): Promise<void> {
    // Both the old and new project's tallies shift, so always refresh.
    return this.edit(task.id, { projectId }, () => updateTask(task.id, { projectId }), {
      affectsProjects: true,
    });
  }

  /** The Clock lens: place a task on a day (null unschedules and clears the time). */
  setScheduledDay(task: Task, scheduledDay: string | null): Promise<void> {
    const body = scheduledDay
      ? { scheduledDay }
      : { scheduledDay: null, scheduledTime: null };
    return this.edit(task.id, body, () => updateTask(task.id, body));
  }

  /** Set or clear the optional time within the scheduled day. */
  setScheduledTime(task: Task, scheduledTime: string | null): Promise<void> {
    return this.edit(task.id, { scheduledTime }, () =>
      updateTask(task.id, { scheduledTime }),
    );
  }

  /** Full edit from the task form sheet. */
  update(task: Task, body: UpdateTaskBody): Promise<void> {
    const important = body.important ?? task.important;
    const urgent = body.urgent ?? task.urgent;
    // The form can move a task between projects (or in/out of one), so refresh
    // when either the current or the target project is involved.
    const affectsProjects =
      !!task.projectId || ("projectId" in body && !!body.projectId);
    return this.edit(
      task.id,
      { ...body, quadrant: deriveQuadrant(important, urgent) } as Partial<Task>,
      () => updateTask(task.id, body),
      { affectsGoals: true, affectsProjects },
    );
  }

  async remove(task: Task): Promise<void> {
    const prev = this.tasks;
    this.tasks = prev.filter((t) => t.id !== task.id);
    try {
      await deleteTask(task.id);
      toast.success("Task deleted");
      if (task.goalId) goalsStore.refresh();
      if (task.projectId) projectsStore.refresh();
    } catch (err) {
      this.tasks = prev;
      toast.error(message(err));
    }
  }
}

export const QUADRANT_META: Record<
  Quadrant,
  { title: string; hint: string; dot: string }
> = {
  Q1: { title: "Urgent & Important", hint: "Do now", dot: "bg-[var(--q1)]" },
  Q2: {
    title: "Important, Not Urgent",
    hint: "Big rocks — plan first",
    dot: "bg-[var(--q2)]",
  },
  Q3: {
    title: "Urgent, Not Important",
    hint: "Delegate / minimize",
    dot: "bg-[var(--q3)]",
  },
  Q4: {
    title: "Not Urgent, Not Important",
    hint: "Eliminate",
    dot: "bg-[var(--q4)]",
  },
};

export const tasksStore = new TasksStore();
