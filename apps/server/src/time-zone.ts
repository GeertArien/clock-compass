import type { FastifyInstance, FastifyRequest } from "fastify";
import { fallbackZone, isTimeZone, type FallbackZone } from "@clock-compass/core";

declare module "fastify" {
  interface FastifyInstance {
    /** The zone used where no device asks (#136): `TZ`, else the app's, else UTC. */
    zones: { fallback(): FallbackZone; reported(): string | null };
  }
}

/** The fallback zone of this server, or the rule without a reported zone. */
export function fallbackOf(fastify: FastifyInstance): string {
  return fastify.hasDecorator("zones") ? fastify.zones.fallback().zone : fallbackZone(null).zone;
}

/**
 * Whose "today" a request means (#112, #136). The app sends the device's zone
 * on every request as `X-Time-Zone`; "today" and "this week" are then the day
 * in that zone. Without the header (MCP, an API script), or with a zone this
 * server does not know, it is the fallback zone: `TZ` when set, else the zone
 * the app last reported, else UTC. The header never changes the stored zone:
 * the app reports it on purpose (`PUT /settings/time-zone`).
 */
export function callerClock(req: FastifyRequest): { timeZone: string } {
  const zone = req.headers["x-time-zone"];
  return { timeZone: isTimeZone(zone) ? zone : fallbackOf(req.server) };
}

/**
 * `TZ`, checked at start-up. Node falls back to UTC without a word on a zone
 * it does not know; this refuses it instead, so a typo cannot quietly move
 * "today" for MCP, push and scripts. An empty `TZ` counts as not set (#136).
 */
export function checkServerZone(env: NodeJS.ProcessEnv = process.env): { ok: true } | { error: string } {
  const tz = env.TZ?.trim();
  if (tz && !isTimeZone(tz)) {
    return { error: `TZ="${env.TZ}" is not a time zone this server knows. Use an IANA name such as Europe/Brussels, or leave TZ unset to follow the app.` };
  }
  return { ok: true };
}
