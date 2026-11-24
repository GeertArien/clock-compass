#!/usr/bin/env node
// Clock & Compass MCP server — stdio entry point.
//
// Usage (e.g. in an MCP client config):
//   DATABASE_URL=file:/path/to/clock-compass.db clock-compass-mcp
//   … --app   also serves the MCP App: the screens drawn inside the host (#118)
//
// A thin adapter over @clock-compass/core; see server.ts.
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaAiSettingsRepository, policyFromSwitches, prisma } from "@clock-compass/core";
import { buildMcpServer, defaultServices } from "./server.js";

// The data switches of Settings → AI (#94), read on every call: MCP follows
// the same policy as the in-app assistant (#117).
const aiSettings = new PrismaAiSettingsRepository(prisma);
// The App page: one self-contained file built by apps/web (pnpm build).
const APP_HTML = new URL("../../../apps/web/dist-mcp-app/index.html", import.meta.url);
const server = buildMcpServer(defaultServices(), {
  policy: async () => policyFromSwitches(await aiSettings.listSwitches()),
  ...(process.argv.includes("--app") ? { app: { html: () => readFileSync(APP_HTML, "utf8") } } : {}),
});
await server.connect(new StdioServerTransport());
