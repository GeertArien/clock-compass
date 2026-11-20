import type { FastifyInstance } from "fastify";
import {
  PrismaTaskRepository,
  TaskService,
  groupByQuadrant,
  prisma,
} from "@clock-compass/core";

/**
 * Task routes. Handlers stay thin: JSON-schema validation + delegation to the
 * core TaskService (which owns all logic and the derived quadrant).
 */
export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TaskService(new PrismaTaskRepository(prisma));

  const taskSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      notes: { type: ["string", "null"] },
      important: { type: "boolean" },
      urgent: { type: "boolean" },
      quadrant: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] },
      status: { type: "string", enum: ["TODO", "DONE", "ARCHIVED"] },
      proactivity: { type: ["string", "null"], enum: ["INFLUENCE", "CONCERN", null] },
      isBigRock: { type: "boolean" },
      plannedWeek: { type: ["string", "null"], format: "date-time" },
      dueDate: { type: ["string", "null"], format: "date-time" },
      completedAt: { type: ["string", "null"], format: "date-time" },
      scheduledDay: { type: ["string", "null"], format: "date-time" },
      scheduledTime: { type: ["string", "null"] },
      goalId: { type: ["string", "null"] },
      projectId: { type: ["string", "null"] },
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

  // --- List ---------------------------------------------------------------
  fastify.get(
    "/tasks",
    {
      ...auth,
      schema: {
        description:
          "List tasks (filter by status, goal, influence/concern, or unlinked), each with its derived quadrant.",
        tags: ["tasks"],
        security: secured,
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["TODO", "DONE", "ARCHIVED"] },
            goalId: { type: "string" },
            projectId: { type: "string" },
            proactivity: { type: "string", enum: ["INFLUENCE", "CONCERN"] },
            unlinked: { type: "boolean", description: "Only tasks not linked to any goal." },
            inbox: { type: "boolean", description: "Only tasks not in any project (the Inbox)." },
          },
        },
        response: { 200: { type: "array", items: taskSchema } },
      },
    },
    async (req) => {
      const q = req.query as {
        status?: "TODO" | "DONE" | "ARCHIVED";
        goalId?: string;
        projectId?: string;
        proactivity?: "INFLUENCE" | "CONCERN";
        unlinked?: boolean;
        inbox?: boolean;
      };
      return service.list({
        status: q.status,
        proactivity: q.proactivity,
        goalId: q.unlinked ? null : q.goalId,
        projectId: q.inbox ? null : q.projectId,
      });
    },
  );

  // --- Quadrant matrix ------------------------------------------------------
  fastify.get(
    "/tasks/quadrants",
    {
      ...auth,
      schema: {
        description:
          "Open tasks grouped by derived quadrant — the matrix, ready to render.",
        tags: ["tasks"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              Q1: { type: "array", items: taskSchema },
              Q2: { type: "array", items: taskSchema },
              Q3: { type: "array", items: taskSchema },
              Q4: { type: "array", items: taskSchema },
            },
          },
        },
      },
    },
    async () => groupByQuadrant(await service.list({ status: "TODO" })),
  );

  // --- This week's big rocks ---------------------------------------------
  fastify.get(
    "/tasks/big-rocks",
    {
      ...auth,
      schema: {
        description:
          "The big rocks: every task pinned as a big rock until it is unpinned, done ones included, archived ones not (what the app's rocks jar shows).",
        tags: ["tasks"],
        security: secured,
        response: { 200: { type: "array", items: taskSchema } },
      },
    },
    async () => service.bigRocks(),
  );

  // --- Get one ------------------------------------------------------------
  fastify.get(
    "/tasks/:id",
    {
      ...auth,
      schema: {
        description: "Fetch a single task.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: taskSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const task = await service.get(id);
      if (!task) return reply.code(404).send({ error: "Task not found" });
      return task;
    },
  );

  // --- Create -------------------------------------------------------------
  fastify.post(
    "/tasks",
    {
      ...auth,
      schema: {
        description: "Create a task. Quadrant is derived from important/urgent.",
        tags: ["tasks"],
        security: secured,
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            notes: { type: "string" },
            important: { type: "boolean" },
            urgent: { type: "boolean" },
            dueDate: { type: "string", format: "date-time" },
            scheduledDay: { type: "string", format: "date-time" },
            scheduledTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            goalId: { type: "string" },
            projectId: { type: "string" },
            proactivity: { type: "string", enum: ["INFLUENCE", "CONCERN"] },
          },
        },
        response: { 201: taskSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        title: string;
        notes?: string;
        important?: boolean;
        urgent?: boolean;
        dueDate?: string;
        scheduledDay?: string;
        scheduledTime?: string;
        goalId?: string;
        projectId?: string;
        proactivity?: "INFLUENCE" | "CONCERN";
      };
      const task = await service.create({
        ...body,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        scheduledDay: body.scheduledDay ? new Date(body.scheduledDay) : undefined,
      });
      reply.code(201);
      return task;
    },
  );

  // --- Update (partial) ---------------------------------------------------
  fastify.patch(
    "/tasks/:id",
    {
      ...auth,
      schema: {
        description: "Update a task. Changing important/urgent moves it between quadrants.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            notes: { type: ["string", "null"] },
            important: { type: "boolean" },
            urgent: { type: "boolean" },
            dueDate: { type: ["string", "null"], format: "date-time" },
            scheduledDay: { type: ["string", "null"], format: "date-time" },
            scheduledTime: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
            goalId: { type: ["string", "null"] },
            projectId: { type: ["string", "null"] },
            isBigRock: { type: "boolean" },
            plannedWeek: { type: ["string", "null"], format: "date-time" },
            proactivity: { type: ["string", "null"], enum: ["INFLUENCE", "CONCERN", null] },
          },
        },
        response: { 200: taskSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Task not found" });
      }
      return service.update(id, {
        ...body,
        dueDate:
          body.dueDate === undefined
            ? undefined
            : body.dueDate === null
              ? null
              : new Date(body.dueDate as string),
        plannedWeek:
          body.plannedWeek === undefined
            ? undefined
            : body.plannedWeek === null
              ? null
              : new Date(body.plannedWeek as string),
        scheduledDay:
          body.scheduledDay === undefined
            ? undefined
            : body.scheduledDay === null
              ? null
              : new Date(body.scheduledDay as string),
      });
    },
  );

  // --- Complete / reopen --------------------------------------------------
  fastify.post(
    "/tasks/:id/complete",
    {
      ...auth,
      schema: {
        description: "Mark a task done.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: taskSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Task not found" });
      }
      return service.complete(id);
    },
  );

  fastify.post(
    "/tasks/:id/reopen",
    {
      ...auth,
      schema: {
        description: "Reopen a completed task.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: taskSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Task not found" });
      }
      return service.reopen(id);
    },
  );

  // --- Delete -------------------------------------------------------------
  fastify.delete(
    "/tasks/:id",
    {
      ...auth,
      schema: {
        description: "Delete a task.",
        tags: ["tasks"],
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
