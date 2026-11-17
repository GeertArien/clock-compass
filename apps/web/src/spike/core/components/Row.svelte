<script lang="ts">
  import type { ComponentNode } from "@a2ui/web_core/v1_0";
  import A2uiNode from "../A2uiNode.svelte";

  let { children = [], align }: { children?: ComponentNode[]; align?: string } = $props();
</script>

<div class="flex flex-wrap gap-2" class:items-center={align === "center"}>
  {#each children as child (child.id)}
    <div class="min-w-0 flex-1 basis-32"><A2uiNode node={child} /></div>
  {/each}
</div>
