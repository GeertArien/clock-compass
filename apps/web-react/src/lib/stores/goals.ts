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
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import {
  OptimisticEdits,
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";
import { Store } from "./store";
import { toast } from "./toast";

export { GOAL_STATUS_LABELS } from "@clock-compass/web-client/meta";

interface GoalsState {
  goals: Goal[];
  loading: boolean;
  error: string | null;
}

/** Goals (Habit 2) with optimistic updates + toast feedback. Mirrors goals.svelte.ts. */
export class GoalsStore extends Store<GoalsState> {
  // In-flight edits per item: whatever order requests succeed or fail in, the
  // shown item is the server-confirmed one plus the edits still pending.
  readonly #edits = new OptimisticEdits<Goal>();

  constructor() {
    super({ goals: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const goals = await listGoals();
      this.#edits.reset();
      this.setState({ goals });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load goals") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Silent reload (no loading flicker) — used when task changes shift progress. */
  async refresh(): Promise<void> {
    try {
      const goals = await listGoals();
      this.#edits.reset();
      this.setState({ goals });
    } catch {
      /* keep current state; a later interaction will surface errors */
    }
  }

  byId(id: string | null): Goal | undefined {
    return id ? this.state.goals.find((g) => g.id === id) : undefined;
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
    this.setState({ goals: [temp, ...this.state.goals] });
    try {
      const created = await createGoal(body);
      this.setState({ goals: this.state.goals.map((g) => (g.id === temp.id ? created : g)) });
      toast.success("Goal added");
    } catch (err) {
      this.setState({ goals: withoutId(this.state.goals, temp.id) });
      toast.error(errorMessage(err));
    }
  }

  async #edit(id: string, optimistic: Partial<Goal>, body: UpdateGoalBody): Promise<void> {
    const current = this.state.goals.find((x) => x.id === id);
    if (!current) return;
    const { item, ticket } = this.#edits.apply(current, optimistic);
    this.setState({ goals: replaceById(this.state.goals, item) });
    try {
      const updated = await updateGoal(id, body);
      this.setState({ goals: replaceById(this.state.goals, this.#edits.succeed(id, ticket, updated)) });
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.#edits.fail(id, ticket);
      if (shown) this.setState({ goals: replaceById(this.state.goals, shown) });
      toast.error(errorMessage(err));
    }
  }

  update(goal: Goal, body: UpdateGoalBody): Promise<void> {
    return this.#edit(goal.id, body as Partial<Goal>, body);
  }

  setStatus(goal: Goal, status: GoalStatus): Promise<void> {
    return this.#edit(goal.id, { status }, { status });
  }

  async remove(goal: Goal): Promise<void> {
    const index = this.state.goals.findIndex((g) => g.id === goal.id);
    const removed = this.state.goals[index] ?? goal;
    this.setState({ goals: withoutId(this.state.goals, goal.id) });
    try {
      await deleteGoal(goal.id);
      toast.success("Goal deleted");
    } catch (err) {
      this.setState({ goals: restoreAt(this.state.goals, removed, index) });
      toast.error(errorMessage(err));
    }
  }

  /**
   * Persist a new order for one role group. `ids` are that group's goals in the
   * desired order; their slots in the flat list are refilled in sequence so
   * other groups keep their positions.
   */
  async reorder(ids: string[]): Promise<void> {
    const prev = this.state.goals;
    const idSet = new Set(ids);
    const ordered = ids
      .map((id) => prev.find((g) => g.id === id))
      .filter((g): g is Goal => g !== undefined);
    if (ordered.length !== ids.length) return; // stale ids — skip
    let k = 0;
    this.setState({
      goals: prev.map((g) => {
        if (!idSet.has(g.id)) return g;
        const index = k++;
        return { ...ordered[index]!, order: index };
      }),
    });
    try {
      await reorderGoals(ids);
    } catch (err) {
      // A reorder rewrites the whole group, so reload the server's order
      // rather than restoring a snapshot that could drop other edits.
      toast.error(errorMessage(err));
      await this.refresh();
    }
  }
}

export const goalsStore = new GoalsStore();
