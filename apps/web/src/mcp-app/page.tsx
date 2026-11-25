import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadOnlyContext } from "@/lib/read-only";
import { createPageQueryClient, seedReads } from "./data";
import { ScreenPage, screenStateOf, type ScreenState } from "./ScreenPage";

/** The host's theme, on the page's own colours (not the host's). */
export function applyTheme(theme: "light" | "dark" | undefined): void {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Wire the page to its host through the SDK's `App`: each tool result is
 * drawn (its reads first filling the page's cache, the data port of step 2),
 * the components are read-only, and the host's theme is followed. `transport` is for tests (an
 * in-memory pair with the SDK's AppBridge); the page itself lets the SDK find
 * the host's window.
 */
export async function startPage(root: HTMLElement, app: App, transport?: Transport): Promise<void> {
  const queryClient = createPageQueryClient();
  seedReads(queryClient, []);
  const reactRoot = createRoot(root);
  let state: ScreenState = { kind: "waiting" };
  const draw = () =>
    reactRoot.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ReadOnlyContext.Provider value={true}>
            <ScreenPage state={state} />
          </ReadOnlyContext.Provider>
        </QueryClientProvider>
      </StrictMode>,
    );

  app.addEventListener("toolresult", (result) => {
    state = screenStateOf(result);
    if (state.kind === "screen") seedReads(queryClient, state.reads);
    draw();
  });
  app.addEventListener("hostcontextchanged", (context) => {
    if (context.theme) applyTheme(context.theme);
  });

  draw();
  await app.connect(transport);
  applyTheme(app.getHostContext()?.theme);
}
