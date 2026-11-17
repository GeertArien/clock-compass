<script lang="ts">
  import type { ComponentNode } from "@a2ui/web_core/v1_0";
  import A2uiNode from "../A2uiNode.svelte";

  let { child }: { child?: ComponentNode } = $props();
</script>

<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
  {#if child}<A2uiNode node={child} />{/if}
</div>
