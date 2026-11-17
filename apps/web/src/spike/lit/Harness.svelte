<script lang="ts">
  /** Candidate B: official `@a2ui/lit` surface + official basic-catalog elements. */
  import "@a2ui/lit";
  import { MessageProcessor, basicCatalog, injectBasicCatalogStyles } from "@a2ui/web_core/v1_0";
  import type { A2uiMessage } from "../fixtures";
  import { litCatalog } from "./elements";

  let {
    messages,
    surfaceId,
    onoutbound,
    onerror,
  }: {
    messages: A2uiMessage[];
    surfaceId: string;
    onoutbound: (m: unknown) => void;
    onerror: (m: string) => void;
  } = $props();

  injectBasicCatalogStyles();

  let host = $state<HTMLElement>();

  $effect(() => {
    if (!host) return;
    const target = host;
    const processor = new MessageProcessor([litCatalog, basicCatalog as unknown as typeof litCatalog]);
    processor.onSurfaceCreated((s) => {
      if (s.id !== surfaceId) return;
      s.onAction.subscribe((action) => onoutbound({ version: "1.0", action }));
      const el = document.createElement("a2ui-surface") as HTMLElement & { surface: unknown };
      el.surface = s;
      target.replaceChildren(el);
    });
    try {
      processor.processMessages(messages as never);
    } catch (err) {
      onerror(err instanceof Error ? err.message : String(err));
    }
  });
</script>

<div bind:this={host}></div>
