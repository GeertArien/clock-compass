import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { ApiKeyService, PrismaApiKeyRepository, prisma } from "@clock-compass/core";
import { loadConfig, type ServerConfig } from "./config.js";
import { authPlugin } from "./plugins/auth.js";
import { keyRoutes } from "./routes/keys.js";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { goalRoutes } from "./routes/goals.js";
import { roleRoutes } from "./routes/roles.js";
import { projectRoutes } from "./routes/projects.js";
import { peopleRoutes } from "./routes/people.js";
import { renewalRoutes } from "./routes/renewal.js";
import { missionRoutes } from "./routes/mission.js";
import { aiRoutes } from "./routes/ai.js";
import { importRoutes } from "./routes/import.js";
import { exportRoutes } from "./routes/export.js";
import { pushRoutes } from "./routes/push.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  config?: ServerConfig;
}

/**
 * Builds the Fastify instance without starting it — so tests can drive it via
 * `app.inject(...)` and the entry point can `listen()`.
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: !config.isProduction });

  // Tolerate an empty body on application/json requests. Bodyless POSTs (e.g.
  // /tasks/:id/complete) otherwise fail with FST_ERR_CTP_EMPTY_JSON_BODY.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (body === "" || body == null) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  // OpenAPI/Swagger so other agents/services can discover the API.
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: "Clock & Compass API", version: "0.0.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  const apiKeys = new ApiKeyService(new PrismaApiKeyRepository(prisma));
  await app.register(authPlugin, { token: config.authToken, apiKeys });

  // API routes under /api.
  await app.register(
    async (api) => {
      await healthRoutes(api);
      await taskRoutes(api);
      await goalRoutes(api);
      await roleRoutes(api);
      await projectRoutes(api);
      await peopleRoutes(api);
      await renewalRoutes(api);
      await missionRoutes(api);
      await keyRoutes(api, apiKeys);
      await importRoutes(api);
      await exportRoutes(api);
      await pushRoutes(api, {
        vapidPublicKey: config.vapidPublicKey,
        vapidPrivateKey: config.vapidPrivateKey,
        vapidSubject: config.vapidSubject,
        startScheduler: config.isProduction,
      });
      await aiRoutes(api, {
        aiProvider: config.aiProvider,
        anthropicApiKey: config.anthropicApiKey,
        anthropicModel: config.anthropicModel,
        openaiBaseUrl: config.openaiBaseUrl,
        openaiApiKey: config.openaiApiKey,
        openaiModel: config.openaiModel,
      });
    },
    { prefix: "/api" },
  );

  // In production, serve the built frontend as static files (single container).
  const webDist = config.webDistPath
    ? resolve(config.webDistPath)
    : join(__dirname, "..", "..", "web", "dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: serve index.html for non-API routes.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
