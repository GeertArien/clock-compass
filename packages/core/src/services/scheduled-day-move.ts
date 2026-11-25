/**
 * The automatic move of old scheduled days to plain dates (#136).
 *
 * LEGACY (to remove in #137, once every stored day has moved).
 *
 * Runs at start-up and whenever the app reports a new zone. Each
 * old value (midnight on the device that scheduled it) is read in the zones
 * the server knows: the one the app reported, then `TZ` if set. All or
 * nothing: if any value is a midnight in none of them, nothing is moved, and
 * the owner is told (the log and a line in Settings) with the command for
 * that case (`days:migrate --from <zone>`, for example tasks scheduled while
 * travelling). Habit marks and weekly intentions are not moved here: their
 * zone is the old server's, which the server cannot know.
 */
import { envZone } from "../domain/fallback-zone.js";
import type { DayRepository } from "../repositories/day-repository.js";
import { countOldScheduledDays, describeScheduledMove, planScheduledDayMove, scheduledExamples } from "./day-migration.js";

export type ScheduledDayMoveOutcome =
  | { kind: "nothing" }
  | { kind: "moved"; count: number; lines: string[] }
  | { kind: "refused"; count: number; lines: string[] }
  | { kind: "no-zone"; count: number; lines: string[] };

const COMMAND = "node apps/server/dist/days-migrate.js --from <zone> --dry-run";

/** The zones old scheduled days are read in: the reported one, then `TZ`. */
export function knownZones(reported: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  const zones = [reported, envZone(env)].filter((z): z is string => !!z);
  return [...new Set(zones)];
}

/** Move the old scheduled days if every one fits a known zone. */
export async function moveScheduledDays(repo: DayRepository, zones: readonly string[]): Promise<ScheduledDayMoveOutcome> {
  const days = await repo.findAll();
  const count = countOldScheduledDays(days);
  if (count === 0) return { kind: "nothing" };
  if (zones.length === 0) {
    return {
      kind: "no-zone",
      count,
      lines: [
        `${count} scheduled days are in the old form (midnight on the device that scheduled them). They are moved as soon as the app reports its zone; until then they read as before.`,
      ],
    };
  }
  const plan = planScheduledDayMove(days, zones);
  if (plan.refused.length) {
    return {
      kind: "refused",
      count,
      lines: [
        `${count} scheduled days are in the old form, and ${plan.refused.length} of them are not a midnight in ${zones.join(" or ")}. Nothing was moved; they read as before.`,
        `To move them, name every zone they were scheduled in: ${COMMAND} (give --from once per zone), then again without --dry-run.`,
        ...plan.refused.slice(0, 3).map((r) => `  Task ${r.id}: ${r.value.toISOString()}`),
      ],
    };
  }
  await repo.apply(plan);
  return {
    kind: "moved",
    count: plan.scheduled.length,
    lines: [
      `Moved ${plan.scheduled.length} scheduled days to plain dates, read in ${zones.join(" or ")}. The days and times shown do not change. Examples:`,
      ...scheduledExamples(plan.scheduled).map(describeScheduledMove),
    ],
  };
}
