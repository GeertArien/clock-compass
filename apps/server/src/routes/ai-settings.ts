import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AiSettingsError,
  DATA_CATEGORIES,
  JOB_KEYS,
  PROVIDER_KINDS,
  type AiSettingsService,
  type ProviderInput,
} from "@clock-compass/core";

/**
 * Settings → AI (issue #94): providers with their keys and models, a provider
 * and model per AI job, and what data AI may use. Every route takes the
 * server's own token only (`requireOwner`); a generated API key gets 403.
 *
 * Keys are write-only: a provider is answered with `keySet` and `keyHint`
 * (the last four characters of a key of 20 or more), never the key. The
 * response schemas list their fields, so nothing else can slip out.
 */
export async function aiSettingsRoutes(fastify: FastifyInstance, options: { service: AiSettingsService }): Promise<void> {
  const { service } = options;
  const owner = { preHandler: fastify.requireOwner };
  const secured = [{ bearerAuth: [] }];
  const tags = ["ai-settings"];

  const errorSchema = { type: "object", properties: { error: { type: "string" } } } as const;
  const providerSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: PROVIDER_KINDS },
      baseUrl: { type: ["string", "null"] },
      keySet: { type: "boolean" },
      keyHint: { type: ["string", "null"] },
      models: { type: "array", items: { type: "string" } },
      warning: { type: ["string", "null"] },
      lastUsage: {
        type: ["object", "null"],
        description:
          "The last assistant answer's token numbers through this provider since the server started (#130): counts only, never the prompt.",
        properties: {
          model: { type: "string" },
          promptTokens: { type: "integer" },
          cachedTokens: { type: ["integer", "null"] },
          cacheWriteTokens: { type: ["integer", "null"] },
          at: { type: "string", format: "date-time" },
        },
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  } as const;
  const jobSchema = {
    type: "object",
    properties: {
      job: { type: "string", enum: JOB_KEYS },
      providerId: { type: ["string", "null"] },
      model: { type: ["string", "null"] },
      sends: {
        type: "array",
        items: { type: "object", properties: { label: { type: "string" }, shared: { type: "boolean" } } },
      },
      offBecause: { type: ["string", "null"] },
    },
  } as const;
  const settingsSchema = {
    type: "object",
    properties: {
      providers: { type: "array", items: providerSchema },
      jobs: { type: "array", items: jobSchema },
      switches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: DATA_CATEGORIES },
            enabled: { type: "boolean" },
            byDefault: { type: "boolean" },
          },
        },
      },
    },
  } as const;
  const providerBody = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      kind: { type: "string", enum: PROVIDER_KINDS },
      baseUrl: { type: ["string", "null"], maxLength: 2000 },
      apiKey: { type: ["string", "null"], maxLength: 1000, description: "Write-only. null removes the stored key." },
      models: { type: "array", maxItems: 100, items: { type: "string", maxLength: 200 } },
    },
  } as const;
  const idParams = { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as const;
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 422: errorSchema };

  /** A rule of the settings, in its own words and status. */
  async function answer<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof AiSettingsError) {
        reply.code(err.status).send({ error: err.message });
        return undefined;
      }
      throw err;
    }
  }

  fastify.get(
    "/ai/settings",
    {
      ...owner,
      schema: {
        description: "The AI settings: providers (keys never included), the provider and model per job with what each sends, and the data switches.",
        tags,
        security: secured,
        response: { 200: settingsSchema, ...errors },
      },
    },
    async () => service.view(),
  );

  fastify.post(
    "/ai/providers",
    {
      ...owner,
      schema: {
        description:
          "Add a provider: Anthropic (key required; address optional), OpenAI-compatible (address required: OpenAI, a local model, a gateway), or the ChatGPT subscription (signs in, no key). The address must be http(s) with no user name, password, query or fragment; local and home-network addresses are allowed.",
        tags,
        security: secured,
        body: { ...providerBody, required: ["name", "kind"] },
        response: { 201: providerSchema, ...errors },
      },
    },
    async (req, reply) => {
      const created = await answer(reply, () => service.addProvider(req.body as ProviderInput));
      if (created) reply.code(201);
      return created;
    },
  );

  fastify.patch(
    "/ai/providers/:id",
    {
      ...owner,
      schema: {
        description: "Change a provider: its name, address, models, or key (a new key replaces it; null removes it; absent keeps it).",
        tags,
        security: secured,
        params: idParams,
        body: providerBody,
        response: { 200: providerSchema, ...errors },
      },
    },
    async (req, reply) => answer(reply, () => service.updateProvider((req.params as { id: string }).id, req.body as ProviderInput)),
  );

  fastify.delete(
    "/ai/providers/:id",
    {
      ...owner,
      schema: {
        description: "Remove a provider. Jobs that used it fall back to the default.",
        tags,
        security: secured,
        params: idParams,
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      const done = await answer(reply, async () => {
        await service.removeProvider((req.params as { id: string }).id);
        return true;
      });
      if (done) reply.code(204);
    },
  );

  fastify.post(
    "/ai/providers/:id/test",
    {
      ...owner,
      schema: {
        description: "One small request to the provider (its model list): no user data. Answers the provider's own error, with the key taken out.",
        tags,
        security: secured,
        params: idParams,
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } },
          ...errors,
        },
      },
    },
    async (req, reply) => answer(reply, () => service.test((req.params as { id: string }).id)),
  );

  fastify.post(
    "/ai/providers/:id/models",
    {
      ...owner,
      schema: {
        description: "The provider's own model list, to choose from. Nothing is stored; keep models with PATCH.",
        tags,
        security: secured,
        params: idParams,
        response: {
          200: { type: "object", properties: { models: { type: "array", items: { type: "string" } } } },
          ...errors,
        },
      },
    },
    async (req, reply) => answer(reply, () => service.loadModels((req.params as { id: string }).id)),
  );

  fastify.put(
    "/ai/jobs",
    {
      ...owner,
      schema: {
        description:
          "Choose the provider and model for each job, and the default for every job without its own choice. A job left out (or with providerId null) uses the default. The ChatGPT subscription is not available for the assistant.",
        tags,
        security: secured,
        body: {
          type: "object",
          required: ["jobs"],
          additionalProperties: false,
          properties: {
            jobs: {
              type: "array",
              maxItems: JOB_KEYS.length,
              items: {
                type: "object",
                required: ["job"],
                additionalProperties: false,
                properties: {
                  job: { type: "string", enum: JOB_KEYS },
                  providerId: { type: ["string", "null"] },
                  model: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      const { jobs } = req.body as { jobs: { job: string; providerId?: string | null; model?: string | null }[] };
      const done = await answer(reply, async () => {
        await service.setJobs(jobs.map((j) => ({ job: j.job, providerId: j.providerId ?? null, model: j.model ?? null })));
        return true;
      });
      if (done) reply.code(204);
    },
  );

  fastify.put(
    "/ai/data-policy",
    {
      ...owner,
      schema: {
        description:
          "Switch data categories on or off for every AI feature: the assistant, the other AI jobs and MCP. A category left out keeps its setting.",
        tags,
        security: secured,
        body: {
          type: "object",
          required: ["switches"],
          additionalProperties: false,
          properties: {
            switches: {
              type: "array",
              maxItems: DATA_CATEGORIES.length,
              items: {
                type: "object",
                required: ["category", "enabled"],
                additionalProperties: false,
                properties: { category: { type: "string", enum: DATA_CATEGORIES }, enabled: { type: "boolean" } },
              },
            },
          },
        },
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      const { switches } = req.body as { switches: { category: string; enabled: boolean }[] };
      const done = await answer(reply, async () => {
        await service.setSwitches(switches);
        return true;
      });
      if (done) reply.code(204);
    },
  );
}
