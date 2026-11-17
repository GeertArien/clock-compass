<script lang="ts">
  /** Catalog component `ConfirmBar`: every agent-proposed write ends in one. */
  import { Button } from "@/lib/components/ui/button";

  let {
    confirmLabel = "Confirm",
    dismissLabel = "Dismiss",
    disabled = false,
    hint,
    onconfirm,
    ondismiss,
  }: {
    confirmLabel?: string;
    dismissLabel?: string;
    disabled?: boolean;
    hint?: string;
    onconfirm?: () => void;
    ondismiss?: () => void;
  } = $props();
</script>

<div class="flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
  <div class="flex items-center justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={() => ondismiss?.()}>{dismissLabel}</Button>
    <Button size="sm" {disabled} onclick={() => onconfirm?.()}>{confirmLabel}</Button>
  </div>
  {#if disabled && hint}
    <p class="text-right text-[0.6875rem] text-[var(--color-muted-foreground)]">{hint}</p>
  {/if}
</div>
