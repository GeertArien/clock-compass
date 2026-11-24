/**
 * The zone the server uses where no device asks (#136). The app reports its
 * zone on purpose (`PUT /settings/time-zone`, when it starts and when it
 * comes back to the foreground in another zone); a request header never sets
 * it. `TZ`, when set, wins (see `fallbackZone`).
 *
 * The server keeps the reported zone in memory, so "today" can be read
 * without a query on every request; the MCP program, a separate process,
 * reads it from the database on each call (`currentFallbackZone`).
 */
import { fallbackZone, type FallbackZone } from "../domain/fallback-zone.js";
import { isTimeZone } from "../domain/zoned.js";
import type { TimeZoneRepository } from "../repositories/time-zone-repository.js";

export class TimeZoneError extends Error {
  readonly status = 400;
}

export class TimeZoneService {
  private reportedZone: string | null = null;

  constructor(
    private readonly repo: TimeZoneRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Reads the stored zone (at start-up). */
  async load(): Promise<void> {
    this.reportedZone = await this.repo.reported();
  }

  /** The zone the app last reported, or null. */
  reported(): string | null {
    return this.reportedZone;
  }

  /** The zone in use where no device asks, and where it comes from. */
  fallback(): FallbackZone {
    return fallbackZone(this.reportedZone, this.env);
  }

  /**
   * The app reports its zone. Written only when it changed. `first` is true
   * when no zone was known before: the moment the automatic move of old
   * scheduled days runs once more (#136).
   */
  async report(zone: string): Promise<{ changed: boolean; first: boolean }> {
    if (!isTimeZone(zone)) throw new TimeZoneError(`"${zone}" is not a time zone this server knows.`);
    if (zone === this.reportedZone) return { changed: false, first: false };
    const first = this.reportedZone === null;
    await this.repo.setReported(zone);
    this.reportedZone = zone;
    return { changed: true, first };
  }
}

/** The fallback zone read fresh from the database (the MCP program). */
export async function currentFallbackZone(repo: TimeZoneRepository, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  try {
    return fallbackZone(await repo.reported(), env).zone;
  } catch {
    return fallbackZone(null, env).zone;
  }
}
