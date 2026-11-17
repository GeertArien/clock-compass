<script lang="ts">
  /** Candidate A: the community Svelte 5 renderer, `svelte-a2ui` 0.2.0. */
  import {
    A2uiClient,
    Surface,
    basicCatalog,
    createCatalogRegistry,
    createMockTransport,
    type AgentToRenderer,
    type Catalog,
  } from "svelte-a2ui";
  import "svelte-a2ui/theme.css";
  import { CC_CATALOG_ID, type A2uiMessage } from "../fixtures";
  import TaskCardEntry from "./TaskCardEntry.svelte";
  import ConfirmBarEntry from "./ConfirmBarEntry.svelte";

  let {
    messages,
    surfaceId,
    onoutbound,
  }: { messages: A2uiMessage[]; surfaceId: string; onoutbound: (m: unknown) => void } = $props();

  // Our catalog: the renderer's own layout primitives plus our two components.
  const ccCatalog: Catalog = {
    id: CC_CATALOG_ID,
    components: {
      ...basicCatalog.components,
      TaskCard: { component: TaskCardEntry },
      ConfirmBar: { component: ConfirmBarEntry, actions: ["confirm", "dismiss"] },
    },
  };
  const catalog = createCatalogRegistry([basicCatalog, ccCatalog]);

  // svelte-ignore state_referenced_locally
  const client = new A2uiClient({
    transport: createMockTransport(messages as unknown as AgentToRenderer[], {
      onSend: (m) => onoutbound(m),
    }),
  });
  client.start();
</script>

<Surface {client} {catalog} {surfaceId}>
  {#snippet pending()}
    <p class="text-sm text-[var(--color-muted-foreground)]">Waiting for the surface…</p>
  {/snippet}
</Surface>
