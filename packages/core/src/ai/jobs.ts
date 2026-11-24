import { NoopAiProvider, type AiProvider } from "./provider.js";

/**
 * Every AI job the app runs. Each can use its own provider and model, chosen
 * in Settings → AI (issue #94); this list is what that setting is keyed by.
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
 * THE place that answers "which provider and model does this AI job use?".
 * The server's answer comes from the stored settings (`StoredAiSettings`,
 * #94); tests use one provider for every job.
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

/** No AI at all: every job off. */
export function noAi(): AiJobs {
  return new SameForEveryJob({ provider: new NoopAiProvider(), providerName: "none", model: null });
}
