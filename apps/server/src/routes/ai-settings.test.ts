import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  AiSettingsService,
  CodexCredentialManager,
  StoredAiSettings,
  loadStoredConfig,
  providerKeyPlace,
  secretsBox,
  type AiSettingsRepository,
  type StoredJob,
  type StoredProvider,
} from "@clock-compass/core";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { authPlugin, OWNER_ONLY } from "../plugins/auth.js";

/** The AI settings tables in memory, keys included (as the database holds them). */
class MemoryAiSettings implements AiSettingsRepository {
  rows = new Map<string, StoredProvider & { apiKey: string | null }>();
  jobs: StoredJob[] = [];
  switches = new Map<string, boolean>();
  private seq = 0;
  private view(r: StoredProvider & { apiKey: string | null }): StoredProvider {
    const { apiKey, ...rest } = r;
    return { ...rest, keySet: apiKey !== null };
  }
  async listProviders() {
    return [...this.rows.values()].map((r) => this.view(r));
  }
  async findProvider(id: string) {
    const r = this.rows.get(id);
    return r ? this.view(r) : null;
  }
  async secretFor(id: string) {
    return this.rows.get(id)?.apiKey ?? null;
  }
  async createProvider(d: { id?: string; name: string; kind: string; baseUrl?: string | null; apiKey?: string | null; keyHint?: string | null; models?: string[] }) {
    const id = d.id ?? `p${++this.seq}`;
    const at = new Date("2026-11-24T10:00:00Z");
    const row = { id, name: d.name, kind: d.kind, baseUrl: d.baseUrl ?? null, apiKey: d.apiKey ?? null, keyHint: d.keyHint ?? null, keySet: false, models: d.models ?? [], createdAt: at, updatedAt: at };
    this.rows.set(id, row);
    return this.view(row);
  }
  async updateProvider(id: string, d: { name?: string; baseUrl?: string | null; apiKey?: string | null; keyHint?: string | null; models?: string[] }) {
    const row = this.rows.get(id)!;
    Object.assign(row, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)));
    if (d.apiKey !== undefined) row.keyHint = d.keyHint ?? null;
    return this.view(row);
  }
  async deleteProvider(id: string) {
    this.rows.delete(id);
    this.jobs = this.jobs.map((j) => (j.providerId === id ? { ...j, providerId: null, model: null } : j));
  }
  async listJobs() {
    return this.jobs;
  }
  async replaceJobs(jobs: StoredJob[]) {
    this.jobs = jobs;
  }
  async listSwitches() {
    return [...this.switches].map(([category, enabled]) => ({ category, enabled }));
  }
  async setSwitches(s: { category: string; enabled: boolean }[]) {
    for (const x of s) this.switches.set(x.category, x.enabled);
  }
}

const KEY = "sk-ant-MARKER-0123456789abcdefgh";
const owner = { authorization: "Bearer test-token" };
/** The server's SECRETS_KEY in these tests: a sentinel that must never be shown (#103). */
const SECRET = Buffer.from("SENTINEL-SECRET-0123456789abcdef").toString("base64");
const box = secretsBox(SECRET);

describe("Settings → AI over HTTP (#94)", () => {
  let app: FastifyInstance;
  let repo: MemoryAiSettings;

  beforeAll(async () => {
    repo = new MemoryAiSettings();
    const codex = new CodexCredentialManager({ get: async () => null, upsert: async () => undefined, remove: async () => undefined } as never, box);
    const settings = new StoredAiSettings(() => loadStoredConfig(repo, box), codex);
    app = await buildApp({
      config: { ...loadConfig(), authToken: "test-token", isProduction: false, secretsKey: SECRET },
      aiSettings: { settings, service: new AiSettingsService(repo, settings, codex, box) },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("adds a provider and never answers its key", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: owner,
      payload: { name: "Claude", kind: "anthropic", apiKey: KEY, models: ["claude-opus-4-8"] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Claude", keySet: true, keyHint: "efgh" });
    // Stored encrypted, bound to its row (#103).
    const stored = repo.rows.get(created.json().id)!.apiKey!;
    expect(stored).toMatch(/^enc1:/);
    expect(box.open(stored, providerKeyPlace(created.json().id))).toEqual({ ok: true, value: KEY });

    const view = await app.inject({ method: "GET", url: "/api/ai/settings", headers: owner });
    expect(view.statusCode).toBe(200);
    for (const res of [created, view]) {
      expect(res.body).not.toContain("MARKER");
      expect(res.body).not.toContain("apiKey");
    }
  });

  it("chooses a model per job, and applies it to the next request", async () => {
    const providers = (await app.inject({ method: "GET", url: "/api/ai/settings", headers: owner })).json().providers;
    const res = await app.inject({
      method: "PUT",
      url: "/api/ai/jobs",
      headers: owner,
      payload: { jobs: [{ job: "default", providerId: providers[0].id, model: "claude-opus-4-8" }] },
    });
    expect(res.statusCode).toBe(204);
    const status = await app.inject({ method: "GET", url: "/api/ai/status", headers: owner });
    expect(status.json()).toMatchObject({ available: true, oauth: false });
  });

  it("refuses a job when its data is switched off (409, in the app's words)", async () => {
    await app.inject({ method: "PUT", url: "/api/ai/data-policy", headers: owner, payload: { switches: [{ category: "mission", enabled: false }] } });
    const refine = await app.inject({ method: "POST", url: "/api/ai/mission/refine", headers: owner, payload: { draft: "Be kind" } });
    expect(refine.statusCode).toBe(409);
    expect(refine.json().error).toBe("Mission refinement is off because the mission is not shared with AI (Settings → AI).");
    const view = (await app.inject({ method: "GET", url: "/api/ai/settings", headers: owner })).json();
    expect(view.switches.find((s: { category: string }) => s.category === "mission")).toEqual({ category: "mission", enabled: false, byDefault: true });
  });

  it("refuses the assistant when no data at all is shared", async () => {
    const all = ["tasks", "goalsAndProjects", "mission", "people", "habitsAndRenewal"].map((category) => ({ category, enabled: false }));
    await app.inject({ method: "PUT", url: "/api/ai/data-policy", headers: owner, payload: { switches: all } });
    const run = await app.inject({
      method: "POST",
      url: "/api/agent",
      headers: owner,
      payload: { threadId: "t", runId: "r", state: {}, messages: [{ id: "m1", role: "user", content: "Hi" }], tools: [], context: [], forwardedProps: {} },
    });
    expect(run.statusCode).toBe(409);
    expect(run.json()).toMatchObject({ reason: "data-off" });
    await app.inject({ method: "PUT", url: "/api/ai/data-policy", headers: owner, payload: { switches: all.map((s) => ({ ...s, enabled: true })) } });
  });

  it("answers the settings' own refusals with their status", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/ai/providers", headers: owner, payload: { name: "Gateway", kind: "openai-compatible", baseUrl: "https://u:p@gw.example/v1" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/key field/);
    const missing = await app.inject({ method: "DELETE", url: "/api/ai/providers/nope", headers: owner });
    expect(missing.statusCode).toBe(404);
  });
});

describe("only the server's own token changes AI settings (#94)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(authPlugin, { token: "test-token", apiKeys: { verify: async (k: string) => k === "generated-key" } as never });
    app.get("/owner", { preHandler: app.requireOwner }, async () => ({ ok: true }));
    app.get("/any", { preHandler: app.requireAuth }, async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("gives a generated key 403 with which token is needed, the owner's token 200, nothing 401", async () => {
    const generated = await app.inject({ method: "GET", url: "/owner", headers: { authorization: "Bearer generated-key" } });
    expect(generated.statusCode).toBe(403);
    expect(generated.json()).toEqual({ error: OWNER_ONLY });
    expect((await app.inject({ method: "GET", url: "/owner", headers: owner })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/owner" })).statusCode).toBe(401);
    // The same generated key still reads the rest of the API.
    expect((await app.inject({ method: "GET", url: "/any", headers: { authorization: "Bearer generated-key" } })).statusCode).toBe(200);
  });
});

describe("Settings → AI without a SECRETS_KEY (#103)", () => {
  for (const [label, raw, state] of [
    ["not set", undefined, "missing"],
    ["set but not 32 bytes in base64", "SENTINEL-SECRET-not-a-key", "invalid"],
  ] as const) {
    describe(`SECRETS_KEY ${label}`, () => {
      let app: FastifyInstance;
      let repo: MemoryAiSettings;
      beforeAll(async () => {
        repo = new MemoryAiSettings();
        const noBox = secretsBox(raw);
        const codex = new CodexCredentialManager({ get: async () => null, upsert: async () => undefined, remove: async () => undefined } as never, noBox);
        const settings = new StoredAiSettings(() => loadStoredConfig(repo, noBox), codex);
        app = await buildApp({
          config: { ...loadConfig(), authToken: "test-token", isProduction: false, secretsKey: raw },
          aiSettings: { settings, service: new AiSettingsService(repo, settings, codex, noBox) },
        });
        await app.ready();
      });
      afterAll(async () => {
        await app.close();
      });

      it("says which case it is, never the value", async () => {
        const view = await app.inject({ method: "GET", url: "/api/ai/settings", headers: owner });
        expect(view.json().secrets).toEqual({ state });
        expect(view.body).not.toContain("SENTINEL");
      });

      it("refuses a key (409) and leaves no provider behind; a keyless provider is added, changed and its job chosen", async () => {
        const refused = await app.inject({ method: "POST", url: "/api/ai/providers", headers: owner, payload: { name: "Claude", kind: "anthropic", apiKey: KEY, models: ["m"] } });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().error).toMatch(state === "missing" ? /has no SECRETS_KEY/ : /is not 32 bytes in base64/);
        expect(repo.rows.size).toBe(0);

        const keyless = await app.inject({ method: "POST", url: "/api/ai/providers", headers: owner, payload: { name: "Ollama", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", models: ["llama3.2"] } });
        expect(keyless.statusCode).toBe(201);
        const id = keyless.json().id as string;
        const keyAdded = await app.inject({ method: "PATCH", url: `/api/ai/providers/${id}`, headers: owner, payload: { apiKey: KEY } });
        expect(keyAdded.statusCode).toBe(409);
        expect((await app.inject({ method: "PATCH", url: `/api/ai/providers/${id}`, headers: owner, payload: { name: "Ollama at home" } })).statusCode).toBe(200);
        const jobs = await app.inject({ method: "PUT", url: "/api/ai/jobs", headers: owner, payload: { jobs: [{ job: "default", providerId: id, model: "llama3.2" }] } });
        expect(jobs.statusCode).toBe(204);
        const switches = await app.inject({ method: "PUT", url: "/api/ai/data-policy", headers: owner, payload: { switches: [{ category: "mission", enabled: false }] } });
        expect(switches.statusCode).toBeLessThan(300);
        for (const res of [refused, keyless, keyAdded]) {
          expect(res.body).not.toContain("MARKER");
          expect(res.body).not.toContain("SENTINEL");
        }
      });

      it("refuses to start a ChatGPT sign-in, before anything is asked of ChatGPT", async () => {
        const start = await app.inject({ method: "POST", url: "/api/ai/codex/device/start", headers: owner });
        expect(start.statusCode).toBe(409);
        expect(start.json().error).toMatch(/^Keys cannot be saved: this server/);
        expect(start.body).not.toContain("SENTINEL");
      });
    });
  }
});
