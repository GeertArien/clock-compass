<script lang="ts">
  import type { A2uiComponentProps } from "svelte-a2ui";
  import ConfirmBarView from "../cc/ConfirmBarView.svelte";

  let { confirmLabel, dismissLabel, actions, validation }: A2uiComponentProps = $props();
</script>

<ConfirmBarView
  confirmLabel={confirmLabel as string | undefined}
  dismissLabel={dismissLabel as string | undefined}
  disabled={!validation.valid}
  hint={validation.errors[0]}
  onconfirm={actions.confirm}
  ondismiss={actions.dismiss}
/>
