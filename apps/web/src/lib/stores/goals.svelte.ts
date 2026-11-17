import {
  createGoal,
  deleteGoal,
  listGoals,
  reorderGoals,
  updateGoal,
  type CreateGoalBody,
  type Goal,
  type GoalStatus,
  type UpdateGoalBody,
} from "@/lib/api";
import { toast } from "@/lib/components/ui/toast";
import {
  OptimisticEdits,
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

/** Reactive goals store (Habit 2) with optimistic updates + toast feedback. */
class GoalsStore {
  goals = $state<Goal[]>([]);
  // In-flight edits per item: whatever order requests succeed or fail in, the
  // shown item is the server-confirmed one plus the edits still pending.
  private readonly edits = new OptimisticEdits<Goal>();
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const goals = await listGoals();
      this.edits.reset();
      this.goals = goals;
    } catch (err) {
      this.error = message(err, "Failed to load goals");
    } finally {
      this.loading = false;
    }
  }

  /** Silent reload (no loading flicker) — used when task changes shift progress. */
  async refresh(): Promise<void> {
    try {
      const goals = await listGoals();
      this.edits.reset();
      this.goals = goals;
    } catch {
      /* keep current state; a later interaction will surface errors */
    }
  }

  async add(body: CreateGoalBody): Promise<void> {
    const now = new Date().toISOString();
    const temp: Goal = {
      id: `temp_${now}`,
      title: body.title,
      description: body.description ?? null,
      targetDate: body.targetDate ?? null,
      status: body.status ?? "ACTIVE",
      order: 0,
      roleId: body.roleId ?? null,
      dimension: null,
      progress: { total: 0, done: 0, ratio: 0 },
      createdAt: now,
      updatedAt: now,
    };
    this.goals = [temp, ...this.goals];
    try {
      const created = await createGoal(body);
      this.goals = this.goals.map((g) => (g.id === temp.id ? created : g));
      toast.success("Goal added");
    } catch (err) {
      this.goals = withoutId(this.goals, temp.id);
      toast.error(message(err));
    }
  }

  private async edit(
    id: string,
    optimistic: Partial<Goal>,
    body: UpdateGoalBody,
  ): Promise<void> {
    const current = this.goals.find((x) => x.id === id);
    if (!current) return;
    const { item, ticket } = this.edits.apply(current, optimistic);
    this.goals = replaceById(this.goals, item);
    try {
      const updated = await updateGoal(id, body);
      this.goals = replaceById(this.goals, this.edits.succeed(id, ticket, updated));
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.edits.fail(id, ticket);
      if (shown) this.goals = replaceById(this.goals, shown);
      toast.error(message(err));
    }
  }

  update(goal: Goal, body: UpdateGoalBody): Promise<void> {
    return this.edit(goal.id, body as Partial<Goal>, body);
  }

  setStatus(goal: Goal, status: GoalStatus): Promise<void> {
    return this.edit(goal.id, { status }, { status });
  }

  async remove(goal: Goal): Promise<void> {
    const index = this.goals.findIndex((g) => g.id === goal.id);
    const removed = this.goals[index] ?? goal;
    this.goals = withoutId(this.goals, goal.id);
    try {
      await deleteGoal(goal.id);
      toast.success("Goal deleted");
    } catch (err) {
      this.goals = restoreAt(this.goals, removed, index);
      toast.error(message(err));
    }
  }

  /**
   * Persist a new order for one role group. `ids` are that group's goals in the
   * desired order; their slots in the flat list are refilled in sequence so
   * other groups keep their positions.
   */
  async reorder(ids: string[]): Promise<void> {
    const prev = this.goals;
    const idSet = new Set(ids);
    const ordered = ids
      .map((id) => prev.find((g) => g.id === id))
      .filter((g): g is Goal => g !== undefined);
    if (ordered.length !== ids.length) return; // stale ids — skip
    let k = 0;
    this.goals = prev.map((g) => {
      if (!idSet.has(g.id)) return g;
      const index = k++;
      return { ...ordered[index]!, order: index };
    });
    try {
      await reorderGoals(ids);
    } catch (err) {
      // A reorder rewrites the whole group, so reload the server's order
      // rather than restoring a snapshot that could drop other edits.
      toast.error(message(err));
      await this.refresh();
    }
  }
}

// Shared with the React app (issue #64): one definition in @clock-compass/web-client.
export { GOAL_STATUS_LABELS } from "@clock-compass/web-client/meta";

export const goalsStore = new GoalsStore();
