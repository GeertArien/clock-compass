<script lang="ts">
  import LiveTaskCard from "../../cc/LiveTaskCard.svelte";

  let { taskId }: { taskId?: string } = $props();
</script>

<LiveTaskCard taskId={taskId ?? ""} />
