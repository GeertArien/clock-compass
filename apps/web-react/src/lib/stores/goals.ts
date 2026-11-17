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
  constructor() {
    super({ goals: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      this.setState({ goals: await listGoals() });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load goals") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Silent reload (no loading flicker) — used when task changes shift progress. */
  async refresh(): Promise<void> {
    try {
      this.setState({ goals: await listGoals() });
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
    const prev = this.state.goals;
    this.setState({ goals: [temp, ...prev] });
    try {
      const created = await createGoal(body);
      this.setState({ goals: this.state.goals.map((g) => (g.id === temp.id ? created : g)) });
      toast.success("Goal added");
    } catch (err) {
      this.setState({ goals: prev });
      toast.error(errorMessage(err));
    }
  }

  async #edit(id: string, optimistic: Partial<Goal>, body: UpdateGoalBody): Promise<void> {
    const prev = this.state.goals;
    this.setState({ goals: prev.map((g) => (g.id === id ? { ...g, ...optimistic } : g)) });
    try {
      const updated = await updateGoal(id, body);
      this.setState({ goals: this.state.goals.map((g) => (g.id === updated.id ? updated : g)) });
    } catch (err) {
      this.setState({ goals: prev });
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
    const prev = this.state.goals;
    this.setState({ goals: prev.filter((g) => g.id !== goal.id) });
    try {
      await deleteGoal(goal.id);
      toast.success("Goal deleted");
    } catch (err) {
      this.setState({ goals: prev });
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
      this.setState({ goals: prev });
      toast.error(errorMessage(err));
    }
  }
}

export const goalsStore = new GoalsStore();
