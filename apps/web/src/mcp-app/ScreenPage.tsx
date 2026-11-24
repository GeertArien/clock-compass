import { useMemo } from "react";
import type { A2uiMessage } from "@clock-compass/assistant-catalog";
import { A2uiSurfaces, createProcessor, processMessages } from "@/assistant/a2ui/renderer";

export type ScreenState =
  | { kind: "waiting" }
  | { kind: "screen"; messages: unknown[] }
  | { kind: "error"; message: string };

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
