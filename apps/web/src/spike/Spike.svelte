<script lang="ts">
  /**
   * A2UI renderer spike (issue #62, step 1). Dev-only page, not part of the
   * production build: run `pnpm dev` and open /a2ui-spike.html
   *   ?f=week   our own catalog: live TaskCards, bound field, ConfirmBar (default)
   *   ?f=spec   the A2UI 1.0 spec's own example stream (basic catalog)
   */
  import { Toaster } from "@/lib/components/ui/toast";
  import { specExample, weekPlan } from "./fixtures";
  import Harness from "./core/Harness.svelte";

  const fixture = new URLSearchParams(location.search).get("f") ?? "week";
  const messages = fixture === "spec" ? specExample : weekPlan;
  const surfaceId = fixture === "spec" ? "contact_form_1" : "week_plan";

  let outbound = $state<unknown[]>([]);
  let error = $state<string | null>(null);
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-4">
  <p class="text-[0.6875rem] uppercase tracking-wide text-[var(--color-muted-foreground)]">
    A2UI 1.0 · {fixture} fixture
  </p>

  <section
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm"
    data-testid="surface"
  >
    <Harness
      {messages}
      {surfaceId}
      onoutbound={(m) => (outbound = [...outbound, m])}
      onerror={(m) => (error = m)}
    />
  </section>

  {#if error}
    <pre
      class="whitespace-pre-wrap rounded-md bg-[var(--color-terra-soft)] p-2 text-[0.6875rem] text-[var(--color-terra)]"
      data-testid="error">{error}</pre>
  {/if}
  {#if outbound.length}
    <!-- What the renderer would send back to the agent. -->
    <pre
      class="whitespace-pre-wrap rounded-md bg-[var(--color-muted)] p-2 text-[0.625rem]"
      data-testid="outbound">{JSON.stringify(outbound.at(-1), null, 1)}</pre>
  {/if}
</main>
<Toaster />
