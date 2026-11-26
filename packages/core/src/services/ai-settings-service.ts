/**
 * AI settings (issue #94): providers, a provider and model per AI job, and
 * the data switches, stored in the database and changed from Settings → AI.
 *
 * Keys are write-only: they are taken in, stored encrypted with the
 * server's `SECRETS_KEY` (#103, `secrets/box.ts`), opened only to build a
 * provider client, and never returned, exported or logged. A provider's own
 * error text is passed on with the key taken out.
 *
 * Without a valid secret, a key cannot be stored (409); a provider without a
 * key can still be added, changed and used. A stored key that does not open
 * (stored as plain text before #103, another secret, no secret) is never used
 * and never changed: the provider says why, and entering the key again
 * replaces it.
 */
import { randomUUID } from "node:crypto";
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
  keyHintOf,
  noRedirectFetch,
  redact,
  type JobKey,
  type LastUsage,
  type ProviderKind,
  type StoredAiConfig,
  type StoredAiSettings,
} from "../ai/settings.js";
import type { AiSettingsRepository, StoredJob, StoredProvider } from "../repositories/ai-settings-repository.js";
import {
  SecretsUnavailableError,
  UNREADABLE_KEY,
  providerKeyPlace,
  type Opened,
  type SecretsBox,
  type SecretsKeyState,
  type Unreadable,
} from "../secrets/box.js";

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
  /** Why a stored key is not used (#103); null when it opens, or when there is none. */
  keyProblem: Unreadable | null;
  /** Said when a key would travel over plain http to a public address. */
  warning: string | null;
  /**
   * The last assistant answer's token numbers through this provider, since
   * the server started (#130); null before any, or when the endpoint did not
   * report them. Counts only, never the prompt.
   */
  lastUsage: LastUsage | null;
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
  /** Whether the server has a usable SECRETS_KEY (#103): "missing", "invalid" or "ok". Never the value. */
  secrets: { state: SecretsKeyState };
  providers: ProviderView[];
  jobs: JobView[];
  switches: { category: DataCategory; enabled: boolean; byDefault: boolean }[];
}

const MAX_NAME = 80;
const MAX_MODELS = 100;
const MAX_MODEL_NAME = 200;
const MAX_KEY = 1000;
const TIMEOUT_MS = 15_000;

/** A provider's stored key, opened with the server's secret; null when it has none. */
async function openKey(repo: AiSettingsRepository, box: SecretsBox, provider: StoredProvider): Promise<Opened | null> {
  if (!provider.keySet) return null;
  const stored = await repo.secretFor(provider.id);
  return stored === null ? null : box.open(stored, providerKeyPlace(provider.id));
}

/**
 * Everything the server needs to build the providers, read from the
 * repository: only the keys that open are passed on (#103).
 */
export async function loadStoredConfig(repo: AiSettingsRepository, box: SecretsBox): Promise<StoredAiConfig> {
  const [providers, jobs, switches] = await Promise.all([repo.listProviders(), repo.listJobs(), repo.listSwitches()]);
  const secrets = new Map<string, string>();
  for (const p of providers) {
    const opened = await openKey(repo, box, p);
    if (opened?.ok) secrets.set(p.id, opened.value);
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
    private readonly box: SecretsBox,
    private readonly fetchImpl: typeof fetch = noRedirectFetch,
  ) {}

  /** A key in its stored form, bound to its provider; refused (409) without a valid secret. */
  private seal(providerId: string, key: string): { apiKey: string; keyHint: string | null } {
    try {
      return { apiKey: this.box.seal(key, providerKeyPlace(providerId)), keyHint: keyHintOf(key) };
    } catch (err) {
      if (err instanceof SecretsUnavailableError) throw new AiSettingsError(409, err.message);
      throw err;
    }
  }

  /** Why a provider's stored key is not used, or null. */
  private async keyProblem(p: StoredProvider): Promise<Unreadable | null> {
    const opened = await openKey(this.repo, this.box, p);
    return opened && !opened.ok ? opened.why : null;
  }

  // --- Reading -------------------------------------------------------------------

  async view(): Promise<AiSettingsView> {
    const [providers, jobs] = await Promise.all([this.repo.listProviders(), this.repo.listJobs()]);
    const policy = this.settings.policy();
    const row = (job: JobKey) => jobs.find((j) => j.job === job);
    const problems = await Promise.all(providers.map((p) => this.keyProblem(p)));
    return {
      secrets: { state: this.box.state },
      providers: providers.map((p, i) => ({
        ...p,
        keyProblem: problems[i] ?? null,
        warning: p.baseUrl ? (checkAddress(p.baseUrl, p.keySet) as { warning?: string | null }).warning ?? null : null,
        lastUsage: this.settings.lastUsage(p.id),
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
    // The id comes first: the key is sealed bound to it, and the row and its
    // key are then written in one insert, so a refused or failed save leaves
    // no provider behind without its key.
    const id = randomUUID();
    const key = input.apiKey ? this.seal(id, input.apiKey.trim()) : null;
    const created = await this.repo.createProvider({
      id,
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
    const key = input.apiKey === undefined ? undefined : input.apiKey === null ? null : this.seal(id, input.apiKey.trim());
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

  private async withWarning(p: StoredProvider): Promise<ProviderView> {
    const check = p.baseUrl ? checkAddress(p.baseUrl, p.keySet) : null;
    return { ...p, keyProblem: await this.keyProblem(p), warning: check?.ok ? check.warning : null, lastUsage: this.settings.lastUsage(p.id) };
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
    const opened = provider.kind === "codex" ? null : await openKey(this.repo, this.box, provider);
    const key = opened?.ok ? opened.value : null;
    if (provider.kind === "codex") {
      const status = await this.codex.status();
      return status.connected
        ? { ok: true, models: [] }
        : { ok: false, message: "No ChatGPT account is connected yet: sign in with ChatGPT first." };
    }
    if (opened && !opened.ok) return { ok: false, message: UNREADABLE_KEY[opened.why] };
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
