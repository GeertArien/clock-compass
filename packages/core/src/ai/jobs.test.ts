import { describe, expect, it } from "vitest";
import { assistantAvailability } from "../assistant/agent.js";
import { AnthropicAiProvider } from "./anthropic-provider.js";
import { CodexCredentialManager, CodexResponsesProvider } from "./codex-provider.js";
import { AI_JOBS, aiJobsFromEnvironment, choiceFromEnvironment, type AiEnvironment } from "./jobs.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { NoopAiProvider } from "./provider.js";

const none: AiEnvironment = {
  aiProvider: undefined,
  anthropicApiKey: undefined,
  anthropicModel: undefined,
  openaiBaseUrl: undefined,
  openaiApiKey: undefined,
  openaiModel: undefined,
  codexModel: undefined,
};
const codexCredentials = new CodexCredentialManager({
  get: async () => null,
  upsert: async () => undefined,
  remove: async () => undefined,
} as never);

describe("choiceFromEnvironment (today's configuration)", () => {
  it("picks Anthropic when its key is set, with the default or configured model", () => {
    const d = choiceFromEnvironment({ ...none, anthropicApiKey: "k" }, codexCredentials);
    expect(d).toMatchObject({ providerName: "anthropic", model: "claude-opus-4-8" });
    expect(d.provider).toBeInstanceOf(AnthropicAiProvider);
    expect(choiceFromEnvironment({ ...none, anthropicApiKey: "k", anthropicModel: "claude-opus-5-5" }, codexCredentials).model).toBe(
      "claude-opus-5-5",
    );
  });

  it("picks an OpenAI-compatible endpoint when only it is configured", () => {
    const c = choiceFromEnvironment({ ...none, openaiBaseUrl: "http://x/v1", openaiModel: "llama3.2" }, codexCredentials);
    expect(c).toMatchObject({ providerName: "openai-compatible", model: "llama3.2" });
    expect(c.provider).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it("picks Codex only when asked, and no AI when nothing is set", () => {
    const codex = choiceFromEnvironment({ ...none, aiProvider: "codex" }, codexCredentials);
    expect(codex).toMatchObject({ providerName: "codex", model: "gpt-5" });
    expect(codex.provider).toBeInstanceOf(CodexResponsesProvider);
    const off = choiceFromEnvironment(none, codexCredentials);
    expect(off).toEqual({ provider: expect.any(NoopAiProvider), providerName: "none", model: null });
  });
});

describe("aiJobsFromEnvironment (the seam for #94)", () => {
  it("gives every job the same provider and model today", () => {
    const jobs = aiJobsFromEnvironment({ ...none, anthropicApiKey: "k" }, codexCredentials);
    const first = jobs.forJob("assistant");
    for (const job of AI_JOBS) expect(jobs.forJob(job)).toBe(first);
    expect(AI_JOBS).toEqual(["assistant", "classifyTask", "tagProactivity", "refineMission", "weeklyReview"]);
  });

  it("reports the assistant unavailable for Codex and for no AI, available for Anthropic and OpenAI-compatible", async () => {
    const env = (e: Partial<AiEnvironment>) => aiJobsFromEnvironment({ ...none, ...e }, codexCredentials);
    expect(await assistantAvailability(env({ aiProvider: "codex" }))).toEqual({ available: false, reason: "unsupported-provider" });
    expect(await assistantAvailability(env({}))).toEqual({ available: false, reason: "no-provider" });
    expect(await assistantAvailability(env({ anthropicApiKey: "k" }))).toEqual({ available: true });
    expect(await assistantAvailability(env({ openaiBaseUrl: "http://x/v1", openaiModel: "m" }))).toEqual({ available: true });
  });
});
