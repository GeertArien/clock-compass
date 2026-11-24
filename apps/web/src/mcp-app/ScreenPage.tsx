import { useMemo } from "react";
import type { A2uiMessage } from "@clock-compass/assistant-catalog";
import { A2uiSurfaces, createProcessor, processMessages } from "@/assistant/a2ui/renderer";

export type ScreenState =
  | { kind: "waiting" }
  | { kind: "screen"; messages: unknown[] }
  | { kind: "error"; message: string };

/** What a screen tool's result means for the page. */
export function screenStateOf(result: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown[] }): ScreenState {
  if (result.isError) {
    const text = (result.content ?? []).map((c) => (c as { text?: string }).text ?? "").join(" ").trim();
    return { kind: "error", message: text || "The screen could not be shown." };
  }
  const messages = result.structuredContent?.messages;
  return Array.isArray(messages) ? { kind: "screen", messages } : { kind: "error", message: "The screen could not be shown." };
}

/**
 * One screen drawn from a tool result. Step 1 is read-only: a user action on
 * the screen does nothing yet (proposals with Confirm come in step 3).
 */
export function ScreenPage({ state }: { state: ScreenState }) {
  const processor = useMemo(() => {
    if (state.kind !== "screen") return null;
    const p = createProcessor(() => {});
    processMessages(p, state.messages as A2uiMessage[]);
    return p;
  }, [state]);

  return (
    <main className="mx-auto w-full max-w-xl p-3 font-sans">
      {state.kind === "waiting" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      )}
      {processor && <A2uiSurfaces processor={processor} />}
    </main>
  );
}
