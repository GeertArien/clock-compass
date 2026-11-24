import type { PrismaClient } from "@prisma/client";

/** A provider as every response may show it: everything but the key. */
export interface StoredProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  /** Whether a key is stored (the key itself is never read here). */
  keySet: boolean;
  keyHint: string | null;
  /** The model names kept for this provider. */
  models: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderWrite {
  name?: string;
  kind?: string;
  baseUrl?: string | null;
  /** The stored form (`plain:<key>`), or null to remove it; absent = unchanged. */
  apiKey?: string | null;
  keyHint?: string | null;
  models?: string[];
}

export interface StoredJob {
  job: string;
  providerId: string | null;
  model: string | null;
}

/**
 * The only place Prisma is touched for the AI settings (issue #94). Two kinds
 * of read: `listProviders`/`findProvider` never select the key and feed every
 * response; `secretFor` returns it and is used only to build a provider
 * client. None of these tables is in the data export.
 */
export interface AiSettingsRepository {
  listProviders(): Promise<StoredProvider[]>;
  findProvider(id: string): Promise<StoredProvider | null>;
  secretFor(id: string): Promise<string | null>;
  createProvider(data: Required<Pick<ProviderWrite, "name" | "kind">> & ProviderWrite): Promise<StoredProvider>;
  updateProvider(id: string, data: ProviderWrite): Promise<StoredProvider>;
  deleteProvider(id: string): Promise<void>;
  listJobs(): Promise<StoredJob[]>;
  /** Replace every job choice at once (a job left out has no row). */
  replaceJobs(jobs: StoredJob[]): Promise<void>;
  listSwitches(): Promise<{ category: string; enabled: boolean }[]>;
  /** Set the given switches (others keep their rows). */
  setSwitches(switches: { category: string; enabled: boolean }[]): Promise<void>;
}

/** Every field but the key: what a response may contain. */
const PUBLIC = {
  id: true,
  name: true,
  kind: true,
  baseUrl: true,
  keyHint: true,
  models: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PublicRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  keyHint: string | null;
  models: string;
  createdAt: Date;
  updatedAt: Date;
};

function parseModels(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

export class PrismaAiSettingsRepository implements AiSettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  /** A public row plus whether a key is stored (checked without reading it). */
  private async view(row: PublicRow): Promise<StoredProvider> {
    const withKey = await this.db.aiProviderConfig.count({ where: { id: row.id, apiKey: { not: null } } });
    return { ...row, models: parseModels(row.models), keySet: withKey > 0 };
  }

  async listProviders(): Promise<StoredProvider[]> {
    const rows = await this.db.aiProviderConfig.findMany({ select: PUBLIC, orderBy: { createdAt: "asc" } });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async findProvider(id: string): Promise<StoredProvider | null> {
    const row = await this.db.aiProviderConfig.findUnique({ where: { id }, select: PUBLIC });
    return row ? this.view(row) : null;
  }

  async secretFor(id: string): Promise<string | null> {
    const row = await this.db.aiProviderConfig.findUnique({ where: { id }, select: { apiKey: true } });
    return row?.apiKey ?? null;
  }

  async createProvider(data: Required<Pick<ProviderWrite, "name" | "kind">> & ProviderWrite): Promise<StoredProvider> {
    const row = await this.db.aiProviderConfig.create({
      data: {
        name: data.name,
        kind: data.kind,
        baseUrl: data.baseUrl ?? null,
        apiKey: data.apiKey ?? null,
        keyHint: data.keyHint ?? null,
        models: JSON.stringify(data.models ?? []),
      },
      select: PUBLIC,
    });
    return this.view(row);
  }

  async updateProvider(id: string, data: ProviderWrite): Promise<StoredProvider> {
    const row = await this.db.aiProviderConfig.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
        ...(data.apiKey !== undefined ? { apiKey: data.apiKey, keyHint: data.keyHint ?? null } : {}),
        ...(data.models !== undefined ? { models: JSON.stringify(data.models) } : {}),
      },
      select: PUBLIC,
    });
    return this.view(row);
  }

  async deleteProvider(id: string): Promise<void> {
    // Its jobs go back to "no choice": the model was one of this provider's,
    // so it goes with it (the foreign key alone would only clear the provider).
    await this.db.$transaction([
      this.db.aiJobSetting.updateMany({ where: { providerId: id }, data: { providerId: null, model: null } }),
      this.db.aiProviderConfig.delete({ where: { id } }),
    ]);
  }

  listJobs(): Promise<StoredJob[]> {
    return this.db.aiJobSetting.findMany({ select: { job: true, providerId: true, model: true } });
  }

  async replaceJobs(jobs: StoredJob[]): Promise<void> {
    await this.db.$transaction([
      this.db.aiJobSetting.deleteMany({}),
      ...jobs.map((j) => this.db.aiJobSetting.create({ data: { job: j.job, providerId: j.providerId, model: j.model } })),
    ]);
  }

  listSwitches(): Promise<{ category: string; enabled: boolean }[]> {
    return this.db.aiDataSwitch.findMany({ select: { category: true, enabled: true } });
  }

  async setSwitches(switches: { category: string; enabled: boolean }[]): Promise<void> {
    await this.db.$transaction(
      switches.map((s) =>
        this.db.aiDataSwitch.upsert({
          where: { category: s.category },
          create: { category: s.category, enabled: s.enabled },
          update: { enabled: s.enabled },
        }),
      ),
    );
  }
}
