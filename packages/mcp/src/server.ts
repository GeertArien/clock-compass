import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
} from "@clock-compass/core";

/** The shared services this adapter wraps 1:1 — no business logic here. */
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

const DIMENSION = z.enum(["PHYSICAL", "MENTAL", "SOCIAL_EMOTIONAL", "SPIRITUAL"]);

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Build the MCP server: a THIN adapter over the shared core services.
 * If this module is ever extracted, swap the service calls for HTTP calls
 * against the REST API — the tool surface stays identical.
 */
export function buildMcpServer(services: Services = defaultServices()): McpServer {
  const server = new McpServer({ name: "clock-compass", version: "0.1.0" });
  const { tasks, goals, roles, projects, people, renewal, mission } = services;

  // --- Tasks (Habit 3) --------------------------------------------------------
  server.tool(
    "list_tasks",
    "List tasks with derived quadrants. Filter by status or inbox (no project).",
    {
      status: z.enum(["TODO", "DONE", "ARCHIVED"]).optional(),
      inbox: z.boolean().optional().describe("Only tasks in no project"),
    },
    async ({ status, inbox }) =>
      json(await tasks.list({ status, projectId: inbox ? null : undefined })),
  );

  server.tool(
    "create_task",
    "Create a task. Quadrant is derived from important × urgent.",
    {
      title: z.string().min(1),
      notes: z.string().optional(),
      important: z.boolean().optional(),
      urgent: z.boolean().optional(),
      dueDate: z.string().datetime().optional(),
      goalId: z.string().optional(),
      projectId: z.string().optional(),
    },
    async ({ dueDate, ...rest }) =>
      json(await tasks.create({ ...rest, dueDate: dueDate ? new Date(dueDate) : undefined })),
  );

  server.tool(
    "update_task",
    "Partially update a task (flags, links, due date, schedule, big-rock pin).",
    {
      id: z.string(),
      title: z.string().min(1).optional(),
      important: z.boolean().optional(),
      urgent: z.boolean().optional(),
      dueDate: z.string().datetime().nullable().optional(),
      goalId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      isBigRock: z.boolean().optional(),
      scheduledDay: z.string().datetime().nullable().optional(),
      scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    },
    async ({ id, dueDate, scheduledDay, isBigRock, ...rest }) => {
      if (isBigRock !== undefined) await tasks.setBigRock(id, isBigRock);
      return json(
        await tasks.update(id, {
          ...rest,
          dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null,
          scheduledDay:
            scheduledDay === undefined ? undefined : scheduledDay ? new Date(scheduledDay) : null,
        }),
      );
    },
  );

  server.tool("complete_task", "Mark a task done.", { id: z.string() }, async ({ id }) =>
    json(await tasks.complete(id)),
  );

  server.tool("reopen_task", "Reopen a completed task.", { id: z.string() }, async ({ id }) =>
    json(await tasks.reopen(id)),
  );

  server.tool("delete_task", "Delete a task.", { id: z.string() }, async ({ id }) => {
    await tasks.remove(id);
    return json({ deleted: id });
  });

  server.tool(
    "quadrant_matrix",
    "Open tasks grouped Q1–Q4 by importance × urgency (the weekly compass).",
    {},
    async () => json(groupByQuadrant(await tasks.list({ status: "TODO" }))),
  );

  server.tool(
    "big_rocks_this_week",
    "What are my big rocks this week? Every task pinned as a big rock until it is unpinned, done ones included (as the app's rocks jar shows).",
    {},
    async () => json(await tasks.bigRocks()),
  );

  // --- Mission, roles, goals, projects (Habit 2) -------------------------------
  server.tool("get_mission", "The personal mission statement.", {}, async () =>
    json(await mission.getActive()),
  );

  server.tool(
    "set_mission",
    "Write the mission statement (previous versions are kept).",
    { content: z.string().min(1) },
    async ({ content }) => json(await mission.set(content)),
  );

  server.tool("list_roles", "The roles the user lives by.", {}, async () =>
    json(await roles.list()),
  );

  server.tool(
    "list_goals",
    "Goals with derived progress, optionally by status.",
    { status: z.enum(["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"]).optional() },
    async ({ status }) => json(await goals.list(status)),
  );

  server.tool(
    "create_goal",
    "Create a goal (a durable outcome), optionally under a role.",
    {
      title: z.string().min(1),
      description: z.string().optional(),
      targetDate: z.string().datetime().optional(),
      roleId: z.string().optional(),
    },
    async ({ targetDate, ...rest }) =>
      json(
        await goals.create({
          ...rest,
          targetDate: targetDate ? new Date(targetDate) : undefined,
        }),
      ),
  );

  server.tool(
    "list_projects",
    "Projects with derived task counts, optionally by status.",
    { status: z.enum(["ACTIVE", "SOMEDAY", "DONE"]).optional() },
    async ({ status }) => json(await projects.list(status)),
  );

  server.tool(
    "create_project",
    "Create a project (a multi-step outcome), optionally serving a goal.",
    { name: z.string().min(1), goalId: z.string().optional() },
    async (input) => json(await projects.create(input)),
  );

  // --- People (Habits 4–6) -------------------------------------------------------
  server.tool(
    "people_overview",
    "Everyone who matters: EBA balance, commitments with per-person status and history.",
    {},
    async () => json(await people.overview()),
  );

  server.tool(
    "overdue_commitments",
    "Which relationship commitments are overdue, per person?",
    {},
    async () => json(await people.overdue()),
  );

  server.tool(
    "log_commitment_occurrence",
    "Log that a commitment happened (per-person tracking).",
    {
      commitmentId: z.string(),
      personId: z.string().optional(),
      note: z.string().optional(),
    },
    async ({ commitmentId, ...opts }) => {
      await people.logOccurrence(commitmentId, opts);
      return json({ logged: commitmentId });
    },
  );

  server.tool(
    "add_eba_entry",
    "Log an emotional-bank-account deposit or withdrawal for a person.",
    {
      personId: z.string(),
      kind: z.enum(["DEPOSIT", "WITHDRAWAL"]),
      note: z.string().optional(),
    },
    async ({ personId, kind, note }) => json(await people.addEbaEntry(personId, kind, note)),
  );

  // --- Renewal (Habit 7) -----------------------------------------------------------
  server.tool(
    "list_habits",
    "Habits with this week's marks, counts, and week-streaks.",
    {},
    async () => json(await renewal.listHabits()),
  );

  server.tool(
    "toggle_habit",
    "Toggle a habit's check-off for a day (defaults to today; future days rejected).",
    { habitId: z.string(), day: z.string().datetime().optional() },
    async ({ habitId, day }) =>
      json(await renewal.toggleMark(habitId, day ? new Date(day) : new Date())),
  );

  server.tool(
    "renewal_summary",
    "This week per dimension — habit marks and one-off activities both count.",
    {},
    async () => json(await renewal.summary()),
  );

  server.tool(
    "renewal_trends",
    "The Almanac record: week delta, longest streak, goal momentum, 12-week heatmap.",
    {},
    async () => json(await renewal.trends()),
  );

  server.tool(
    "log_renewal_activity",
    "Log a one-off renewal activity (a retreat, a long hike) toward a dimension.",
    { dimension: DIMENSION, title: z.string().min(1), note: z.string().optional() },
    async (input) => json(await renewal.logActivity(input)),
  );

  server.tool(
    "weekly_intentions",
    "This ISO week's intention per renewal dimension.",
    {},
    async () => json(await renewal.intentions()),
  );

  server.tool(
    "set_weekly_intention",
    "Set (or clear, with empty text) this week's intention for a dimension.",
    { dimension: DIMENSION, text: z.string() },
    async ({ dimension, text }) => {
      await renewal.setIntention(dimension, text);
      return json({ dimension, text });
    },
  );

  return server;
}
