<script lang="ts">
  /** Candidate C: official `@a2ui/web_core` protocol core + our Svelte adapter. */
  import {
    MessageProcessor,
    type ComponentApi,
    type SurfaceModel,
  } from "@a2ui/web_core/v1_0";
  import type { A2uiMessage } from "../fixtures";
  import { ccCatalog } from "./catalog";
  import A2uiSurface from "./A2uiSurface.svelte";
  import type { Implementations } from "./A2uiNode.svelte";
  import Button from "./components/Button.svelte";
  import Card from "./components/Card.svelte";
  import CheckBox from "./components/CheckBox.svelte";
  import Column from "./components/Column.svelte";
  import ConfirmBar from "./components/ConfirmBar.svelte";
  import Divider from "./components/Divider.svelte";
  import List from "./components/List.svelte";
  import Row from "./components/Row.svelte";
  import TaskCard from "./components/TaskCard.svelte";
  import Text from "./components/Text.svelte";
  import TextField from "./components/TextField.svelte";

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

  const implementations: Implementations = {
    Button, Card, CheckBox, Column, ConfirmBar, Divider, List, Row, TaskCard, Text, TextField,
  };

  let surface = $state.raw<SurfaceModel<ComponentApi>>();

  // svelte-ignore state_referenced_locally
  {
    const processor = new MessageProcessor<ComponentApi>([ccCatalog]);
    processor.onSurfaceCreated((s) => {
      if (s.id !== surfaceId) return;
      surface = s;
      s.onAction.subscribe((action) => onoutbound({ version: "1.0", action }));
    });
    try {
      processor.processMessages(messages as never);
    } catch (err) {
      onerror(err instanceof Error ? err.message : String(err));
    }
  }
</script>

{#if surface}
  <A2uiSurface {surface} {implementations} />
{/if}
