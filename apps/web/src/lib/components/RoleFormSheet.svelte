<script lang="ts">
  import { Sheet } from "@/lib/components/ui/sheet";
  import { Button } from "@/lib/components/ui/button";
  import { Input } from "@/lib/components/ui/input";
  import { rolesStore } from "@/lib/stores/roles.svelte";
  import type { Role } from "@/lib/api";

  type Props = { open: boolean; role: Role | null };
  let { open = $bindable(), role = null }: Props = $props();

  let name = $state("");
  let mission = $state("");
  let submitting = $state(false);

  let lastOpen = $state(false);
  $effect(() => {
    if (open && !lastOpen) {
      name = role?.name ?? "";
      mission = role?.mission ?? "";
    }
    lastOpen = open;
  });

  async function submit(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !role || submitting) return;
    submitting = true;
    await rolesStore.update(role, { name: n, mission: mission.trim() || null });
    submitting = false;
    open = false;
  }
</script>

<Sheet
  bind:open
  title="Edit role"
  description="A part you play in life, with an optional per-role mission line."
>
  <form id="role-form" onsubmit={submit} class="flex flex-col gap-4">
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-[var(--color-muted-foreground)]">Name</span>
      <Input bind:value={name} placeholder="Parent, Professional, Self…" required />
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-[var(--color-muted-foreground)]">Mission</span>
      <textarea
        bind:value={mission}
        rows="2"
        placeholder="A short line for this role — “Present, not just around.”"
        class="w-full resize-y rounded-md border border-[var(--color-border)] bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      ></textarea>
    </label>
  </form>

  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
      <Button type="submit" form="role-form" size="sm" disabled={submitting || !name.trim()}>
        Save
      </Button>
    </div>
  {/snippet}
</Sheet>
