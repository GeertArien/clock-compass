import type { FastifyInstance } from "fastify";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import {
  AssistantUnavailableError,
  assistantAvailability,
  assistantSystemPrompt,
  isTimeZone,
  localDay,
  runAgent,
  type AiJobs,
  type AssistantServices,
} from "@clock-compass/core";
import { sse, toAgentHistory, toAguiEvents } from "../agent/agui.js";

export interface AgentRouteOptions {
  jobs: AiJobs;
  services: AssistantServices;
  /** For tests. */
  now?: () => Date;
  /**
   * How often to write an SSE comment while nothing else is sent (the model
   * thinking, a tool running), so a proxy's idle timeout does not cut the
   * answer. Default 15 s.
   */
  heartbeatMs?: number;
}

/** What the client may pass along with a run (AG-UI `forwardedProps`). */
interface ForwardedProps {
  /** The browser's IANA time zone, so "today" and scheduled days are the user's. */
  timeZone?: unknown;
  /** The screen the user has open, e.g. "Clock · Today". */
  view?: unknown;
}

const UNAVAILABLE_MESSAGE: Record<string, string> = {
  "no-provider": "The assistant is unavailable: no AI provider is configured on the server.",
  "unsupported-provider": "The assistant is unavailable with the configured AI provider.",
  "not-ready": "The assistant is unavailable: the AI provider is not connected yet.",
};

/**
 * The in-app assistant over AG-UI (issue #62, step 4). `POST /agent` takes an
 * AG-UI RunAgentInput and streams AG-UI events as server-sent events; `GET
 * /agent/status` says whether the assistant can run. Both sit behind the
 * bearer / API-key auth. Read-only: the model's tools only read, and screens
 * cannot propose changes yet.
 */
export async function agentRoutes(fastify: FastifyInstance, options: AgentRouteOptions): Promise<void> {
  const auth = { preHandler: fastify.requireAuth };
  const secured = [{ bearerAuth: [] }];
  const now = options.now ?? (() => new Date());
  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" }, reason: { type: "string" } },
  } as const;

  fastify.get(
    "/agent/status",
    {
      ...auth,
      schema: {
        description:
          "Whether the in-app assistant can run: an AI provider that supports it (Anthropic or OpenAI-compatible) is configured and ready.",
        tags: ["agent"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              available: { type: "boolean" },
              reason: { type: "string", enum: ["no-provider", "unsupported-provider", "not-ready"] },
            },
          },
        },
      },
    },
    async () => assistantAvailability(options.jobs),
  );

  fastify.post(
    "/agent",
    {
      ...auth,
      schema: {
        description:
          "Run the in-app assistant (AG-UI). Body: an AG-UI RunAgentInput; `forwardedProps` may carry `timeZone` (IANA) and `view`. " +
          "Answers with an SSE stream of AG-UI events: RUN_STARTED, TEXT_MESSAGE_*, STEP_STARTED/STEP_FINISHED per tool, " +
          'ACTIVITY_SNAPSHOT (activityType "a2ui-surface", content.a2ui_operations) per validated A2UI screen, then RUN_FINISHED or RUN_ERROR. ' +
          "503 before the stream when the assistant is unavailable.",
        tags: ["agent"],
        security: secured,
        body: { type: "object" },
        response: { 400: errorSchema, 503: errorSchema },
      },
    },
    async (req, reply) => {
      const parsed = RunAgentInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: `Not an AG-UI RunAgentInput: ${parsed.error.issues[0]?.message ?? "invalid"}` });
      }
      const input = parsed.data;
      const history = toAgentHistory(input.messages);
      if (!history) return reply.code(400).send({ error: "The conversation must end with a user message." });

      const availability = await assistantAvailability(options.jobs);
      if (!availability.available) {
        return reply
          .code(503)
          .send({ error: UNAVAILABLE_MESSAGE[availability.reason], reason: availability.reason });
      }

      const props = (input.forwardedProps ?? {}) as ForwardedProps;
      const clientZone = isTimeZone(props.timeZone) ? props.timeZone : undefined;
      const timeZone = clientZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const system = assistantSystemPrompt({
        today: localDay(now(), timeZone)!,
        view: typeof props.view === "string" ? props.view : undefined,
        ui: true,
        timeZoneNote: clientZone
          ? undefined
          : `The user's time zone is unknown; dates are in the server's (${timeZone}).`,
      });

      // Stop the model when the client goes away.
      const abort = new AbortController();
      reply.raw.on("close", () => abort.abort());

      const events = runAgent(
        {
          jobs: options.jobs,
          services: options.services,
          now,
          timeZone,
          ui: true,
          onToolError: (tool, err) => req.log.error({ err, tool }, "assistant tool failed"),
        },
        { system, history, signal: abort.signal },
      );

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const stream = toAguiEvents(events, { threadId: input.threadId, runId: input.runId }, (err) => {
        if (err instanceof AssistantUnavailableError) return "unavailable";
        if (!abort.signal.aborted) req.log.error({ err }, "assistant run failed");
        return "provider-error";
      });
      const heartbeat = setInterval(() => {
        if (!abort.signal.aborted) reply.raw.write(": ping\n\n");
      }, options.heartbeatMs ?? 15_000);
      try {
        for await (const event of stream) {
          if (abort.signal.aborted) break;
          reply.raw.write(sse(event));
        }
      } finally {
        clearInterval(heartbeat);
      }
      reply.raw.end();
    },
  );
}
