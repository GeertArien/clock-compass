<script lang="ts">
  /**
   * A2UI renderer spike (issue #62, step 1). Dev-only page: /a2ui-spike.html
   *   ?r=svelte-a2ui | lit | core     which renderer
   *   &f=week | spec                  which fixture
   *   &d=final | draft                final v1.0 wire format, or rewritten to
   *                                   the dialect the library was published for
   */
  import { Toaster } from "@/lib/components/ui/toast";
  import { specExample, toDraftDialect, weekPlan } from "./fixtures";
  import SvelteA2uiHarness from "./svelte-a2ui/Harness.svelte";
  import LitHarness from "./lit/Harness.svelte";
  import CoreHarness from "./core/Harness.svelte";

  const q = new URLSearchParams(location.search);
  const renderer = q.get("r") ?? "core";
  const fixture = q.get("f") ?? "week";
  const dialect = q.get("d") ?? "final";

  const base = fixture === "spec" ? specExample : weekPlan;
  const surfaceId = fixture === "spec" ? "contact_form_1" : "week_plan";
  const messages =
    dialect === "draft" ? toDraftDialect(base, renderer === "svelte-a2ui") : base;

  let outbound = $state<unknown[]>([]);
  let error = $state<string | null>(null);
  const push = (m: unknown) => (outbound = [...outbound, m]);
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-4" data-renderer={renderer}>
  <p class="text-[0.6875rem] uppercase tracking-wide text-[var(--color-muted-foreground)]">
    {renderer} · {fixture} · {dialect} wire format
  </p>

  <section
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm"
    data-testid="surface"
  >
    {#if renderer === "svelte-a2ui"}
      <SvelteA2uiHarness {messages} {surfaceId} onoutbound={push} />
    {:else if renderer === "lit"}
      <LitHarness {messages} {surfaceId} onoutbound={push} onerror={(m) => (error = m)} />
    {:else}
      <CoreHarness {messages} {surfaceId} onoutbound={push} onerror={(m) => (error = m)} />
    {/if}
  </section>

  {#if error}
    <pre
      class="whitespace-pre-wrap rounded-md bg-[var(--color-terra-soft)] p-2 text-[0.6875rem] text-[var(--color-terra)]"
      data-testid="error">{error}</pre>
  {/if}
  {#if outbound.length}
    <pre
      class="whitespace-pre-wrap rounded-md bg-[var(--color-muted)] p-2 text-[0.625rem]"
      data-testid="outbound">{JSON.stringify(outbound.at(-1), null, 1)}</pre>
  {/if}
</main>
<Toaster />
