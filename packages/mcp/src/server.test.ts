import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OPERATION_LIST, PROPOSABLE, mcpToolName, validatePayload } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY, RenewalService, TaskService, createProposalSigner, type DataPolicy } from "@clock-compass/core";
import { FakeHabitRepository, FakeTaskRepository } from "@clock-compass/core/testing";
import { buildMcpServer, type McpOptions, type Services } from "./server.js";
import pinned from "./tools.json" with { type: "json" };

/** A real MCP client over an in-memory transport. */
async function connect(services?: Services, options?: McpOptions) {
  // No database here: the fallback zone is given, UTC unless a test says otherwise.
  const server = buildMcpServer(services, { timeZone: () => "UTC", ...options });
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

  it("keeps a recurring task's weekday over MCP in any server zone, with no TZ set (#136, the #116 case)", async () => {
    for (const zone of ["UTC", "Europe/Brussels", "America/New_York"]) {
      const services = memoryServices();
      const { client, close } = await connect(services, { timeZone: () => zone });
      // Thursday 26 November, every week.
      const created = result(
        await client.callTool({
          name: "create_task",
          arguments: { title: "Bins out", scheduledDay: "2026-11-26", repeat: { unit: "WEEK", every: 1, from: "SCHEDULE", leadDays: null } },
        }),
      );
      const first = await services.tasks.get(created.id as string);
      expect(first?.scheduledDay?.toISOString(), zone).toBe("2026-11-26T00:00:00.000Z");
      expect(result(await client.callTool({ name: "set_task_done", arguments: { taskId: created.id, done: true } }))).toEqual({ changed: 1 });
      const next = (await services.tasks.list({ status: "TODO" })).find((t) => t.previousId === created.id);
      // Thursday 3 December, not Wednesday 2 December.
      expect(next?.scheduledDay?.toISOString(), zone).toBe("2026-12-03T00:00:00.000Z");
      // And it reads as that day.
      const { tasks } = result(await client.callTool({ name: "list_tasks", arguments: { status: "TODO" } })) as { tasks: { scheduledDay: string }[] };
      expect(tasks.map((t) => t.scheduledDay), zone).toEqual(["2026-12-03"]);
      await close();
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

  it("refuses an argument a tool does not know, on a read and on a write (#132 review)", async () => {
    const { client, close } = await connect(peopleServices());
    const read = await client.callTool({ name: "list_tasks", arguments: { quadrnt: "Q2" } });
    expect(read.isError).toBe(true);
    expect(text(read)).toMatch(/quadrnt/);
    const write = await client.callTool({ name: "set_task_done", arguments: { taskId: "t1", done: false, nope: 1 } });
    expect(write.isError).toBe(true);
    expect(text(write)).toMatch(/nope/);
    expect((await client.callTool({ name: "list_tasks", arguments: { quadrant: "Q2" } })).isError).toBeFalsy();
    await close();
  });
});

describe("the MCP App, step 1 (#118)", () => {
  const html = "<!doctype html><title>page</title>";
  const withApp = () => connect(memoryServices(), { app: { html: () => html } });

  it("serves the page as a ui:// resource with its content-security policy", async () => {
    const { client, close } = await withApp();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["ui://clock-compass/screen"]);
    const read = await client.readResource({ uri: "ui://clock-compass/screen" });
    expect(read.contents[0]).toMatchObject({
      uri: "ui://clock-compass/screen",
      mimeType: "text/html;profile=mcp-app",
      text: html,
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] } } },
    });
    await close();
  });

  it("offers show_week pointing to the page, the reads, and no write the model can see", async () => {
    const { client, close } = await withApp();
    const { tools } = await client.listTools();
    const week = tools.find((t) => t.name === "show_week");
    expect(week?.annotations).toEqual({ readOnlyHint: true });
    expect(week?._meta).toMatchObject({ ui: { resourceUri: "ui://clock-compass/screen" } });
    // Every write is the page's (step 3): the model sees only reads and screens.
    const forModel = tools.filter((t) => !(t._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility?.every((v) => v === "app"));
    expect(forModel.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.map((t) => t.name)).toContain("list_tasks");
    await close();
  });

  it("answers a summary for the model and valid A2UI messages for the page", async () => {
    const { client, close } = await withApp();
    const answer = await client.callTool({ name: "show_week", arguments: {} });
    expect(answer.isError).toBeFalsy();
    expect((answer.content as { text: string }[])[0]!.text).toMatch(/^This week \(.+ \d{4}, UTC\): No big rocks pinned\. Nothing is scheduled\.$/);
    const { messages } = answer.structuredContent as { messages: unknown[] };
    expect(validatePayload(messages)).toEqual({ ok: true });
    await close();
  });

  it("refuses the screen when tasks are not shared, and a week that is not a Monday", async () => {
    const off = await connect(memoryServices(), { app: { html: () => html }, policy: () => ({ ...DEFAULT_DATA_POLICY, tasks: false }) });
    expect((await off.client.callTool({ name: "show_week", arguments: {} })).isError).toBe(true);
    await off.close();
    const { client, close } = await withApp();
    expect((await client.callTool({ name: "show_week", arguments: { week: "2026-11-25" } })).isError).toBe(true);
    expect((await client.callTool({ name: "show_week", arguments: { wek: "2026-11-23" } })).isError).toBe(true);
    await close();
  });

  it("offers the step-2 screens, each pointing to the page; the matrix and habits carry their reads (#118)", async () => {
    const { client, close } = await withApp();
    const { tools } = await client.listTools();
    for (const name of ["show_matrix", "show_habits", "show_people"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations).toEqual({ readOnlyHint: true });
      expect(tool?._meta).toMatchObject({ ui: { resourceUri: "ui://clock-compass/screen" } });
    }
    const matrix = await client.callTool({ name: "show_matrix", arguments: {} });
    expect(matrix.isError).toBeFalsy();
    const { messages, reads } = matrix.structuredContent as { messages: unknown[]; reads: { name: string }[] };
    expect(validatePayload(messages)).toEqual({ ok: true });
    expect(reads.map((r) => r.name)).toContain("listTasks");
    const habits = await client.callTool({ name: "show_habits", arguments: {} });
    expect((habits.structuredContent as { reads: { name: string }[] }).reads.map((r) => r.name)).toEqual(["listHabits"]);
    await close();
  });

  it("without --app: no resources and no screen tools (the tool list stays as pinned)", async () => {
    const { client, close } = await connect(memoryServices());
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["show_week", "show_matrix", "show_habits", "show_people"]) expect(names).not.toContain(name);
    await close();
  });
});


describe("the MCP App, step 3: proposals confirmed in the page (#118)", () => {
  const html = "<!doctype html><title>page</title>";
  const withApp = (services = memoryServices(), options: McpOptions = {}) => connect(services, { app: { html: () => html }, ...options });
  type Change = { id: string; tool: string; sentence: string; arguments: Record<string, unknown>; taskChanges: unknown[] };
  const proposed = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.structuredContent as { changes: Change[] }).changes;
  const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]!.text;

  async function withTask() {
    const services = memoryServices();
    const task = await services.tasks.create({ title: "Call the plumber", important: true, urgent: false });
    return { services, task };
  }

  it("guard 1: registers only the operations that may be proposed, visible to the page only; no delete", async () => {
    const { client, close } = await withApp();
    const { tools } = await client.listTools();
    const writes = tools.filter((t) => t.annotations?.readOnlyHint === false);
    expect(writes.map((t) => t.name).sort()).toEqual(PROPOSABLE.map((op) => mcpToolName(op.name)).sort());
    expect(writes.map((t) => t.name)).not.toContain("delete_task");
    expect(tools.map((t) => t.name)).not.toContain("delete_task");
    for (const tool of writes) {
      expect(tool._meta, tool.name).toEqual({ ui: { visibility: ["app"] } });
      expect(tool.inputSchema.required, tool.name).toContain("proposal");
    }
    const propose = tools.find((t) => t.name === "propose_changes");
    expect(propose?.annotations).toEqual({ readOnlyHint: true });
    expect(propose?._meta).toMatchObject({ ui: { resourceUri: "ui://clock-compass/screen" } });
    await close();
  });

  it("guard 2: a write without the proof of a shown change is refused, and nothing is written", async () => {
    const { services, task } = await withTask();
    const { client, close } = await withApp(services);
    const direct = await client.callTool({ name: "set_task_done", arguments: { taskId: task.id, done: true } });
    expect(direct.isError).toBe(true);
    const forged = await client.callTool({ name: "set_task_done", arguments: { taskId: task.id, done: true, proposal: "AAAA" } });
    expect(forged.isError).toBe(true);
    expect(text(forged)).toMatch(/Only a change shown by propose_changes/);
    expect((await services.tasks.get(task.id))?.status).toBe("TODO");
    await close();
  });

  it("propose_changes writes nothing and shows each change with the app's sentence; Confirm's arguments then write it", async () => {
    const { services, task } = await withTask();
    const { client, close } = await withApp(services);
    const answer = await client.callTool({
      name: "propose_changes",
      arguments: { changes: [{ operation: "setTaskDone", input: { taskId: task.id, done: true } }] },
    });
    expect(answer.isError).toBeFalsy();
    expect(text(answer)).toBe("Shown to the user to confirm; nothing changes until they press Confirm on a card: 1. Mark “Call the plumber” done.");
    const { messages } = answer.structuredContent as { messages: unknown[] };
    expect(validatePayload(messages)).toEqual({ ok: true });
    expect((await services.tasks.get(task.id))?.status).toBe("TODO");

    const [change] = proposed(answer);
    expect(change).toMatchObject({ tool: "set_task_done", sentence: "Mark “Call the plumber” done", arguments: { taskId: task.id, done: true, proposal: expect.any(String) } });
    const confirmed = await client.callTool({ name: change!.tool, arguments: change!.arguments });
    expect(result(confirmed)).toEqual({ changed: 1 });
    expect((await services.tasks.get(task.id))?.status).toBe("DONE");
    await close();
  });

  it("guard 2: a shown change with anything altered is refused (another task, another operation, another key)", async () => {
    const { services, task } = await withTask();
    const other = await services.tasks.create({ title: "Other", important: false, urgent: false });
    const { client, close } = await withApp(services);
    const answer = await client.callTool({
      name: "propose_changes",
      arguments: {
        changes: [
          { operation: "set_task_done", input: { taskId: task.id, done: true } },
          { operation: "createTask", input: { title: "File taxes" } },
        ],
      },
    });
    const [done, create] = proposed(answer);
    const refused = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(args)).toBe(true);
    };
    await refused("set_task_done", { ...done!.arguments, taskId: other.id });
    await refused("set_task_done", { ...done!.arguments, done: false });
    await refused("set_big_rock", { taskId: task.id, bigRock: true, proposal: done!.arguments.proposal });
    await refused("create_task", { ...create!.arguments, idempotencyKey: "model-chosen-key-1" });
    await refused("create_task", { ...create!.arguments, title: "Something else" });
    expect((await services.tasks.list({})).map((t) => t.title).sort()).toEqual(["Call the plumber", "Other"]);
    expect((await services.tasks.get(task.id))?.status).toBe("TODO");
    await close();
  });

  it("the key comes from the server: the same tool result confirmed twice (a redraw) creates one item", async () => {
    const services = memoryServices();
    const { client, close } = await withApp(services);
    const answer = await client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "createTask", input: { title: "File taxes", important: true } }] } });
    const [change] = proposed(answer);
    expect(change!.arguments.idempotencyKey).toMatch(/^proposal-/);
    const first = result(await client.callTool({ name: "create_task", arguments: change!.arguments }));
    const again = result(await client.callTool({ name: "create_task", arguments: change!.arguments }));
    expect(first).toMatchObject({ changed: 1 });
    expect(again).toEqual({ changed: 0, id: first.id });
    expect((await services.tasks.list({})).map((t) => t.title)).toEqual(["File taxes"]);
    // A second proposal of the same task is a new proposal with a key of its own.
    const second = proposed(await client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "createTask", input: { title: "File taxes", important: true } }] } }));
    expect(second[0]!.arguments.idempotencyKey).not.toBe(change!.arguments.idempotencyKey);
    await close();
  });

  it("refuses what may never be proposed, unknown operations and failed checks, with the reason; shows the rest", async () => {
    const { services, task } = await withTask();
    const { client, close } = await withApp(services);
    const answer = await client.callTool({
      name: "propose_changes",
      arguments: {
        changes: [
          { operation: "deleteTask", input: { taskId: task.id } },
          { operation: "createApiKey", input: { name: "x" } },
          { operation: "setTaskDone", input: { taskId: "missing", done: true } },
          { operation: "setBigRock", input: { taskId: task.id, bigRock: true } },
        ],
      },
    });
    expect(answer.isError).toBeFalsy();
    expect(proposed(answer).map((c) => c.tool)).toEqual(["set_big_rock"]);
    expect(text(answer)).toContain("Not shown: 1. deleteTask: this cannot be proposed");
    expect(text(answer)).toContain("2. createApiKey: this cannot be proposed");
    expect(text(answer)).toContain("3. setTaskDone: That task no longer exists.");
    const none = await client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "deleteTask", input: { taskId: task.id } }] } });
    expect(none.isError).toBe(true);
    expect((await services.tasks.get(task.id))?.status).toBe("TODO");
    await close();
  });

  it("the data switches: a change whose category is off is not shown, and a shown one is refused once switched off", async () => {
    const { services, task } = await withTask();
    let policy: DataPolicy = DEFAULT_DATA_POLICY;
    const { client, close } = await withApp(services, { policy: () => policy });
    const answer = await client.callTool({
      name: "propose_changes",
      arguments: {
        changes: [
          { operation: "setTaskDone", input: { taskId: task.id, done: true } },
          { operation: "createTask", input: { title: "With notes", notes: "private words" } },
        ],
      },
    });
    expect(proposed(answer)).toHaveLength(2);
    policy = { ...DEFAULT_DATA_POLICY, taskNotes: false };
    const notes = await client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "createTask", input: { title: "With notes", notes: "private words" } }] } });
    expect(notes.isError).toBe(true);
    expect(text(notes)).toBe("Nothing was shown. 1. createTask: Notes on tasks are not shared with AI: leave them out.");
    // Shown while tasks were shared, confirmed after they were switched off.
    policy = { ...DEFAULT_DATA_POLICY, tasks: false };
    const late = await client.callTool({ name: "set_task_done", arguments: proposed(answer)[0]!.arguments });
    expect(late.isError).toBe(true);
    expect(text(late)).toBe("This changes data the user has not shared with AI.");
    expect((await services.tasks.get(task.id))?.status).toBe("TODO");
    await close();
  });

  it("a proof from another process (another secret: a restart) is refused", async () => {
    const { services, task } = await withTask();
    const before = await withApp(services, { signer: createProposalSigner(Buffer.alloc(32, 1)) });
    const [change] = proposed(await before.client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "setTaskDone", input: { taskId: task.id, done: true } }] } }));
    await before.close();
    const after = await withApp(services, { signer: createProposalSigner(Buffer.alloc(32, 2)) });
    expect((await after.client.callTool({ name: "set_task_done", arguments: change!.arguments })).isError).toBe(true);
    await after.close();
  });

  it("without the App, the writes stay the model's, also refused when a note's own switch is off", async () => {
    const { client, close } = await connect(memoryServices(), { policy: () => ({ ...DEFAULT_DATA_POLICY, taskNotes: false }) });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("propose_changes");
    expect(names).toContain("delete_task");
    const noted = await client.callTool({ name: "create_task", arguments: { title: "x", notes: "y" } });
    expect(noted.isError).toBe(true);
    expect((await client.callTool({ name: "create_task", arguments: { title: "x" } })).isError).toBeFalsy();
    await close();
  });
});
