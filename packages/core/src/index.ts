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
export {
  addDays,
  dayAtUtc,
  isoWeekStart,
  isoWeekday,
  plainDayOf,
  resolveClock,
  serverZone,
  todayOf,
  type DayClock,
  type PlainDay,
} from "./domain/week.js";
export { weekStreak, countThisWeek } from "./domain/habit.js";
export {
  parseCsv,
  parseTodoistCsv,
  parseTodoistDate,
  recurringPhrase,
  todoistNotes,
  priorityToFlags,
  type TodoistRow,
} from "./domain/todoist.js";
export {
  dueNotifications,
  type PendingNotification,
  type NotificationFacts,
} from "./domain/notifications.js";
export { notificationFacts } from "./services/notification-facts.js";
export {
  deriveStatus,
  nextDueDate,
  periodHistory,
  addCadence,
  addCadenceToDay,
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
  PrismaProviderCredentialRepository,
  type ProviderCredentialRepository,
  type ProviderCredentialInput,
} from "./repositories/provider-credential-repository.js";
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
  TaskRuleError,
  groupByQuadrant,
  progressCounts,
  serverToday,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskFilter,
  type TaskWithQuadrant,
  type TaskClock,
  type RecurrenceInput,
  type RecurrenceView,
  type TaskPreview,
  MAX_PREVIEW_RANGE_DAYS,
} from "./services/task-service.js";
export {
  firstSlotAfter,
  nextSlot,
  nextOccurrenceDates,
  upcomingOccurrences,
  type UpcomingOccurrence,
  type RecurrenceRule,
  type OccurrenceDates,
} from "./domain/recurrence.js";
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
  type AgentMessage,
  type AssistantMessage,
  type AssistantTurnEvent,
  type AssistantTurnRequest,
  type ToolCall,
  type ToolResultMessage,
  type ToolSpec,
  type TurnStopReason,
  type UserMessage,
  NoopAiProvider,
} from "./ai/provider.js";
export {
  AI_JOBS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_CODEX_MODEL,
  SameForEveryJob,
  aiJobsFromEnvironment,
  choiceFromEnvironment,
  singleProvider,
  type AiEnvironment,
  type AiJob,
  type AiJobChoice,
  type AiJobs,
  type AiProviderName,
} from "./ai/jobs.js";
export { AnthropicAiProvider } from "./ai/anthropic-provider.js";
export {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from "./ai/openai-compatible-provider.js";
export {
  CodexResponsesProvider,
  CodexCredentialManager,
  CodexAuthError,
  CODEX_PROVIDER,
  type CodexConnectionStatus,
} from "./ai/codex-provider.js";
export {
  startCodexDeviceAuth,
  awaitCodexDeviceApproval,
  exchangeCodexCode,
  type CodexDeviceCode,
  type CodexTokens,
} from "./ai/codex-oauth.js";
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

// The in-app assistant (issue #62)
export {
  DATA_CATEGORIES,
  DEFAULT_DATA_POLICY,
  currentDataPolicy,
  type DataCategory,
  type DataPolicy,
} from "./assistant/data-policy.js";
export {
  READ_TOOLS,
  isTimeZone,
  localDay,
  personView,
  runTool,
  toolSpecs,
  type AssistantServices,
  type AssistantTool,
  type ToolContext,
  type ToolOutcome,
} from "./assistant/tools.js";
// One set of read tools for the assistant and MCP (#117)
export {
  readAllowed,
  runRead,
  taskView,
  type ReadContext,
  type ReadOutcome,
  type ReadServices,
} from "./reads/handlers.js";
export {
  AssistantUnavailableError,
  assistantAvailability,
  assistantProvider,
  assistantPromptParts,
  assistantSystemPrompt,
  runAgent,
  withheldData,
  type AgentEvent,
  type AgentOptions,
  type AgentRun,
  type SystemPromptInput,
  type DoneReason,
  type UnavailableReason,
} from "./assistant/agent.js";
export {
  MAX_RENDER_FAILURES,
  RENDER_TOOL,
  RENDER_TOOL_NAME,
  renderInstructions,
  renderSurface,
  type RenderOptions,
  type RenderOutcome,
} from "./assistant/render.js";

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
  ProviderCredential,
  Prisma,
} from "@prisma/client";

// The operation registry's handlers (issue #109): the REST endpoint and the
// MCP adapter run every write operation through `runOperation`.
export {
  OperationError,
  runOperation,
  type Changed,
  type OperationContext,
  type OperationServices,
} from "./operations/handlers.js";
export { zonedDay, zonedMidnight } from "./domain/zoned.js";

// Stored days to plain dates (#112)
export { PrismaDayRepository, type DayRepository } from "./repositories/day-repository.js";
export {
  countNotPlain,
  describePlan,
  isPlain,
  planDayMigration,
  type DayMigrationPlan,
  type StoredDays,
} from "./services/day-migration.js";
