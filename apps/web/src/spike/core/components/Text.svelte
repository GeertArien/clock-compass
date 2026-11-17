<script lang="ts">
  let { text = "", variant = "body" }: { text?: unknown; variant?: string } = $props();

  // The basic catalog allows a leading markdown heading ("# Contact Us").
  const heading = $derived(/^#{1,5}\s/.test(String(text)));
  const label = $derived(String(text ?? "").replace(/^#{1,5}\s+/, ""));
</script>

{#if heading || /^h[1-5]$/.test(variant)}
  <h3 class="font-serif text-lg leading-tight">{label}</h3>
{:else if variant === "caption"}
  <p class="text-xs text-[var(--color-muted-foreground)]">{label}</p>
{:else}
  <p class="text-sm leading-snug">{label}</p>
{/if}
