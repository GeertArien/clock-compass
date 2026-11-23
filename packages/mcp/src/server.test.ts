import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OPERATION_LIST } from "@clock-compass/assistant-catalog";
import { buildMcpServer } from "./server.js";
import before from "./tools-before-109.json" with { type: "json" };

/** The tool list a real MCP client sees, over an in-memory transport (no database touched). */
async function listTools() {
  const server = buildMcpServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

describe("clock-compass MCP server", () => {
  it("offers the same tools as before the operation registry: names, descriptions and input schemas (#109)", async () => {
    // tools-before-109.json is the tool list of main before #109, as a client saw it.
    const tools = await listTools();
    const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(tools).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual(byName(before));
  });

  it("marks every read tool read-only, and gives each write the registry's annotations", async () => {
    const tools = await listTools();
    const writes = new Map(OPERATION_LIST.filter((op) => op.mcp).map((op) => [op.name, op]));
    expect(writes.size).toBe(13);
    for (const tool of tools) {
      const op = writes.get(tool.name);
      if (op) expect(tool.annotations, tool.name).toEqual(op.hints);
      else expect(tool.annotations, tool.name).toEqual({ readOnlyHint: true });
    }
    expect(tools.find((t) => t.name === "delete_task")?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("does not offer the in-app assistant's actions as tools", async () => {
    const names = (await listTools()).map((t) => t.name);
    for (const op of OPERATION_LIST.filter((o) => !o.mcp)) expect(names).not.toContain(op.name);
  });
});
