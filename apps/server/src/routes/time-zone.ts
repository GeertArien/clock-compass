import type { FastifyInstance } from "fastify";
import { TimeZoneError, type TimeZoneService } from "@clock-compass/core";

export interface TimeZoneRouteOptions {
  service: TimeZoneService;
}

const viewSchema = {
  type: "object",
  properties: {
    zone: { type: "string", description: "The zone used where no device asks (MCP, scripts, push)." },
    source: { type: "string", enum: ["TZ", "app", "default"], description: "TZ (the override), app (reported by the app) or default (UTC)." },
    reported: { type: ["string", "null"], description: "The zone the app last reported." },
  },
  required: ["zone", "source", "reported"],
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
  const { service } = options;
  const owner = { preHandler: fastify.requireOwner };
  const secured = [{ bearerAuth: [] }];

  function view() {
    const { zone, source } = service.fallback();
    return { zone, source, reported: service.reported() };
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
    async () => view(),
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
        await service.report(timeZone);
      } catch (err) {
        if (err instanceof TimeZoneError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      return view();
    },
  );
}
