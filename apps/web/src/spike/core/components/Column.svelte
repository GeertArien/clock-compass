<script lang="ts">
  import type { ComponentNode } from "@a2ui/web_core/v1_0";
  import A2uiNode from "../A2uiNode.svelte";

  let { children = [] }: { children?: ComponentNode[] } = $props();
</script>

<div class="flex flex-col gap-3">
  {#each children as child (child.id)}
    <A2uiNode node={child} />
  {/each}
</div>
