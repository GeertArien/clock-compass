import type { FastifyInstance, FastifyReply } from "fastify";
import {
  PrismaTaskRepository,
  dayAtUtc,
  TaskRuleError,
  TaskService,
  groupByQuadrant,
  MAX_PREVIEW_RANGE_DAYS,
  prisma,
  type RecurrenceInput,
} from "@clock-compass/core";
import { callerClock } from "../time-zone.js";

/** `scheduledDay` as the routes take it: a plain date (#136). A date-time is refused (#137). */
const SCHEDULED_DAY_INPUT = {
  type: "string",
  format: "date",
  description: "The day to do it, YYYY-MM-DD: a plain date, the same in every zone.",
} as const;

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
      scheduledDay: {
        type: ["string", "null"],
        format: "date-time",
        description: "A plain date at UTC midnight (#136), like dueDate: the first 10 characters are the day, in every zone.",
      },
      scheduledTime: { type: ["string", "null"], description: "HH:MM on that day, floating: no zone attached." },
      goalId: { type: ["string", "null"] },
      projectId: { type: ["string", "null"] },
      // Recurrence (#105): an occurrence of a series, and its rule.
      seriesId: { type: ["string", "null"] },
      previousId: { type: ["string", "null"] },
      slotDate: { type: ["string", "null"], format: "date-time" },
      showFrom: { type: ["string", "null"], format: "date-time" },
      later: { type: "boolean", description: "Its \"show from\" date has not come yet (derived from the server's day)." },
      recurrence: {
        type: ["object", "null"],
        properties: {
          unit: { type: "string", enum: ["DAY", "WEEK", "MONTH", "YEAR"] },
          every: { type: "integer" },
          from: { type: "string", enum: ["SCHEDULE", "COMPLETION"] },
          leadDays: { type: ["integer", "null"] },
          active: { type: "boolean" },
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

  const recurrenceInput = {
    type: "object",
    additionalProperties: false,
    required: ["unit"],
    description:
      "Repeat the task (#105): every `every` `unit`s, counted from the schedule or from completion; \"show from\" `leadDays` before the due date. The task needs a due date or a scheduled day.",
    properties: {
      unit: { type: "string", enum: ["DAY", "WEEK", "MONTH", "YEAR"] },
      every: { type: "integer", minimum: 1, maximum: 999 },
      from: { type: "string", enum: ["SCHEDULE", "COMPLETION"] },
      leadDays: { type: ["integer", "null"], minimum: 0, maximum: 365 },
    },
  } as const;

  /** The caller's zone (X-Time-Zone) for a scheduled day, "today" and "after I completed it"; else the server's. */
  const clockOf = callerClock;

  /** A recurrence change that cannot be made: 400 or 422 with the service's words. */
  const ruled = async <T>(reply: FastifyReply, work: () => Promise<T>) => {
    try {
      return await work();
    } catch (err) {
      if (err instanceof TaskRuleError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };

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
            shown: {
              type: "boolean",
              description:
                "Only tasks shown now: no \"later\" occurrences of a recurring task. Skipped (ARCHIVED) occurrences are left out unless status=ARCHIVED.",
            },
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
        shown?: boolean;
      };
      return service.list({
        shown: q.shown,
        status: q.status,
        proactivity: q.proactivity,
        goalId: q.unlinked ? null : q.goalId,
        projectId: q.inbox ? null : q.projectId,
      }, clockOf(req));
    },
  );

  // --- Quadrant matrix ------------------------------------------------------
  fastify.get(
    "/tasks/quadrants",
    {
      ...auth,
      schema: {
        description:
          "Open tasks grouped by derived quadrant — the matrix, ready to render. \"Later\" occurrences of a recurring task are left out.",
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
    async (req) => groupByQuadrant(await service.list({ status: "TODO", shown: true }, clockOf(req))),
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
    async (req) => service.bigRocks(clockOf(req)),
  );

  // --- Previews of upcoming occurrences (#105 step 2) ----------------------
  const plainDate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
  fastify.get(
    "/tasks/previews",
    {
      ...auth,
      schema: {
        description: `Upcoming occurrences of repeating tasks for the calendar, worked out from each series' rule: the occurrences that would follow the open one if it were completed today or on its day. They are not tasks (nothing is stored; each becomes a task only when the one before it is completed or skipped). \`from\` and \`to\` are plain dates in the caller's zone (X-Time-Zone), inclusive, at most ${MAX_PREVIEW_RANGE_DAYS} days. An ended series has none; a series counted from completion has at most one, marked approximate.`,
        tags: ["tasks"],
        security: secured,
        querystring: {
          type: "object",
          required: ["from", "to"],
          properties: { from: plainDate, to: plainDate },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                seriesId: { type: "string" },
                taskId: { type: "string", description: "The open occurrence this preview would follow." },
                title: { type: "string" },
                day: { type: "string", description: "The calendar day (YYYY-MM-DD): its scheduled day, else its due date." },
                dueDate: { type: ["string", "null"], format: "date-time" },
                scheduledTime: { type: ["string", "null"] },
                approximate: { type: "boolean", description: "Counted from completion: the date if the open one is completed on its day." },
              },
            },
          },
          400: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { from, to } = req.query as { from: string; to: string };
      return ruled(reply, () => service.previews(from, to, clockOf(req)));
    },
  );

  // --- A series' history (#105 step 2) --------------------------------------
  fastify.get(
    "/tasks/:id/occurrences",
    {
      ...auth,
      schema: {
        description:
          "Every occurrence of the task's series, oldest first: done, skipped (ARCHIVED) and open. Empty for a task that does not repeat.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: { type: "array", items: taskSchema }, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const task = await service.get(id);
      if (!task) return reply.code(404).send({ error: "Task not found" });
      return task.seriesId ? service.occurrences(task.seriesId, clockOf(req)) : [];
    },
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
      const task = await service.get(id, clockOf(req));
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
            scheduledDay: SCHEDULED_DAY_INPUT,
            scheduledTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            goalId: { type: "string" },
            projectId: { type: "string" },
            proactivity: { type: "string", enum: ["INFLUENCE", "CONCERN"] },
            recurrence: recurrenceInput,
          },
        },
        response: { 201: taskSchema, 400: errorSchema },
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
        recurrence?: RecurrenceInput;
      };
      return ruled(reply, async () => {
        const task = await service.create(
          {
            ...body,
            dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
            scheduledDay: body.scheduledDay ? dayAtUtc(body.scheduledDay) : undefined,
          },
          clockOf(req),
        );
        reply.code(201);
        return task;
      });
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
            scheduledDay: { ...SCHEDULED_DAY_INPUT, type: ["string", "null"] },
            scheduledTime: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
            goalId: { type: ["string", "null"] },
            projectId: { type: ["string", "null"] },
            isBigRock: { type: "boolean" },
            plannedWeek: { type: ["string", "null"], format: "date-time" },
            proactivity: { type: ["string", "null"], enum: ["INFLUENCE", "CONCERN", null] },
            recurrence: {
              anyOf: [recurrenceInput, { type: "null" }],
              description: "A new rule from this occurrence on, or null to stop repeating. Left out: this occurrence only.",
            },
          },
        },
        response: { 200: taskSchema, 400: errorSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Task not found" });
      }
      return ruled(reply, () => service.update(id, {
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
              : dayAtUtc(body.scheduledDay as string),
      }, clockOf(req)));
    },
  );

  // --- Complete / reopen --------------------------------------------------
  fastify.post(
    "/tasks/:id/complete",
    {
      ...auth,
      schema: {
        description:
          "Mark a task done (safe to repeat). For an occurrence of a repeating task, this creates the next occurrence, once.",
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
      return service.complete(id, clockOf(req));
    },
  );

  fastify.post(
    "/tasks/:id/reopen",
    {
      ...auth,
      schema: {
        description:
          "Reopen a completed task (safe to repeat). The next occurrence it led to is removed if it is still exactly as it was created.",
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
      return service.reopen(id, clockOf(req));
    },
  );

  // --- Skip an occurrence (#105) ------------------------------------------
  fastify.post(
    "/tasks/:id/skip",
    {
      ...auth,
      schema: {
        description:
          "Skip the open occurrence of a repeating task: it is archived (not done) and the next occurrence is created, counted from today. Safe to repeat.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: taskSchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.get(id)) === null) {
        return reply.code(404).send({ error: "Task not found" });
      }
      return ruled(reply, () => service.skip(id, clockOf(req)));
    },
  );

  // --- Delete -------------------------------------------------------------
  fastify.delete(
    "/tasks/:id",
    {
      ...auth,
      schema: {
        description:
          "Delete a task. Deleting the open occurrence of a repeating task ends the series; done and skipped occurrences stay.",
        tags: ["tasks"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.remove((req.params as { id: string }).id, clockOf(req));
      reply.code(204);
    },
  );
}
