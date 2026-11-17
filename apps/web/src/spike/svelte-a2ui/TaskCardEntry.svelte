<script lang="ts">
  import type { A2uiComponentProps } from "svelte-a2ui";
  import LiveTaskCard from "../cc/LiveTaskCard.svelte";

  let { taskId }: A2uiComponentProps = $props();
</script>

<LiveTaskCard taskId={String(taskId ?? "")} />
