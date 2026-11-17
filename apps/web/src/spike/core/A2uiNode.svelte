<script lang="ts" module>
  import type { Component } from "svelte";

  /** Component type name → Svelte implementation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Implementations = Record<string, Component<any>>;
  export const IMPLEMENTATIONS = Symbol("a2ui-implementations");
</script>

<script lang="ts">
  import { getContext } from "svelte";
  import { effect as watch, getValue, peekValue, type ComponentNode } from "@a2ui/web_core/v1_0";
  import { unwrapProps } from "./props";

  let { node }: { node: ComponentNode } = $props();

  const implementations = getContext<Implementations>(IMPLEMENTATIONS);
  const Impl = $derived(implementations[node.type]);

  // Bridge the core's signal into Svelte state: one subscription per node.
  // svelte-ignore state_referenced_locally
  let resolved = $state.raw(unwrapProps(peekValue(node.props)));
  $effect(() => {
    const current = node;
    return watch(() => {
      resolved = unwrapProps(getValue(current.props));
    });
  });
</script>

{#if node.isPlaceholder}
  <!-- Definition not streamed in yet (or unknown / cyclic): hold the slot. -->
  <div class="h-9 animate-pulse rounded-md bg-[var(--color-muted)]"></div>
{:else if Impl}
  <Impl {node} {...resolved} />
{:else}
  <p
    class="rounded-md border border-dashed border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted-foreground)]"
  >
    ⟨{node.type}⟩ has no Svelte implementation yet
  </p>
{/if}
