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
import { App } from "@modelcontextprotocol/ext-apps";
import { startPage } from "./page";
import "./page.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

await startPage(root, new App({ name: "Clock & Compass", version: "1.0.0" }, {}, { autoResize: true }));
