import type { Project } from "@clock-compass/web-client/api";

/** Where a task lives: its project (▤) or the Inbox (⌂). */
export function crumb(projects: Project[], projectId: string | null): string {
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  return project ? `▤ ${project.name}` : "⌂ Inbox";
}
