import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServer, hostDrawsPages, type Services } from "@clock-compass/mcp";
import type { DataPolicy } from "@clock-compass/core";
import { fallbackOf } from "../time-zone.js";

export interface McpRouteOptions {
  services: Services;
  /** The data switches of Settings → AI, read on every call. */
  policy: () => DataPolicy;
  /** The built App page (one file), read when a host asks for it. */
  appHtmlPath: string;
  /** Limits, smaller in tests. */
  maxSessions?: number;
  idleMs?: number;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastUsed: number;
}

const MAX_BODY = 1024 * 1024;
const SESSION_HEADER = "mcp-session-id";

/** A JSON-RPC error answer, as the transport writes its own. */
function rpcError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply.code(status).send({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * The MCP program at the app's own address (#118): `/api/mcp`, over the SDK's
 * Streamable HTTP transport, built from `packages/mcp` with the same services
 * as the REST API. No business logic here: the adapter is the MCP package.
 *
 * - **Plain JSON answers** (`enableJsonResponse`) and no long-lived GET
 *   stream (405): every tool answers at once and the server sends nothing of
 *   its own, so a reverse proxy needs no streaming settings.
 * - **The tools follow the host.** A host that declares, when it connects,
 *   that it draws MCP App pages gets the App (reads and the week screen, no
 *   writes for now); any other host gets the reads and writes, as the stdio
 *   program without `--app`. Chosen per session at `initialize`.
 * - **The same token rule as the REST API** (`requireAuth`).
 * - **No `Origin`:** a request that carries one is refused (403). The hosts
 *   connect from a server or a local program; a browser page never needs this.
 * - **Sessions** live in memory: at most 20, ended after 30 idle minutes, on
 *   DELETE, or when the server restarts. An unknown session id gets 404, which
 *   tells a client to connect again.
 * - Nothing from request or response bodies is logged.
 */
export async function mcpRoutes(fastify: FastifyInstance, options: McpRouteOptions): Promise<void> {
  const sessions = new Map<string, Session>();
  const maxSessions = options.maxSessions ?? 20;
  const idleMs = options.idleMs ?? 30 * 60 * 1000;

  const appHtml = () => {
    try {
      return readFileSync(options.appHtmlPath, "utf8");
    } catch {
      return "<!doctype html><p>The Clock &amp; Compass page is not built on this server.</p>";
    }
  };

  async function end(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastUsed > idleMs) void end(id);
  }, Math.min(60_000, idleMs));
  sweep.unref?.();
  fastify.addHook("onClose", async () => {
    clearInterval(sweep);
    await Promise.all([...sessions.keys()].map(end));
  });

  /** Refuse a browser request: one that carries an Origin header (DNS rebinding). */
  async function noOrigin(req: FastifyRequest, reply: FastifyReply) {
    if (req.headers.origin !== undefined) {
      return reply.code(403).send({ error: "Requests from a browser page are not accepted here." });
    }
  }

  const preHandler = [noOrigin, fastify.requireAuth];
  const hide = { hide: true } as const; // not part of the REST API's OpenAPI document

  async function handle(req: FastifyRequest, reply: FastifyReply, session: Session) {
    session.lastUsed = Date.now();
    reply.hijack();
    await session.transport.handleRequest(req.raw, reply.raw, req.body);
  }

  async function newSession(capabilities: unknown): Promise<Session> {
    // Room for one more: close the session idle the longest.
    if (sessions.size >= maxSessions) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) await end(oldest[0]);
    }
    const app = hostDrawsPages(capabilities);
    const server = buildMcpServer(options.services, {
      policy: options.policy,
      // No device asks over MCP: "today" is the fallback zone (#136).
      timeZone: () => fallbackOf(fastify),
      ...(app ? { app: { html: appHtml } } : {}),
    });
    const session: Session = {
      server,
      lastUsed: Date.now(),
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => void sessions.set(id, session),
      }),
    };
    session.transport.onclose = () => {
      const id = session.transport.sessionId;
      if (id && sessions.get(id) === session) sessions.delete(id);
    };
    await server.connect(session.transport);
    return session;
  }

  fastify.post("/mcp", { preHandler, bodyLimit: MAX_BODY, schema: hide }, async (req, reply) => {
    const id = req.headers[SESSION_HEADER];
    if (typeof id === "string") {
      const session = sessions.get(id);
      if (!session) return rpcError(reply, 404, -32001, "Session not found: connect again.");
      return handle(req, reply, session);
    }
    // No session yet: only `initialize` starts one. Anything else (a newer
    // client's `server/discover` probe, say) is a 400, from which clients fall
    // back to `initialize`.
    if (!isInitializeRequest(req.body)) {
      return rpcError(reply, 400, -32000, "No session: start with initialize.");
    }
    const capabilities = (req.body as { params?: { capabilities?: unknown } }).params?.capabilities;
    return handle(req, reply, await newSession(capabilities));
  });

  // No server-sent stream: every answer comes back with its request.
  fastify.get("/mcp", { preHandler, schema: hide }, async (_req, reply) =>
    reply.code(405).header("Allow", "POST, DELETE").send({ error: "This server sends no stream; use POST." }),
  );

  fastify.delete("/mcp", { preHandler, schema: hide }, async (req, reply) => {
    const id = req.headers[SESSION_HEADER];
    if (typeof id !== "string" || !sessions.has(id)) return rpcError(reply, 404, -32001, "Session not found.");
    await end(id);
    return reply.code(200).send();
  });
}
