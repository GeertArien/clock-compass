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
  createdAt: string;
  updatedAt: string;
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

export type CadenceUnit = "DAY" | "WEEK" | "MONTH";
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
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    throw new ApiError(res.status, (await res.text()) || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health");
}

export function listTasks(status?: TaskStatus): Promise<Task[]> {
  return request<Task[]>(`/tasks${status ? `?status=${status}` : ""}`);
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

export function getAiStatus(): Promise<{ available: boolean }> {
  return request<{ available: boolean }>("/ai/status");
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
