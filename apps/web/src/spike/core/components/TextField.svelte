<script lang="ts">
  import { Input } from "@/lib/components/ui/input";

  let {
    label,
    value,
    setValue,
    placeholder,
    isValid,
    validationErrors = [],
  }: {
    label?: string;
    value?: string;
    setValue?: (next: string) => void;
    placeholder?: string;
    isValid?: boolean;
    validationErrors?: string[];
  } = $props();
</script>

<label class="flex flex-col gap-1">
  {#if label}<span class="text-xs font-medium">{label}</span>{/if}
  <Input
    value={value ?? ""}
    {placeholder}
    aria-invalid={isValid === false}
    oninput={(e) => setValue?.(e.currentTarget.value)}
  />
  {#if isValid === false && validationErrors[0]}
    <span class="text-[0.6875rem] text-[var(--color-destructive)]">{validationErrors[0]}</span>
  {/if}
</label>
