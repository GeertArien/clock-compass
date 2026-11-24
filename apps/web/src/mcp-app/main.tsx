/**
 * The MCP App page (issue #118): the assistant's screens inside an outside
 * MCP host (Claude Desktop first). Built into one self-contained HTML file
 * (`vite.mcp-app.config.ts`) that the MCP program serves as
 * `ui://clock-compass/screen`.
 *
 * The host passes the screen tool's result; its `structuredContent.messages`
 * are A2UI messages the server built and validated, drawn here with the app's
 * own renderer and components. Step 1 needs no other data: the page makes no
 * network request of its own (its content-security policy allows none). The
 * SDK's `App` does the frame messaging.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "@modelcontextprotocol/ext-apps";
import { createQueryClient } from "@/lib/query-client";
import { ScreenPage, type ScreenState } from "./ScreenPage";
import "./page.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

let state: ScreenState = { kind: "waiting" };
const queryClient = createQueryClient();
const reactRoot = createRoot(root);
const draw = () =>
  reactRoot.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ScreenPage state={state} />
      </QueryClientProvider>
    </StrictMode>,
  );

/** The host's theme, on the page's own colours (not the host's). */
function applyTheme(theme: "light" | "dark" | undefined) {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const app = new App({ name: "Clock & Compass", version: "1.0.0" }, {}, { autoResize: true });
app.addEventListener("toolresult", (result) => {
  state = ScreenPageResult(result);
  draw();
});
app.addEventListener("hostcontextchanged", (context) => {
  if (context.theme) applyTheme(context.theme);
});

draw();
await app.connect();
applyTheme(app.getHostContext()?.theme);

/** What a tool result means for the page. */
function ScreenPageResult(result: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown[] }): ScreenState {
  if (result.isError) {
    const text = (result.content ?? []).map((c) => (c as { text?: string }).text ?? "").join(" ").trim();
    return { kind: "error", message: text || "The screen could not be shown." };
  }
  const messages = result.structuredContent?.messages;
  return Array.isArray(messages) ? { kind: "screen", messages } : { kind: "error", message: "The screen could not be shown." };
}
