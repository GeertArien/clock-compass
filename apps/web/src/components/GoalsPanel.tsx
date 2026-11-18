import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Repeat, Target, Trash2 } from "lucide-react";
import type { Goal, GoalStatus, HabitView, Role } from "@clock-compass/web-client/api";
import { momentumFor } from "@clock-compass/web-client/momentum";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useStore } from "@/lib/stores/store";
import { errorMessage } from "@clock-compass/web-client/meta";
import {
  GOAL_STATUS_LABELS,
  editGoal,
  goalsQuery,
  refreshGoals,
  removeGoal,
  reorderGoal,
  statusEdit,
} from "@/lib/queries/goals";
import { addRole as addRoleMutation, removeRole, reorderRole, useRoles } from "@/lib/queries/roles";
import { renewalStore } from "@/lib/stores/renewal";
import { GoalFormSheet } from "./GoalFormSheet";
import { RoleFormSheet } from "./RoleFormSheet";
import { useSheet } from "./use-sheet";

const statuses: GoalStatus[] = ["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"];
const iconButton =
  "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30";
const roleButton =
  "flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent disabled:pointer-events-none disabled:opacity-30";

const pct = (ratio: number): number => Math.round(ratio * 100);
const momentumPct = (m: { met: number; target: number }): number =>
  m.target ? Math.round((100 * m.met) / m.target) : 0;

/** Move one id up/down in a list of ids; null when the move is out of range. */
function swapped(ids: string[], index: number, delta: number): string[] | null {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function GoalCard({
  goal,
  siblings,
  index,
  habits,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  siblings: Goal[];
  index: number;
  habits: HabitView[];
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}) {
  // Habit momentum (the second goal facet): this-week cadence of linked habits.
  const m = momentumFor(habits, new Set([goal.id]));
  const reorder = useMutation(reorderGoal);
  const edit = useMutation(editGoal);
  function move(delta: number) {
    const ids = swapped(
      siblings.map((g) => g.id),
      index,
      delta,
    );
    if (ids) reorder.mutate(ids);
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <h3 className="font-display text-[0.9375rem] font-semibold">{goal.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={index === 0}
            aria-label="Move goal up"
            title="Move up"
            className={iconButton}
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={index === siblings.length - 1}
            aria-label="Move goal down"
            title="Move down"
            className={iconButton}
          >
            <ChevronDown className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(goal)}
            aria-label="Edit goal"
            title="Edit"
            className={iconButton}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(goal)}
            aria-label="Delete goal"
            title="Delete"
            className={`${iconButton} hover:text-destructive`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {goal.description ? <p className="text-xs text-muted-foreground">{goal.description}</p> : null}

      {/* Completion: the share of the goal's tasks done. */}
      <div className="flex items-center gap-2" title="Tasks completed">
        <Check className="size-3.5 shrink-0 text-[var(--pine)]" />
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-[var(--pine)]"
            style={{ width: `${pct(goal.progress.ratio)}%` }}
          />
        </div>
        <span className="w-24 text-right text-xs text-muted-foreground">
          {goal.progress.done}/{goal.progress.total} · {pct(goal.progress.ratio)}%
        </span>
      </div>

      {/* Momentum: this-week cadence of the goal's recurring habits. */}
      {m ? (
        <div
          className="flex items-center gap-2"
          title={`${m.habits} habit${m.habits === 1 ? "" : "s"} · kept this week vs weekly target`}
        >
          <Repeat className="size-3.5 shrink-0 text-[var(--gold)]" />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[var(--gold)]" style={{ width: `${momentumPct(m)}%` }} />
          </div>
          <span className="w-24 text-right text-xs text-muted-foreground">
            {m.met}/{m.target}
            {m.streak > 0 ? ` · ${m.streak}w 🔥` : ""}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <select
          value={goal.status}
          onChange={(e) => edit.mutate(statusEdit(goal, e.currentTarget.value as GoalStatus))}
          aria-label="Goal status"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {GOAL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {goal.targetDate ? (
          <span className="text-xs text-muted-foreground">
            Target: {new Date(goal.targetDate).toLocaleDateString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const NO_GOALS: Goal[] = [];

/** Compass · Mission & Goals: goals grouped by role. */
export function GoalsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery(goalsQuery);
  const goals = query.data ?? NO_GOALS;
  // A load error shows until Retry starts, as it did.
  const error =
    query.isError && !query.isFetching ? errorMessage(query.error, "Failed to load goals") : null;
  const goalRemove = useMutation(removeGoal);
  const roles = useRoles();
  const addRoleM = useMutation(addRoleMutation);
  const reorder = useMutation(reorderRole);
  const remove = useMutation(removeRole);
  const habits = useStore(renewalStore, (s) => s.habits);
  const goalSheet = useSheet<Goal>();
  const roleSheet = useSheet<Role>();
  const goalDelete = useSheet<Goal>();
  const roleDelete = useSheet<Role>();
  const [newRoleName, setNewRoleName] = useState("");

  const loadingFirst = query.isFetching && goals.length === 0;

  // Goals grouped under their role (ordered), with unassigned goals last.
  const groups = useMemo(() => {
    const byRole: { role: Role | null; goals: Goal[] }[] = roles.map((role) => ({
      role,
      goals: goals.filter((g) => g.roleId === role.id),
    }));
    const unassigned = goals.filter((g) => !g.roleId || !roles.some((r) => r.id === g.roleId));
    if (unassigned.length > 0) byRole.push({ role: null, goals: unassigned });
    return byRole;
  }, [goals, roles]);

  async function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    await addRoleM.mutateAsync({ name }).catch(() => {});
    setNewRoleName("");
  }

  /** Move a role up/down among the roles and persist the new order. */
  function moveRole(role: Role, delta: number) {
    const ids = swapped(
      roles.map((r) => r.id),
      roles.findIndex((r) => r.id === role.id),
      delta,
    );
    if (ids) reorder.mutate(ids);
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Durable outcomes, grouped by the roles you live by.
          </p>
          <Button size="sm" onClick={() => goalSheet.show(null)}>
            <Plus className="size-4" />
            New goal
          </Button>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        {loadingFirst ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : goals.length === 0 && roles.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            hint="Add a goal to start linking tasks to a bigger outcome (Habit 2)."
          >
            <Button size="sm" onClick={() => goalSheet.show(null)}>
              <Plus className="size-4" />
              New goal
            </Button>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => {
              const rm = momentumFor(habits, new Set(group.goals.map((g) => g.id)));
              const role = group.role;
              const roleIndex = role ? roles.findIndex((r) => r.id === role.id) : -1;
              return (
                <div key={role?.id ?? "unassigned"} className="flex flex-col gap-2.5">
                  <div className="group flex items-baseline gap-2.5 border-l-[3px] border-[var(--pine)] pl-3">
                    <h3 className="font-display text-base font-semibold">
                      {role?.name ?? "Without a role"}
                    </h3>
                    {role?.mission ? (
                      <span className="font-display text-xs text-muted-foreground italic">
                        “{role.mission}”
                      </span>
                    ) : null}
                    {rm ? (
                      <span
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                        title="Habits kept this week across this group's goals"
                      >
                        <Repeat className="size-3 text-[var(--gold)]" />
                        {rm.met}/{rm.target}
                      </span>
                    ) : null}
                    {role ? (
                      <>
                        <button
                          type="button"
                          onClick={() => moveRole(role, -1)}
                          disabled={roleIndex === 0}
                          aria-label="Move role up"
                          title="Move up"
                          className={`ml-auto ${roleButton}`}
                        >
                          <ChevronUp className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRole(role, 1)}
                          disabled={roleIndex === roles.length - 1}
                          aria-label="Move role down"
                          title="Move down"
                          className={roleButton}
                        >
                          <ChevronDown className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => roleSheet.show(role)}
                          aria-label="Edit role"
                          title="Edit role"
                          className={roleButton}
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => roleDelete.show(role)}
                          aria-label="Delete role"
                          title="Delete role (its goals are kept)"
                          className={`${roleButton} hover:text-destructive`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </>
                    ) : null}
                  </div>
                  {group.goals.length === 0 ? (
                    <p className="pl-3 font-display text-sm text-muted-foreground italic">
                      No goals set for this role.
                    </p>
                  ) : (
                    group.goals.map((goal, i) => (
                      <GoalCard
                        key={goal.id}
                        goal={goal}
                        siblings={group.goals}
                        index={i}
                        habits={habits}
                        onEdit={(g) => goalSheet.show(g)}
                        onDelete={(g) => goalDelete.show(g)}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add a role */}
        <div className="flex gap-2">
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="Name a role you play in life — Parent, Professional, Self…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addRole();
            }}
            className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void addRole()}
            disabled={!newRoleName.trim()}
          >
            <Plus className="size-4" />
            Role
          </Button>
        </div>
      </section>

      <GoalFormSheet
        key={`goal-${goalSheet.key}`}
        open={goalSheet.open}
        onOpenChange={goalSheet.setOpen}
        goal={goalSheet.item}
      />
      <RoleFormSheet
        key={`role-${roleSheet.key}`}
        open={roleSheet.open}
        onOpenChange={roleSheet.setOpen}
        role={roleSheet.item}
      />
      <ConfirmDialog
        open={goalDelete.open}
        onOpenChange={goalDelete.setOpen}
        title="Delete goal?"
        description={
          goalDelete.item
            ? `“${goalDelete.item.title}” will be removed. Its tasks are kept but unlinked.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (goalDelete.item) goalRemove.mutate(goalDelete.item);
        }}
      />
      <ConfirmDialog
        open={roleDelete.open}
        onOpenChange={roleDelete.setOpen}
        title="Delete role?"
        description={
          roleDelete.item
            ? `“${roleDelete.item.name}” will be removed. Its goals are kept but ungrouped.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const role = roleDelete.item;
          if (role) remove.mutate(role, { onSettled: () => void refreshGoals(queryClient) });
        }}
      />
    </>
  );
}
