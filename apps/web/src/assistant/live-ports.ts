/**
 * The executor's ports bound to the app: proposals are checked against the
 * query cache (what the screens show), the operation runs on the server with
 * the browser's time zone (a day is the browser's local midnight, as the
 * Clock stores it), and afterwards the queries the operation touches are
 * invalidated: the ones on screen reload at once, the others on next use.
 */
import type { CheckData, Touches } from "@clock-compass/assistant-catalog";
import { runOperation, type Goal, type HabitView, type Project, type Task } from "@clock-compass/web-client/api";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { tasksQuery } from "@/lib/queries/tasks";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { peopleQuery } from "@/lib/queries/people";
import { missionQuery } from "@/lib/queries/mission";
import { habitsQuery } from "@/lib/queries/renewal";
import type { OperationPorts } from "./actions";

const RENEWAL: QueryKey = ["renewal"];

/** The queries an operation's `touches` reload. Goal and project tallies are derived from tasks. */
const QUERIES: Record<Touches, readonly QueryKey[]> = {
  // Previews and series histories follow the tasks (#105).
  tasks: [tasksQuery.queryKey, goalsQuery.queryKey, projectsQuery.queryKey, ["task-previews"], ["task-occurrences"]],
  goals: [goalsQuery.queryKey],
  projects: [projectsQuery.queryKey],
  people: [peopleQuery.queryKey],
  habits: [RENEWAL],
  intentions: [RENEWAL],
  renewal: [RENEWAL],
  mission: [missionQuery.queryKey],
};

/** What the app has loaded, or nothing to check against before the first load. */
export function cachedCheckData(): CheckData | undefined {
  const data: CheckData = {
    tasks: queryClient.getQueryData<Task[]>(tasksQuery.queryKey),
    habits: queryClient.getQueryData<HabitView[]>(habitsQuery.queryKey),
    goals: queryClient.getQueryData<Goal[]>(goalsQuery.queryKey),
    projects: queryClient.getQueryData<Project[]>(projectsQuery.queryKey),
  };
  const loaded = Object.entries(data).filter(([, list]) => list !== undefined);
  return loaded.length ? (Object.fromEntries(loaded) as CheckData) : undefined;
}

/**
 * The idempotency key a create sends: a SHA-256 of the action key (surface,
 * name and arguments), so it is the same for the same proposal on every press
 * and after a reload, and short enough for a header.
 */
export async function idempotencyKey(actionKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actionKey));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const livePorts: OperationPorts = {
  data: cachedCheckData,
  run: async (name, input, key) =>
    runOperation(name, input, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      idempotencyKey: await idempotencyKey(key),
    }),
  async refresh(touches) {
    const keys = new Map(touches.flatMap((t) => QUERIES[t]).map((key) => [JSON.stringify(key), key]));
    await Promise.all([...keys.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  },
};
