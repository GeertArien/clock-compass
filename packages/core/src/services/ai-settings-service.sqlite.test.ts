import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CodexCredentialManager } from "../ai/codex-provider.js";
import { StoredAiSettings } from "../ai/settings.js";
import { PrismaAiSettingsRepository } from "../repositories/ai-settings-repository.js";
import { ExportService } from "./export-service.js";
import { PrismaExportRepository } from "../repositories/export-repository.js";
import { AiSettingsService, loadStoredConfig } from "./ai-settings-service.js";

/**
 * AI settings (#94) on a real SQLite file migrated with the project's own
 * migrations, and against local HTTP servers standing in for providers.
 */
const coreDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const KEY = "sk-test-MARKER-0123456789abcdef";
let dir: string;
let db: PrismaClient;
let repo: PrismaAiSettingsRepository;
let settings: StoredAiSettings;
let service: AiSettingsService;
let provider: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cc-ai-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: coreDir, env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  db = new PrismaClient({ datasources: { db: { url } } });
  repo = new PrismaAiSettingsRepository(db);
  const codex = new CodexCredentialManager({ get: async () => null, upsert: async () => undefined, remove: async () => undefined } as never);
  settings = new StoredAiSettings(() => loadStoredConfig(repo), codex);
  service = new AiSettingsService(repo, settings, codex);

  // A stand-in provider: /ok/models answers a list, /echo/models echoes the
  // key in a 401, /redirect/models redirects to another host.
  provider = createServer((req, res) => {
    if (req.url === "/ok/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] }));
    } else if (req.url === "/echo/models") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `bad key ${req.headers.authorization}` } }));
    } else if (req.url === "/redirect/models") {
      res.writeHead(302, { location: "http://elsewhere.example/steal" }).end();
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  provider?.close();
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.aiJobSetting.deleteMany();
  await db.aiProviderConfig.deleteMany();
  await db.aiDataSwitch.deleteMany();
  await settings.reload();
});

const local = (path: string, apiKey: string | undefined = KEY) =>
  service.addProvider({ name: `Local ${path}`, kind: "openai-compatible", baseUrl: `${base}/${path}`, apiKey, models: ["llama3.2"] });

describe("AI settings on SQLite (#94)", () => {
  it("never returns a stored key: not in the view, the provider, or the export", async () => {
    const created = await local("ok");
    expect(created).toMatchObject({ keySet: true, keyHint: "cdef" });
    expect(await db.aiProviderConfig.findFirstOrThrow()).toMatchObject({ apiKey: `plain:${KEY}` });
    const view = await service.view();
    const exported = await new ExportService(new PrismaExportRepository(db)).export();
    for (const text of [JSON.stringify(created), JSON.stringify(view), JSON.stringify(exported)]) expect(text).not.toContain("MARKER");
    expect(JSON.stringify(exported)).not.toMatch(/aiProvider|aiJob|aiDataSwitch/i);
  });

  it("replaces and removes a key, and refuses an Anthropic provider without one", async () => {
    const p = await local("ok");
    expect(await service.updateProvider(p.id, { apiKey: "short" })).toMatchObject({ keySet: true, keyHint: null });
    expect(await service.updateProvider(p.id, { apiKey: null })).toMatchObject({ keySet: false, keyHint: null });
    await expect(service.addProvider({ name: "Claude", kind: "anthropic" })).rejects.toMatchObject({ status: 400 });
  });

  it("checks names, kinds and addresses", async () => {
    await local("ok");
    await expect(local("ok")).rejects.toMatchObject({ status: 409 });
    await expect(service.addProvider({ name: "X", kind: "magic" })).rejects.toMatchObject({ status: 400 });
    await expect(service.addProvider({ name: "Y", kind: "openai-compatible", baseUrl: "https://u:p@host/v1" })).rejects.toMatchObject({ status: 400 });
    await expect(service.addProvider({ name: "Z", kind: "openai-compatible" })).rejects.toMatchObject({ status: 400 });
    const warned = await service.addProvider({ name: "W", kind: "openai-compatible", baseUrl: "http://gateway.example.com/v1", apiKey: KEY });
    expect(warned.warning).toMatch(/unencrypted/);
    await service.addProvider({ name: "ChatGPT", kind: "codex", models: ["gpt-5"] });
    await expect(service.addProvider({ name: "ChatGPT 2", kind: "codex" })).rejects.toMatchObject({ status: 409 });
  });

  it("sets a model per job, applies at once, and moves a removed provider's jobs to the default", async () => {
    const a = await local("ok");
    const b = await service.addProvider({ name: "Other", kind: "openai-compatible", baseUrl: `${base}/ok`, models: ["qwen2.5"] });
    await service.setJobs([
      { job: "default", providerId: a.id, model: "llama3.2" },
      { job: "weeklyReview", providerId: b.id, model: "qwen2.5" },
    ]);
    expect(settings.forJob("weeklyReview")).toMatchObject({ providerName: "openai-compatible", model: "qwen2.5" });
    expect(settings.forJob("assistant")).toMatchObject({ model: "llama3.2" });

    await service.removeProvider(b.id);
    expect((await db.aiJobSetting.findUniqueOrThrow({ where: { job: "weeklyReview" } })).providerId).toBeNull();
    expect(settings.forJob("weeklyReview")).toMatchObject({ model: "llama3.2" });
  });

  it("refuses a model the provider does not keep, and the ChatGPT subscription for the assistant", async () => {
    const a = await local("ok");
    await expect(service.setJobs([{ job: "default", providerId: a.id, model: "gpt-9" }])).rejects.toMatchObject({ status: 422 });
    const c = await service.addProvider({ name: "ChatGPT", kind: "codex", models: ["gpt-5"] });
    await expect(service.setJobs([{ job: "assistant", providerId: c.id, model: "gpt-5" }])).rejects.toMatchObject({
      status: 422,
      message: "The ChatGPT subscription is not available for the assistant yet.",
    });
    await service.setJobs([{ job: "weeklyReview", providerId: c.id, model: "gpt-5" }]);
  });

  it("stores the switches as rows, defaults first, and shows what each job sends", async () => {
    const before = await service.view();
    expect(before.switches.find((s) => s.category === "personNotes")).toEqual({ category: "personNotes", enabled: false, byDefault: false });
    await service.setSwitches([{ category: "mission", enabled: false }]);
    expect(await db.aiDataSwitch.findMany()).toEqual([expect.objectContaining({ category: "mission", enabled: false })]);
    const view = await service.view();
    const mission = view.jobs.find((j) => j.job === "refineMission")!;
    expect(mission.sends).toEqual([{ label: "your mission draft", shared: false }]);
    expect(mission.offBecause).toMatch(/mission is not shared/);
    expect(settings.policy().mission).toBe(false);
    await expect(service.setSwitches([{ category: "everything", enabled: true }])).rejects.toMatchObject({ status: 400 });
  });

  it("loads the provider's model list, and tests it", async () => {
    const p = await local("ok");
    expect(await service.loadModels(p.id)).toEqual({ models: ["llama3.2", "qwen2.5"] });
    expect(await service.test(p.id)).toEqual({ ok: true, message: "The provider answered." });
  });

  it("shows the provider's own error with the key taken out", async () => {
    const p = await local("echo");
    const outcome = await service.test(p.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("HTTP 401: bad key Bearer [key]");
    expect(outcome.message).not.toContain("MARKER");
  });

  it("refuses a redirect, so the key never follows it to another host", async () => {
    const p = await local("redirect");
    const outcome = await service.test(p.id);
    expect(outcome).toEqual({ ok: false, message: "The provider answered with a redirect; it is refused so the key does not go to another address." });
    await expect(service.loadModels(p.id)).rejects.toMatchObject({ status: 422 });
  });
});
