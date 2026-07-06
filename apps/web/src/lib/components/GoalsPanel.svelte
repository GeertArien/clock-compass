<script lang="ts">
  import { ChevronDown, ChevronUp, Pencil, Plus, Target, Trash2 } from "lucide-svelte";
  import { Button } from "@/lib/components/ui/button";
  import { EmptyState } from "@/lib/components/ui/state";
  import { ConfirmDialog } from "@/lib/components/ui/confirm";
  import GoalFormSheet from "./GoalFormSheet.svelte";
  import RoleFormSheet from "./RoleFormSheet.svelte";
  import { GOAL_STATUS_LABELS, goalsStore } from "@/lib/stores/goals.svelte";
  import { rolesStore } from "@/lib/stores/roles.svelte";
  import type { Goal, GoalStatus, Role } from "@/lib/api";

  const statuses: GoalStatus[] = ["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"];
  const loadingFirst = $derived(goalsStore.loading && goalsStore.goals.length === 0);

  // Goals grouped under their role (ordered), with unassigned goals last.
  const groups = $derived.by(() => {
    const byRole = rolesStore.roles.map((role) => ({
      role: role as Role | null,
      goals: goalsStore.goals.filter((g) => g.roleId === role.id),
    }));
    const unassigned = goalsStore.goals.filter(
      (g) => !g.roleId || !rolesStore.roles.some((r) => r.id === g.roleId),
    );
    if (unassigned.length > 0) byRole.push({ role: null, goals: unassigned });
    return byRole;
  });

  let formOpen = $state(false);
  let editingGoal = $state<Goal | null>(null);
  let deleteOpen = $state(false);
  let deletingGoal = $state<Goal | null>(null);
  let newRoleName = $state("");
  let roleFormOpen = $state(false);
  let editingRole = $state<Role | null>(null);
  let deleteRoleOpen = $state(false);
  let deletingRole = $state<Role | null>(null);

  function openCreate() {
    editingGoal = null;
    formOpen = true;
  }
  function openEdit(goal: Goal) {
    editingGoal = goal;
    formOpen = true;
  }
  function askDelete(goal: Goal) {
    deletingGoal = goal;
    deleteOpen = true;
  }
  function openEditRole(role: Role) {
    editingRole = role;
    roleFormOpen = true;
  }
  function askDeleteRole(role: Role) {
    deletingRole = role;
    deleteRoleOpen = true;
  }

  async function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    await rolesStore.add({ name });
    newRoleName = "";
  }

  /** Move a goal up/down within its role group and persist the new order. */
  function moveGoal(siblings: Goal[], index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((g) => g.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    goalsStore.reorder(ids);
  }

  /** Move a role up/down among the roles and persist the new order. */
  function moveRole(role: Role, delta: number) {
    const roles = rolesStore.roles;
    const index = roles.findIndex((r) => r.id === role.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= roles.length) return;
    const ids = roles.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    rolesStore.reorder(ids);
  }

  const roleIndex = (role: Role) => rolesStore.roles.findIndex((r) => r.id === role.id);

  function pct(ratio: number): number {
    return Math.round(ratio * 100);
  }
</script>

{#snippet goalCard(goal: Goal, siblings: Goal[], index: number)}
  <div
    class="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-sm"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <Target class="size-4 text-[var(--color-muted-foreground)]" />
        <h3 class="font-display text-[0.9375rem] font-semibold">{goal.title}</h3>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          onclick={() => moveGoal(siblings, index, -1)}
          disabled={index === 0}
          aria-label="Move goal up"
          title="Move up"
          class="flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronUp class="size-3.5" />
        </button>
        <button
          onclick={() => moveGoal(siblings, index, 1)}
          disabled={index === siblings.length - 1}
          aria-label="Move goal down"
          title="Move down"
          class="flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronDown class="size-3.5" />
        </button>
        <button
          onclick={() => openEdit(goal)}
          aria-label="Edit goal"
          title="Edit"
          class="flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
        >
          <Pencil class="size-3.5" />
        </button>
        <button
          onclick={() => askDelete(goal)}
          aria-label="Delete goal"
          title="Delete"
          class="flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--destructive)]"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>

    {#if goal.description}
      <p class="text-xs text-[var(--color-muted-foreground)]">{goal.description}</p>
    {/if}

    <div class="flex items-center gap-2">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-muted)]">
        <div class="h-full bg-[var(--pine)]" style={`width: ${pct(goal.progress.ratio)}%`}></div>
      </div>
      <span class="w-20 text-right text-xs text-[var(--color-muted-foreground)]">
        {goal.progress.done}/{goal.progress.total} · {pct(goal.progress.ratio)}%
      </span>
    </div>

    <div class="flex items-center justify-between">
      <select
        value={goal.status}
        onchange={(e) =>
          goalsStore.setStatus(goal, (e.currentTarget as HTMLSelectElement).value as GoalStatus)}
        aria-label="Goal status"
        class="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
      >
        {#each statuses as s (s)}
          <option value={s}>{GOAL_STATUS_LABELS[s]}</option>
        {/each}
      </select>
      {#if goal.targetDate}
        <span class="text-xs text-[var(--color-muted-foreground)]">
          Target: {new Date(goal.targetDate).toLocaleDateString()}
        </span>
      {/if}
    </div>
  </div>
{/snippet}

<section class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <p class="text-sm text-[var(--color-muted-foreground)]">
      Durable outcomes, grouped by the roles you live by.
    </p>
    <Button size="sm" onclick={openCreate}>
      <Plus class="size-4" />
      New goal
    </Button>
  </div>

  {#if goalsStore.error}
    <div
      class="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]"
    >
      <span>{goalsStore.error}</span>
      <Button variant="outline" size="sm" onclick={() => goalsStore.load()}>Retry</Button>
    </div>
  {/if}

  {#if loadingFirst}
    <div class="flex flex-col gap-3">
      {#each [0, 1, 2] as i (i)}
        <div
          class="h-24 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]"
        ></div>
      {/each}
    </div>
  {:else if goalsStore.goals.length === 0 && rolesStore.roles.length === 0}
    <EmptyState
      icon={Target}
      title="No goals yet"
      hint="Add a goal to start linking tasks to a bigger outcome (Habit 2)."
    >
      <Button size="sm" onclick={openCreate}>
        <Plus class="size-4" />
        New goal
      </Button>
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-5">
      {#each groups as group (group.role?.id ?? "unassigned")}
        <div class="flex flex-col gap-2.5">
          <div class="group flex items-baseline gap-2.5 border-l-[3px] border-[var(--pine)] pl-3">
            <h3 class="font-display text-base font-semibold">
              {group.role?.name ?? "Without a role"}
            </h3>
            {#if group.role?.mission}
              <span class="font-display text-xs italic text-[var(--color-muted-foreground)]">
                “{group.role.mission}”
              </span>
            {/if}
            {#if group.role}
              <button
                onclick={() => group.role && moveRole(group.role, -1)}
                disabled={roleIndex(group.role) === 0}
                aria-label="Move role up"
                title="Move up"
                class="ml-auto flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronUp class="size-3" />
              </button>
              <button
                onclick={() => group.role && moveRole(group.role, 1)}
                disabled={roleIndex(group.role) === rolesStore.roles.length - 1}
                aria-label="Move role down"
                title="Move down"
                class="flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronDown class="size-3" />
              </button>
              <button
                onclick={() => group.role && openEditRole(group.role)}
                aria-label="Edit role"
                title="Edit role"
                class="flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-accent)]"
              >
                <Pencil class="size-3" />
              </button>
              <button
                onclick={() => group.role && askDeleteRole(group.role)}
                aria-label="Delete role"
                title="Delete role (its goals are kept)"
                class="flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-accent)] hover:text-[var(--destructive)]"
              >
                <Trash2 class="size-3" />
              </button>
            {/if}
          </div>
          {#each group.goals as goal, i (goal.id)}
            {@render goalCard(goal, group.goals, i)}
          {:else}
            <p class="pl-3 font-display text-sm italic text-[var(--color-muted-foreground)]">
              No goals set for this role.
            </p>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Add a role -->
  <div class="flex gap-2">
    <input
      bind:value={newRoleName}
      placeholder="Name a role you play in life — Parent, Professional, Self…"
      onkeydown={(e) => e.key === "Enter" && addRole()}
      class="flex-1 rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
    />
    <Button variant="outline" size="sm" onclick={addRole} disabled={!newRoleName.trim()}>
      <Plus class="size-4" />
      Role
    </Button>
  </div>
</section>

<GoalFormSheet bind:open={formOpen} goal={editingGoal} />
<RoleFormSheet bind:open={roleFormOpen} role={editingRole} />
<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete goal?"
  description={deletingGoal
    ? `“${deletingGoal.title}” will be removed. Its tasks are kept but unlinked.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => deletingGoal && goalsStore.remove(deletingGoal)}
/>
<ConfirmDialog
  bind:open={deleteRoleOpen}
  title="Delete role?"
  description={deletingRole
    ? `“${deletingRole.name}” will be removed. Its goals are kept but ungrouped.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (deletingRole) {
      rolesStore.remove(deletingRole).then(() => goalsStore.refresh());
    }
  }}
/>
