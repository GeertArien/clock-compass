import type { FastifyInstance } from "fastify";
import { GoalService, PrismaGoalRepository, prisma } from "@clock-compass/core";

const GOAL_STATUSES = ["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"] as const;

/** Goal routes (Habit 2). Progress is derived from the goal's tasks. */
export async function goalRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new GoalService(new PrismaGoalRepository(prisma));

  const goalSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: ["string", "null"] },
      targetDate: { type: ["string", "null"], format: "date-time" },
      status: { type: "string", enum: GOAL_STATUSES },
      order: { type: "integer" },
      roleId: { type: ["string", "null"] },
      dimension: { type: ["string", "null"] },
      progress: {
        type: "object",
        properties: {
          total: { type: "integer" },
          done: { type: "integer" },
          ratio: { type: "number" },
        },
      },
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
    "/goals",
    {
      ...auth,
      schema: {
        description: "List goals (optionally by status), each with derived progress.",
        tags: ["goals"],
        security: secured,
        querystring: {
          type: "object",
          properties: { status: { type: "string", enum: GOAL_STATUSES } },
        },
        response: { 200: { type: "array", items: goalSchema } },
      },
    },
    async (req) => {
      const { status } = req.query as { status?: (typeof GOAL_STATUSES)[number] };
      return service.list(status);
    },
  );

  fastify.get(
    "/goals/:id",
    {
      ...auth,
      schema: {
        description: "Fetch a goal with its progress.",
        tags: ["goals"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: goalSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const goal = await service.get((req.params as { id: string }).id);
      if (!goal) return reply.code(404).send({ error: "Goal not found" });
      return goal;
    },
  );

  fastify.post(
    "/goals",
    {
      ...auth,
      schema: {
        description: "Create a goal.",
        tags: ["goals"],
        security: secured,
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            targetDate: { type: "string", format: "date-time" },
            status: { type: "string", enum: GOAL_STATUSES },
            order: { type: "integer" },
            roleId: { type: "string" },
          },
        },
        response: { 201: goalSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        title: string;
        description?: string;
        targetDate?: string;
        status?: (typeof GOAL_STATUSES)[number];
        order?: number;
        roleId?: string;
      };
      const goal = await service.create({
        ...body,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
      });
      reply.code(201);
      return goal;
    },
  );

  fastify.patch(
    "/goals/:id",
    {
      ...auth,
      schema: {
        description: "Update a goal.",
        tags: ["goals"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            targetDate: { type: ["string", "null"], format: "date-time" },
            status: { type: "string", enum: GOAL_STATUSES },
            order: { type: "integer" },
            roleId: { type: ["string", "null"] },
          },
        },
        response: { 200: goalSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Goal not found" });
      }
      const body = req.body as Record<string, unknown>;
      return service.update(id, {
        ...body,
        targetDate:
          body.targetDate === undefined
            ? undefined
            : body.targetDate === null
              ? null
              : new Date(body.targetDate as string),
      });
    },
  );

  fastify.post(
    "/goals/reorder",
    {
      ...auth,
      schema: {
        description:
          "Persist a manual goal order (e.g. one role group): each id gets order = its index.",
        tags: ["goals"],
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
    "/goals/:id",
    {
      ...auth,
      schema: {
        description: "Delete a goal. Its tasks are kept but unlinked.",
        tags: ["goals"],
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
