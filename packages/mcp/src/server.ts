import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPERATION_LIST, inputShape, mcpToolName } from "@clock-compass/assistant-catalog";
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
  groupByQuadrant,
  prisma,
  runOperation,
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

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** Every read tool says so (MCP's standard annotation). */
const READ = { readOnlyHint: true } as const;

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
 * - Reads are registered here, each marked `readOnlyHint`.
 * - Writes come from the operation registry (issue #109): one set of
 *   operations for the assistant and MCP alike. Every operation declared
 *   with `mcp: true` is a tool named by rule (`mcpToolName`: setTaskDone →
 *   set_task_done), with its schema, summary and annotations, run through
 *   core's `runOperation` (the same handlers as `POST /api/operations/{name}`).
 *   Days are read in the server's time zone (MCP has no browser). An
 *   operation that creates also takes an `idempotencyKey` argument.
 * If this module is ever extracted, swap the service calls for HTTP calls
 * against the REST API — the tool surface stays identical.
 */
export function buildMcpServer(services: Services = defaultServices()): McpServer {
  const server = new McpServer({ name: "clock-compass", version: "0.1.0" });
  const { tasks, goals, roles, projects, people, renewal, mission } = services;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // --- Writes: the operation registry -------------------------------------------
  for (const decl of OPERATION_LIST.filter((op) => op.mcp)) {
    const shape = decl.creates ? { ...inputShape(decl.input), idempotencyKey: IdempotencyKey } : inputShape(decl.input);
    server.tool(mcpToolName(decl.name), decl.summary, shape, { ...decl.hints }, async (args) => {
      const { idempotencyKey, ...input } = args as Record<string, unknown> & { idempotencyKey?: string };
      return json(await runOperation(decl.name, input, services, { timeZone, now: new Date(), idempotencyKey }));
    });
  }

  // --- Tasks (Habit 3) --------------------------------------------------------
  server.tool(
    "list_tasks",
    "List tasks with derived quadrants. Filter by status or inbox (no project).",
    {
      status: z.enum(["TODO", "DONE", "ARCHIVED"]).optional(),
      inbox: z.boolean().optional().describe("Only tasks in no project"),
    },
    READ,
    async ({ status, inbox }) =>
      json(await tasks.list({ status, projectId: inbox ? null : undefined })),
  );

  server.tool(
    "quadrant_matrix",
    "Open tasks grouped Q1–Q4 by importance × urgency (the weekly compass).",
    {},
    READ,
    async () => json(groupByQuadrant(await tasks.list({ status: "TODO", shown: true }))),
  );

  server.tool(
    "big_rocks_this_week",
    "What are my big rocks this week? Every task pinned as a big rock until it is unpinned, done ones included (as the app's rocks jar shows).",
    {},
    READ,
    async () => json(await tasks.bigRocks()),
  );

  // --- Mission, roles, goals, projects (Habit 2) -------------------------------
  server.tool("get_mission", "The personal mission statement.", {}, READ, async () =>
    json(await mission.getActive()),
  );

  server.tool("list_roles", "The roles the user lives by.", {}, READ, async () =>
    json(await roles.list()),
  );

  server.tool(
    "list_goals",
    "Goals with derived progress, optionally by status.",
    { status: z.enum(["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"]).optional() },
    READ,
    async ({ status }) => json(await goals.list(status)),
  );

  server.tool(
    "list_projects",
    "Projects with derived task counts, optionally by status.",
    { status: z.enum(["ACTIVE", "SOMEDAY", "DONE"]).optional() },
    READ,
    async ({ status }) => json(await projects.list(status)),
  );

  // --- People (Habits 4–6) -------------------------------------------------------
  server.tool(
    "people_overview",
    "Everyone who matters: EBA balance, commitments with per-person status and history.",
    {},
    READ,
    async () => json(await people.overview()),
  );

  server.tool(
    "overdue_commitments",
    "Which relationship commitments are overdue, per person?",
    {},
    READ,
    async () => json(await people.overdue()),
  );

  // --- Renewal (Habit 7) -----------------------------------------------------------
  server.tool(
    "list_habits",
    "Habits with this week's marks, counts, and week-streaks.",
    {},
    READ,
    async () => json(await renewal.listHabits()),
  );

  server.tool(
    "renewal_summary",
    "This week per dimension — habit marks and one-off activities both count.",
    {},
    READ,
    async () => json(await renewal.summary()),
  );

  server.tool(
    "renewal_trends",
    "The Almanac record: week delta, longest streak, goal momentum, 12-week heatmap.",
    {},
    READ,
    async () => json(await renewal.trends()),
  );

  server.tool(
    "weekly_intentions",
    "This ISO week's intention per renewal dimension.",
    {},
    READ,
    async () => json(await renewal.intentions()),
  );

  return server;
}
