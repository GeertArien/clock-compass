import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AiService,
  AnthropicAiProvider,
  NoopAiProvider,
  OpenAiCompatibleProvider,
  CodexResponsesProvider,
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
  PrismaProviderCredentialRepository,
  PrismaTaskRepository,
  startCodexDeviceAuth,
  awaitCodexDeviceApproval,
  exchangeCodexCode,
  prisma,
  type AiProvider,
} from "@clock-compass/core";

export interface AiRouteOptions {
  aiProvider: string | undefined;
  anthropicApiKey: string | undefined;
  anthropicModel: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiApiKey: string | undefined;
  openaiModel: string | undefined;
  codexModel: string | undefined;
}

/**
 * Pick the provider from the environment. AI_PROVIDER forces a choice;
 * otherwise it's inferred: Anthropic when ANTHROPIC_API_KEY is set, else an
 * OpenAI-compatible endpoint (ChatGPT, Ollama, LM Studio, OpenRouter…) when
 * OPENAI_BASE_URL + OPENAI_MODEL are set, else the Noop provider (AI off).
 *
 * The Codex (ChatGPT subscription) provider is only ever chosen explicitly via
 * AI_PROVIDER=codex — never inferred — because it needs an interactive sign-in
 * before it can do anything.
 */
export function selectProvider(
  options: AiRouteOptions,
  codexCredentials: CodexCredentialManager,
): AiProvider {
  const openaiConfigured = !!(options.openaiBaseUrl && options.openaiModel);
  const choice =
    options.aiProvider ??
    (options.anthropicApiKey ? "anthropic" : openaiConfigured ? "openai-compatible" : "none");

  if (choice === "anthropic" && options.anthropicApiKey) {
    return new AnthropicAiProvider({
      apiKey: options.anthropicApiKey,
      model: options.anthropicModel,
    });
  }
  if (choice === "openai-compatible" && openaiConfigured) {
    return new OpenAiCompatibleProvider({
      baseUrl: options.openaiBaseUrl!,
      apiKey: options.openaiApiKey,
      model: options.openaiModel!,
    });
  }
  if (choice === "codex") {
    return new CodexResponsesProvider(codexCredentials, { model: options.codexModel });
  }
  return new NoopAiProvider();
}

/**
 * AI jobs (build-order step 7). All behind the swappable AiProvider; with no
 * provider configured the routes answer 503 instead of calling out.
 * `unaligned` is deterministic and works without a key.
 */
export async function aiRoutes(
  fastify: FastifyInstance,
  options: AiRouteOptions,
): Promise<void> {
  const codexCredentials = new CodexCredentialManager(
    new PrismaProviderCredentialRepository(prisma),
  );
  const provider = selectProvider(options, codexCredentials);
  const isCodex = provider instanceof CodexResponsesProvider;

  const service = new AiService(
    provider,
    new TaskService(new PrismaTaskRepository(prisma)),
    new ProjectService(new PrismaProjectRepository(prisma)),
    new PeopleService(
      new PrismaPersonRepository(prisma),
      new PrismaCommitmentRepository(prisma),
    ),
    new RenewalService(new PrismaHabitRepository(prisma)),
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
  const secured = [{ bearerAuth: [] }];

  const AI_DISABLED = {
    error:
      "AI is disabled — set ANTHROPIC_API_KEY (or OPENAI_BASE_URL + OPENAI_MODEL, or AI_PROVIDER=codex) on the server.",
  };

  /**
   * Run a provider-backed job. Answers 503 when AI is off, and turns a
   * CodexAuthError (no ChatGPT account connected, or its tokens can no longer
   * be refreshed) into a 503 with a "connect your account" message instead of
   * an opaque 500. Returns undefined when it has already sent an error reply.
   */
  async function callProvider<T>(
    reply: FastifyReply,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!provider.available) {
      reply.code(503).send(AI_DISABLED);
      return undefined;
    }
    try {
      return await fn();
    } catch (err) {
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
        description: "Whether the AI provider is configured and ready to call.",
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
    async () => ({
      available: provider.available,
      // `ready()` only exists on providers whose creds live outside the env
      // (Codex). For everything else, available implies ready.
      connected: provider.ready ? await provider.ready() : provider.available,
      // True when the provider connects via an interactive sign-in (Codex), so
      // the UI knows to offer the "Sign in with ChatGPT" flow.
      oauth: isCodex,
    }),
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
        response: { 200: classificationSchema, 503: errorSchema },
      },
    },
    async (req, reply) =>
      callProvider(reply, () => service.classify((req.body as { text: string }).text)),
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
          503: errorSchema,
        },
      },
    },
    async (req, reply) =>
      callProvider(reply, async () => {
        const result = await service.intake((req.body as { text: string }).text);
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
        response: { 200: taskSchema, 404: errorSchema, 503: errorSchema },
      },
    },
    async (req, reply) =>
      callProvider(reply, async () => {
        try {
          return await service.tagTask((req.params as { id: string }).id);
        } catch (err) {
          // A genuine auth failure must surface as 503, not a misleading 404.
          if (err instanceof CodexAuthError) throw err;
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
          503: errorSchema,
        },
      },
    },
    async (req, reply) =>
      callProvider(reply, async () => ({
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
          503: errorSchema,
        },
      },
    },
    async (_req, reply) => callProvider(reply, () => service.weeklyReview()),
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
  // Only mounted when AI_PROVIDER=codex. The device-code flow: the UI asks to
  // start, shows the user a short code + URL, then polls the login state while
  // the server waits in the background for approval and stores the tokens.
  if (!isCodex) return;

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
      ...auth,
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
      ...auth,
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
      ...auth,
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
      ...auth,
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
