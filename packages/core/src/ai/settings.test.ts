import { describe, expect, it } from "vitest";
import { assistantAvailability } from "../assistant/agent.js";
import { DEFAULT_DATA_POLICY } from "../assistant/data-policy.js";
import type { StoredProvider } from "../repositories/ai-settings-repository.js";
import { AnthropicAiProvider } from "./anthropic-provider.js";
import { CodexCredentialManager } from "./codex-provider.js";
import { AI_JOBS } from "./jobs.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import {
  StoredAiSettings,
  checkAddress,
  isLocalHost,
  jobOffReason,
  policyFromSwitches,
  readKey,
  redact,
  storeKey,
  type StoredAiConfig,
} from "./settings.js";

const codex = new CodexCredentialManager({ get: async () => null, upsert: async () => undefined, remove: async () => undefined } as never);
const at = new Date("2026-11-24T10:00:00Z");
const provider = (id: string, kind: string, extra: Partial<StoredProvider> = {}): StoredProvider => ({
  id,
  name: id,
  kind,
  baseUrl: null,
  keySet: false,
  keyHint: null,
  models: [],
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const settingsOf = async (config: Partial<StoredAiConfig>) => {
  const s = new StoredAiSettings(async () => ({ providers: [], secrets: new Map(), jobs: [], switches: [], ...config }), codex);
  await s.reload();
  return s;
};

describe("StoredAiSettings: which provider and model a job uses (#94)", () => {
  const anthropic = provider("a", "anthropic", { keySet: true, models: ["claude-opus-4-8", "claude-haiku-4-5"] });
  const local = provider("l", "openai-compatible", { baseUrl: "http://localhost:11434/v1", models: ["llama3.2"] });

  it("has AI off for every job with nothing configured", async () => {
    const s = await settingsOf({});
    for (const job of AI_JOBS) expect(s.forJob(job)).toMatchObject({ providerName: "none", model: null });
    expect(await assistantAvailability(s)).toEqual({ available: false, reason: "no-provider" });
  });

  it("uses the default for a job without its own row; a job's own row wins", async () => {
    const s = await settingsOf({
      providers: [anthropic, local],
      secrets: new Map([["a", "plain:sk-ant-test"]]),
      jobs: [
        { job: "default", providerId: "a", model: "claude-haiku-4-5" },
        { job: "classifyTask", providerId: "l", model: "llama3.2" },
      ],
    });
    expect(s.forJob("weeklyReview")).toMatchObject({ providerName: "anthropic", model: "claude-haiku-4-5" });
    expect(s.forJob("weeklyReview").provider).toBeInstanceOf(AnthropicAiProvider);
    expect(s.forJob("classifyTask")).toMatchObject({ providerName: "openai-compatible", model: "llama3.2" });
    expect(s.forJob("classifyTask").provider).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it("turns a job off when its provider has no usable key, or was removed", async () => {
    const noKey = await settingsOf({ providers: [anthropic], jobs: [{ job: "default", providerId: "a", model: "claude-opus-4-8" }] });
    expect(noKey.forJob("assistant").providerName).toBe("none");
    const unknownMarker = await settingsOf({
      providers: [anthropic],
      secrets: new Map([["a", "v9:something"]]),
      jobs: [{ job: "default", providerId: "a", model: "claude-opus-4-8" }],
    });
    expect(unknownMarker.forJob("assistant").providerName).toBe("none");
    const removed = await settingsOf({ jobs: [{ job: "default", providerId: "gone", model: "x" }] });
    expect(removed.forJob("assistant").providerName).toBe("none");
  });

  it("reports the ChatGPT subscription as unsupported for the assistant", async () => {
    const s = await settingsOf({ providers: [provider("c", "codex", { models: ["gpt-5"] })], jobs: [{ job: "default", providerId: "c", model: "gpt-5" }] });
    expect(s.forJob("weeklyReview")).toMatchObject({ providerName: "codex", model: "gpt-5" });
    expect(await assistantAvailability(s)).toMatchObject({ available: false, reason: "unsupported-provider" });
  });

  it("reads the data switches as rows, each category falling back to its default", async () => {
    const s = await settingsOf({ switches: [{ category: "taskNotes", enabled: false }, { category: "personNotes", enabled: true }, { category: "gone", enabled: true }] });
    expect(s.policy()).toEqual({ ...DEFAULT_DATA_POLICY, taskNotes: false, personNotes: true });
    expect(policyFromSwitches([])).toEqual(DEFAULT_DATA_POLICY);
  });
});

describe("keys (write-only, #94)", () => {
  it("are stored with the plain: marker and read back; another marker reads as no key", () => {
    expect(storeKey("sk-ant-0123456789abcdefWXYZ")).toEqual({ apiKey: "plain:sk-ant-0123456789abcdefWXYZ", keyHint: "WXYZ" });
    expect(readKey("plain:abc")).toBe("abc");
    expect(readKey("v1:nonce:ciphertext")).toBeNull();
    expect(readKey(null)).toBeNull();
  });

  it("show no hint for a key shorter than 20 characters", () => {
    expect(storeKey("short-key").keyHint).toBeNull();
    expect(storeKey("x".repeat(19)).keyHint).toBeNull();
    expect(storeKey("x".repeat(20)).keyHint).toBe("xxxx");
  });

  it("are taken out of a provider's message, which is cut at 300 characters", () => {
    expect(redact("invalid x-api-key: sk-secret-123 (sk-secret-123)", "sk-secret-123")).toBe("invalid x-api-key: [key] ([key])");
    expect(redact("y".repeat(400), null)).toHaveLength(301);
  });
});

describe("the address check (owner decision 4)", () => {
  it("refuses other schemes, credentials in the address, a query, a fragment, and long addresses", () => {
    for (const bad of ["ftp://host/v1", "https://user:pass@host/v1", "https://host/v1?x=1", "https://host/v1#a", "not a url", `https://h/${"a".repeat(2000)}`]) {
      expect(checkAddress(bad, true).ok, bad).toBe(false);
    }
  });

  it("allows localhost, the home network and plain http, and drops a trailing slash", () => {
    expect(checkAddress("http://localhost:11434/v1/", true)).toEqual({ ok: true, address: "http://localhost:11434/v1", warning: null });
    expect(checkAddress("http://192.168.1.20:4000", true)).toMatchObject({ ok: true, warning: null });
    expect(checkAddress("http://nas:4000/v1", true)).toMatchObject({ ok: true, warning: null });
    for (const host of ["10.0.0.5", "172.20.1.1", "127.0.0.1", "[::1]", "box.local"]) expect(isLocalHost(host.replace(/[[\]]/g, "")), host).toBe(true);
    expect(isLocalHost("8.8.8.8")).toBe(false);
  });

  it("warns when a key would go over plain http to a public address", () => {
    expect(checkAddress("http://gateway.example.com/v1", true)).toMatchObject({ ok: true, warning: expect.stringMatching(/unencrypted/) });
    expect(checkAddress("http://gateway.example.com/v1", false)).toMatchObject({ ok: true, warning: null });
    expect(checkAddress("https://gateway.example.com/v1", true)).toMatchObject({ ok: true, warning: null });
  });
});

describe("a job whose data is switched off", () => {
  it("says why, in the app's words", () => {
    expect(jobOffReason("refineMission", { ...DEFAULT_DATA_POLICY, mission: false })).toBe(
      "Mission refinement is off because the mission is not shared with AI (Settings → AI).",
    );
    expect(jobOffReason("tagProactivity", { ...DEFAULT_DATA_POLICY, taskNotes: false })).toBeNull();
    expect(jobOffReason("weeklyReview", { ...DEFAULT_DATA_POLICY, tasks: false, people: false })).toBeNull();
    expect(jobOffReason("weeklyReview", { ...DEFAULT_DATA_POLICY, tasks: false, people: false, habitsAndRenewal: false })).toMatch(/weekly review is off/);
  });
});
