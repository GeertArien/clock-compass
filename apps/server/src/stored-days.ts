import { notPlainDaysMessage, type StoredDayCheckRepository } from "@clock-compass/core";

/**
 * The start-up check of #137: every stored day must be a plain date. One
 * that is not was written before #112 or #136, and this version can no longer
 * read it, so the server must not start. Run before anything else at start-up
 * touches the database; it only reads.
 */
export async function checkStoredDays(repo: StoredDayCheckRepository): Promise<{ ok: true } | { error: string }> {
  const count = await repo.countNotPlain();
  return count === 0 ? { ok: true } : { error: notPlainDaysMessage(count) };
}
