<script lang="ts">
  import ConfirmBarView from "../../cc/ConfirmBarView.svelte";

  let {
    confirmLabel,
    dismissLabel,
    confirm,
    dismiss,
    isValid,
    validationErrors = [],
  }: {
    confirmLabel?: string;
    dismissLabel?: string;
    confirm?: () => void;
    dismiss?: () => void;
    isValid?: boolean;
    validationErrors?: string[];
  } = $props();
</script>

<ConfirmBarView
  {confirmLabel}
  {dismissLabel}
  disabled={isValid === false}
  hint={validationErrors[0]}
  onconfirm={confirm}
  ondismiss={dismiss}
/>
