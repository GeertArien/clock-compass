/**
 * Spike-only: seed the real stores with three big rocks and answer `/api/*`
 * locally, so the real `TaskCard` (optimistic store updates and all) works
 * without a backend.
 */
import type { Project, Task } from "@/lib/api";
import { tasksStore } from "@/lib/stores/tasks.svelte";
import { projectsStore } from "@/lib/stores/projects.svelte";

const now = "2026-11-16T08:00:00.000Z";

function rock(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    notes: null,
    important: true,
    urgent: false,
    quadrant: "Q2",
    status: "TODO",
    proactivity: null,
    isBigRock: true,
    plannedWeek: "2026-11-16",
    dueDate: null,
    completedAt: null,
    scheduledDay: null,
    scheduledTime: null,
    goalId: null,
    projectId: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

export function seedStores(): void {
  const project: Project = {
    id: "proj_news",
    name: "Launch the newsletter",
    description: null,
    status: "ACTIVE",
    goalId: null,
    progress: { total: 1, done: 0, ratio: 0 },
    createdAt: now,
    updatedAt: now,
  };
  projectsStore.projects = [project];
  tasksStore.tasks = [
    rock("task_rock_1", "Draft the first newsletter issue", { projectId: "proj_news" }),
    rock("task_rock_2", "Monthly one-on-one day with Noor", { proactivity: "INFLUENCE" }),
    rock("task_rock_3", "Long run + plan next training block", { urgent: true, quadrant: "Q1" }),
  ];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url, location.origin).pathname.startsWith("/api/")) return realFetch(input, init);
    const id = url.match(/tasks\/([^/?]+)/)?.[1];
    const task = tasksStore.tasks.find((t) => t.id === id);
    const patch = init?.body ? (JSON.parse(String(init.body)) as Partial<Task>) : {};
    const status = url.endsWith("/complete") ? "DONE" : url.endsWith("/reopen") ? "TODO" : task?.status;
    const body = url.includes("/projects") ? projectsStore.projects : { ...task, ...patch, status };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
