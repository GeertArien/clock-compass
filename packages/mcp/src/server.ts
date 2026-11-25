import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  OPERATION_LIST,
  READ_LIST,
  SCREEN_LIST,
  SCREEN_RESOURCE_URI,
  inputShape,
  mcpToolName,
  type ScreenName,
} from "@clock-compass/assistant-catalog";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
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
  PrismaTimeZoneRepository,
  currentFallbackZone,
  type DataPolicy,
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
   * Serve the MCP App (#118): the screen tools and their page. Step 1 is
   * read-only: with the App on, no write operation is registered, so the
   * host's model cannot change anything (writes come back in step 3, only
   * from a press in the page).
   */
  app?: { html: () => string };
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
  // Not with the App on (step 1 of #118 is read-only).
  for (const decl of options.app ? [] : OPERATION_LIST.filter((op) => op.mcp)) {
    const shape = decl.creates ? { ...inputShape(decl.input), idempotencyKey: IdempotencyKey } : inputShape(decl.input);
    // A strict schema: an argument the operation does not know is refused, not dropped.
    server.registerTool(mcpToolName(decl.name), { description: decl.summary, inputSchema: z.object(shape).strict(), annotations: { ...decl.hints } }, async (args) => {
      // MCP is the door for AI in both directions (#117): a write whose data
      // category is switched off is refused.
      if (!(await policy())[decl.category]) {
        return { isError: true, content: [{ type: "text" as const, text: "This changes data the user has not shared with AI." }] };
      }
      const { idempotencyKey, ...input } = args as Record<string, unknown> & { idempotencyKey?: string };
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

  if (options.app) registerApp(server, services, policy, zone, options.app.html);

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
          structuredContent: { messages: outcome.messages },
        };
      },
    );
  }
}
