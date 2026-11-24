#!/usr/bin/env node
// Clock & Compass MCP server — stdio entry point.
//
// Usage (e.g. in an MCP client config):
//   DATABASE_URL=file:/path/to/clock-compass.db clock-compass-mcp
//
// A thin adapter over @clock-compass/core; see server.ts.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaAiSettingsRepository, policyFromSwitches, prisma } from "@clock-compass/core";
import { buildMcpServer, defaultServices } from "./server.js";

// The data switches of Settings → AI (#94), read on every call: MCP follows
// the same policy as the in-app assistant (#117).
const aiSettings = new PrismaAiSettingsRepository(prisma);
const server = buildMcpServer(defaultServices(), {
  policy: async () => policyFromSwitches(await aiSettings.listSwitches()),
});
await server.connect(new StdioServerTransport());
