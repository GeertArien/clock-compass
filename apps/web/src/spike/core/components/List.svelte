<script lang="ts">
  import type { ComponentNode } from "@a2ui/web_core/v1_0";
  import A2uiNode from "../A2uiNode.svelte";

  let { children = [] }: { children?: ComponentNode[] } = $props();
</script>

<ul class="flex flex-col gap-2">
  {#each children as child (child.id)}
    <li><A2uiNode node={child} /></li>
  {/each}
</ul>
