import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RenewalService, TaskService, TimeZoneService } from "@clock-compass/core";
import { FakeHabitRepository, FakeTaskRepository } from "@clock-compass/core/testing";
import type { Services } from "@clock-compass/mcp";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

/**
 * The MCP program at /api/mcp (#118), over real http with the SDK's own
 * client, on in-memory services. A client that declares MCP Apps gets the
 * App's tools; one that does not gets the reads and writes.
 */
const TOKEN = "test-token";
const UI = { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } };

describe("/api/mcp (#118)", () => {
  let app: FastifyInstance;
  let base: string;
  let tasks: TaskService;

  beforeAll(async () => {
    tasks = new TaskService(new FakeTaskRepository());
    app = await buildApp({
      config: { ...loadConfig(), authToken: TOKEN, isProduction: false },
      mcpServices: { tasks, renewal: new RenewalService(new FakeHabitRepository()) } as unknown as Services,
      timeZones: new TimeZoneService({ reported: async () => null, setReported: async () => undefined }, {}),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/mcp`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function connect(declareUi: boolean, token = TOKEN) {
    const client = new Client(
      { name: "test host", version: "0" },
      // The SDK 1.x types do not know `extensions` yet; the wire carries it.
      { capabilities: (declareUi ? { extensions: UI } : {}) as never },
    );
    const transport = new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return { client, transport };
  }

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}`, ...headers },
      body: JSON.stringify(body),
    });
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } } };

  it("a host that draws pages gets the reads, the screens with their page, and no write its model can see", async () => {
    const { client } = await connect(true);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("show_week");
    expect(names).toContain("list_tasks");
    expect(names).toContain("propose_changes");
    expect(names).not.toContain("delete_task");
    // The writes are there for the page only (step 3).
    for (const name of ["set_task_done", "create_task"]) {
      expect(tools.find((t) => t.name === name)?._meta).toEqual({ ui: { visibility: ["app"] } });
    }
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://clock-compass/screen");
    const page = await client.readResource({ uri: "ui://clock-compass/screen" });
    expect(page.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    expect((page.contents[0]!._meta as { ui: { csp: unknown } }).ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    });
    const week = await client.callTool({ name: "show_week", arguments: {} });
    expect(week.isError).toBeFalsy();
    expect((week.content as { text: string }[])[0]!.text).toMatch(/^This week \(.+\): No big rocks pinned\. Nothing is scheduled\.$/);
    expect(week.structuredContent).toHaveProperty("messages");
    await client.close();
  });

  it("with the App, a write runs only for a change propose_changes showed, also from another session of the same server", async () => {
    const { client } = await connect(true);
    const t = await tasks.create({ title: "Fix the gate" });
    const direct = await client.callTool({ name: "set_task_done", arguments: { taskId: t.id, done: true } });
    expect(direct.isError).toBe(true);
    const shown = await client.callTool({ name: "propose_changes", arguments: { changes: [{ operation: "setTaskDone", input: { taskId: t.id, done: true } }] } });
    const [change] = (shown.structuredContent as { changes: { tool: string; arguments: Record<string, unknown> }[] }).changes;
    expect((await tasks.get(t.id))?.status).toBe("TODO");
    await client.close();
    // The host reconnected (a new session) before the press: the proof still holds in this process.
    const again = await connect(true);
    const done = await again.client.callTool({ name: change!.tool, arguments: change!.arguments });
    // The answer carries the task as list_tasks shows it, for the page's card (#159).
    expect(JSON.parse((done.content as { text: string }[])[0]!.text)).toEqual({
      changed: 1,
      tasks: [expect.objectContaining({ id: t.id, title: "Fix the gate", status: "DONE" })],
    });
    expect((await tasks.get(t.id))?.status).toBe("DONE");
    // The proof is spent for the whole process: a third session's replay writes nothing (#159).
    await tasks.reopen(t.id);
    const third = await connect(true);
    const replay = await third.client.callTool({ name: change!.tool, arguments: change!.arguments });
    expect(JSON.parse((replay.content as { text: string }[])[0]!.text)).toMatchObject({ changed: 0 });
    expect((await tasks.get(t.id))?.status).toBe("TODO");
    await third.client.close();
    await again.client.close();
  });

  it("any other host gets the reads and writes, and a write runs", async () => {
    const { client } = await connect(false);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("set_task_done");
    expect(names).not.toContain("show_week");
    const t = await tasks.create({ title: "Call the plumber" });
    const done = await client.callTool({ name: "set_task_done", arguments: { taskId: t.id, done: true } });
    expect(JSON.parse((done.content as { text: string }[])[0]!.text)).toEqual({ changed: 1 });
    expect((await tasks.get(t.id))?.status).toBe("DONE");
    await client.close();
  });

  it("answers in plain JSON, not a stream, and refuses the GET stream", async () => {
    const res = await post(initialize);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(((await res.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("clock-compass");
    const stream = await fetch(base, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" } });
    expect(stream.status).toBe(405);
  });

  it("needs the token, and refuses any request that carries an Origin", async () => {
    expect((await post(initialize, { Authorization: "" })).status).toBe(401);
    expect((await post(initialize, { Authorization: "Bearer wrong" })).status).toBe(401);
    const fromPage = await post(initialize, { Origin: "https://evil.example" });
    expect(fromPage.status).toBe(403);
    // No exception for the app's own address either.
    expect((await post(initialize, { Origin: base.replace("/api/mcp", "") })).status).toBe(403);
  });

  it("a request before initialize gets a 4xx (a newer client's probe falls back from it)", async () => {
    const probe = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
    expect(probe.status).toBe(400);
  });

  it("an unknown or ended session gets 404, so the client connects again", async () => {
    const unknown = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "00000000-0000-0000-0000-000000000000" });
    expect(unknown.status).toBe(404);
    const { client, transport } = await connect(false);
    const id = transport.sessionId!;
    await transport.terminateSession(); // DELETE
    await client.close();
    const ended = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": id, "mcp-protocol-version": "2025-11-25" });
    expect(ended.status).toBe(404);
  });
});

describe("/api/mcp sessions are limited", () => {
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    app = await buildApp({
      config: { ...loadConfig(), authToken: TOKEN, isProduction: false },
      mcpServices: { tasks: new TaskService(new FakeTaskRepository()) } as unknown as Services,
      timeZones: new TimeZoneService({ reported: async () => null, setReported: async () => undefined }, {}),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/mcp`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("the 21st session closes the one idle the longest", async () => {
    const opened: string[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: `c${i}`, version: "0" } } }),
      });
      opened.push(res.headers.get("mcp-session-id")!);
      await new Promise((r) => setTimeout(r, 2));
    }
    const list = (id: string) =>
      fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
    expect((await list(opened[0]!)).status).toBe(404);
    expect((await list(opened[20]!)).status).toBe(200);
  });
});
