import { useMemo } from "react";
import type { A2uiMessage } from "@clock-compass/assistant-catalog";
import { ConfirmHostContext } from "@/assistant/a2ui/components";
import { A2uiSurfaces, createProcessor, processMessages } from "@/assistant/a2ui/renderer";
import type { ScreenRead } from "./data";
import type { PageProposals, ProposedChange } from "./proposals";

export type ScreenState =
  | { kind: "waiting" }
  | { kind: "screen"; messages: unknown[]; reads: ScreenRead[]; changes: ProposedChange[] }
  | { kind: "error"; message: string };

/** What a screen tool's result means for the page. */
export function screenStateOf(result: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown[] }): ScreenState {
  if (result.isError) {
    const text = (result.content ?? []).map((c) => (c as { text?: string }).text ?? "").join(" ").trim();
    return { kind: "error", message: text || "The screen could not be shown." };
  }
  const messages = result.structuredContent?.messages;
  const reads = result.structuredContent?.reads;
  const changes = result.structuredContent?.changes;
  return Array.isArray(messages)
    ? {
        kind: "screen",
        messages,
        reads: Array.isArray(reads) ? (reads as ScreenRead[]) : [],
        changes: Array.isArray(changes) ? (changes as ProposedChange[]) : [],
      }
    : { kind: "error", message: "The screen could not be shown." };
}

/**
 * One screen drawn from a tool result. The live components show no control
 * that writes (the page turns `ReadOnlyContext` on); the only write is a
 * press on Confirm in a proposal's bar (step 3), which `proposals` carries out.
 */
export function ScreenPage({ state, proposals }: { state: ScreenState; proposals?: PageProposals | null }) {
  const processor = useMemo(() => {
    if (state.kind !== "screen") return null;
    const p = createProcessor((action) => proposals?.onAction(action));
    processMessages(p, state.messages as A2uiMessage[]);
    return p;
  }, [state, proposals]);

  return (
    <main className="mx-auto w-full max-w-xl p-3 font-sans">
      {state.kind === "waiting" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      )}
      {processor && (
        <ConfirmHostContext.Provider value={proposals?.host ?? null}>
          <A2uiSurfaces processor={processor} />
        </ConfirmHostContext.Provider>
      )}
    </main>
  );
}
