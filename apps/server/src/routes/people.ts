import type { FastifyInstance } from "fastify";
import {
  PeopleService,
  PrismaCommitmentRepository,
  PrismaPersonRepository,
  prisma,
} from "@clock-compass/core";

const CADENCE_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
const EBA_KINDS = ["DEPOSIT", "WITHDRAWAL"] as const;

/**
 * People + recurring commitments + emotional bank account (Habits 4-6).
 * Status, history, and balance are derived in the core service.
 */
export async function peopleRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new PeopleService(
    new PrismaPersonRepository(prisma),
    new PrismaCommitmentRepository(prisma),
  );

  const commitmentViewSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      cadenceUnit: { type: "string", enum: CADENCE_UNITS },
      cadenceValue: { type: "integer" },
      status: { type: "string", enum: ["ON_TRACK", "DUE_SOON", "OVERDUE"] },
      lastOccurredAt: { type: ["string", "null"], format: "date-time" },
      nextDueAt: { type: ["string", "null"], format: "date-time" },
      history: { type: "array", items: { type: "boolean" } },
    },
  } as const;

  const personSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      relationship: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      balance: { type: "integer" },
      ledger: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: EBA_KINDS },
            note: { type: ["string", "null"] },
            occurredAt: { type: "string", format: "date-time" },
          },
        },
      },
      commitments: { type: "array", items: commitmentViewSchema },
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

  // --- People -----------------------------------------------------------------

  fastify.get(
    "/people",
    {
      ...auth,
      schema: {
        description:
          "Everyone who matters, with derived EBA balance and per-person commitment status/history.",
        tags: ["people"],
        security: secured,
        response: { 200: { type: "array", items: personSchema } },
      },
    },
    async () => service.overview(),
  );

  fastify.post(
    "/people",
    {
      ...auth,
      schema: {
        description: "Add a person. Relationship is a plain field (kid, spouse, parent…).",
        tags: ["people"],
        security: secured,
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            relationship: { type: "string" },
            notes: { type: "string" },
          },
        },
        response: { 201: personSchema },
      },
    },
    async (req, reply) => {
      const person = await service.createPerson(
        req.body as { name: string; relationship?: string; notes?: string },
      );
      reply.code(201);
      return person;
    },
  );

  fastify.patch(
    "/people/:id",
    {
      ...auth,
      schema: {
        description: "Update a person.",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            relationship: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
          },
        },
        response: { 200: personSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if ((await service.getPerson(id)) === null) {
        return reply.code(404).send({ error: "Person not found" });
      }
      return service.updatePerson(id, req.body as Record<string, never>);
    },
  );

  fastify.delete(
    "/people/:id",
    {
      ...auth,
      schema: {
        description: "Delete a person (their EBA entries go too; commitments survive).",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.removePerson((req.params as { id: string }).id);
      reply.code(204);
    },
  );

  // --- Emotional bank account ---------------------------------------------------

  fastify.post(
    "/people/:id/eba",
    {
      ...auth,
      schema: {
        description: "Log a deposit or withdrawal on a person's emotional bank account.",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: EBA_KINDS },
            note: { type: "string" },
          },
        },
        response: { 200: personSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { kind: (typeof EBA_KINDS)[number]; note?: string };
      if ((await service.getPerson(id)) === null) {
        return reply.code(404).send({ error: "Person not found" });
      }
      await service.addEbaEntry(id, body.kind, body.note);
      return service.getPerson(id);
    },
  );

  // --- Commitments ----------------------------------------------------------------

  fastify.post(
    "/commitments",
    {
      ...auth,
      schema: {
        description: "Create a recurring commitment linked to one or more people.",
        tags: ["people"],
        security: secured,
        body: {
          type: "object",
          required: ["title", "cadenceUnit", "personIds"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            cadenceUnit: { type: "string", enum: CADENCE_UNITS },
            cadenceValue: { type: "integer", minimum: 1 },
            personIds: { type: "array", items: { type: "string" }, minItems: 1 },
          },
        },
        response: { 201: { type: "object", properties: { id: { type: "string" } } } },
      },
    },
    async (req, reply) => {
      const id = await service.createCommitment(
        req.body as Parameters<PeopleService["createCommitment"]>[0],
      );
      reply.code(201);
      return { id };
    },
  );

  fastify.patch(
    "/commitments/:id",
    {
      ...auth,
      schema: {
        description: "Update a commitment (title, cadence, participants, active).",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            cadenceUnit: { type: "string", enum: CADENCE_UNITS },
            cadenceValue: { type: "integer", minimum: 1 },
            active: { type: "boolean" },
            personIds: { type: "array", items: { type: "string" } },
          },
        },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.updateCommitment(
        (req.params as { id: string }).id,
        req.body as Record<string, never>,
      );
      reply.code(204);
    },
  );

  fastify.delete(
    "/commitments/:id",
    {
      ...auth,
      schema: {
        description: "Delete a commitment and its occurrence log.",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await service.removeCommitment((req.params as { id: string }).id);
      reply.code(204);
    },
  );

  fastify.post(
    "/commitments/:id/log",
    {
      ...auth,
      schema: {
        description: "Log an occurrence (personId set = per-person tracking, the default).",
        tags: ["people"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            personId: { type: "string" },
            note: { type: "string" },
            occurredAt: { type: "string", format: "date-time" },
          },
        },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        personId?: string;
        note?: string;
        occurredAt?: string;
      };
      await service.logOccurrence((req.params as { id: string }).id, {
        personId: body.personId,
        note: body.note,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      });
      reply.code(204);
    },
  );

  fastify.get(
    "/commitments/overdue",
    {
      ...auth,
      schema: {
        description: "Overdue commitments per person — the nudge surface.",
        tags: ["people"],
        security: secured,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                personId: { type: "string" },
                personName: { type: "string" },
                commitmentId: { type: "string" },
                title: { type: "string" },
                lastOccurredAt: { type: ["string", "null"], format: "date-time" },
              },
            },
          },
        },
      },
    },
    async () => service.overdue(),
  );
}
