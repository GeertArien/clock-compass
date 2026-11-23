/**
 * The executor's ports bound to the app: proposals are checked against the
 * query cache (what the screens show), the operation runs on the server with
 * the browser's time zone (a day is the browser's local midnight, as the
 * Clock stores it), and afterwards the queries the operation touches are
 * invalidated: the ones on screen reload at once, the others on next use.
 */
import type { CheckData, Touches } from "@clock-compass/assistant-catalog";
import { runOperation, type HabitView, type Task } from "@clock-compass/web-client/api";
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
  tasks: [tasksQuery.queryKey, goalsQuery.queryKey, projectsQuery.queryKey],
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
  const tasks = queryClient.getQueryData<Task[]>(tasksQuery.queryKey);
  const habits = queryClient.getQueryData<HabitView[]>(habitsQuery.queryKey);
  return tasks || habits ? { ...(tasks ? { tasks } : {}), ...(habits ? { habits } : {}) } : undefined;
}

export const livePorts: OperationPorts = {
  data: cachedCheckData,
  run: (name, input) => runOperation(name, input, Intl.DateTimeFormat().resolvedOptions().timeZone),
  async refresh(touches) {
    const keys = new Map(touches.flatMap((t) => QUERIES[t]).map((key) => [JSON.stringify(key), key]));
    await Promise.all([...keys.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  },
};
