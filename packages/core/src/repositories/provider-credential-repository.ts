import type { PrismaClient, ProviderCredential } from "@prisma/client";

/** Fields written when storing or refreshing a provider's OAuth credentials. */
export interface ProviderCredentialInput {
  accessToken: string;
  refreshToken: string;
  accountId?: string | null;
  expiresAt: Date;
  label?: string | null;
}

/** The only place Prisma is touched for AI provider OAuth credentials. */
export interface ProviderCredentialRepository {
  get(provider: string): Promise<ProviderCredential | null>;
  upsert(provider: string, data: ProviderCredentialInput): Promise<ProviderCredential>;
  delete(provider: string): Promise<void>;
}

export class PrismaProviderCredentialRepository
  implements ProviderCredentialRepository
{
  constructor(private readonly db: PrismaClient) {}

  get(provider: string): Promise<ProviderCredential | null> {
    return this.db.providerCredential.findUnique({ where: { provider } });
  }

  upsert(
    provider: string,
    data: ProviderCredentialInput,
  ): Promise<ProviderCredential> {
    const values = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accountId: data.accountId ?? null,
      expiresAt: data.expiresAt,
      label: data.label ?? null,
    };
    return this.db.providerCredential.upsert({
      where: { provider },
      create: { provider, ...values },
      update: values,
    });
  }

  async delete(provider: string): Promise<void> {
    // deleteMany never throws on a missing row — disconnecting twice is a no-op.
    await this.db.providerCredential.deleteMany({ where: { provider } });
  }
}
