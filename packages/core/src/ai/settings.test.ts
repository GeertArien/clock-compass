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
  keyHintOf,
  policyFromSwitches,
  redact,
  type StoredAiConfig,
} from "./settings.js";
import { secretsBox } from "../secrets/box.js";

const codex = new CodexCredentialManager({ get: async () => null, upsert: async () => undefined, remove: async () => undefined } as never, secretsBox(undefined));
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
      // The opened key (loadStoredConfig passes only keys that open, #103).
      secrets: new Map([["a", "sk-ant-test"]]),
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
    // An OpenAI-compatible provider whose stored key did not open is off too:
    // it is never called without its key (#103). Without a stored key it runs.
    const lockedGateway = provider("g", "openai-compatible", { keySet: true, baseUrl: "https://gateway.example.com/v1", models: ["m"] });
    const locked = await settingsOf({ providers: [lockedGateway], jobs: [{ job: "default", providerId: "g", model: "m" }] });
    expect(locked.forJob("assistant").providerName).toBe("none");
    const keyless = await settingsOf({ providers: [local], jobs: [{ job: "default", providerId: "l", model: "llama3.2" }] });
    expect(keyless.forJob("assistant").providerName).toBe("openai-compatible");
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
  it("show their last four characters as a hint, and none for a key shorter than 20 characters", () => {
    expect(keyHintOf("sk-ant-0123456789abcdefWXYZ")).toBe("WXYZ");
    expect(keyHintOf("short-key")).toBeNull();
    expect(keyHintOf("x".repeat(19))).toBeNull();
    expect(keyHintOf("x".repeat(20))).toBe("xxxx");
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

describe("the last answer's token numbers per provider (#130)", () => {
  it("keeps them in memory for the provider's card and logs counts only, never the prompt", async () => {
    const lines: string[] = [];
    const gateway = provider("g", "openai-compatible", { name: "LiteLLM", baseUrl: "http://gw:4000/v1", models: ["claude-sonnet"] });
    const s = new StoredAiSettings(
      async () => ({ providers: [gateway], secrets: new Map(), jobs: [{ job: "default", providerId: "g", model: "claude-sonnet" }], switches: [] }),
      codex,
      (line) => lines.push(line),
    );
    await s.reload();
    expect(s.lastUsage("g")).toBeNull();

    const fetchMock = async () =>
      new Response(
        [
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Secret plan text" }, finish_reason: "stop" }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5210, prompt_tokens_details: { cached_tokens: 4980 }, cache_creation_input_tokens: 0 } })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200 },
      );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const turn = s.forJob("assistant").provider.assistantTurn!({ system: "My mission is private", messages: [{ role: "user", content: "hi" }], tools: [] });
      for await (const _ of turn) void _;
    } finally {
      globalThis.fetch = original;
    }

    expect(s.lastUsage("g")).toMatchObject({ model: "claude-sonnet", promptTokens: 5210, cachedTokens: 4980, cacheWriteTokens: 0 });
    expect(lines).toEqual(["AI usage (LiteLLM, claude-sonnet): 5,210 prompt tokens, 4,980 read from cache, 0 written."]);
    expect(lines.join()).not.toMatch(/mission|Secret|hi/);
  });
});
