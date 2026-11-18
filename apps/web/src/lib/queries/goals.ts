import { mutationOptions, queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
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
import { replaceById, restoreAt, withoutId } from "@clock-compass/web-client/rollback";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";

export { GOAL_STATUS_LABELS } from "@clock-compass/web-client/meta";

const edits = editsFor<Goal>();
const KEY = ["goals"] as const;

/** Goals (Habit 2), with their progress (derived server-side). */
export const goalsQuery = queryOptions({
  queryKey: KEY,
  queryFn: async ({ client }) => {
    const goals = await listGoals();
    // A full reload is the confirmed state: drop the in-flight bookkeeping.
    edits(client).reset();
    return goals;
  },
});

const NO_GOALS: Goal[] = [];

/** The goals, or none until they've loaded (a stable empty list). */
export function useGoals(): Goal[] {
  return useQuery(goalsQuery).data ?? NO_GOALS;
}

function cached(client: QueryClient): Goal[] {
  return client.getQueryData(goalsQuery.queryKey) ?? [];
}

function write(client: QueryClient, update: (goals: Goal[]) => Goal[]): void {
  client.setQueryData(goalsQuery.queryKey, (goals) => update(goals ?? []));
}

/**
 * Silent reload, used when something else shifted progress (a task completed
 * or relinked, a role deleted). A failure keeps what's shown, with no error:
 * a later interaction will surface it.
 */
export async function refreshGoals(client: QueryClient): Promise<void> {
  try {
    const goals = await listGoals();
    edits(client).reset();
    client.setQueryData(goalsQuery.queryKey, goals);
  } catch {
    /* keep current state */
  }
}

/** Add a goal: a placeholder shows at once (first), replaced by the created goal. */
export const addGoal = mutationOptions({
  mutationKey: [...KEY, "add"],
  mutationFn: (body: CreateGoalBody) => createGoal(body),
  onMutate: (body, { client }) => {
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
    write(client, (goals) => [temp, ...goals]);
    return { tempId: temp.id };
  },
  onSuccess: (created, _body, ctx, { client }) => {
    write(client, (goals) => goals.map((g) => (g.id === ctx.tempId ? created : g)));
    toast.success("Goal added");
  },
  onError: (err, _body, ctx, { client }) => {
    if (ctx) write(client, (goals) => withoutId(goals, ctx.tempId));
    toast.error(errorMessage(err));
  },
});

/**
 * Edit a goal (any fields, or just its status). Overlapping edits settle in
 * any order: a failure drops only its own patch.
 */
export const editGoal = mutationOptions({
  mutationKey: [...KEY, "update"],
  mutationFn: ({ goal, body }: { goal: Goal; body: UpdateGoalBody }) => updateGoal(goal.id, body),
  onMutate: ({ goal, body }, { client }) => {
    const current = cached(client).find((g) => g.id === goal.id);
    if (!current) return undefined;
    const { item, ticket } = edits(client).apply(current, body as Partial<Goal>);
    write(client, (goals) => replaceById(goals, item));
    return { ticket };
  },
  onSuccess: (updated, { goal }, ctx, { client }) => {
    if (!ctx) return;
    const shown = edits(client).succeed(goal.id, ctx.ticket, updated);
    write(client, (goals) => replaceById(goals, shown));
  },
  onError: (err, { goal }, ctx, { client }) => {
    const shown = ctx ? edits(client).fail(goal.id, ctx.ticket) : undefined;
    if (shown) write(client, (goals) => replaceById(goals, shown));
    toast.error(errorMessage(err));
  },
});

/** The variables for a status change through editGoal. */
export const statusEdit = (goal: Goal, status: GoalStatus) => ({ goal, body: { status } });

/** Delete a goal; a failure puts it back in place. */
export const removeGoal = mutationOptions({
  mutationKey: [...KEY, "remove"],
  mutationFn: (goal: Goal) => deleteGoal(goal.id),
  onMutate: (goal, { client }) => {
    const goals = cached(client);
    const index = goals.findIndex((g) => g.id === goal.id);
    const removed = goals[index] ?? goal;
    write(client, (list) => withoutId(list, goal.id));
    // With an edit in flight, `removed` carries a patch that may yet fail.
    return { removed, index, edited: edits(client).inFlight(goal.id) };
  },
  onSuccess: () => toast.success("Goal deleted"),
  onError: (err, goal, ctx, { client }) => {
    if (ctx) {
      const back = (ctx.edited ? edits(client).shown(goal.id) : undefined) ?? ctx.removed;
      write(client, (goals) => restoreAt(goals, back, ctx.index));
    }
    toast.error(errorMessage(err));
  },
});

/** Whether `ids` all name cached goals (else the reorder is stale). */
function known(client: QueryClient, ids: string[]): boolean {
  const goals = cached(client);
  return ids.every((id) => goals.some((g) => g.id === id));
}

/** Whether the cached goals named in `ids` are in that order. */
function inOrder(client: QueryClient, ids: string[]): boolean {
  const idSet = new Set(ids);
  const group = cached(client).filter((g) => idSet.has(g.id));
  return group.length === ids.length && group.every((g, i) => g.id === ids[i]);
}

/**
 * Persist a new order for one role group. `ids` are that group's goals in the
 * desired order; their slots in the flat list are refilled in sequence so
 * other groups keep their positions.
 */
export const reorderGoal = mutationOptions({
  mutationKey: [...KEY, "reorder"],
  mutationFn: async (ids: string[], { client }) => {
    // onMutate shows the new order unless `ids` is stale; send nothing then.
    if (!inOrder(client, ids)) return;
    await reorderGoals(ids);
  },
  onMutate: (ids, { client }) => {
    if (!known(client, ids)) return; // stale ids
    const prev = cached(client);
    const idSet = new Set(ids);
    const ordered = ids.map((id) => prev.find((g) => g.id === id)!);
    let k = 0;
    write(client, () =>
      prev.map((g) => {
        if (!idSet.has(g.id)) return g;
        const index = k++;
        return { ...ordered[index]!, order: index };
      }),
    );
  },
  onError: async (err, _ids, _ctx, { client }) => {
    // A reorder rewrites the whole group, so reload the server's order
    // rather than restoring a snapshot that could drop other edits.
    toast.error(errorMessage(err));
    await refreshGoals(client);
  },
});
