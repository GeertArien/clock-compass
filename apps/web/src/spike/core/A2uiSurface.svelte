<script lang="ts">
  /**
   * Renders one A2UI surface with Svelte components: the official core owns
   * the protocol (validation, data model, bindings, checks, templates) and
   * hands us a resolved, reactive node tree to walk.
   */
  import { setContext } from "svelte";
  import {
    NodeResolver,
    effect as watch,
    getValue,
    type ComponentApi,
    type ComponentNode,
    type SurfaceModel,
  } from "@a2ui/web_core/v1_0";
  import A2uiNode, { IMPLEMENTATIONS, type Implementations } from "./A2uiNode.svelte";

  let {
    surface,
    implementations,
  }: { surface: SurfaceModel<ComponentApi>; implementations: Implementations } = $props();

  // svelte-ignore state_referenced_locally
  setContext(IMPLEMENTATIONS, implementations);

  let root = $state.raw<ComponentNode | undefined>();
  $effect(() => {
    const resolver = new NodeResolver(surface);
    const stop = watch(() => {
      root = getValue(resolver.rootNode);
    });
    return () => {
      stop();
      resolver.dispose();
    };
  });
</script>

{#if root}
  {#key root.id}
    <A2uiNode node={root} />
  {/key}
{:else}
  <p class="text-sm text-[var(--color-muted-foreground)]">Waiting for the surface…</p>
{/if}
