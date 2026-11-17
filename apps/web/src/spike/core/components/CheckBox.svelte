<script lang="ts">
  let {
    label,
    value,
    setValue,
  }: { label?: string; value?: boolean; setValue?: (next: boolean) => void } = $props();
</script>

<label class="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={value === true}
    onchange={(e) => setValue?.(e.currentTarget.checked)}
    class="size-4 accent-[var(--color-pine)]"
  />
  {label}
</label>
