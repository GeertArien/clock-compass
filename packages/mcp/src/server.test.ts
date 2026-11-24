import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OPERATION_LIST, mcpToolName } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY, RenewalService, TaskService, type DataPolicy } from "@clock-compass/core";
import { FakeHabitRepository, FakeTaskRepository } from "@clock-compass/core/testing";
import { buildMcpServer, type McpOptions, type Services } from "./server.js";
import pinned from "./tools.json" with { type: "json" };

/** A real MCP client over an in-memory transport. */
async function connect(services?: Services, options?: McpOptions) {
  const server = buildMcpServer(services, options);
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
    const { tasks } = result(await client.callTool({ name: "list_tasks", arguments: { status: "DONE" } })) as {
      tasks: { title: string; status: string; dueDate: string }[];
    };
    expect(tasks.map((t) => [t.title, t.status, t.dueDate])).toEqual([["File taxes", "DONE", "2027-04-01"]]);
    await close();
  });

  it("refuses in the app's words, the same as the endpoint", async () => {
    const { client, close } = await connect(memoryServices());
    const gone = await client.callTool({ name: "set_task_done", arguments: { taskId: "gone", done: true } });
    expect(gone.isError).toBe(true);
    expect(JSON.stringify(gone.content)).toContain("That task no longer exists.");
    await close();
  });

  it("keeps a recurring task's weekday when completed over MCP in the server's zone (#112, the #116 case)", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "Europe/Brussels";
    try {
      const services = memoryServices();
      const { client, close } = await connect(services);
      // Thursday 26 November in Brussels, every week.
      const created = result(
        await client.callTool({
          name: "create_task",
          arguments: { title: "Bins out", scheduledDay: "2026-11-26", repeat: { unit: "WEEK", every: 1, from: "SCHEDULE", leadDays: null } },
        }),
      );
      const first = await services.tasks.get(created.id as string);
      expect(first?.scheduledDay?.toISOString()).toBe("2026-11-25T23:00:00.000Z");
      expect(result(await client.callTool({ name: "set_task_done", arguments: { taskId: created.id, done: true } }))).toEqual({ changed: 1 });
      const next = (await services.tasks.list({ status: "TODO" })).find((t) => t.previousId === created.id);
      // Thursday 3 December in Brussels, not Wednesday 2 December.
      expect(next?.scheduledDay?.toISOString()).toBe("2026-12-02T23:00:00.000Z");
      await close();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

});

describe("one set of reads with the assistant, under one data policy (#117)", () => {
  const PERSON_NOTE = "MARKER-PERSON-NOTE";
  const EBA_NOTE = "MARKER-EBA-NOTE";
  /** People with notes on the person and on a bank-account entry; the rest empty. */
  function peopleServices(): Services {
    const person = {
      id: "p1",
      name: "Sam",
      relationship: "kid",
      notes: PERSON_NOTE,
      balance: 2,
      ledger: [{ id: "e1", kind: "DEPOSIT", note: EBA_NOTE, occurredAt: "2026-11-20T10:00:00.000Z" }],
      commitments: [
        {
          id: "c1",
          title: "Monthly adventure",
          cadenceUnit: "MONTH",
          cadenceValue: 1,
          status: "OVERDUE",
          lastOccurredAt: "2026-09-01T10:00:00.000Z",
          nextDueAt: "2026-10-01T10:00:00.000Z",
          history: [true, false],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    return {
      ...memoryServices(),
      people: { overview: async () => [person] },
      goals: { list: async () => [] },
      projects: { list: async () => [] },
      roles: { list: async () => [] },
      mission: { getActive: async () => null },
    } as unknown as Services;
  }
  const policyWith = (changes: Partial<DataPolicy>) => () => ({ ...DEFAULT_DATA_POLICY, ...changes });
  const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]!.text;

  it("returns no notes from any read with both notes switches off (the default)", async () => {
    const { client, close } = await connect(peopleServices());
    const { tools } = await client.listTools();
    const reads = tools.filter((t) => t.annotations?.readOnlyHint);
    expect(reads.map((t) => t.name).sort()).toEqual(
      ["big_rocks_this_week", "get_compass", "list_habits", "list_people", "list_tasks", "renewal_overview"],
    );
    for (const read of reads) {
      const answer = await client.callTool({ name: read.name, arguments: {} });
      expect(answer.isError, read.name).toBeFalsy();
      expect(text(answer), read.name).not.toContain("MARKER");
    }
    await close();
  });

  it("returns the notes only from list_people, and only the kind switched on", async () => {
    const { client, close } = await connect(peopleServices(), { policy: policyWith({ personNotes: true }) });
    const people = text(await client.callTool({ name: "list_people", arguments: {} }));
    expect(people).toContain(PERSON_NOTE);
    expect(people).not.toContain(EBA_NOTE);
    for (const name of ["list_tasks", "big_rocks_this_week", "get_compass", "list_habits", "renewal_overview"]) {
      expect(text(await client.callTool({ name, arguments: {} })), name).not.toContain("MARKER");
    }
    await close();
  });

  it("refuses a read whose data is not shared, and a write whose category is off", async () => {
    const { client, close } = await connect(peopleServices(), { policy: policyWith({ people: false, tasks: false }) });
    const read = await client.callTool({ name: "list_people", arguments: {} });
    expect(read.isError).toBe(true);
    expect(text(read)).toMatch(/not shared/);
    const write = await client.callTool({ name: "create_task", arguments: { title: "Call the plumber" } });
    expect(write.isError).toBe(true);
    expect(text(write)).toMatch(/not shared/);
    await close();
  });

  it("sends the same answer as text and as structured content", async () => {
    const { client, close } = await connect(peopleServices());
    const people = await client.callTool({ name: "list_people", arguments: { status: "OVERDUE" } });
    expect(people.structuredContent).toEqual({ items: JSON.parse(text(people)) });
    const compass = await client.callTool({ name: "get_compass", arguments: {} });
    expect(compass.structuredContent).toEqual(JSON.parse(text(compass)));
    await close();
  });
});
