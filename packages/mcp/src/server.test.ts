import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OPERATION_LIST, mcpToolName } from "@clock-compass/assistant-catalog";
import { RenewalService, TaskService } from "@clock-compass/core";
import { FakeHabitRepository, FakeTaskRepository } from "@clock-compass/core/testing";
import { buildMcpServer, type Services } from "./server.js";
import pinned from "./tools.json" with { type: "json" };

/** A real MCP client over an in-memory transport. */
async function connect(services?: Services) {
  const server = buildMcpServer(services);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The tool list a client sees (no database touched). */
async function listTools() {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  await close();
  return tools;
}

/** Tasks and habits on the real services over in-memory repositories. */
function memoryServices(): Services {
  return {
    tasks: new TaskService(new FakeTaskRepository()),
    renewal: new RenewalService(new FakeHabitRepository()),
  } as unknown as Services;
}

const result = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((r.content as { type: string; text: string }[])[0]!.text) as Record<string, unknown>;

describe("clock-compass MCP server", () => {
  it("offers exactly the pinned tools: names, descriptions, input schemas and annotations (tools.json, #109 step 3)", async () => {
    const tools = await listTools();
    const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(tools).map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }))).toEqual(
      byName(pinned),
    );
  });

  it("is one set with the assistant: every write tool is an operation, named by rule, with its annotations", async () => {
    const tools = await listTools();
    const writes = new Map(OPERATION_LIST.filter((op) => op.mcp).map((op) => [mcpToolName(op.name), op]));
    expect(writes.size).toBe(15);
    for (const tool of tools) {
      const op = writes.get(tool.name);
      if (op) expect(tool.annotations, tool.name).toEqual(op.hints);
      else expect(tool.annotations, tool.name).toEqual({ readOnlyHint: true });
    }
    for (const name of writes.keys()) expect(tools.map((t) => t.name)).toContain(name);
    // Creates take a key; nothing else does.
    for (const tool of tools) {
      const op = writes.get(tool.name);
      expect("idempotencyKey" in (tool.inputSchema.properties ?? {}), tool.name).toBe(!!op?.creates);
    }
  });

  it("creates once per idempotencyKey, and sets a task done as a target state", async () => {
    const { client, close } = await connect(memoryServices());
    const args = { title: "File taxes", important: true, dueDate: "2027-04-01", idempotencyKey: "mcp-call-0001" };
    const first = result(await client.callTool({ name: "create_task", arguments: args }));
    expect(first).toMatchObject({ changed: 1, id: expect.any(String) });
    expect(result(await client.callTool({ name: "create_task", arguments: args }))).toEqual({ changed: 0, id: first.id });
    expect(result(await client.callTool({ name: "set_task_done", arguments: { taskId: first.id, done: true } }))).toEqual({ changed: 1 });
    expect(result(await client.callTool({ name: "set_task_done", arguments: { taskId: first.id, done: true } }))).toEqual({ changed: 0 });
    const tasks = JSON.parse(
      ((await client.callTool({ name: "list_tasks", arguments: {} })).content as { text: string }[])[0]!.text,
    ) as { title: string; status: string; dueDate: string }[];
    expect(tasks.map((t) => [t.title, t.status, t.dueDate])).toEqual([["File taxes", "DONE", "2027-04-01T00:00:00.000Z"]]);
    await close();
  });

  it("refuses in the app's words, the same as the endpoint", async () => {
    const { client, close } = await connect(memoryServices());
    const gone = await client.callTool({ name: "set_task_done", arguments: { taskId: "gone", done: true } });
    expect(gone.isError).toBe(true);
    expect(JSON.stringify(gone.content)).toContain("That task no longer exists.");
    await close();
  });
});
