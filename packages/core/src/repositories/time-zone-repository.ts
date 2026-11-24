import type { PrismaClient } from "@prisma/client";

/**
 * The zone the app last reported (#136), on the single settings row that
 * also holds the quiet hours (read in that zone). The only place Prisma is
 * touched for it.
 */
export interface TimeZoneRepository {
  reported(): Promise<string | null>;
  setReported(zone: string): Promise<void>;
}

export class PrismaTimeZoneRepository implements TimeZoneRepository {
  constructor(private readonly db: PrismaClient) {}

  private async row() {
    return (await this.db.notificationSettings.findFirst()) ?? this.db.notificationSettings.create({ data: {} });
  }

  async reported(): Promise<string | null> {
    const row = await this.db.notificationSettings.findFirst({ select: { timeZone: true } });
    return row?.timeZone ?? null;
  }

  async setReported(zone: string): Promise<void> {
    const row = await this.row();
    await this.db.notificationSettings.update({ where: { id: row.id }, data: { timeZone: zone } });
  }
}
