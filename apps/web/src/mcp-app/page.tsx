import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadOnlyContext } from "@/lib/read-only";
import { createPageQueryClient, seedReads } from "./data";
import { ScreenPage, screenStateOf, type ScreenState } from "./ScreenPage";
import { createPageProposals, seedDrafts, type PageProposals } from "./proposals";
import { ProposalFields } from "./ProposalFields";

/** The host's theme, on the page's own colours (not the host's). */
export function applyTheme(theme: "light" | "dark" | undefined): void {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Wire the page to its host through the SDK's `App`: each tool result is
 * drawn (its reads first filling the page's cache, the data port of step 2),
 * the components are read-only, a proposal's card can be edited and its
 * Confirm writes through the host (step 3, #159), and the host's theme is
 * followed. `transport` is for tests (an
 * in-memory pair with the SDK's AppBridge); the page itself lets the SDK find
 * the host's window.
 */
export async function startPage(root: HTMLElement, app: App, transport?: Transport): Promise<void> {
  const queryClient = createPageQueryClient();
  seedReads(queryClient, []);
  const reactRoot = createRoot(root);
  let state: ScreenState = { kind: "waiting" };
  let proposals: PageProposals | null = null;
  // The host's tool calls, and its model context where it offers one (step 3).
  const port = {
    callServerTool: (params: { name: string; arguments?: Record<string, unknown> }) => app.callServerTool(params),
    tellModel: (text: string) =>
      app.getHostCapabilities()?.updateModelContext ? app.updateModelContext({ content: [{ type: "text", text }] }) : Promise.resolve(),
  };
  const draw = () =>
    reactRoot.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ReadOnlyContext.Provider value={true}>
            <ScreenPage state={state} proposals={proposals} />
          </ReadOnlyContext.Provider>
        </QueryClientProvider>
      </StrictMode>,
    );

  app.addEventListener("toolresult", (result) => {
    state = screenStateOf(result);
    proposals = null;
    if (state.kind === "screen") {
      seedReads(queryClient, state.reads);
      seedDrafts(queryClient, state.changes);
      if (state.changes.length) proposals = createPageProposals(state.changes, port, queryClient, { Fields: ProposalFields });
    }
    draw();
  });
  app.addEventListener("hostcontextchanged", (context) => {
    if (context.theme) applyTheme(context.theme);
  });

  draw();
  await app.connect(transport);
  applyTheme(app.getHostContext()?.theme);
}
