import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { OPERATION_LIST } from "@clock-compass/assistant-catalog";
import { RenewalService, TaskService, type OperationServices } from "@clock-compass/core";
import { FakeHabitRepository, FakeTaskRepository } from "@clock-compass/core/testing";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

/**
 * POST /api/operations/{name} (issue #109) through the real task and renewal
 * services on in-memory repositories (no database in these tests). The
 * other services are stubs: those operations hand their input on, as the
 * handler tests in core show.
 */
describe("operation endpoint", () => {
  let app: FastifyInstance;
  let tasks: TaskService;
  const auth = { authorization: "Bearer test-token" };
  const missing = Object.assign(new Error("No record was found for an update."), { code: "P2025" });

  beforeAll(async () => {
    tasks = new TaskService(new FakeTaskRepository());
    const services = {
      tasks,
      renewal: new RenewalService(new FakeHabitRepository()),
      goals: {},
      projects: {},
      mission: {},
      people: {
        logOccurrence: async () => {
          throw missing;
        },
      },
    } as unknown as OperationServices;
    app = await buildApp({
      config: { ...loadConfig(), authToken: "test-token", isProduction: false },
      operationServices: services,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (name: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/api/operations/${name}`, headers: { ...auth, ...headers }, payload: payload as object });

  it("needs the API token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/operations/setTaskDone", payload: { taskId: "t1", done: true } });
    expect(res.statusCode).toBe(401);
  });

  it("answers 404 for an operation that does not exist", async () => {
    expect((await post("dropTables", {})).statusCode).toBe(404);
  });

  it("validates with the operation's Zod schema, refinements included (400)", async () => {
    const empty = await post("setTaskDone");
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toMatch(/taskId/);
    const extra = await post("setTaskDone", { taskId: "t1", done: true, admin: true });
    expect(extra.statusCode).toBe(400);
    const date = await post("scheduleTask", { taskId: "t1", day: "2026-02-31" });
    expect(date.json()).toEqual({ error: "day: a real calendar date" });
    const time = await post("scheduleTask", { taskId: "t1", day: null, time: "07:30" });
    expect(time.json()).toEqual({ error: "time: a time needs a day" });
  });

  it("runs a target-state operation once: repeating it changes nothing", async () => {
    const task = await tasks.create({ title: "Plan the garden" });
    const first = await post("setTaskDone", { taskId: task.id, done: true });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ changed: 1 });
    expect((await post("setTaskDone", { taskId: task.id, done: true })).json()).toEqual({ changed: 0 });
  });

  it("refuses what cannot be done with the data as it is (422), with the app's words", async () => {
    const gone = await post("setTaskDone", { taskId: "gone", done: true });
    expect(gone.statusCode).toBe(422);
    expect(gone.json()).toEqual({ error: "That task no longer exists." });
    const urgent = await tasks.create({ title: "Reply to email", urgent: true });
    const rock = await post("setBigRock", { taskId: urgent.id, bigRock: true });
    expect(rock.statusCode).toBe(422);
    expect(rock.json().error).toMatch(/not in Quadrant II/);
  });

  it("reads a day in the caller's time zone (X-Time-Zone), and refuses an unknown zone", async () => {
    const task = await tasks.create({ title: "Call the plumber" });
    const res = await post("scheduleTask", { taskId: task.id, day: "2026-11-24" }, { "x-time-zone": "America/New_York" });
    expect(res.json()).toEqual({ changed: 1 });
    expect((await tasks.get(task.id))?.scheduledDay?.toISOString()).toBe("2026-11-24T05:00:00.000Z");
    const bad = await post("scheduleTask", { taskId: task.id, day: "2026-11-24" }, { "x-time-zone": "Mars/Olympus" });
    expect(bad.statusCode).toBe(400);
  });

  it("answers 404 when a record the input names is not there", async () => {
    const res = await post("log_commitment_occurrence", { commitmentId: "gone" });
    expect(res.statusCode).toBe(404);
  });

  it("lists every operation in the OpenAPI spec with its own schema and description", async () => {
    const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json() as {
      paths: Record<string, { post?: { summary?: string; description?: string; requestBody?: { content: Record<string, { schema: { properties?: object } }> } } }>;
    };
    for (const decl of OPERATION_LIST) {
      const post = spec.paths[`/api/operations/${decl.name}`]?.post;
      expect(post?.summary, decl.name).toBe(decl.title);
      expect(post?.description).toContain(decl.summary);
      expect(post?.requestBody?.content["application/json"]?.schema.properties, decl.name).toBeTruthy();
    }
    const schedule = spec.paths["/api/operations/scheduleTask"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(schedule).toMatchObject({
      type: "object",
      properties: { taskId: { type: "string" }, day: { type: "string", nullable: true } },
      required: ["taskId", "day"],
      additionalProperties: false,
    });
  });
});
