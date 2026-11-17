<script lang="ts">
  /**
   * Catalog component `TaskCard`: the agent names a task by id and the real
   * app card renders it from the store, so it stays live and editable.
   */
  import TaskCard from "@/lib/components/TaskCard.svelte";
  import { tasksStore } from "@/lib/stores/tasks.svelte";

  let { taskId }: { taskId: string } = $props();

  const task = $derived(tasksStore.tasks.find((t) => t.id === taskId));
</script>

{#if task}
  <TaskCard {task} />
{:else}
  <p
    class="rounded-md border border-dashed border-[var(--color-border)] p-2.5 text-xs text-[var(--color-muted-foreground)]"
  >
    Task “{taskId}” is no longer available.
  </p>
{/if}
