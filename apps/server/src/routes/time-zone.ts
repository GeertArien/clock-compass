import type { FastifyInstance } from "fastify";
import {
  TimeZoneError,
  countOldScheduledDays,
  knownZones,
  type DayRepository,
  type TimeZoneService,
} from "@clock-compass/core";
import { runScheduledDayMove } from "../time-zone.js";

export interface TimeZoneRouteOptions {
  service: TimeZoneService;
  /** The stored days, for the automatic move and the Settings line (#136, legacy until #137). */
  days: DayRepository;
  /** Where the move reports (the console: the production logger is off). */
  log?: { info(msg: string): void; warn(msg: string): void };
}

const viewSchema = {
  type: "object",
  properties: {
    zone: { type: "string", description: "The zone used where no device asks (MCP, scripts, push)." },
    source: { type: "string", enum: ["TZ", "app", "default"], description: "TZ (the override), app (reported by the app) or default (UTC)." },
    reported: { type: ["string", "null"], description: "The zone the app last reported." },
    oldScheduledDays: {
      type: "object",
      description:
        "LEGACY (#136, until #137): scheduled days still in the old form. `reason` is no-zone (no zone known yet) or refused (they fit no known zone; the command is needed).",
      properties: { count: { type: "integer" }, reason: { type: ["string", "null"], enum: ["no-zone", "refused", null] } },
      required: ["count", "reason"],
    },
  },
  required: ["zone", "source", "reported", "oldScheduledDays"],
} as const;

const errorSchema = { type: "object", properties: { error: { type: "string" } } } as const;

/**
 * The zone the app reports (#136). The app calls `PUT` when it starts and
 * when it comes back to the foreground in another zone; a request header
 * never sets it. Only the server's own token may (`requireOwner`): a
 * generated API key gets 403, since the zone moves the owner's push hours
 * and MCP's "today".
 */
export async function timeZoneRoutes(fastify: FastifyInstance, options: TimeZoneRouteOptions): Promise<void> {
  const { service, days } = options;
  const owner = { preHandler: fastify.requireOwner };
  const secured = [{ bearerAuth: [] }];

  async function view() {
    const { zone, source } = service.fallback();
    // LEGACY (#136, to remove in #137): the count behind the Settings line.
    const count = countOldScheduledDays(await days.findAll());
    const reason = count === 0 ? null : knownZones(service.reported()).length ? "refused" : "no-zone";
    return { zone, source, reported: service.reported(), oldScheduledDays: { count, reason } };
  }

  fastify.get(
    "/settings/time-zone",
    {
      ...owner,
      schema: {
        description: "The zone used where no device asks, and where it comes from.",
        tags: ["settings"],
        security: secured,
        response: { 200: viewSchema },
      },
    },
    view,
  );

  fastify.put(
    "/settings/time-zone",
    {
      ...owner,
      schema: {
        description:
          "The app reports its zone (IANA name). Used for MCP, API calls without X-Time-Zone and push hours, unless TZ is set. The server's own token only.",
        tags: ["settings"],
        security: secured,
        body: {
          type: "object",
          required: ["timeZone"],
          additionalProperties: false,
          properties: { timeZone: { type: "string", minLength: 1, maxLength: 64 } },
        },
        response: { 200: viewSchema, 400: errorSchema },
      },
    },
    async (req, reply) => {
      const { timeZone } = req.body as { timeZone: string };
      try {
        const { changed } = await service.report(timeZone);
        // LEGACY (#136, to remove in #137): a newly reported zone is a moment
        // old scheduled days may be readable, without a restart. Not only the
        // first one: the app may first be opened away from home, where the
        // old values do not fit, and report the home zone later.
        if (changed) await runScheduledDayMove(days, service.reported(), options.log ?? console);
      } catch (err) {
        if (err instanceof TimeZoneError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      return view();
    },
  );
}
