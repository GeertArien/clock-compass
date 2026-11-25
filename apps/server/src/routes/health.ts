import type { FastifyInstance } from "fastify";
import { versionFromEnv } from "@clock-compass/core";

/**
 * Public liveness route — no auth, used by Docker healthchecks and the UI.
 * It also names the running version (#140): the commit, build time and tag of
 * a public repository, so nothing secret, and useful before any token is
 * entered (did the update start?).
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const version = versionFromEnv();
  fastify.get(
    "/health",
    {
      schema: {
        description: "Liveness check, and the running version (null values when the image was built without them).",
        tags: ["system"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
              version: {
                type: "object",
                properties: {
                  commit: { type: ["string", "null"] },
                  date: { type: ["string", "null"] },
                  tag: { type: ["string", "null"] },
                },
                required: ["commit", "date", "tag"],
              },
            },
            required: ["status", "uptime", "version"],
          },
        },
      },
    },
    async () => ({ status: "ok", uptime: process.uptime(), version }),
  );
}
