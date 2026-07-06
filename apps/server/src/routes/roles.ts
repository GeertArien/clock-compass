import type { FastifyInstance } from "fastify";
import { PrismaRoleRepository, RoleService, prisma } from "@clock-compass/core";

/** Role routes (Habit 2). Goals group under roles; deleting a role keeps them. */
export async function roleRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new RoleService(new PrismaRoleRepository(prisma));

  const roleSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      mission: { type: ["string", "null"] },
      order: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  } as const;

  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
  } as const;

  const auth = { preHandler: fastify.requireAuth };
  const secured = [{ bearerAuth: [] }];

  fastify.get(
    "/roles",
    {
      ...auth,
      schema: {
        description: "List roles, ordered.",
        tags: ["roles"],
        security: secured,
        response: { 200: { type: "array", items: roleSchema } },
      },
    },
    async () => service.list(),
  );

  fastify.post(
    "/roles",
    {
      ...auth,
      schema: {
        description: "Create a role (a part you play in life, e.g. Parent).",
        tags: ["roles"],
        security: secured,
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            mission: { type: "string" },
            order: { type: "integer" },
          },
        },
        response: { 201: roleSchema },
      },
    },
    async (req, reply) => {
      const role = await service.create(
        req.body as { name: string; mission?: string; order?: number },
      );
      reply.code(201);
      return role;
    },
  );

  fastify.patch(
    "/roles/:id",
    {
      ...auth,
      schema: {
        description: "Update a role's name, mission line, or order.",
        tags: ["roles"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            mission: { type: ["string", "null"] },
            order: { type: "integer" },
          },
        },
        response: { 200: roleSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Role not found" });
      }
      return service.update(id, req.body as Record<string, never>);
    },
  );

  fastify.post(
    "/roles/reorder",
    {
      ...auth,
      schema: {
        description: "Persist a manual role order: each id gets order = its index.",
        tags: ["roles"],
        security: secured,
        body: {
          type: "object",
          required: ["ids"],
          additionalProperties: false,
          properties: { ids: { type: "array", items: { type: "string" } } },
        },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.reorder((req.body as { ids: string[] }).ids);
      reply.code(204);
    },
  );

  fastify.delete(
    "/roles/:id",
    {
      ...auth,
      schema: {
        description: "Delete a role. Its goals are kept but unlinked.",
        tags: ["roles"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.remove((req.params as { id: string }).id);
      reply.code(204);
    },
  );
}
