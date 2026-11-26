/**
 * AI settings stored in the app (issue #94): the rules that do not touch the
 * database. Providers, keys and addresses; what each AI job sends; and the
 * one object that answers "which provider and model does this job use?" and
 * "what data may AI use?" from the stored settings.
 */
import type { DataCategory, DataPolicy } from "../assistant/data-policy.js";
import { DATA_CATEGORIES, DEFAULT_DATA_POLICY } from "../assistant/data-policy.js";
import type { StoredJob, StoredProvider } from "../repositories/ai-settings-repository.js";
import { AnthropicAiProvider } from "./anthropic-provider.js";
import { CodexResponsesProvider, type CodexCredentialManager } from "./codex-provider.js";
import { AI_JOBS, type AiJob, type AiJobChoice, type AiJobs, type AiProviderName } from "./jobs.js";
import { OpenAiCompatibleProvider, type TokenUsage } from "./openai-compatible-provider.js";
import { NoopAiProvider } from "./provider.js";

export const PROVIDER_KINDS = ["anthropic", "openai-compatible", "codex"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** A job choice as stored: a job, or "default" for every job without its own. */
export const JOB_KEYS = ["default", ...AI_JOBS] as const;
export type JobKey = (typeof JOB_KEYS)[number];

export const DEFAULT_CODEX_MODEL = "gpt-5";

/** One answer's token numbers, kept in memory for the provider's card (#130). */
export interface LastUsage extends TokenUsage {
  model: string;
  /** When the answer came, ISO. */
  at: string;
}
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

// --- Keys ----------------------------------------------------------------------

/** Keys shorter than this show no hint: four characters would be most of the key. */
export const KEY_HINT_MIN_LENGTH = 20;

/**
 * The hint shown for a key: its last four characters, for a key of 20 or more.
 * The key itself is stored encrypted (#103, `secrets/box.ts`).
 */
export function keyHintOf(key: string): string | null {
  return key.length >= KEY_HINT_MIN_LENGTH ? key.slice(-4) : null;
}

/** Longest provider message passed on to the browser. */
export const MAX_PROVIDER_MESSAGE = 300;

/** A provider's error text with the key taken out, wherever it appears, and cut short. */
export function redact(text: string, key: string | null | undefined): string {
  const clean = key ? text.split(key).join("[key]") : text;
  return clean.length > MAX_PROVIDER_MESSAGE ? `${clean.slice(0, MAX_PROVIDER_MESSAGE)}…` : clean;
}

// --- Addresses -----------------------------------------------------------------

/** Whether a host is this machine or the home network (no key leaves the house). */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan")) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // a bare name on the home network ("nas")
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ip = host.split(".").map(Number);
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = ip as [number, number, number, number];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export type AddressCheck = { ok: true; address: string; warning: string | null } | { ok: false; error: string };

/**
 * The endpoint address check (owner decision 4). Refused: anything but
 * http(s), a user name or password in it, a query or fragment, more than
 * 2,000 characters. Allowed: localhost, the home network and plain http
 * (local models live there). Warned: a key sent over plain http to a public
 * address.
 */
export function checkAddress(address: string, withKey: boolean): AddressCheck {
  if (address.length > 2000) return { ok: false, error: "The address is longer than 2,000 characters." };
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, error: "The address is not a URL (for example https://api.openai.com/v1)." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The address must start with http:// or https://." };
  }
  if (url.username || url.password) return { ok: false, error: "Put the key in the key field, not in the address." };
  if (url.search || url.hash) return { ok: false, error: "The address cannot have a query (?…) or a fragment (#…)." };
  const warning =
    url.protocol === "http:" && withKey && !isLocalHost(url.hostname)
      ? "The key would travel unencrypted: this address uses plain http and is not on this machine or the home network."
      : null;
  return { ok: true, address: address.replace(/\/+$/, ""), warning };
}

/** A fetch that refuses redirects, so a key never follows one to another host. */
export const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });

// --- What each job sends -------------------------------------------------------

/** One thing a job sends, and the categories that must all be on for it. */
export interface SentItem {
  label: string;
  categories: readonly DataCategory[];
}

export interface JobData {
  /** What the job sends; an item whose categories are off is left out. */
  sends: readonly SentItem[];
  /** The job needs at least one of these items to run at all. */
  needsOneOf: readonly string[];
  /** Said when it cannot run with the current switches. */
  offBecause: string;
}

/**
 * THE declaration of what each AI job sends (owner decision: shown per job in
 * Settings). `AiService` and the assistant send exactly this, filtered by the
 * switches, so the screen cannot drift from what is really sent.
 */
export const JOB_DATA: Readonly<Record<AiJob, JobData>> = {
  assistant: {
    sends: [
      { label: "tasks", categories: ["tasks"] },
      { label: "task notes", categories: ["taskNotes"] },
      { label: "goals, projects and roles", categories: ["goalsAndProjects"] },
      { label: "the mission", categories: ["mission"] },
      { label: "people and commitments (names, status, streaks)", categories: ["people"] },
      { label: "the emotional-bank-account balance", categories: ["ebaBalance"] },
      { label: "notes on people", categories: ["personNotes"] },
      { label: "emotional-bank-account entry notes", categories: ["ebaEntryNotes"] },
      { label: "habits and renewal", categories: ["habitsAndRenewal"] },
      { label: "your messages and today's date", categories: [] },
    ],
    needsOneOf: ["tasks", "goals, projects and roles", "the mission", "people and commitments (names, status, streaks)", "habits and renewal"],
    offBecause: "The assistant is off because no data is shared with AI (Settings → AI).",
  },
  classifyTask: {
    sends: [
      { label: "the sentence you type", categories: ["tasks"] },
      { label: "today's date", categories: [] },
    ],
    needsOneOf: ["the sentence you type"],
    offBecause: "Task classification is off because tasks are not shared with AI (Settings → AI).",
  },
  tagProactivity: {
    sends: [
      { label: "the task's title", categories: ["tasks"] },
      { label: "the task's notes", categories: ["tasks", "taskNotes"] },
    ],
    needsOneOf: ["the task's title"],
    offBecause: "Influence or concern tagging is off because tasks are not shared with AI (Settings → AI).",
  },
  refineMission: {
    sends: [{ label: "your mission draft", categories: ["mission"] }],
    needsOneOf: ["your mission draft"],
    offBecause: "Mission refinement is off because the mission is not shared with AI (Settings → AI).",
  },
  weeklyReview: {
    sends: [
      { label: "the week's label", categories: [] },
      { label: "big rock titles and whether they are done", categories: ["tasks"] },
      { label: "overdue commitments (person name and commitment title)", categories: ["people"] },
      { label: "renewal counts per dimension", categories: ["habitsAndRenewal"] },
      { label: "counts of tasks and projects with no goal", categories: ["tasks", "goalsAndProjects"] },
    ],
    needsOneOf: [
      "big rock titles and whether they are done",
      "overdue commitments (person name and commitment title)",
      "renewal counts per dimension",
      "counts of tasks and projects with no goal",
    ],
    offBecause: "The weekly review is off because none of its data is shared with AI (Settings → AI).",
  },
};

/** Whether an item may be sent under this policy. */
export function itemShared(item: SentItem, policy: DataPolicy): boolean {
  return item.categories.every((c) => policy[c]);
}

/** Whether a job sends the item with this label under this policy. */
export function sends(job: AiJob, label: string, policy: DataPolicy): boolean {
  const item = JOB_DATA[job].sends.find((i) => i.label === label);
  return !!item && itemShared(item, policy);
}

/** Null when the job can run under this policy, else why not (the app's words). */
export function jobOffReason(job: AiJob, policy: DataPolicy): string | null {
  const data = JOB_DATA[job];
  return data.needsOneOf.some((label) => sends(job, label, policy)) ? null : data.offBecause;
}

/** A job that cannot run with the current switches (answered as 409 with the reason). */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

// --- The policy from its rows --------------------------------------------------

/** The policy: each category's row, or its default when it has none. */
export function policyFromSwitches(rows: readonly { category: string; enabled: boolean }[]): DataPolicy {
  const policy: Record<DataCategory, boolean> = { ...DEFAULT_DATA_POLICY };
  for (const row of rows) {
    if ((DATA_CATEGORIES as readonly string[]).includes(row.category)) policy[row.category as DataCategory] = row.enabled;
  }
  return Object.freeze(policy);
}

// --- Jobs from the stored settings ---------------------------------------------

/** Everything needed to build the providers: the providers, their keys, the job rows. */
export interface StoredAiConfig {
  providers: readonly StoredProvider[];
  /**
   * The key of each provider whose stored key opens with this server's
   * secret, by provider id (#103). A provider with a key that does not open
   * (stored before encryption, another secret, no secret) has no entry, and
   * its jobs are off.
   */
  secrets: ReadonlyMap<string, string>;
  jobs: readonly StoredJob[];
  switches: readonly { category: string; enabled: boolean }[];
}

const OFF: AiJobChoice = { provider: new NoopAiProvider(), providerName: "none", model: null };

/**
 * A provider client for one stored provider and model, given its opened key;
 * null when it cannot be built. A provider that has a stored key which did
 * not open is off: it is never called without its key (#103).
 */
export function buildProvider(
  provider: StoredProvider,
  key: string | undefined,
  model: string,
  codex: CodexCredentialManager,
  onUsage?: (usage: TokenUsage) => void,
): AiJobChoice | null {
  const kind = provider.kind as ProviderKind;
  if (kind !== "codex" && provider.keySet && !key) return null;
  if (kind === "anthropic") {
    if (!key) return null;
    return {
      provider: new AnthropicAiProvider({ apiKey: key, model, baseUrl: provider.baseUrl ?? undefined, fetch: noRedirectFetch }),
      providerName: "anthropic",
      model,
    };
  }
  if (kind === "openai-compatible") {
    if (!provider.baseUrl) return null;
    return {
      provider: new OpenAiCompatibleProvider({ baseUrl: provider.baseUrl, apiKey: key ?? undefined, model, onUsage }),
      providerName: "openai-compatible",
      model,
    };
  }
  if (kind === "codex") return { provider: new CodexResponsesProvider(codex, { model }), providerName: "codex", model };
  return null;
}

/**
 * THE answer to "which provider and model does this job use?" and "what data
 * may AI use?" (issue #94), from a snapshot of the stored settings. The
 * server holds one and reloads it after every settings change (one process),
 * so a change applies to the next request without a restart.
 */
export class StoredAiSettings implements AiJobs {
  private choices = new Map<AiJob, AiJobChoice>();
  private policySnapshot: DataPolicy = DEFAULT_DATA_POLICY;
  /** The last answer's token numbers per provider id, since the server started (#130). */
  private readonly usage = new Map<string, LastUsage>();

  constructor(
    private readonly load: () => Promise<StoredAiConfig>,
    private readonly codex: CodexCredentialManager,
    private readonly log: (line: string) => void = (line) => console.info(line),
  ) {}

  /** The last answer's token numbers for a provider, since the server started; null before any. */
  lastUsage(providerId: string): LastUsage | null {
    return this.usage.get(providerId) ?? null;
  }

  /** Keep and log one answer's numbers: never the prompt, only counts (#130). */
  private recordUsage(provider: StoredProvider, model: string, u: TokenUsage): void {
    this.usage.set(provider.id, { model, ...u, at: new Date().toISOString() });
    const n = (v: number) => v.toLocaleString("en-US");
    const cached = u.cachedTokens === null ? "cache not reported" : `${n(u.cachedTokens)} read from cache`;
    const written = u.cacheWriteTokens === null ? "" : `, ${n(u.cacheWriteTokens)} written`;
    this.log(`AI usage (${provider.name}, ${model}): ${n(u.promptTokens)} prompt tokens, ${cached}${written}.`);
  }

  /** Read the stored settings again. */
  async reload(): Promise<void> {
    const config = await this.load();
    const byId = new Map(config.providers.map((p) => [p.id, p]));
    const row = (job: JobKey) => config.jobs.find((j) => j.job === job);
    const choiceOf = (stored: StoredJob | undefined): AiJobChoice | null => {
      const provider = stored?.providerId ? byId.get(stored.providerId) : undefined;
      if (!provider) return null;
      const model = stored!.model ?? provider.models[0] ?? (provider.kind === "codex" ? DEFAULT_CODEX_MODEL : null);
      return model
        ? buildProvider(provider, config.secrets.get(provider.id), model, this.codex, (u) => this.recordUsage(provider, model, u))
        : null;
    };
    const fallback = choiceOf(row("default"));
    const next = new Map<AiJob, AiJobChoice>();
    for (const job of AI_JOBS) next.set(job, choiceOf(row(job)) ?? fallback ?? OFF);
    this.choices = next;
    this.policySnapshot = policyFromSwitches(config.switches);
  }

  forJob(job: AiJob): AiJobChoice {
    return this.choices.get(job) ?? OFF;
  }

  /** The data policy in force. */
  policy(): DataPolicy {
    return this.policySnapshot;
  }

  /** The provider names in use, for a quick "is AI on at all" answer. */
  providerNames(): AiProviderName[] {
    return AI_JOBS.map((j) => this.forJob(j).providerName);
  }
}
