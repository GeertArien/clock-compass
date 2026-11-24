/**
 * AI settings (issue #94): providers, a provider and model per AI job, and
 * the data switches, stored in the database and changed from Settings → AI.
 *
 * Keys are write-only: they are taken in, stored with their format marker
 * (`plain:`), used to build a provider client, and never returned, exported
 * or logged. A provider's own error text is passed on with the key taken out.
 */
import { DATA_CATEGORIES, DEFAULT_DATA_POLICY, type DataCategory } from "../assistant/data-policy.js";
import type { CodexCredentialManager } from "../ai/codex-provider.js";
import { AI_JOBS, type AiJob } from "../ai/jobs.js";
import {
  ANTHROPIC_API_URL,
  JOB_DATA,
  JOB_KEYS,
  PROVIDER_KINDS,
  checkAddress,
  itemShared,
  jobOffReason,
  noRedirectFetch,
  readKey,
  redact,
  storeKey,
  type JobKey,
  type ProviderKind,
  type StoredAiConfig,
  type StoredAiSettings,
} from "../ai/settings.js";
import type { AiSettingsRepository, StoredJob, StoredProvider } from "../repositories/ai-settings-repository.js";

export class AiSettingsError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "AiSettingsError";
  }
}

export interface ProviderInput {
  name?: string;
  kind?: string;
  /** The endpoint address; null removes it. */
  baseUrl?: string | null;
  /** A new key; null removes the stored one; absent keeps it. */
  apiKey?: string | null;
  models?: string[];
}

export interface ProviderView extends StoredProvider {
  /** Said when a key would travel over plain http to a public address. */
  warning: string | null;
}

export interface JobView {
  job: JobKey;
  providerId: string | null;
  model: string | null;
  /** What it sends with the current switches (absent for "default"). */
  sends?: { label: string; shared: boolean }[];
  /** Null when it can run with the current switches, else why not. */
  offBecause?: string | null;
}

export interface AiSettingsView {
  providers: ProviderView[];
  jobs: JobView[];
  switches: { category: DataCategory; enabled: boolean; byDefault: boolean }[];
}

const MAX_NAME = 80;
const MAX_MODELS = 100;
const MAX_MODEL_NAME = 200;
const MAX_KEY = 1000;
const TIMEOUT_MS = 15_000;

/** Everything the server needs to build the providers, read from the repository. */
export async function loadStoredConfig(repo: AiSettingsRepository): Promise<StoredAiConfig> {
  const [providers, jobs, switches] = await Promise.all([repo.listProviders(), repo.listJobs(), repo.listSwitches()]);
  const secrets = new Map<string, string>();
  for (const p of providers) {
    if (!p.keySet) continue;
    const secret = await repo.secretFor(p.id);
    if (secret) secrets.set(p.id, secret);
  }
  return { providers, secrets, jobs, switches };
}

function cleanModels(models: unknown): string[] {
  if (!Array.isArray(models)) throw new AiSettingsError(400, "models: a list of model names.");
  const names = [...new Set(models.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean))];
  if (names.length > MAX_MODELS) throw new AiSettingsError(400, `models: at most ${MAX_MODELS} names.`);
  if (names.some((m) => m.length > MAX_MODEL_NAME)) throw new AiSettingsError(400, `models: a name has at most ${MAX_MODEL_NAME} characters.`);
  return names;
}

export class AiSettingsService {
  constructor(
    private readonly repo: AiSettingsRepository,
    private readonly settings: StoredAiSettings,
    private readonly codex: CodexCredentialManager,
    private readonly fetchImpl: typeof fetch = noRedirectFetch,
  ) {}

  // --- Reading -------------------------------------------------------------------

  async view(): Promise<AiSettingsView> {
    const [providers, jobs] = await Promise.all([this.repo.listProviders(), this.repo.listJobs()]);
    const policy = this.settings.policy();
    const row = (job: JobKey) => jobs.find((j) => j.job === job);
    return {
      providers: providers.map((p) => ({
        ...p,
        warning: p.baseUrl ? (checkAddress(p.baseUrl, p.keySet) as { warning?: string | null }).warning ?? null : null,
      })),
      jobs: JOB_KEYS.map((job) => {
        const stored = row(job);
        const base = { job, providerId: stored?.providerId ?? null, model: stored?.model ?? null };
        if (job === "default") return base;
        return {
          ...base,
          sends: JOB_DATA[job].sends.map((item) => ({ label: item.label, shared: itemShared(item, policy) })),
          offBecause: jobOffReason(job, policy),
        };
      }),
      switches: DATA_CATEGORIES.map((category) => ({
        category,
        enabled: policy[category],
        byDefault: DEFAULT_DATA_POLICY[category],
      })),
    };
  }

  // --- Providers -----------------------------------------------------------------

  private async existing(id: string): Promise<StoredProvider> {
    const found = await this.repo.findProvider(id);
    if (!found) throw new AiSettingsError(404, "That provider does not exist.");
    return found;
  }

  /** The checked fields of a provider as it would be after `input`. */
  private async checked(input: ProviderInput, current: StoredProvider | null) {
    const kind = (input.kind ?? current?.kind) as ProviderKind | undefined;
    if (!kind || !(PROVIDER_KINDS as readonly string[]).includes(kind)) {
      throw new AiSettingsError(400, `kind: one of ${PROVIDER_KINDS.join(", ")}.`);
    }
    if (current && input.kind !== undefined && input.kind !== current.kind) {
      throw new AiSettingsError(400, "A provider's kind cannot change; add a new provider instead.");
    }
    const name = (input.name ?? current?.name ?? "").trim();
    if (!name || name.length > MAX_NAME) throw new AiSettingsError(400, `name: 1 to ${MAX_NAME} characters.`);
    const others = await this.repo.listProviders();
    if (others.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== current?.id)) {
      throw new AiSettingsError(409, `There is already a provider named "${name}".`);
    }
    if (kind === "codex" && !current && others.some((p) => p.kind === "codex")) {
      throw new AiSettingsError(409, "There is one ChatGPT subscription provider already: it uses the one ChatGPT sign-in.");
    }

    if (input.apiKey !== undefined && input.apiKey !== null) {
      if (kind === "codex") throw new AiSettingsError(400, "The ChatGPT subscription signs in with ChatGPT; it takes no key.");
      if (!input.apiKey.trim() || input.apiKey.length > MAX_KEY || /\s/.test(input.apiKey.trim())) {
        throw new AiSettingsError(400, "apiKey: the key as the provider gives it, without spaces.");
      }
    }
    const keyWillBeSet = input.apiKey === undefined ? !!current?.keySet : input.apiKey !== null;
    if (kind === "anthropic" && !keyWillBeSet) throw new AiSettingsError(400, "An Anthropic provider needs its API key.");

    let baseUrl = input.baseUrl === undefined ? current?.baseUrl ?? null : input.baseUrl;
    if (kind === "codex" && baseUrl) throw new AiSettingsError(400, "The ChatGPT subscription has no address.");
    if (kind === "openai-compatible" && !baseUrl) throw new AiSettingsError(400, "An OpenAI-compatible provider needs its address (for example http://localhost:11434/v1).");
    if (baseUrl) {
      const check = checkAddress(baseUrl.trim(), keyWillBeSet);
      if (!check.ok) throw new AiSettingsError(400, check.error);
      baseUrl = check.address;
    }
    const models = input.models !== undefined ? cleanModels(input.models) : undefined;
    return { kind, name, baseUrl, models };
  }

  async addProvider(input: ProviderInput): Promise<ProviderView> {
    const { kind, name, baseUrl, models } = await this.checked(input, null);
    const key = input.apiKey ? storeKey(input.apiKey.trim()) : null;
    const created = await this.repo.createProvider({
      name,
      kind,
      baseUrl,
      apiKey: key?.apiKey ?? null,
      keyHint: key?.keyHint ?? null,
      models: models ?? [],
    });
    await this.settings.reload();
    return this.withWarning(created);
  }

  async updateProvider(id: string, input: ProviderInput): Promise<ProviderView> {
    const current = await this.existing(id);
    const { name, baseUrl, models } = await this.checked(input, current);
    const key = input.apiKey === undefined ? undefined : input.apiKey === null ? null : storeKey(input.apiKey.trim());
    const updated = await this.repo.updateProvider(id, {
      name,
      baseUrl,
      ...(models !== undefined ? { models } : {}),
      ...(key === undefined ? {} : key === null ? { apiKey: null, keyHint: null } : { apiKey: key.apiKey, keyHint: key.keyHint }),
    });
    await this.settings.reload();
    return this.withWarning(updated);
  }

  async removeProvider(id: string): Promise<void> {
    await this.existing(id);
    await this.repo.deleteProvider(id);
    await this.settings.reload();
  }

  private withWarning(p: StoredProvider): ProviderView {
    const check = p.baseUrl ? checkAddress(p.baseUrl, p.keySet) : null;
    return { ...p, warning: check?.ok ? check.warning : null };
  }

  // --- Jobs and switches ---------------------------------------------------------

  /** Replace every job choice. A job left out uses the default. */
  async setJobs(jobs: { job: string; providerId: string | null; model: string | null }[]): Promise<void> {
    const providers = new Map((await this.repo.listProviders()).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const rows: StoredJob[] = [];
    for (const j of jobs) {
      if (!(JOB_KEYS as readonly string[]).includes(j.job)) throw new AiSettingsError(400, `job: one of ${JOB_KEYS.join(", ")}.`);
      if (seen.has(j.job)) throw new AiSettingsError(400, `job "${j.job}" is listed twice.`);
      seen.add(j.job);
      if (!j.providerId) continue; // "use the default" (or, for the default, AI off)
      const provider = providers.get(j.providerId);
      if (!provider) throw new AiSettingsError(422, `job "${j.job}": that provider does not exist.`);
      if (provider.kind === "codex" && j.job === "assistant") {
        throw new AiSettingsError(422, "The ChatGPT subscription is not available for the assistant yet.");
      }
      const model = j.model?.trim() || null;
      if (!model) throw new AiSettingsError(400, `job "${j.job}": choose one of the provider's models.`);
      if (!provider.models.includes(model)) {
        throw new AiSettingsError(422, `job "${j.job}": "${model}" is not one of the models kept for ${provider.name}.`);
      }
      rows.push({ job: j.job, providerId: provider.id, model });
    }
    await this.repo.replaceJobs(rows);
    await this.settings.reload();
  }

  async setSwitches(switches: { category: string; enabled: boolean }[]): Promise<void> {
    for (const s of switches) {
      if (!(DATA_CATEGORIES as readonly string[]).includes(s.category)) {
        throw new AiSettingsError(400, `category: one of ${DATA_CATEGORIES.join(", ")}.`);
      }
    }
    await this.repo.setSwitches(switches);
    await this.settings.reload();
  }

  // --- Talking to a provider -----------------------------------------------------

  /** One request to a provider's model list, with its own error made safe to show. */
  private async models(provider: StoredProvider): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
    const key = readKey(provider.keySet ? await this.repo.secretFor(provider.id) : null);
    if (provider.kind === "codex") {
      const status = await this.codex.status();
      return status.connected
        ? { ok: true, models: [] }
        : { ok: false, message: "No ChatGPT account is connected yet: sign in with ChatGPT first." };
    }
    if (provider.keySet && !key) return { ok: false, message: "This provider needs its key again." };
    const anthropic = provider.kind === "anthropic";
    const url = anthropic ? `${provider.baseUrl ?? ANTHROPIC_API_URL}/v1/models?limit=100` : `${provider.baseUrl}/models`;
    const headers: Record<string, string> = anthropic
      ? { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" }
      : key
        ? { Authorization: `Bearer ${key}` }
        : {};
    try {
      const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try {
          const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
          message = (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? text;
        } catch {
          // not JSON: the text as it came
        }
        return { ok: false, message: redact(`HTTP ${res.status}: ${message || res.statusText}`, key) };
      }
      const body = JSON.parse(text) as { data?: { id?: unknown }[]; models?: { name?: unknown }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((m): m is string => typeof m === "string");
      return { ok: true, models: ids.sort() };
    } catch (err) {
      const e = err as Error & { cause?: { message?: string } };
      const why = e.name === "TimeoutError" ? "no answer within 15 seconds" : (e.cause?.message ?? e.message);
      const redirected = /redirect/i.test(why) ? "The provider answered with a redirect; it is refused so the key does not go to another address." : null;
      return { ok: false, message: redirected ?? redact(`Could not reach the provider: ${why}`, key) };
    }
  }

  /** One small request (the model list): no user data. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const outcome = await this.models(await this.existing(id));
    return outcome.ok ? { ok: true, message: "The provider answered." } : { ok: false, message: outcome.message };
  }

  /** The provider's own model list, to choose from; nothing is stored. */
  async loadModels(id: string): Promise<{ models: string[] }> {
    const provider = await this.existing(id);
    const outcome = await this.models(provider);
    if (!outcome.ok) throw new AiSettingsError(422, outcome.message);
    return { models: outcome.models };
  }
}

/** The jobs, for callers that need the list (the screen keys its rows by them). */
export const SETTING_JOBS: readonly AiJob[] = AI_JOBS;
