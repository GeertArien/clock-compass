import type { FastifyRequest } from "fastify";
import { isTimeZone, serverZone } from "@clock-compass/core";

/**
 * Whose "today" a request means (#112). The app sends the device's zone on
 * every request as `X-Time-Zone`; "today" and "this week" are then the day in
 * that zone. Without the header (MCP, an API script), or with a zone this
 * server does not know, it is the server's own zone (`TZ`): the services fall
 * back to it when `timeZone` is absent.
 */
export function callerClock(req: FastifyRequest): { timeZone?: string } {
  const zone = req.headers["x-time-zone"];
  return isTimeZone(zone) ? { timeZone: zone } : {};
}

/**
 * The server's zone from `TZ`, checked at start-up. Node falls back to UTC
 * without a word on a zone it does not know; this refuses it instead, so a
 * typo cannot quietly move "today" for MCP, push and scripts.
 */
export function checkServerZone(env: NodeJS.ProcessEnv = process.env): { zone: string } | { error: string } {
  const tz = env.TZ;
  if (tz && !isTimeZone(tz)) {
    return { error: `TZ="${tz}" is not a time zone this server knows. Use an IANA name such as Europe/Brussels, or leave TZ unset for UTC.` };
  }
  return { zone: serverZone() };
}
