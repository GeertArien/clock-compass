<script lang="ts">
  import type { ComponentNode } from "@a2ui/web_core/v1_0";
  import { Button } from "@/lib/components/ui/button";
  import A2uiNode from "../A2uiNode.svelte";

  let {
    child,
    variant,
    action,
    isValid,
  }: { child?: ComponentNode; variant?: string; action?: () => void; isValid?: boolean } = $props();
</script>

<Button
  variant={variant === "primary" ? "default" : variant === "borderless" ? "ghost" : "outline"}
  disabled={isValid === false}
  onclick={() => action?.()}
  class="[&_p]:text-inherit"
>
  {#if child}<A2uiNode node={child} />{/if}
</Button>
