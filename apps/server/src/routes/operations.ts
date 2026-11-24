import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LEGACY_ACTION_NAMES, OPERATION_LIST, mcpToolName, type OperationDeclaration } from "@clock-compass/assistant-catalog";
import {
  OperationError,
  isTimeZone,
  runOperation,
  type OperationServices,
} from "@clock-compass/core";

const TIME_ZONE_HEADER = "x-time-zone";
const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;

/** The operation's hints and audience, for its OpenAPI description. */
function notes(decl: OperationDeclaration): string {
  const yes = (b: boolean) => (b ? "yes" : "no");
  return [
    decl.summary,
    "",
    `Safe to repeat (idempotentHint): ${yes(decl.hints.idempotentHint)}. ` +
      `Destructive (destructiveHint): ${yes(decl.hints.destructiveHint)}. ` +
      `The in-app assistant may propose it: ${yes(decl.assistant === "propose")}. ` +
      `MCP tool: ${decl.mcp ? mcpToolName(decl.name) : "no"}.`,
  ].join("\n");
}

/**
 * The operation registry over HTTP (issue #109): `POST /api/operations/{name}`
 * for every operation declared in `@clock-compass/assistant-catalog`.
 *
 * - Each operation is its own route, so the OpenAPI spec lists it with its
 *   own schema and description. The body schema is generated from the
 *   operation's Zod schema with `zod-to-json-schema` (the converter the MCP
 *   SDK uses, so agents see the same schema over MCP and REST).
 * - The Zod schema is the one validator: Fastify's JSON-schema validation is
 *   switched off for these routes, because refinements ("a real calendar
 *   date", "a time needs a day") exist only in Zod.
 * - The optional `X-Time-Zone` header (IANA) says whose midnight a day such as
 *   "2026-11-23" means; without it, the server's zone.
 * - An operation that creates takes an optional `Idempotency-Key`: the same
 *   key creates the item once (its id is derived from the key), so a retry
 *   after a lost answer finds the item instead of making another.
 * - Errors: 400 invalid input, 422 valid but not possible with the data as it
 *   is (an item that no longer exists), 404 a record that is not there.
 *
 * One list (#109 step 3): the same operations, in the same shapes, are the
 * MCP adapter's write tools. The existing per-resource routes stay; the web
 * app's screens use those.
 */
export async function operationRoutes(fastify: FastifyInstance, services: OperationServices): Promise<void> {
  const errorSchema = { type: "object", properties: { error: { type: "string" } } } as const;

  /** Runs one operation for a request: its headers checked, its errors as HTTP statuses. */
  async function run(name: string, req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers[TIME_ZONE_HEADER];
    if (header !== undefined && !isTimeZone(header)) {
      return reply.code(400).send({ error: `${TIME_ZONE_HEADER}: not a time zone this server knows` });
    }
    const timeZone = header ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const idempotencyKey = req.headers[IDEMPOTENCY_HEADER];
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey))) {
      return reply.code(400).send({ error: `${IDEMPOTENCY_HEADER}: 8 to 200 visible ASCII characters` });
    }
    try {
      return await runOperation(name, req.body, services, { timeZone, now: new Date(), idempotencyKey });
    } catch (err) {
      if (err instanceof OperationError) return reply.code(err.status).send({ error: err.message });
      // A record the input names is not there: Prisma's "record not found"
      // (P2025) or a foreign key that points at nothing (P2003).
      const code = (err as { code?: unknown }).code;
      if (code === "P2025" || code === "P2003") return reply.code(404).send({ error: "Not found" });
      throw err;
    }
  }

  for (const decl of OPERATION_LIST) {
    fastify.post(
      `/operations/${decl.name}`,
      {
        preHandler: fastify.requireAuth,
        // Validation is the operation's Zod schema (in runOperation); the
        // JSON schema below documents it.
        validatorCompiler: () => (value) => ({ value }),
        schema: {
          summary: decl.title,
          description: notes(decl),
          tags: ["operations"],
          security: [{ bearerAuth: [] }],
          headers: {
            type: "object",
            properties: {
              [TIME_ZONE_HEADER]: {
                type: "string",
                description: 'IANA time zone a day ("YYYY-MM-DD") is read in, e.g. "Europe/Brussels". Defaults to the server\'s.',
              },
              ...(decl.creates
                ? {
                    [IDEMPOTENCY_HEADER]: {
                      type: "string",
                      description:
                        "8 to 200 visible ASCII characters. The same key creates the item once: a repeat answers with the item made the first time (changed: 0).",
                    },
                  }
                : {}),
            },
          },
          body: zodToJsonSchema(decl.input, { target: "openApi3", $refStrategy: "none" }),
          response: { 400: errorSchema, 401: errorSchema, 404: errorSchema, 422: errorSchema },
        },
      },
      (req, reply) => run(decl.name, req, reply),
    );
  }

  // A browser tab still running a build from before #109 step 3 posts the old
  // names; they keep working, out of the spec, until those tabs reload.
  for (const [legacy, current] of Object.entries(LEGACY_ACTION_NAMES)) {
    fastify.post(
      `/operations/${legacy}`,
      { preHandler: fastify.requireAuth, validatorCompiler: () => (value) => ({ value }), schema: { hide: true } },
      (req, reply) => run(current, req, reply),
    );
  }
}
