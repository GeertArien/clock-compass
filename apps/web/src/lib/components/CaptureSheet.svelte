<script lang="ts">
  import { Sparkles, Star } from "lucide-svelte";
  import { Sheet } from "@/lib/components/ui/sheet";
  import { Button } from "@/lib/components/ui/button";
  import { toast } from "@/lib/components/ui/toast";
  import { aiClassify, aiIntake, type TaskClassification } from "@/lib/api";
  import { aiStore } from "@/lib/stores/ai.svelte";
  import { tasksStore } from "@/lib/stores/tasks.svelte";

  type Props = { open: boolean };
  let { open = $bindable() }: Props = $props();

  let text = $state("");
  let preview = $state<TaskClassification | null>(null);
  let previewing = $state(false);
  let saving = $state(false);

  let lastOpen = $state(false);
  $effect(() => {
    if (open && !lastOpen) {
      text = "";
      preview = null;
    }
    lastOpen = open;
  });

  const quadrant = $derived(
    preview
      ? preview.important
        ? preview.urgent
          ? "Q1"
          : "Q2"
        : preview.urgent
          ? "Q3"
          : "Q4"
      : null,
  );

  async function doPreview() {
    const sentence = text.trim();
    if (!sentence || previewing) return;
    previewing = true;
    try {
      preview = await aiClassify(sentence);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Classification failed");
    } finally {
      previewing = false;
    }
  }

  async function save(asBigRock: boolean) {
    const sentence = text.trim();
    if (!sentence || saving) return;
    saving = true;
    try {
      if (aiStore.connected) {
        const { task } = await aiIntake(sentence);
        await tasksStore.load();
        if (asBigRock) {
          const created = tasksStore.tasks.find((t) => t.id === task.id);
          if (created) await tasksStore.toggleBigRock(created);
        }
        toast.success("Captured");
      } else {
        // No AI configured: capture is a plain quick-add into the Inbox.
        await tasksStore.add({ title: sentence });
      }
      open = false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Capture failed");
    } finally {
      saving = false;
    }
  }
</script>

<Sheet
  bind:open
  title="Capture"
  description={aiStore.connected
    ? "A plain sentence — the AI fills in quadrant, tags, and date."
    : "Quick-add a task to the Inbox."}
>
  <div class="flex flex-col gap-3">
    <textarea
      bind:value={text}
      rows="3"
      placeholder="Take Noor to the climbing gym Saturday morning…"
      onkeydown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(false);
      }}
      class="w-full resize-none rounded-xl border border-[var(--color-input)] bg-transparent p-3 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
    ></textarea>

    {#if aiStore.connected}
      {#if preview}
        <div class="flex flex-col gap-2 rounded-xl border border-[#ddd6ea] bg-[var(--plum-soft)] p-3">
          <p class="flex items-center gap-1.5 text-[0.65625rem] font-bold tracking-[0.14em] text-[var(--plum)] uppercase">
            <Sparkles class="size-3" />
            AI understood
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span class="rounded-full border border-[#bcd8cc] bg-[var(--pine-soft)] px-2.5 py-1 text-[0.71875rem] font-semibold text-[var(--pine)]">
              {quadrant}
            </span>
            <span class="rounded-full border border-[#ddd6ea] bg-[var(--color-card)] px-2.5 py-1 text-[0.71875rem] font-semibold text-[var(--color-foreground)]/80">
              {preview.title}
            </span>
            {#if preview.dueDate}
              <span class="rounded-full border border-[#ddd6ea] bg-[var(--color-card)] px-2.5 py-1 text-[0.71875rem] font-semibold text-[var(--color-foreground)]/80">
                📅 {new Date(preview.dueDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
            {/if}
            {#if preview.proactivity}
              <span class="rounded-full border border-[#ddd6ea] bg-[var(--color-card)] px-2.5 py-1 text-[0.71875rem] font-semibold text-[var(--color-foreground)]/80">
                {preview.proactivity === "INFLUENCE" ? "⊙ influence" : "◌ concern"}
              </span>
            {/if}
          </div>
          <p class="font-display text-xs italic text-[var(--color-muted-foreground)]">
            {preview.rationale}
          </p>
        </div>
      {:else}
        <Button
          variant="outline"
          size="sm"
          onclick={doPreview}
          disabled={!text.trim() || previewing}
          class="self-start"
        >
          <Sparkles class="size-3.5" />
          {previewing ? "Thinking…" : "Preview"}
        </Button>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
      <Button variant="outline" size="sm" onclick={() => save(true)} disabled={saving || !text.trim()}>
        <Star class="size-3.5" />
        Big rock
      </Button>
      <Button size="sm" onclick={() => save(false)} disabled={saving || !text.trim()}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  {/snippet}
</Sheet>
