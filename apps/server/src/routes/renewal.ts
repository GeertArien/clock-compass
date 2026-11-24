import type { FastifyInstance } from "fastify";
import { PrismaHabitRepository, RenewalService, prisma } from "@clock-compass/core";
import { callerClock } from "../time-zone.js";

const DIMENSIONS = ["PHYSICAL", "MENTAL", "SOCIAL_EMOTIONAL", "SPIRITUAL"] as const;

/**
 * Habit 7: habits (recurring renewal) + one-off renewal activities.
 * Streaks, week views, and dimension aggregates are derived in core.
 * "Today" and "this week" are the caller's (`X-Time-Zone`), else the
 * server's (`TZ`); see #112.
 */
export async function renewalRoutes(
  fastify: FastifyInstance,
  options: { service?: RenewalService } = {},
): Promise<void> {
  const service = options.service ?? new RenewalService(new PrismaHabitRepository(prisma));

  const habitSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      dimension: { type: ["string", "null"], enum: [...DIMENSIONS, null] },
      goalId: { type: ["string", "null"] },
      goalTitle: { type: ["string", "null"] },
      targetPerWeek: { type: "integer" },
      weekDays: { type: "array", items: { type: "boolean" } },
      doneThisWeek: { type: "integer" },
      markedToday: { type: "boolean" },
      streak: { type: "integer" },
    },
  } as const;

  const activitySchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      dimension: { type: "string", enum: DIMENSIONS },
      title: { type: "string" },
      note: { type: ["string", "null"] },
      occurredAt: { type: "string", format: "date-time" },
    },
  } as const;

  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
  } as const;

  const auth = { preHandler: fastify.requireAuth };
  const secured = [{ bearerAuth: [] }];

  // --- Habits -------------------------------------------------------------------

  fastify.get(
    "/habits",
    {
      ...auth,
      schema: {
        description:
          "List habits with this week's marks, counts, and week-streaks. \"Today\" and \"this week\" are in the caller's zone (X-Time-Zone), else the server's.",
        tags: ["renewal"],
        security: secured,
        response: { 200: { type: "array", items: habitSchema } },
      },
    },
    async (req) => service.listHabits(callerClock(req)),
  );

  fastify.post(
    "/habits",
    {
      ...auth,
      schema: {
        description: "Define a habit (Compass · Renew): cadence, dimension, goal link.",
        tags: ["renewal"],
        security: secured,
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            dimension: { type: "string", enum: DIMENSIONS },
            goalId: { type: "string" },
            targetPerWeek: { type: "integer", minimum: 1, maximum: 7 },
          },
        },
        response: { 201: habitSchema },
      },
    },
    async (req, reply) => {
      const habit = await service.createHabit(
        req.body as Parameters<RenewalService["createHabit"]>[0],
        callerClock(req),
      );
      reply.code(201);
      return habit;
    },
  );

  fastify.patch(
    "/habits/:id",
    {
      ...auth,
      schema: {
        description: "Update a habit (rename, retag, relink, retarget, archive).",
        tags: ["renewal"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            dimension: { type: ["string", "null"], enum: [...DIMENSIONS, null] },
            goalId: { type: ["string", "null"] },
            targetPerWeek: { type: "integer", minimum: 1, maximum: 7 },
            archived: { type: "boolean" },
          },
        },
        response: { 200: habitSchema },
      },
    },
    async (req) =>
      service.updateHabit(
        (req.params as { id: string }).id,
        req.body as Record<string, never>,
        callerClock(req),
      ),
  );

  fastify.delete(
    "/habits/:id",
    {
      ...auth,
      schema: {
        description: "Delete a habit and its marks.",
        tags: ["renewal"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.removeHabit((req.params as { id: string }).id);
      reply.code(204);
    },
  );

  fastify.post(
    "/habits/:id/toggle",
    {
      ...auth,
      schema: {
        description:
          "Toggle a day's check-off. `day` is a plain date (YYYY-MM-DD); without it, today in the caller's zone (X-Time-Zone), else the server's. A day still to come is refused.",
        tags: ["renewal"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { day: { type: "string", format: "date" } },
        },
        response: { 200: habitSchema, 400: errorSchema },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as { day?: string };
      try {
        return await service.toggleMark((req.params as { id: string }).id, body.day, callerClock(req));
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // --- One-off renewal activities + aggregates -------------------------------------

  fastify.post(
    "/renewal/activities",
    {
      ...auth,
      schema: {
        description: "Log a one-off renewal activity (a retreat, a long hike).",
        tags: ["renewal"],
        security: secured,
        body: {
          type: "object",
          required: ["dimension", "title"],
          additionalProperties: false,
          properties: {
            dimension: { type: "string", enum: DIMENSIONS },
            title: { type: "string", minLength: 1 },
            note: { type: "string" },
            occurredAt: { type: "string", format: "date-time" },
          },
        },
        response: { 201: activitySchema },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        dimension: (typeof DIMENSIONS)[number];
        title: string;
        note?: string;
        occurredAt?: string;
      };
      const activity = await service.logActivity({
        ...body,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      });
      reply.code(201);
      return activity;
    },
  );

  fastify.get(
    "/renewal/activities",
    {
      ...auth,
      schema: {
        description: "One-off renewal activities from the last 30 days.",
        tags: ["renewal"],
        security: secured,
        response: { 200: { type: "array", items: activitySchema } },
      },
    },
    async () => service.recentActivities(),
  );

  fastify.delete(
    "/renewal/activities/:id",
    {
      ...auth,
      schema: {
        description: "Delete a one-off renewal activity.",
        tags: ["renewal"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.removeActivity((req.params as { id: string }).id);
      reply.code(204);
    },
  );

  fastify.get(
    "/renewal/intentions",
    {
      ...auth,
      schema: {
        description: "This ISO week's intention per dimension (intent, never scored).",
        tags: ["renewal"],
        security: secured,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dimension: { type: "string", enum: DIMENSIONS },
                text: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (req) => service.intentions(callerClock(req)),
  );

  fastify.put(
    "/renewal/intentions/:dimension",
    {
      ...auth,
      schema: {
        description: "Set (or clear, with empty text) this week's intention for a dimension.",
        tags: ["renewal"],
        security: secured,
        params: {
          type: "object",
          properties: { dimension: { type: "string", enum: DIMENSIONS } },
          required: ["dimension"],
        },
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string" } },
        },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      const { dimension } = req.params as { dimension: (typeof DIMENSIONS)[number] };
      await service.setIntention(dimension, (req.body as { text: string }).text, callerClock(req));
      reply.code(204);
    },
  );

  fastify.get(
    "/renewal/summary",
    {
      ...auth,
      schema: {
        description:
          "This week per dimension — habit marks AND one-off activities both count.",
        tags: ["renewal"],
        security: secured,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dimension: { type: "string", enum: DIMENSIONS },
                habitsDone: { type: "integer" },
                habitsTarget: { type: "integer" },
                oneOffs: { type: "integer" },
                total: { type: "integer" },
              },
            },
          },
        },
      },
    },
    async (req) => service.summary(callerClock(req)),
  );

  fastify.get(
    "/renewal/trends",
    {
      ...auth,
      schema: {
        description: "The Almanac record: week delta, longest streak, goal momentum, heatmap.",
        tags: ["renewal"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              thisWeek: { type: "integer" },
              lastWeek: { type: "integer" },
              longestStreak: {
                type: "object",
                properties: {
                  weeks: { type: "integer" },
                  habitName: { type: ["string", "null"] },
                },
              },
              goalMomentum: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    goalId: { type: "string" },
                    title: { type: "string" },
                    pct: { type: "integer" },
                  },
                },
              },
              heatmap: {
                type: "array",
                items: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
    async (req) => service.trends(callerClock(req)),
  );
}
