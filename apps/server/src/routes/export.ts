import type { FastifyInstance } from "fastify";
import {
  ExportService,
  PrismaExportRepository,
  prisma,
} from "@clock-compass/core";

/**
 * Full JSON data backup — the mirror of the Todoist CSV import. Read-only;
 * secrets (API keys) and device-bound push subscriptions are excluded at the
 * repository layer. The browser saves the body as a file.
 */
export async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ExportService(new PrismaExportRepository(prisma));

  fastify.get(
    "/export",
    {
      preHandler: fastify.requireAuth,
      schema: {
        description:
          "Download a full JSON backup of all Clock & Compass data (mission, roles, goals, projects, tasks, people, commitments + EBA, habits, renewal). Secrets (API keys) and device-bound push subscriptions are excluded.",
        tags: ["export"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              format: { type: "string" },
              version: { type: "integer" },
              exportedAt: { type: "string" },
              data: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const bundle = await service.export();
      const date = bundle.exportedAt.slice(0, 10); // YYYY-MM-DD
      reply.header(
        "Content-Disposition",
        `attachment; filename="clock-compass-backup-${date}.json"`,
      );
      reply.type("application/json");
      return bundle;
    },
  );
}
