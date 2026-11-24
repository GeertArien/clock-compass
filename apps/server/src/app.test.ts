import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

/**
 * App-level tests using Fastify's `inject` — no network, no real database calls
 * (these routes don't hit the DB). Verifies wiring: health, docs, and auth gate.
 */
describe("server app", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: {
        ...loadConfig(),
        authToken: "test-token",
        isProduction: false,
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responds to the health check", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("serves an OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: expect.any(String) });
  });

  it("rejects protected routes without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(401);
  });

  it("gates the entity routes behind auth", async () => {
    for (const url of [
      "/api/roles",
      "/api/projects",
      "/api/people",
      "/api/commitments/overdue",
      "/api/habits",
      "/api/renewal/summary",
      "/api/ai/status",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("answers 503 on AI routes when no provider is configured (Settings → AI)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/classify",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      payload: { text: "take noor climbing saturday" },
    });
    expect(res.statusCode).toBe(503);

    const status = await app.inject({
      method: "GET",
      url: "/api/ai/status",
      headers: { authorization: "Bearer test-token" },
    });
    expect(status.json()).toEqual({ available: false, connected: false, oauth: false });
  });

  it("documents the entity routes in the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    const paths = Object.keys(res.json().paths as Record<string, unknown>);
    for (const path of [
      "/api/roles",
      "/api/projects",
      "/api/people",
      "/api/commitments/overdue",
      "/api/habits",
      "/api/renewal/summary",
      "/api/renewal/trends",
      "/api/renewal/activities",
      "/api/ai/intake",
      "/api/ai/review",
      "/api/ai/unaligned",
      "/api/import/todoist",
      "/api/export",
      "/api/goals/reorder",
      "/api/roles/reorder",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("gates the export route behind auth", async () => {
    // The success path (envelope + secret exclusion) is covered by the
    // ExportService / ExportRepository unit tests; these app tests don't hit a DB.
    const res = await app.inject({ method: "GET", url: "/api/export" });
    expect(res.statusCode).toBe(401);
  });

  it("gates the import route and rejects non-Todoist files with 400", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/import/todoist",
      headers: { "content-type": "application/json" },
      payload: { csv: "x" },
    });
    expect(unauthorized.statusCode).toBe(401);

    const badFile = await app.inject({
      method: "POST",
      url: "/api/import/todoist",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      payload: { csv: "name,email\\nGeert,x@y.z" },
    });
    expect(badFile.statusCode).toBe(400);
    expect(badFile.json().error).toMatch(/Todoist/);
  });

  it("rejects protected routes with a wrong token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates the previews range before reading anything (#105)", async () => {
    const get = (query: string) =>
      app.inject({ method: "GET", url: `/api/tasks/previews?${query}`, headers: { authorization: "Bearer test-token" } });
    expect((await get("from=2026-11-30")).statusCode).toBe(400);
    expect((await get("from=30-11-2026&to=2026-12-06")).statusCode).toBe(400);
    const backwards = await get("from=2026-12-06&to=2026-11-30");
    expect(backwards.statusCode).toBe(400);
    expect(backwards.json()).toEqual({ error: "to must be on or after from" });
    expect((await get("from=2026-11-01&to=2027-01-31")).statusCode).toBe(400);
  });

  it("accepts an empty body on application/json POSTs (no FST_ERR_CTP_EMPTY_JSON_BODY)", async () => {
    // A bodyless POST with a JSON content-type used to 400 before reaching auth.
    // Now the empty body is parsed as undefined, so the request reaches the auth
    // gate and returns 401 (not 400) when unauthenticated.
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/abc/complete",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(401);
  });
});
