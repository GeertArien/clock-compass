<script lang="ts">
  import { ChevronRight, FolderOpen, Inbox, Plus, Trash2, TriangleAlert } from "lucide-svelte";
  import TaskCard from "./TaskCard.svelte";
  import { Button } from "@/lib/components/ui/button";
  import { ConfirmDialog } from "@/lib/components/ui/confirm";
  import { EmptyState } from "@/lib/components/ui/state";
  import { PROJECT_STATUS_LABELS, projectsStore } from "@/lib/stores/projects.svelte";
  import { goalsStore } from "@/lib/stores/goals.svelte";
  import { rolesStore } from "@/lib/stores/roles.svelte";
  import { tasksStore } from "@/lib/stores/tasks.svelte";
  import type { Project, ProjectStatus } from "@/lib/api";

  const statuses: ProjectStatus[] = ["ACTIVE", "SOMEDAY", "DONE"];
  const loadingFirst = $derived(projectsStore.loading && projectsStore.projects.length === 0);

  // Done projects sink to the bottom.
  const projects = $derived(
    [...projectsStore.projects].sort(
      (a, b) => Number(a.status === "DONE") - Number(b.status === "DONE"),
    ),
  );
  const inboxTasks = $derived(
    tasksStore.tasks.filter((t) => !t.projectId && t.status !== "DONE"),
  );

  let expanded = $state<string | null>(null);
  let newName = $state("");
  let newGoalId = $state("");
  let newTaskTitle = $state("");
  let deleteOpen = $state(false);
  let deletingProject = $state<Project | null>(null);

  function lineage(project: Project): string | null {
    const goal = goalsStore.goals.find((g) => g.id === project.goalId);
    if (!goal) return null;
    const role = rolesStore.byId(goal.roleId);
    return role ? `${goal.title} › ${role.name}` : goal.title;
  }

  function tasksOf(projectId: string) {
    return tasksStore.tasks.filter((t) => t.projectId === projectId);
  }

  function toggle(id: string) {
    expanded = expanded === id ? null : id;
    newTaskTitle = "";
  }

  async function addProject() {
    const name = newName.trim();
    if (!name) return;
    await projectsStore.add({ name, goalId: newGoalId || undefined });
    newName = "";
    newGoalId = "";
  }

  async function addTask(project: Project) {
    const title = newTaskTitle.trim();
    if (!title) return;
    // Project tasks default to Q2 (important, not urgent) and inherit the goal.
    await tasksStore.add({
      title,
      important: true,
      projectId: project.id,
      goalId: project.goalId ?? undefined,
    });
    newTaskTitle = "";
    projectsStore.refresh();
  }

  function askDelete(project: Project) {
    deletingProject = project;
    deleteOpen = true;
  }
</script>

<section class="flex flex-col gap-4">
  {#if projectsStore.error}
    <div
      class="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]"
    >
      <span>{projectsStore.error}</span>
      <Button variant="outline" size="sm" onclick={() => projectsStore.load()}>Retry</Button>
    </div>
  {/if}

  <!-- New project -->
  <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-sm sm:flex-row">
    <input
      bind:value={newName}
      placeholder="An outcome worth pursuing…"
      onkeydown={(e) => e.key === "Enter" && addProject()}
      class="flex-1 rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
    />
    <select
      bind:value={newGoalId}
      aria-label="Serves which goal?"
      class="rounded-md border border-[var(--color-input)] bg-transparent px-2 py-2 text-sm text-[var(--color-muted-foreground)]"
    >
      <option value="">— no goal yet —</option>
      {#each goalsStore.goals as goal (goal.id)}
        <option value={goal.id}>{goal.title}</option>
      {/each}
    </select>
    <Button size="sm" onclick={addProject} disabled={!newName.trim()}>
      <Plus class="size-4" />
      Project
    </Button>
  </div>

  {#if loadingFirst}
    <div class="flex flex-col gap-3">
      {#each [0, 1] as i (i)}
        <div class="h-20 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]"></div>
      {/each}
    </div>
  {:else if projects.length === 0}
    <EmptyState
      icon={FolderOpen}
      title="No projects yet"
      hint="A project is any outcome that takes more than one step — “Launch the newsletter”, “Plan the trip”."
    />
  {:else}
    <div class="flex flex-col gap-3">
      {#each projects as project (project.id)}
        {@const lin = lineage(project)}
        {@const open = expanded === project.id}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
          <button
            onclick={() => toggle(project.id)}
            class="flex w-full items-start gap-2.5 p-3 text-left"
            aria-expanded={open}
          >
            <ChevronRight
              class="mt-0.5 size-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform {open
                ? 'rotate-90'
                : ''}"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-display text-[0.9375rem] font-semibold">{project.name}</h3>
                <span class="text-xs text-[var(--color-muted-foreground)]">
                  {project.progress.done} / {project.progress.total}
                </span>
              </div>
              {#if lin}
                <p class="mt-0.5 text-xs text-[var(--color-muted-foreground)]">Goal: {lin}</p>
              {:else}
                <p class="mt-0.5 flex items-center gap-1 text-xs text-[var(--gold)]">
                  <TriangleAlert class="size-3" />
                  Not linked to a goal — worth doing, or worth dropping?
                </p>
              {/if}
            </div>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold {project.status ===
              'ACTIVE'
                ? 'bg-[var(--pine-soft)] text-[var(--pine)]'
                : project.status === 'DONE'
                  ? 'bg-[var(--plum-soft)] text-[var(--plum)]'
                  : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'}"
            >
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
          </button>

          {#if open}
            <div class="border-t border-[var(--color-border)] bg-[var(--color-secondary)]/40 p-3">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={project.goalId ?? ""}
                  onchange={(e) =>
                    projectsStore.setGoal(project, (e.currentTarget as HTMLSelectElement).value || null)}
                  aria-label="Serves which goal?"
                  class="rounded-md border border-[var(--color-input)] bg-transparent px-2 py-1 text-xs text-[var(--color-muted-foreground)]"
                >
                  <option value="">— no goal —</option>
                  {#each goalsStore.goals as goal (goal.id)}
                    <option value={goal.id}>{goal.title}</option>
                  {/each}
                </select>
                <select
                  value={project.status}
                  onchange={(e) =>
                    projectsStore.setStatus(
                      project,
                      (e.currentTarget as HTMLSelectElement).value as ProjectStatus,
                    )}
                  aria-label="Project status"
                  class="rounded-md border border-[var(--color-input)] bg-transparent px-2 py-1 text-xs text-[var(--color-muted-foreground)]"
                >
                  {#each statuses as s (s)}
                    <option value={s}>{PROJECT_STATUS_LABELS[s]}</option>
                  {/each}
                </select>
                <button
                  onclick={() => askDelete(project)}
                  aria-label="Delete project"
                  title="Delete (tasks go back to the Inbox)"
                  class="ml-auto flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--destructive)]"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </div>

              <div class="flex flex-col gap-2">
                {#each tasksOf(project.id) as task (task.id)}
                  <TaskCard {task} />
                {:else}
                  <p class="py-1 text-center font-display text-sm italic text-[var(--color-muted-foreground)]">
                    No tasks yet.
                  </p>
                {/each}
              </div>

              <div class="mt-2 flex gap-2">
                <input
                  bind:value={newTaskTitle}
                  placeholder="Add a task…"
                  onkeydown={(e) => e.key === "Enter" && addTask(project)}
                  class="flex-1 rounded-md border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
                />
                <Button variant="outline" size="sm" onclick={() => addTask(project)}>Add</Button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Inbox: loose tasks with no project -->
  <div class="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--color-input)] bg-[var(--color-secondary)]/40 p-3">
    <div class="flex items-center gap-2">
      <Inbox class="size-4 text-[var(--color-muted-foreground)]" />
      <h3 class="font-display text-[0.9375rem] font-semibold">Inbox</h3>
      <span class="text-xs text-[var(--color-muted-foreground)]">
        {inboxTasks.length} unsorted
      </span>
    </div>
    <div class="flex flex-col gap-2">
      {#each inboxTasks as task (task.id)}
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1"><TaskCard {task} /></div>
          {#if projects.length > 0}
            <select
              value=""
              onchange={(e) => {
                const id = (e.currentTarget as HTMLSelectElement).value;
                if (id) tasksStore.setProject(task, id);
              }}
              aria-label="Move to project"
              class="max-w-28 shrink-0 rounded-md border border-[var(--color-input)] bg-transparent px-1.5 py-1 text-[0.6875rem] text-[var(--color-muted-foreground)]"
            >
              <option value="">move to…</option>
              {#each projects.filter((p) => p.status !== "DONE") as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          {/if}
        </div>
      {:else}
        <p class="py-1 text-center font-display text-sm italic text-[var(--color-muted-foreground)]">
          Inbox empty.
        </p>
      {/each}
    </div>
  </div>
</section>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete project?"
  description={deletingProject
    ? `“${deletingProject.name}” will be removed. Its tasks go back to the Inbox.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (deletingProject) {
      projectsStore.remove(deletingProject).then(() => tasksStore.load());
    }
  }}
/>
