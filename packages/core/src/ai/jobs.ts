import { AnthropicAiProvider } from "./anthropic-provider.js";
import { CodexResponsesProvider, type CodexCredentialManager } from "./codex-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { NoopAiProvider, type AiProvider } from "./provider.js";

/**
 * Every AI job the app runs. Issue #94 will let the owner pick a provider and
 * model per job; this list is what that setting is keyed by.
 */
export const AI_JOBS = [
  "assistant",
  "classifyTask",
  "tagProactivity",
  "refineMission",
  "weeklyReview",
] as const;
export type AiJob = (typeof AI_JOBS)[number];

export type AiProviderName = "anthropic" | "openai-compatible" | "codex" | "none";

/** Which provider and model a job runs on. */
export interface AiJobChoice {
  provider: AiProvider;
  providerName: AiProviderName;
  /** The model the provider will call; null when AI is off. */
  model: string | null;
}

/**
 * THE place that answers "which provider and model does this AI job use?"
 * (seam for #94). Today every job gets the same choice, from the environment;
 * #94 adds a stored per-job setting behind this interface without touching the
 * callers (AiService, the assistant's agent loop).
 */
export interface AiJobs {
  forJob(job: AiJob): AiJobChoice;
}

/** Every job on one provider and model. */
export class SameForEveryJob implements AiJobs {
  constructor(private readonly choice: AiJobChoice) {}
  forJob(): AiJobChoice {
    return this.choice;
  }
}

/** One provider for every job, e.g. in tests. */
export function singleProvider(provider: AiProvider, providerName: AiProviderName = "anthropic"): AiJobs {
  return new SameForEveryJob({ provider, providerName, model: null });
}

/** The AI settings read from the environment (API keys stay there, never in the database). */
export interface AiEnvironment {
  aiProvider: string | undefined;
  anthropicApiKey: string | undefined;
  anthropicModel: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiApiKey: string | undefined;
  openaiModel: string | undefined;
  codexModel: string | undefined;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
export const DEFAULT_CODEX_MODEL = "gpt-5";

/**
 * Today's configuration, chosen once from the environment. AI_PROVIDER forces
 * a choice; otherwise it's inferred: Anthropic when ANTHROPIC_API_KEY is set,
 * else an OpenAI-compatible endpoint (ChatGPT, Ollama, LM Studio, OpenRouter…)
 * when OPENAI_BASE_URL + OPENAI_MODEL are set, else no AI.
 *
 * The Codex (ChatGPT subscription) provider is only ever chosen explicitly via
 * AI_PROVIDER=codex — never inferred — because it needs an interactive sign-in
 * before it can do anything.
 */
export function choiceFromEnvironment(
  env: AiEnvironment,
  codexCredentials: CodexCredentialManager,
): AiJobChoice {
  const openaiConfigured = !!(env.openaiBaseUrl && env.openaiModel);
  const choice =
    env.aiProvider ??
    (env.anthropicApiKey ? "anthropic" : openaiConfigured ? "openai-compatible" : "none");

  if (choice === "anthropic" && env.anthropicApiKey) {
    const model = env.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
    return {
      provider: new AnthropicAiProvider({ apiKey: env.anthropicApiKey, model }),
      providerName: "anthropic",
      model,
    };
  }
  if (choice === "openai-compatible" && openaiConfigured) {
    return {
      provider: new OpenAiCompatibleProvider({
        baseUrl: env.openaiBaseUrl!,
        apiKey: env.openaiApiKey,
        model: env.openaiModel!,
      }),
      providerName: "openai-compatible",
      model: env.openaiModel!,
    };
  }
  if (choice === "codex") {
    const model = env.codexModel ?? DEFAULT_CODEX_MODEL;
    return {
      provider: new CodexResponsesProvider(codexCredentials, { model }),
      providerName: "codex",
      model,
    };
  }
  return { provider: new NoopAiProvider(), providerName: "none", model: null };
}

/** Today: every job on the environment's provider and model. */
export function aiJobsFromEnvironment(
  env: AiEnvironment,
  codexCredentials: CodexCredentialManager,
): AiJobs {
  return new SameForEveryJob(choiceFromEnvironment(env, codexCredentials));
}
