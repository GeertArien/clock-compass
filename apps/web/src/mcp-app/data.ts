/**
 * The MCP App page's data port (#118, step 2).
 *
 * The app's components read through the app's query cache (tasks, goals,
 * projects, habits). In the app those queries call the REST API. In the page
 * there is no API and no token: the same keys are filled from the read
 * tools' answers instead, mapped here to the app's own shapes. So the same
 * component files run in both places, and only this binding differs.
 *
 * A screen's result carries the reads its live components need (answered
 * on the server under the data policy), so drawing a screen calls nothing.
 * `refreshReads` asks the same read tools again through the host, for when
 * the page has changed something (step 3).
 *
 * The page's query client never fetches by itself: nothing goes stale and
 * nothing refetches on focus or reconnect, and every key a component reads
 * is filled before the screen is drawn. A component never reaches the REST
 * API from the page (its content-security policy would refuse it anyway).
 */
import { QueryClient } from "@tanstack/react-query";
import { mcpToolName, type ReadName } from "@clock-compass/assistant-catalog";
import type { Goal, HabitView, Project, Task } from "@clock-compass/web-client/api";
import { storedDay } from "@clock-compass/web-client/week";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { habitsQuery } from "@/lib/queries/renewal";
import { tasksQuery } from "@/lib/queries/tasks";

/** One read a screen answered for the page (`structuredContent.reads`). */
export interface ScreenRead {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

// --- The read tools' shapes (packages/core/src/reads/handlers.ts) ------------

/** A task as `listTasks` answers it: days as plain dates. */
export interface ReadTask {
  id: string;
  title: string;
  notes?: string | null;
  quadrant: Task["quadrant"];
  important: boolean;
  urgent: boolean;
  status: Task["status"];
  proactivity: Task["proactivity"];
  isBigRock: boolean;
  dueDate: string | null;
  scheduledDay: string | null;
  scheduledTime: string | null;
  goalId: string | null;
  projectId: string | null;
  completedAt: string | null;
  repeat: { unit: "DAY" | "WEEK" | "MONTH" | "YEAR"; every: number; from: "SCHEDULE" | "COMPLETION"; leadDays: number | null } | null;
  later: boolean;
  showFrom: string | null;
}

/** A goal as `getCompass` answers it. */
export interface ReadGoal {
  id: string;
  title: string;
  description: string | null;
  status: Goal["status"];
  targetDate: string | null;
  roleId: string | null;
  progress: Goal["progress"];
}

/** A project as `getCompass` answers it. */
export interface ReadProject {
  id: string;
  name: string;
  description: string | null;
  status: Project["status"];
  goalId: string | null;
  progress: Project["progress"];
}

/** A habit as `listHabits` answers it. */
export interface ReadHabit {
  id: string;
  name: string;
  dimension: HabitView["dimension"];
  goalId: string | null;
  targetPerWeek: number;
  doneThisWeek: number;
  markedToday: boolean;
  weekDays: boolean[];
  streak: number;
}

// --- Into the app's shapes ---------------------------------------------------

const day = (plain: string | null | undefined) => (plain ? storedDay(plain) : null);

/** A read-tool task as the app's `Task`; what the read leaves out, the components do not use. */
export function taskFromRead(t: ReadTask): Task {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    important: t.important,
    urgent: t.urgent,
    quadrant: t.quadrant,
    status: t.status,
    proactivity: t.proactivity,
    isBigRock: t.isBigRock,
    plannedWeek: null,
    dueDate: day(t.dueDate),
    completedAt: t.completedAt,
    scheduledDay: day(t.scheduledDay),
    scheduledTime: t.scheduledTime,
    goalId: t.goalId,
    projectId: t.projectId,
    showFrom: day(t.showFrom),
    later: t.later,
    recurrence: t.repeat ? { ...t.repeat, active: true } : null,
    createdAt: "",
    updatedAt: "",
  };
}

export function goalFromRead(g: ReadGoal, order: number): Goal {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    targetDate: day(g.targetDate),
    status: g.status,
    order,
    roleId: g.roleId,
    dimension: null,
    progress: g.progress,
    createdAt: "",
    updatedAt: "",
  };
}

export function projectFromRead(p: ReadProject): Project {
  return { id: p.id, name: p.name, description: p.description, status: p.status, goalId: p.goalId, progress: p.progress, createdAt: "", updatedAt: "" };
}

export function habitFromRead(h: ReadHabit): HabitView {
  return {
    id: h.id,
    name: h.name,
    dimension: h.dimension,
    goalId: h.goalId,
    goalTitle: null,
    targetPerWeek: h.targetPerWeek,
    weekDays: h.weekDays,
    doneThisWeek: h.doneThisWeek,
    markedToday: h.markedToday,
    streak: h.streak,
  };
}

// --- The page's cache --------------------------------------------------------

/** The page's query client: it never fetches by itself (see the top of this file). */
export function createPageQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: "always",
      },
    },
  });
}

/** A read tool's answer: a list comes back as `{ items }` over MCP (packages/mcp `json`). */
const unwrap = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) && "items" in value ? (value as { items: unknown }).items : value;

/** Writes one read's answer into the app's query keys. Unknown reads are ignored. */
function seedOne(client: QueryClient, name: string, result: unknown): void {
  const value = unwrap(result);
  switch (name as ReadName) {
    case "listTasks":
      client.setQueryData(tasksQuery.queryKey, ((value as { tasks?: ReadTask[] })?.tasks ?? []).map(taskFromRead));
      break;
    case "getCompass": {
      const compass = (value ?? {}) as { goals?: ReadGoal[]; projects?: ReadProject[] };
      client.setQueryData(goalsQuery.queryKey, (compass.goals ?? []).map(goalFromRead));
      client.setQueryData(projectsQuery.queryKey, (compass.projects ?? []).map(projectFromRead));
      break;
    }
    case "listHabits":
      client.setQueryData(habitsQuery.queryKey, ((value as ReadHabit[]) ?? []).map(habitFromRead));
      break;
    default:
      break;
  }
}

/**
 * Fills the page's cache for one screen. Every key a component may read gets
 * a value (empty when the screen sent none: data not shared, or not needed),
 * so no component falls back to fetching.
 */
export function seedReads(client: QueryClient, reads: readonly ScreenRead[]): void {
  client.setQueryData(tasksQuery.queryKey, []);
  client.setQueryData(goalsQuery.queryKey, []);
  client.setQueryData(projectsQuery.queryKey, []);
  client.setQueryData(habitsQuery.queryKey, []);
  for (const read of reads) seedOne(client, read.name, read.result);
}

/** What the page needs of the host to read: the SDK `App`'s `callServerTool`. */
export interface HostReader {
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
}

/**
 * Reads the screen's data again through the host, with the same read tools
 * and arguments the server used, and updates the cache (step 3 calls it after
 * a write). A read the host refuses leaves what is shown as it is.
 */
export async function refreshReads(host: HostReader, client: QueryClient, reads: readonly Pick<ScreenRead, "name" | "args">[]): Promise<void> {
  await Promise.all(
    reads.map(async (read) => {
      const answer = await host.callServerTool({ name: mcpToolName(read.name), arguments: read.args }).catch(() => null);
      if (!answer || answer.isError || !answer.structuredContent) return;
      seedOne(client, read.name, answer.structuredContent);
    }),
  );
}
