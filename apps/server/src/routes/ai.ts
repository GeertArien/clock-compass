import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AiService,
  AiUnavailableError,
  CodexCredentialManager,
  CodexAuthError,
  PeopleService,
  ProjectService,
  RenewalService,
  TaskService,
  PrismaCommitmentRepository,
  PrismaHabitRepository,
  PrismaPersonRepository,
  PrismaProjectRepository,
  PrismaTaskRepository,
  startCodexDeviceAuth,
  awaitCodexDeviceApproval,
  exchangeCodexCode,
  prisma,
  type AiJob,
  type StoredAiSettings,
} from "@clock-compass/core";
import { callerClock } from "../time-zone.js";

export interface AiRouteOptions {
  /** The stored AI settings: a provider and model per job, and the data policy (#94). */
  settings: StoredAiSettings;
  codexCredentials: CodexCredentialManager;
}

/**
 * AI jobs (build-order step 7). All behind the swappable AiProvider; each
 * job asks the stored settings (Settings → AI, #94) for its provider on every
 * request, so a change applies at once. With no provider for a job the route
 * answers 503; with its data switched off, 409 with the reason. `unaligned`
 * is deterministic and works without AI.
 */
export async function aiRoutes(
  fastify: FastifyInstance,
  options: AiRouteOptions,
): Promise<void> {
  const { settings, codexCredentials } = options;
  const providerOf = (job: AiJob) => settings.forJob(job).provider;

  const service = new AiService(
    settings,
    new TaskService(new PrismaTaskRepository(prisma)),
    new ProjectService(new PrismaProjectRepository(prisma)),
    new PeopleService(
      new PrismaPersonRepository(prisma),
      new PrismaCommitmentRepository(prisma),
    ),
    new RenewalService(new PrismaHabitRepository(prisma)),
    () => settings.policy(),
  );

  const classificationSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      important: { type: "boolean" },
      urgent: { type: "boolean" },
      proactivity: { type: ["string", "null"], enum: ["INFLUENCE", "CONCERN", null] },
      dueDate: { type: ["string", "null"] },
      rationale: { type: "string" },
    },
  } as const;

  const taskSchema = { type: "object", additionalProperties: true } as const;

  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
  } as const;

  const auth = { preHandler: fastify.requireAuth };
  /** Signing in to a provider is an AI setting: the owner's token only (#94). */
  const owner = { preHandler: fastify.requireOwner };
  const secured = [{ bearerAuth: [] }];

  const AI_DISABLED = {
    error: "AI is off for this: add a provider in Settings → AI and choose it for this job.",
  };

  /**
   * Run a provider-backed job. Answers 503 when the job has no provider, 409
   * when its data is switched off (with the reason), and turns a
   * CodexAuthError (no ChatGPT account connected, or its tokens can no longer
   * be refreshed) into a 503 with a "connect your account" message instead of
   * an opaque 500. Returns undefined when it has already sent an error reply.
   */
  async function callProvider<T>(
    reply: FastifyReply,
    job: AiJob,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!providerOf(job).available) {
      reply.code(503).send(AI_DISABLED);
      return undefined;
    }
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        reply.code(409).send({ error: err.message });
        return undefined;
      }
      if (err instanceof CodexAuthError) {
        reply.code(503).send({ error: err.message });
        return undefined;
      }
      throw err;
    }
  }

  fastify.get(
    "/ai/status",
    {
      ...auth,
      schema: {
        description: "Whether AI is set up for task classification (the capture preview) and ready to call.",
        tags: ["ai"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              available: { type: "boolean" },
              connected: { type: "boolean" },
              oauth: { type: "boolean" },
            },
          },
        },
      },
    },
    async () => {
      const provider = providerOf("classifyTask");
      return {
        available: provider.available,
        // `ready()` only exists on providers whose sign-in can change while the
        // server runs (Codex). For everything else, available implies ready.
        connected: provider.ready ? await provider.ready() : provider.available,
        // True when a job uses the ChatGPT subscription, so the UI knows to
        // offer the "Sign in with ChatGPT" flow.
        oauth: settings.providerNames().includes("codex"),
      };
    },
  );

  fastify.post(
    "/ai/classify",
    {
      ...auth,
      schema: {
        description: "Classify a free-text sentence (the capture preview) — creates nothing.",
        tags: ["ai"],
        security: secured,
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1 } },
        },
        response: { 200: classificationSchema, 409: errorSchema, 503: errorSchema },
      },
    },
    async (req, reply) =>
      callProvider(reply, "classifyTask", () => service.classify((req.body as { text: string }).text, callerClock(req))),
  );

  fastify.post(
    "/ai/intake",
    {
      ...auth,
      schema: {
        description: "Natural-language intake: POST a sentence → classify → create the task.",
        tags: ["ai"],
        security: secured,
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1 } },
        },
        response: {
          201: {
            type: "object",
            properties: { task: taskSchema, classification: classificationSchema },
          },
          409: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (req, reply) =>
      callProvider(reply, "classifyTask", async () => {
        const result = await service.intake((req.body as { text: string }).text, callerClock(req));
        reply.code(201);
        return result;
      }),
  );

  fastify.post(
    "/ai/tasks/:id/proactivity",
    {
      ...auth,
      schema: {
        description: "Habit 1: tag a task influence vs concern and persist it.",
        tags: ["ai"],
        security: secured,
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: taskSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema },
      },
    },
    async (req, reply) =>
      callProvider(reply, "tagProactivity", async () => {
        try {
          return await service.tagTask((req.params as { id: string }).id);
        } catch (err) {
          // A genuine auth failure or a switched-off category must surface as
          // such, not as a misleading 404.
          if (err instanceof CodexAuthError || err instanceof AiUnavailableError) throw err;
          return reply.code(404).send({ error: "Task not found" });
        }
      }),
  );

  fastify.post(
    "/ai/mission/refine",
    {
      ...auth,
      schema: {
        description: "Habit 2: refine a mission-statement draft (nothing is saved).",
        tags: ["ai"],
        security: secured,
        body: {
          type: "object",
          required: ["draft"],
          additionalProperties: false,
          properties: { draft: { type: "string", minLength: 1 } },
        },
        response: {
          200: { type: "object", properties: { content: { type: "string" } } },
          409: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (req, reply) =>
      callProvider(reply, "refineMission", async () => ({
        content: await service.refineMission((req.body as { draft: string }).draft),
      })),
  );

  fastify.get(
    "/ai/review",
    {
      ...auth,
      schema: {
        description: "The weekly review summary, composed from the week's actual record.",
        tags: ["ai"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              summary: { type: "string" },
              generatedAt: { type: "string", format: "date-time" },
            },
          },
          409: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (req, reply) => callProvider(reply, "weeklyReview", () => service.weeklyReview(callerClock(req))),
  );

  fastify.get(
    "/ai/unaligned",
    {
      ...auth,
      schema: {
        description:
          "Habit 2 flag: open tasks and projects that connect to no goal (deterministic — works without AI).",
        tags: ["ai"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              tasks: { type: "array", items: taskSchema },
              projects: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async () => service.unaligned(),
  );

  // --- Codex (ChatGPT subscription) sign-in --------------------------------
  // The device-code flow: the UI asks to start, shows the user a short code +
  // URL, then polls the login state while the server waits in the background
  // for approval and stores the tokens. Owner's token only: it is part of the
  // AI settings (#94).

  type LoginState =
    | { state: "idle" }
    | { state: "pending"; userCode: string; verificationUri: string }
    | { state: "connected" }
    | { state: "error"; message: string };
  let login: LoginState = { state: "idle" };
  let loginAbort: AbortController | null = null;

  fastify.get(
    "/ai/codex/status",
    {
      ...owner,
      schema: {
        description: "Whether a ChatGPT account is connected (Codex provider).",
        tags: ["ai"],
        security: secured,
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async () => codexCredentials.status(),
  );

  fastify.post(
    "/ai/codex/device/start",
    {
      ...owner,
      schema: {
        description: "Begin a 'Sign in with ChatGPT' device-code flow.",
        tags: ["ai"],
        security: secured,
        response: { 200: { type: "object", additionalProperties: true }, 502: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        loginAbort?.abort();
        const device = await startCodexDeviceAuth();
        const controller = new AbortController();
        loginAbort = controller;
        login = {
          state: "pending",
          userCode: device.userCode,
          verificationUri: device.verificationUri,
        };
        // Wait for approval in the background; the UI polls /device/login.
        void awaitCodexDeviceApproval(device, { signal: controller.signal })
          .then(({ authorizationCode, codeVerifier }) =>
            exchangeCodexCode(authorizationCode, codeVerifier),
          )
          .then((tokens) => codexCredentials.save(tokens))
          .then(() => {
            if (!controller.signal.aborted) login = { state: "connected" };
          })
          .catch((err: unknown) => {
            if (!controller.signal.aborted) {
              login = {
                state: "error",
                message: err instanceof Error ? err.message : "Sign-in failed.",
              };
            }
          });
        return {
          userCode: device.userCode,
          verificationUri: device.verificationUri,
          intervalSeconds: device.intervalSeconds,
          expiresInSeconds: device.expiresInSeconds,
        };
      } catch (err) {
        return reply
          .code(502)
          .send({ error: err instanceof Error ? err.message : "Could not start sign-in." });
      }
    },
  );

  fastify.get(
    "/ai/codex/device/login",
    {
      ...owner,
      schema: {
        description: "Poll the in-flight device sign-in (idle/pending/connected/error).",
        tags: ["ai"],
        security: secured,
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async () => login,
  );

  fastify.post(
    "/ai/codex/disconnect",
    {
      ...owner,
      schema: {
        description: "Forget the connected ChatGPT account.",
        tags: ["ai"],
        security: secured,
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async () => {
      loginAbort?.abort();
      await codexCredentials.disconnect();
      login = { state: "idle" };
      return { ok: true };
    },
  );
}
