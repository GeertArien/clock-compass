/** Typed API client for the Clock & Compass REST API. */

import { getToken } from "./token";

export type Quadrant = "Q1" | "Q2" | "Q3" | "Q4";
export type TaskStatus = "TODO" | "DONE" | "ARCHIVED";
export type Proactivity = "INFLUENCE" | "CONCERN";
export type GoalStatus = "ACTIVE" | "ON_HOLD" | "ACHIEVED" | "DROPPED";
export type ProjectStatus = "ACTIVE" | "SOMEDAY" | "DONE";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  important: boolean;
  urgent: boolean;
  quadrant: Quadrant;
  status: TaskStatus;
  proactivity: Proactivity | null;
  isBigRock: boolean;
  plannedWeek: string | null;
  dueDate: string | null;
  completedAt: string | null;
  scheduledDay: string | null;
  scheduledTime: string | null;
  goalId: string | null;
  projectId: string | null;
  // Recurrence (#105). The server always sends these; optional here so older
  // fixtures and cached lists still type-check.
  seriesId?: string | null;
  previousId?: string | null;
  slotDate?: string | null;
  showFrom?: string | null;
  /** Its "show from" date has not come yet (the server decides; never compare dates here). */
  later?: boolean;
  recurrence?: TaskRecurrence | null;
  createdAt: string;
  updatedAt: string;
}

/** A recurring task's rule, as the server returns it. */
export interface TaskRecurrence {
  unit: CadenceUnit;
  every: number;
  from: "SCHEDULE" | "COMPLETION";
  leadDays: number | null;
  active: boolean;
}

export interface GoalProgress {
  total: number;
  done: number;
  ratio: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  status: GoalStatus;
  order: number;
  roleId: string | null;
  dimension: string | null;
  progress: GoalProgress;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
  mission: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  goalId: string | null;
  progress: GoalProgress;
  createdAt: string;
  updatedAt: string;
}

export type CadenceUnit = "DAY" | "WEEK" | "MONTH" | "YEAR";
export type CommitmentStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE";
export type EbaKind = "DEPOSIT" | "WITHDRAWAL";

export interface CommitmentView {
  id: string;
  title: string;
  cadenceUnit: CadenceUnit;
  cadenceValue: number;
  status: CommitmentStatus;
  lastOccurredAt: string | null;
  nextDueAt: string | null;
  history: boolean[];
}

export interface PersonOverview {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  balance: number;
  ledger: { id: string; kind: EbaKind; note: string | null; occurredAt: string }[];
  commitments: CommitmentView[];
  createdAt: string;
  updatedAt: string;
}

export interface OverdueCommitment {
  personId: string;
  personName: string;
  commitmentId: string;
  title: string;
  lastOccurredAt: string | null;
}

export type RenewalDimension = "PHYSICAL" | "MENTAL" | "SOCIAL_EMOTIONAL" | "SPIRITUAL";

export interface HabitView {
  id: string;
  name: string;
  dimension: RenewalDimension | null;
  goalId: string | null;
  goalTitle: string | null;
  targetPerWeek: number;
  weekDays: boolean[];
  doneThisWeek: number;
  markedToday: boolean;
  streak: number;
}

export interface RenewalActivity {
  id: string;
  dimension: RenewalDimension;
  title: string;
  note: string | null;
  occurredAt: string;
}

export interface DimensionSummary {
  dimension: RenewalDimension;
  habitsDone: number;
  habitsTarget: number;
  oneOffs: number;
  total: number;
}

export interface RenewalTrends {
  thisWeek: number;
  lastWeek: number;
  longestStreak: { weeks: number; habitName: string | null };
  goalMomentum: { goalId: string; title: string; pct: number }[];
  heatmap: number[][];
}

export interface Mission {
  id: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Health {
  status: string;
  uptime: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The human-readable message for a failed response body. Fastify's own errors
 * are `{"statusCode":400,"error":"Bad Request","message":"…"}`, so `message`
 * wins; the routes' errors are `{"error":"Task not found"}`, so `error` is next.
 * Otherwise the raw body, else the status text.
 */
function messageFromBody(body: string, statusText: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const { message, error } = parsed as { message?: unknown; error?: unknown };
      if (typeof message === "string" && message) return message;
      if (typeof error === "string" && error) return error;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body || statusText;
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  // Only declare a JSON content-type when we actually send a body — otherwise
  // Fastify rejects the empty body (FST_ERR_CTP_EMPTY_JSON_BODY) on bodyless
  // POST/DELETE calls like complete/reopen/delete.
  if (init?.body !== undefined && init?.body !== null) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // The browser's zone on every request: the server counts "after I completed
  // it" from its local day (#105), and takes "today" and "this week" for
  // habits, intentions and the weekly review from it (#112). It never sets
  // the zone the server remembers: the app reports that on purpose
  // (`reportTimeZone`, #136).
  const zone = browserTimeZone();
  if (zone && !headers["X-Time-Zone"]) headers["X-Time-Zone"] = zone;
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    throw new ApiError(res.status, messageFromBody(await res.text(), res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Run one operation of the registry (issue #109): `POST /operations/{name}`.
 * `timeZone` (IANA) says whose "today" the operation means (days such as
 * "2026-11-23" are plain dates, #136). `idempotencyKey` makes a create happen
 * once: the same key answers with the item made the first time. Resolves with
 * the server's result (`{ changed }`, and the new `id` for a create).
 */
export function runOperation(
  name: string,
  input: unknown,
  options: { timeZone?: string; idempotencyKey?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options.timeZone) headers["X-Time-Zone"] = options.timeZone;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  return request<unknown>(`/operations/${encodeURIComponent(name)}`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
    headers,
  });
}

/** The zone the server uses where no device asks (#136). */
export interface TimeZoneSettings {
  zone: string;
  /** TZ (the server's override), app (reported by the app) or default (UTC). */
  source: "TZ" | "app" | "default";
  reported: string | null;
  /**
   * LEGACY (#136, to remove in #137): scheduled days still in the old form.
   * `reason`: no-zone (no zone known yet) or refused (they fit no known zone).
   */
  oldScheduledDays: { count: number; reason: "no-zone" | "refused" | null };
}

export function getTimeZoneSettings(): Promise<TimeZoneSettings> {
  return request<TimeZoneSettings>("/settings/time-zone");
}

/** Tell the server this device's zone (#136): used for MCP, scripts and push hours unless TZ is set. */
export function reportTimeZone(timeZone: string): Promise<TimeZoneSettings> {
  return request<TimeZoneSettings>("/settings/time-zone", { method: "PUT", body: JSON.stringify({ timeZone }) });
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health");
}

/**
 * The tasks the app loads: every status but skipped occurrences. "Later"
 * occurrences of a recurring task are included, flagged `later` by the
 * server (#105): Clock · Week and "Later (n)" show them; the other screens
 * leave them out by that flag, never by comparing dates.
 */
export function listTasks(status?: TaskStatus): Promise<Task[]> {
  const query = status ? `?${new URLSearchParams({ status }).toString()}` : "";
  return request<Task[]>(`/tasks${query}`);
}

/**
 * An upcoming occurrence of a recurring task, worked out by the server from
 * the series' rule for the calendar. Not a task: it cannot be ticked or
 * edited, and becomes one only when the occurrence before it is completed
 * or skipped.
 */
export interface TaskPreview {
  seriesId: string;
  /** The open occurrence it would follow. */
  taskId: string;
  title: string;
  /** Its calendar day, YYYY-MM-DD in the browser's zone. */
  day: string;
  dueDate: string | null;
  scheduledTime: string | null;
  /** Counted from completion: the date if the open one is completed on its day. */
  approximate: boolean;
}

/** Previews for the days `from`..`to` (YYYY-MM-DD, inclusive; at most 62 days). */
export function listTaskPreviews(from: string, to: string): Promise<TaskPreview[]> {
  return request<TaskPreview[]>(`/tasks/previews?${new URLSearchParams({ from, to }).toString()}`);
}

/** Every occurrence of a task's series, oldest first (empty when it does not repeat). */
export function listTaskOccurrences(id: string): Promise<Task[]> {
  return request<Task[]>(`/tasks/${id}/occurrences`);
}

/** A rule for a recurring task, as the form sends it. */
export interface RecurrenceBody {
  unit: CadenceUnit;
  every?: number;
  from?: "SCHEDULE" | "COMPLETION";
  leadDays?: number | null;
}

export interface CreateTaskBody {
  title: string;
  notes?: string;
  important?: boolean;
  urgent?: boolean;
  dueDate?: string;
  scheduledDay?: string;
  scheduledTime?: string;
  goalId?: string;
  projectId?: string;
  proactivity?: Proactivity;
  recurrence?: RecurrenceBody;
}

export function createTask(body: CreateTaskBody): Promise<Task> {
  return request<Task>("/tasks", { method: "POST", body: JSON.stringify(body) });
}

export interface UpdateTaskBody {
  title?: string;
  notes?: string | null;
  important?: boolean;
  urgent?: boolean;
  dueDate?: string | null;
  scheduledDay?: string | null;
  scheduledTime?: string | null;
  isBigRock?: boolean;
  plannedWeek?: string | null;
  goalId?: string | null;
  projectId?: string | null;
  proactivity?: Proactivity | null;
  /** A new rule from this occurrence on, or null to stop repeating. Left out: unchanged. */
  recurrence?: RecurrenceBody | null;
}

export function updateTask(id: string, body: UpdateTaskBody): Promise<Task> {
  return request<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function completeTask(id: string): Promise<Task> {
  return request<Task>(`/tasks/${id}/complete`, { method: "POST" });
}

export function reopenTask(id: string): Promise<Task> {
  return request<Task>(`/tasks/${id}/reopen`, { method: "POST" });
}

/** Skip the open occurrence of a repeating task; the next one is created. */
export function skipTask(id: string): Promise<Task> {
  return request<Task>(`/tasks/${id}/skip`, { method: "POST" });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/tasks/${id}`, { method: "DELETE" });
}

// --- Goals (Habit 2) --------------------------------------------------------

export function listGoals(status?: GoalStatus): Promise<Goal[]> {
  return request<Goal[]>(`/goals${status ? `?status=${status}` : ""}`);
}

export interface CreateGoalBody {
  title: string;
  description?: string;
  targetDate?: string;
  status?: GoalStatus;
  roleId?: string;
}

export function createGoal(body: CreateGoalBody): Promise<Goal> {
  return request<Goal>("/goals", { method: "POST", body: JSON.stringify(body) });
}

export interface UpdateGoalBody {
  title?: string;
  description?: string | null;
  targetDate?: string | null;
  status?: GoalStatus;
  roleId?: string | null;
}

export function updateGoal(id: string, body: UpdateGoalBody): Promise<Goal> {
  return request<Goal>(`/goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteGoal(id: string): Promise<void> {
  return request<void>(`/goals/${id}`, { method: "DELETE" });
}

/** Persist a manual goal order (the ids of one role group, in new order). */
export function reorderGoals(ids: string[]): Promise<void> {
  return request<void>("/goals/reorder", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// --- Roles (Habit 2) ---------------------------------------------------------

export function listRoles(): Promise<Role[]> {
  return request<Role[]>("/roles");
}

export interface CreateRoleBody {
  name: string;
  mission?: string;
  order?: number;
}

export function createRole(body: CreateRoleBody): Promise<Role> {
  return request<Role>("/roles", { method: "POST", body: JSON.stringify(body) });
}

export interface UpdateRoleBody {
  name?: string;
  mission?: string | null;
  order?: number;
}

export function updateRole(id: string, body: UpdateRoleBody): Promise<Role> {
  return request<Role>(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteRole(id: string): Promise<void> {
  return request<void>(`/roles/${id}`, { method: "DELETE" });
}

/** Persist a manual role order (all role ids, in new order). */
export function reorderRoles(ids: string[]): Promise<void> {
  return request<void>("/roles/reorder", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// --- Projects ----------------------------------------------------------------

export function listProjects(status?: ProjectStatus): Promise<Project[]> {
  return request<Project[]>(`/projects${status ? `?status=${status}` : ""}`);
}

export interface CreateProjectBody {
  name: string;
  description?: string;
  goalId?: string;
  status?: ProjectStatus;
}

export function createProject(body: CreateProjectBody): Promise<Project> {
  return request<Project>("/projects", { method: "POST", body: JSON.stringify(body) });
}

export interface UpdateProjectBody {
  name?: string;
  description?: string | null;
  goalId?: string | null;
  status?: ProjectStatus;
}

export function updateProject(id: string, body: UpdateProjectBody): Promise<Project> {
  return request<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${id}`, { method: "DELETE" });
}

// --- People + commitments + EBA (Habits 4–6) ---------------------------------

export function listPeople(): Promise<PersonOverview[]> {
  return request<PersonOverview[]>("/people");
}

export function createPerson(body: {
  name: string;
  relationship?: string;
  notes?: string;
}): Promise<PersonOverview> {
  return request<PersonOverview>("/people", { method: "POST", body: JSON.stringify(body) });
}

export function deletePerson(id: string): Promise<void> {
  return request<void>(`/people/${id}`, { method: "DELETE" });
}

export function addEbaEntry(
  personId: string,
  body: { kind: EbaKind; note?: string },
): Promise<PersonOverview> {
  return request<PersonOverview>(`/people/${personId}/eba`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createCommitment(body: {
  title: string;
  description?: string;
  cadenceUnit: CadenceUnit;
  cadenceValue?: number;
  personIds: string[];
}): Promise<{ id: string }> {
  return request<{ id: string }>("/commitments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteCommitment(id: string): Promise<void> {
  return request<void>(`/commitments/${id}`, { method: "DELETE" });
}

export function logOccurrence(
  commitmentId: string,
  body: { personId?: string; note?: string } = {},
): Promise<void> {
  return request<void>(`/commitments/${commitmentId}/log`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Habits + renewal (Habit 7) ------------------------------------------------

export function listHabits(): Promise<HabitView[]> {
  return request<HabitView[]>("/habits");
}

export function createHabit(body: {
  name: string;
  dimension?: RenewalDimension;
  goalId?: string;
  targetPerWeek?: number;
}): Promise<HabitView> {
  return request<HabitView>("/habits", { method: "POST", body: JSON.stringify(body) });
}

export function deleteHabit(id: string): Promise<void> {
  return request<void>(`/habits/${id}`, { method: "DELETE" });
}

/** Toggle a check-off; `day` is a plain date (YYYY-MM-DD), absent = today on this device. */
export function toggleHabit(id: string, day?: string): Promise<HabitView> {
  return request<HabitView>(`/habits/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify(day ? { day } : {}),
  });
}

export function getIntentions(): Promise<{ dimension: RenewalDimension; text: string }[]> {
  return request<{ dimension: RenewalDimension; text: string }[]>("/renewal/intentions");
}

export function setIntention(dimension: RenewalDimension, text: string): Promise<void> {
  return request<void>(`/renewal/intentions/${dimension}`, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
}

export function getRenewalSummary(): Promise<DimensionSummary[]> {
  return request<DimensionSummary[]>("/renewal/summary");
}

export function getRenewalTrends(): Promise<RenewalTrends> {
  return request<RenewalTrends>("/renewal/trends");
}

export function listRenewalActivities(): Promise<RenewalActivity[]> {
  return request<RenewalActivity[]>("/renewal/activities");
}

export function logRenewalActivity(body: {
  dimension: RenewalDimension;
  title: string;
  note?: string;
}): Promise<RenewalActivity> {
  return request<RenewalActivity>("/renewal/activities", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- API keys (agent & service access) ----------------------------------------

export interface ApiKeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function listApiKeys(): Promise<ApiKeyView[]> {
  return request<ApiKeyView[]>("/keys");
}

export function createApiKey(name: string): Promise<{ key: string; record: ApiKeyView }> {
  return request<{ key: string; record: ApiKeyView }>("/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(id: string): Promise<ApiKeyView> {
  return request<ApiKeyView>(`/keys/${id}/revoke`, { method: "POST" });
}

// --- AI jobs ------------------------------------------------------------------

export interface TaskClassification {
  title: string;
  important: boolean;
  urgent: boolean;
  proactivity: Proactivity | null;
  dueDate: string | null;
  rationale: string;
}

export interface AiStatus {
  available: boolean;
  /** Ready to call right now (for OAuth providers, signed in). */
  connected: boolean;
  /** True when the provider connects via sign-in (Codex / ChatGPT subscription). */
  oauth: boolean;
}

export function getAiStatus(): Promise<AiStatus> {
  return request<AiStatus>("/ai/status");
}

// --- AI settings (Settings → AI, #94) ----------------------------------------
// The server's own token only; keys are write-only (never in an answer).

export type AiProviderKind = "anthropic" | "openai-compatible" | "codex";
export type AiJobKey = "default" | "assistant" | "classifyTask" | "tagProactivity" | "refineMission" | "weeklyReview";

export interface AiProviderView {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string | null;
  /** A key is stored (the key itself is never sent back). */
  keySet: boolean;
  /** The last four characters of a key of 20 or more; null otherwise. */
  keyHint: string | null;
  models: string[];
  /** Said when a key would travel over plain http to a public address. */
  warning: string | null;
  /**
   * The last assistant answer's token numbers through this provider since the
   * server started (#130), or null. Absent from an older server.
   */
  lastUsage?: AiLastUsage | null;
}

/** One answer's token numbers (#130): counts only. */
export interface AiLastUsage {
  model: string;
  promptTokens: number;
  /** Read from the provider's prompt cache; null when the endpoint did not say. */
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  at: string;
}

export interface AiJobView {
  job: AiJobKey;
  providerId: string | null;
  model: string | null;
  /** What it sends with the current switches (not for "default"). */
  sends?: { label: string; shared: boolean }[];
  offBecause?: string | null;
}

export interface AiSettings {
  providers: AiProviderView[];
  jobs: AiJobView[];
  switches: { category: string; enabled: boolean; byDefault: boolean }[];
}

export interface AiProviderInput {
  name?: string;
  kind?: AiProviderKind;
  baseUrl?: string | null;
  /** A new key; null removes the stored one; leave out to keep it. */
  apiKey?: string | null;
  models?: string[];
}

export function getAiSettings(): Promise<AiSettings> {
  return request<AiSettings>("/ai/settings");
}

export function addAiProvider(input: AiProviderInput): Promise<AiProviderView> {
  return request<AiProviderView>("/ai/providers", { method: "POST", body: JSON.stringify(input) });
}

export function updateAiProvider(id: string, input: AiProviderInput): Promise<AiProviderView> {
  return request<AiProviderView>(`/ai/providers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function removeAiProvider(id: string): Promise<void> {
  return request<void>(`/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testAiProvider(id: string): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`/ai/providers/${encodeURIComponent(id)}/test`, { method: "POST" });
}

export function loadAiModels(id: string): Promise<{ models: string[] }> {
  return request<{ models: string[] }>(`/ai/providers/${encodeURIComponent(id)}/models`, { method: "POST" });
}

export function setAiJobs(jobs: { job: AiJobKey; providerId: string | null; model: string | null }[]): Promise<void> {
  return request<void>("/ai/jobs", { method: "PUT", body: JSON.stringify({ jobs }) });
}

export function setAiDataPolicy(switches: { category: string; enabled: boolean }[]): Promise<void> {
  return request<void>("/ai/data-policy", { method: "PUT", body: JSON.stringify({ switches }) });
}

// --- Codex (ChatGPT subscription) sign-in ---------------------------------

export interface CodexStatus {
  connected: boolean;
  accountId: string | null;
  label: string | null;
  expiresAt: string | null;
}

export function getCodexStatus(): Promise<CodexStatus> {
  return request<CodexStatus>("/ai/codex/status");
}

export interface CodexDeviceStart {
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export function startCodexDevice(): Promise<CodexDeviceStart> {
  return request<CodexDeviceStart>("/ai/codex/device/start", { method: "POST" });
}

export type CodexLogin =
  | { state: "idle" }
  | { state: "pending"; userCode: string; verificationUri: string }
  | { state: "connected" }
  | { state: "error"; message: string };

export function getCodexLogin(): Promise<CodexLogin> {
  return request<CodexLogin>("/ai/codex/device/login");
}

export function codexDisconnect(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/ai/codex/disconnect", { method: "POST" });
}

export function aiClassify(text: string): Promise<TaskClassification> {
  return request<TaskClassification>("/ai/classify", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function aiIntake(
  text: string,
): Promise<{ task: Task; classification: TaskClassification }> {
  return request<{ task: Task; classification: TaskClassification }>("/ai/intake", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function aiRefineMission(draft: string): Promise<{ content: string }> {
  return request<{ content: string }>("/ai/mission/refine", {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
}

export function aiReview(): Promise<{ summary: string; generatedAt: string }> {
  return request<{ summary: string; generatedAt: string }>("/ai/review");
}

// --- Todoist import ------------------------------------------------------------

export interface TodoistImportResult {
  imported: number;
  skipped: number;
  projectId: string | null;
}

export function importTodoist(
  csv: string,
  projectName?: string,
): Promise<TodoistImportResult> {
  return request<TodoistImportResult>("/import/todoist", {
    method: "POST",
    body: JSON.stringify({ csv, ...(projectName ? { projectName } : {}) }),
  });
}

// --- Data export (full JSON backup) ---------------------------------------------

export interface ExportBundle {
  format: string;
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export function exportBackup(): Promise<ExportBundle> {
  return request<ExportBundle>("/export");
}

// --- Web push + notification settings -------------------------------------------

export interface NotificationSettings {
  overdueCommitments: boolean;
  morningRocks: boolean;
  weeklyReview: boolean;
  morningHour: number;
  quietStart: number;
  quietEnd: number;
}

export function getPushStatus(): Promise<{
  configured: boolean;
  publicKey: string | null;
  subscriptions: number;
}> {
  return request("/push/status");
}

export function pushSubscribe(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }> {
  return request("/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export function pushUnsubscribe(endpoint: string): Promise<void> {
  return request("/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

export function pushTest(): Promise<{ ok: boolean }> {
  return request("/push/test", { method: "POST" });
}

export function getNotificationSettings(): Promise<NotificationSettings> {
  return request("/notifications/settings");
}

export function updateNotificationSettings(
  body: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  return request("/notifications/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// --- Mission statement (Habit 2) -------------------------------------------

export function getMission(): Promise<Mission | null> {
  return request<Mission | null>("/mission");
}

export function setMission(content: string): Promise<Mission> {
  return request<Mission>("/mission", {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}
