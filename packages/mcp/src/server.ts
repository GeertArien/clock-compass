import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  OPERATION_LIST,
  PROPOSABLE,
  PROPOSAL_ARGUMENT,
  PROPOSE_CHANGES,
  READ_LIST,
  SCREEN_LIST,
  SCREEN_RESOURCE_URI,
  inputShape,
  mcpToolName,
  type ScreenName,
} from "@clock-compass/assistant-catalog";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, getUiCapability, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import {
  ApiKeyService,
  GoalService,
  MissionService,
  PeopleService,
  ProjectService,
  RenewalService,
  RoleService,
  TaskService,
  PrismaApiKeyRepository,
  PrismaCommitmentRepository,
  PrismaGoalRepository,
  PrismaHabitRepository,
  PrismaMissionRepository,
  PrismaPersonRepository,
  PrismaProjectRepository,
  PrismaRoleRepository,
  PrismaTaskRepository,
  currentDataPolicy,
  prisma,
  runRead,
  runScreen,
  runOperation,
  runProposeChanges,
  runProposedOperation,
  processProposalSigner,
  writeRefusal,
  PrismaTimeZoneRepository,
  currentFallbackZone,
  type DataPolicy,
  type ProposalSigner,
} from "@clock-compass/core";

/** The shared services this adapter wraps — no business logic here. */
export interface Services {
  tasks: TaskService;
  goals: GoalService;
  roles: RoleService;
  projects: ProjectService;
  people: PeopleService;
  renewal: RenewalService;
  mission: MissionService;
  apiKeys: ApiKeyService;
}

export function defaultServices(): Services {
  return {
    tasks: new TaskService(new PrismaTaskRepository(prisma)),
    goals: new GoalService(new PrismaGoalRepository(prisma)),
    roles: new RoleService(new PrismaRoleRepository(prisma)),
    projects: new ProjectService(new PrismaProjectRepository(prisma)),
    people: new PeopleService(
      new PrismaPersonRepository(prisma),
      new PrismaCommitmentRepository(prisma),
    ),
    renewal: new RenewalService(new PrismaHabitRepository(prisma)),
    mission: new MissionService(new PrismaMissionRepository(prisma)),
    apiKeys: new ApiKeyService(new PrismaApiKeyRepository(prisma)),
  };
}

/**
 * A result as JSON text (for the model) and as `structuredContent` (for an
 * MCP App page, #118). Structured content is an object: a list is sent as
 * `{ items: [...] }`.
 */
function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: (Array.isArray(value) ? { items: value } : value) as Record<string, unknown>,
  };
}

/**
 * The argument an operation that creates takes over MCP, with the meaning of
 * the endpoint's `Idempotency-Key` header: the same key creates the item once.
 */
const IdempotencyKey = z
  .string()
  .regex(/^[\x21-\x7e]{8,200}$/, "8 to 200 visible ASCII characters")
  .optional()
  .describe(
    "Optional, 8 to 200 visible ASCII characters. The same key creates the item once: sending it again (a retry after a lost answer) answers with the item made the first time (changed: 0).",
  );

/**
 * Build the MCP server: a THIN adapter over the shared core services.
 * - Reads are the one set shared with the in-app assistant (issue #117):
 *   every read declared in the catalog is a tool named by rule, answered by
 *   core's `runRead` with the same data policy as the assistant (the notes on
 *   people and bank-account entries stay out unless switched on). Each is
 *   marked `readOnlyHint`.
 * - Writes come from the operation registry (issue #109): one set of
 *   operations for the assistant and MCP alike. Every operation declared
 *   with `mcp: true` is a tool named by rule (`mcpToolName`: setTaskDone →
 *   set_task_done), with its schema, summary and annotations, run through
 *   core's `runOperation` (the same handlers as `POST /api/operations/{name}`).
 *   "Today" is read in the fallback zone (#136: `TZ` when set, else the zone
 *   the app last reported, else UTC); MCP has no device to ask. Scheduled
 *   days are plain dates and need no zone. An
 *   operation that creates also takes an `idempotencyKey` argument.
 * If this module is ever extracted, swap the service calls for HTTP calls
 * against the REST API — the tool surface stays identical.
 */
export interface McpOptions {
  /**
   * Serve the MCP App (#118): the screen tools, `propose_changes` and their
   * page. With the App on, the host's model gets no write tool: only the
   * operations that may be proposed are registered, visible to the page
   * only, and each is accepted only with the proof that `propose_changes`
   * showed exactly that change (step 3). So a write needs a press on Confirm
   * in the page, whatever the host does with the visibility.
   */
  app?: { html: () => string };
  /** Signs the proof of a shown change (default: one secret per process). */
  signer?: ProposalSigner;
  /**
   * The data policy in force, read on every call (default: core's built-in
   * `currentDataPolicy`). The program passes the switches stored in Settings
   * → AI (#94), so a change applies without restarting it.
   */
  policy?: () => DataPolicy | Promise<DataPolicy>;
  /**
   * The zone "today" is read in, on every call (default: the fallback zone
   * from the database, #136), so a zone the app reports applies without
   * restarting this process.
   */
  timeZone?: () => string | Promise<string>;
}

/** The fallback zone, read fresh from the settings row (#136). */
const storedZone = () => currentFallbackZone(new PrismaTimeZoneRepository(prisma));

export function buildMcpServer(services: Services = defaultServices(), options: McpOptions = {}): McpServer {
  const policy = options.policy ?? currentDataPolicy;
  const zone = options.timeZone ?? storedZone;
  const server = new McpServer({ name: "clock-compass", version: "0.1.0" });

  // --- Writes: the operation registry -------------------------------------------
  // With the App on, the writes are the page's (registerApp), not the model's.
  for (const decl of options.app ? [] : OPERATION_LIST.filter((op) => op.mcp)) {
    const shape = decl.creates ? { ...inputShape(decl.input), idempotencyKey: IdempotencyKey } : inputShape(decl.input);
    // A strict schema: an argument the operation does not know is refused, not dropped.
    server.registerTool(mcpToolName(decl.name), { description: decl.summary, inputSchema: z.object(shape).strict(), annotations: { ...decl.hints } }, async (args) => {
      const { idempotencyKey, ...input } = args as Record<string, unknown> & { idempotencyKey?: string };
      // MCP is the door for AI in both directions (#117): a write that touches
      // a switched-off category (its own, an item it names, notes with a
      // switch of their own) is refused.
      const off = writeRefusal(decl, input, await policy());
      if (off) return { isError: true, content: [{ type: "text" as const, text: off }] };
      // No device asks over MCP: "today" is read in the fallback zone (#136).
      return json(await runOperation(decl.name, input, services, { timeZone: await zone(), now: new Date(), idempotencyKey }));
    });
  }

  // --- Reads: the one set shared with the assistant (#117) ---------------------
  for (const decl of READ_LIST) {
    // Strict too: a misspelled filter must not quietly answer with everything.
    server.registerTool(mcpToolName(decl.name), { description: decl.summary, inputSchema: z.object(inputShape(decl.input)).strict(), annotations: { ...decl.hints } }, async (args) => {
      // The policy is read on every call, so a change in Settings applies
      // without restarting this process. No device asks over MCP: "today" is
      // read in the fallback zone (#136).
      const outcome = await runRead(decl.name, args, services, {
        policy: await policy(),
        now: new Date(),
        timeZone: await zone(),
      });
      if (!outcome.ok) return { isError: true, content: [{ type: "text" as const, text: outcome.error }] };
      return json(outcome.result);
    });
  }

  if (options.app) registerApp(server, services, policy, zone, options.app.html, options.signer ?? processProposalSigner());

  return server;
}

/**
 * The MCP App (#118, step 1): the page as a `ui://` resource and the screen
 * tools pointing to it, through the official SDK's helpers. Each screen is
 * built and validated in core (`runScreen`); the tool answers a one-line
 * summary for the host's model and the A2UI messages, as structured content,
 * for the page.
 */
function registerApp(
  server: McpServer,
  services: Services,
  policy: () => DataPolicy | Promise<DataPolicy>,
  zone: () => string | Promise<string>,
  html: () => string,
  signer: ProposalSigner,
): void {
  registerAppResource(
    server,
    "Clock & Compass screen",
    SCREEN_RESOURCE_URI,
    { description: "The Clock & Compass screens (the week, and more in later steps)." },
    async () => ({
      contents: [
        {
          uri: SCREEN_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html(),
          _meta: {
            ui: {
              // No network of its own: all data comes through the host. Only
              // the fonts, with the system fonts as fallback.
              csp: { connectDomains: [], resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] },
              prefersBorder: true,
            },
          },
        },
      ],
    }),
  );

  for (const decl of SCREEN_LIST) {
    // What the SDK's registerAppTool does (the page's address under both the
    // current and the legacy key), with a strict schema it cannot take: an
    // unknown argument is refused, as for the reads and writes.
    server.registerTool(
      mcpToolName(decl.name),
      {
        description: decl.summary,
        inputSchema: z.object(inputShape(decl.input)).strict(),
        annotations: { ...decl.hints },
        _meta: { ui: { resourceUri: SCREEN_RESOURCE_URI }, [RESOURCE_URI_META_KEY]: SCREEN_RESOURCE_URI },
      },
      async (args: Record<string, unknown>) => {
        const outcome = await runScreen(decl.name as ScreenName, args, services, {
          policy: await policy(),
          now: new Date(),
          timeZone: await zone(),
        });
        if (!outcome.ok) return { isError: true, content: [{ type: "text" as const, text: outcome.error }] };
        return {
          content: [{ type: "text" as const, text: outcome.summary }],
          // The reads the screen's live components need (step 2), so the page
          // draws them without calling a tool through the host.
          structuredContent: { messages: outcome.messages, ...(outcome.reads ? { reads: outcome.reads } : {}) },
        };
      },
    );
  }

  // --- Proposals (step 3) -----------------------------------------------------
  // The model proposes; the page shows each change with Confirm. Nothing is written here.
  server.registerTool(
    mcpToolName(PROPOSE_CHANGES.name),
    {
      description: PROPOSE_CHANGES.summary,
      inputSchema: PROPOSE_CHANGES.input as z.AnyZodObject,
      annotations: { ...PROPOSE_CHANGES.hints },
      _meta: { ui: { resourceUri: SCREEN_RESOURCE_URI }, [RESOURCE_URI_META_KEY]: SCREEN_RESOURCE_URI },
    },
    async (args: Record<string, unknown>) => {
      const outcome = await runProposeChanges(args, services, { policy: await policy(), now: new Date(), timeZone: await zone(), signer });
      if (!outcome.ok) return { isError: true, content: [{ type: "text" as const, text: outcome.error }] };
      return {
        content: [{ type: "text" as const, text: outcome.summary }],
        structuredContent: { messages: outcome.messages, reads: outcome.reads, changes: outcome.changes },
      };
    },
  );

  // The writes, for the page only (guard 1: only what may be proposed, so no
  // delete), each accepted only with the proof of a shown change (guard 2).
  for (const decl of PROPOSABLE) {
    const shape = {
      ...inputShape(decl.input),
      ...(decl.creates ? { idempotencyKey: IdempotencyKey } : {}),
      [PROPOSAL_ARGUMENT]: z.string().min(1).max(200).describe("The proof propose_changes gave this change; sent by the page on Confirm."),
    };
    server.registerTool(
      mcpToolName(decl.name),
      {
        description: `${decl.summary} Only from a press on Confirm in the page, for a change propose_changes showed.`,
        inputSchema: z.object(shape).strict(),
        annotations: { ...decl.hints },
        // Hidden from the host's model: only the page calls it.
        _meta: { ui: { visibility: ["app"] } },
      },
      async (args: Record<string, unknown>) => {
        const outcome = await runProposedOperation(decl.name, args, services, { policy: await policy(), timeZone: await zone(), now: new Date(), signer });
        if (!outcome.ok) return { isError: true, content: [{ type: "text" as const, text: outcome.error }] };
        return json(outcome.result);
      },
    );
  }
}

/**
 * Whether a host declared, when it connected, that it draws MCP App pages
 * (#118): `capabilities.extensions["io.modelcontextprotocol/ui"]` with the
 * page's MIME type. Over http the server picks the session's tools from it:
 * such a host gets the App (reads and the screens); any other gets the reads
 * and writes, as the stdio program without `--app`.
 */
export function hostDrawsPages(capabilities: unknown): boolean {
  const ui = getUiCapability((capabilities ?? {}) as Parameters<typeof getUiCapability>[0]);
  return !!ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE);
}
