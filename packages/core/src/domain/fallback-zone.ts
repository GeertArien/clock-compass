/**
 * The zone used where no device asks (#136): MCP calls, API calls without
 * `X-Time-Zone`, push notification hours and the Sunday review.
 *
 * One rule: `TZ` when it is set (not empty), else the zone the app last
 * reported, else UTC. `TZ` is the override, set on purpose (for example to
 * keep push hours fixed while the phone travels); without it the server
 * follows the app.
 */
import { isTimeZone } from "./zoned.js";

/** Where the zone in use comes from. */
export type ZoneSource = "TZ" | "app" | "default";

export interface FallbackZone {
  zone: string;
  source: ZoneSource;
}

/** `TZ` when it is set and not empty (an empty `TZ` counts as not set). */
export function envZone(env: NodeJS.ProcessEnv = process.env): string | null {
  const tz = env.TZ?.trim();
  return tz && isTimeZone(tz) ? tz : null;
}

/** The fallback zone from `TZ` and the zone the app reported. */
export function fallbackZone(reported: string | null | undefined, env: NodeJS.ProcessEnv = process.env): FallbackZone {
  const tz = envZone(env);
  if (tz) return { zone: tz, source: "TZ" };
  if (reported && isTimeZone(reported)) return { zone: reported, source: "app" };
  return { zone: "UTC", source: "default" };
}

/** The zone in use, in words, for the start-up log. */
export function describeFallbackZone(z: FallbackZone): string {
  switch (z.source) {
    case "TZ":
      return `${z.zone} (TZ)`;
    case "app":
      return `${z.zone} (reported by the app)`;
    default:
      return "UTC (the app has not reported its zone yet, and TZ is not set)";
  }
}
