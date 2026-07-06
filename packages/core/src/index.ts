// Public surface of the shared core. The server and the future MCP adapter
// import from here — never from deep paths and never the Prisma client directly.

export { prisma } from "./db/client.js";

// Domain helpers
export {
  deriveQuadrant,
  isBigRockQuadrant,
  QUADRANT_LABELS,
  type Quadrant,
  type ImportanceUrgency,
} from "./domain/quadrant.js";
export { startOfIsoWeek, isSameIsoWeek } from "./domain/week.js";
export { weekStreak, countThisWeek } from "./domain/habit.js";
export {
  parseCsv,
  parseTodoistCsv,
  parseTodoistDate,
  priorityToFlags,
  type TodoistRow,
} from "./domain/todoist.js";
export {
  dueNotifications,
  type PendingNotification,
  type NotificationFacts,
} from "./domain/notifications.js";
export {
  deriveStatus,
  nextDueDate,
  periodHistory,
  intervalMs,
  type Cadence,
  type CommitmentStatus,
} from "./domain/cadence.js";

// Repositories
export {
  PrismaTaskRepository,
  type TaskRepository,
} from "./repositories/task-repository.js";
export {
  PrismaGoalRepository,
  type GoalRepository,
  type GoalWithTasks,
} from "./repositories/goal-repository.js";
export {
  PrismaMissionRepository,
  type MissionRepository,
} from "./repositories/mission-repository.js";
export {
  PrismaRoleRepository,
  type RoleRepository,
} from "./repositories/role-repository.js";
export {
  PrismaProjectRepository,
  type ProjectRepository,
  type ProjectWithTasks,
} from "./repositories/project-repository.js";
export {
  PrismaPersonRepository,
  type PersonRepository,
  type PersonWithRelations,
} from "./repositories/person-repository.js";
export {
  PrismaCommitmentRepository,
  type CommitmentRepository,
  type CommitmentWithParticipants,
} from "./repositories/commitment-repository.js";
export {
  PrismaHabitRepository,
  type HabitRepository,
  type HabitWithMarks,
} from "./repositories/habit-repository.js";
export {
  PrismaApiKeyRepository,
  type ApiKeyRepository,
} from "./repositories/api-key-repository.js";
export {
  PrismaPushRepository,
  type PushRepository,
} from "./repositories/push-repository.js";
export {
  PrismaExportRepository,
  type ExportRepository,
  type ExportData,
} from "./repositories/export-repository.js";

// Services
export {
  TaskService,
  groupByQuadrant,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskFilter,
  type TaskWithQuadrant,
} from "./services/task-service.js";
export {
  GoalService,
  type CreateGoalInput,
  type UpdateGoalInput,
  type GoalProgress,
  type GoalWithProgress,
} from "./services/goal-service.js";
export { MissionService } from "./services/mission-service.js";
export {
  RoleService,
  type CreateRoleInput,
  type UpdateRoleInput,
} from "./services/role-service.js";
export {
  ProjectService,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ProjectProgress,
  type ProjectWithProgress,
} from "./services/project-service.js";
export {
  PeopleService,
  type CreatePersonInput,
  type UpdatePersonInput,
  type CreateCommitmentInput,
  type UpdateCommitmentInput,
  type CommitmentView,
  type PersonOverview,
} from "./services/people-service.js";
export { ApiKeyService, type ApiKeyView } from "./services/api-key-service.js";
export {
  RenewalService,
  DIMENSIONS,
  type CreateHabitInput,
  type UpdateHabitInput,
  type HabitView,
  type DimensionSummary,
  type RenewalTrends,
} from "./services/renewal-service.js";

// AI
export {
  type AiProvider,
  type TaskClassification,
  type WeeklyReviewContext,
  NoopAiProvider,
} from "./ai/provider.js";
export { AnthropicAiProvider } from "./ai/anthropic-provider.js";
export {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from "./ai/openai-compatible-provider.js";
export {
  AiService,
  type AiIntakeResult,
  type UnalignedReport,
} from "./services/ai-service.js";
export {
  ImportService,
  type TodoistImportResult,
} from "./services/import-service.js";
export {
  ExportService,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportBundle,
} from "./services/export-service.js";

// Re-export Prisma's generated types so consumers get them without a direct dep.
export type {
  Task,
  Goal,
  GoalStatus,
  Role,
  Project,
  ProjectStatus,
  MissionStatement,
  Person,
  Commitment,
  CommitmentLog,
  EbaEntry,
  EbaKind,
  CadenceUnit,
  Habit,
  HabitMark,
  RenewalDimension,
  RenewalActivity,
  WeeklyIntention,
  PushSubscription,
  NotificationSettings,
  ProactivityTag,
  ApiKey,
  Prisma,
} from "@prisma/client";
