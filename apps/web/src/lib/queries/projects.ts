import { mutationOptions, queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
  type CreateProjectBody,
  type Project,
  type ProjectStatus,
  type UpdateProjectBody,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { replaceById, restoreAt, withoutId } from "@clock-compass/web-client/rollback";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";
import { reloadTasks } from "./tasks";

export { PROJECT_STATUS_LABELS } from "@clock-compass/web-client/meta";

const edits = editsFor<Project>();
const KEY = ["projects"] as const;

/** Projects, with their task counts (derived server-side). */
export const projectsQuery = queryOptions({
  queryKey: KEY,
  queryFn: async ({ client }) => {
    const before = edits(client).latestTicket;
    const projects = await listProjects();
    // A full reload is the confirmed state: drop the in-flight bookkeeping,
    // unless an edit started meanwhile (its onMutate cancelled this request).
    if (edits(client).latestTicket === before) edits(client).reset();
    return projects;
  },
});

const NO_PROJECTS: Project[] = [];

/** The projects, or none until they've loaded (a stable empty list). */
export function useProjects(): Project[] {
  return useQuery(projectsQuery).data ?? NO_PROJECTS;
}

/**
 * One project by id, re-rendering only when that project changes (the
 * selected value is structurally shared), so a task card doesn't re-render
 * when another project's counts move.
 */
export function useProject(id: string | null): Project | undefined {
  return useQuery({
    ...projectsQuery,
    select: (projects) => (id ? projects.find((p) => p.id === id) : undefined),
  }).data;
}

function cached(client: QueryClient): Project[] {
  return client.getQueryData(projectsQuery.queryKey) ?? [];
}

function write(client: QueryClient, update: (projects: Project[]) => Project[]): void {
  client.setQueryData(projectsQuery.queryKey, (projects) => update(projects ?? []));
}

/**
 * Silent reload, used when task changes shift the derived counts (or after an
 * import). A failure keeps what's shown, with no error: a later interaction
 * will surface it.
 */
export async function refreshProjects(client: QueryClient): Promise<void> {
  try {
    const projects = await listProjects();
    edits(client).reset();
    client.setQueryData(projectsQuery.queryKey, projects);
  } catch {
    /* keep current state */
  }
}

/** Add a project: a placeholder shows at once (first), replaced by the created one. */
export const addProject = mutationOptions({
  mutationKey: [...KEY, "add"],
  mutationFn: (body: CreateProjectBody) => createProject(body),
  onMutate: async (body, { client }) => {
    // A list request already in flight may predate this write: drop its answer.
    await client.cancelQueries({ queryKey: projectsQuery.queryKey });
    const now = new Date().toISOString();
    const temp: Project = {
      id: `temp_${now}`,
      name: body.name,
      description: body.description ?? null,
      status: body.status ?? "ACTIVE",
      goalId: body.goalId ?? null,
      progress: { total: 0, done: 0, ratio: 0 },
      createdAt: now,
      updatedAt: now,
    };
    write(client, (projects) => [temp, ...projects]);
    return { tempId: temp.id };
  },
  onSuccess: (created, _body, ctx, { client }) => {
    write(client, (projects) => projects.map((p) => (p.id === ctx.tempId ? created : p)));
    toast.success("Project added");
  },
  onError: (err, _body, ctx, { client }) => {
    if (ctx) write(client, (projects) => withoutId(projects, ctx.tempId));
    toast.error(errorMessage(err));
  },
});

/**
 * Edit a project (any fields, or just its status or goal). Overlapping edits
 * settle in any order: a failure drops only its own patch.
 */
export const editProject = mutationOptions({
  mutationKey: [...KEY, "update"],
  mutationFn: ({ project, body }: { project: Project; body: UpdateProjectBody }) =>
    updateProject(project.id, body),
  onMutate: async ({ project, body }, { client }) => {
    // A list request already in flight may predate this write: drop its answer.
    await client.cancelQueries({ queryKey: projectsQuery.queryKey });
    const current = cached(client).find((p) => p.id === project.id);
    if (!current) return undefined;
    const { item, ticket } = edits(client).apply(current, body as Partial<Project>);
    write(client, (projects) => replaceById(projects, item));
    return { ticket };
  },
  onSuccess: (updated, { project }, ctx, { client }) => {
    if (!ctx) return;
    const shown = edits(client).succeed(project.id, ctx.ticket, updated);
    write(client, (projects) => replaceById(projects, shown));
  },
  onError: (err, { project }, ctx, { client }) => {
    const shown = ctx ? edits(client).fail(project.id, ctx.ticket) : undefined;
    if (shown) write(client, (projects) => replaceById(projects, shown));
    toast.error(errorMessage(err));
  },
});

/** The variables for a status change through editProject. */
export const projectStatusEdit = (project: Project, status: ProjectStatus) => ({
  project,
  body: { status },
});

/** The variables for linking a project to a goal (or none) through editProject. */
export const projectGoalEdit = (project: Project, goalId: string | null) => ({
  project,
  body: { goalId },
});

/** Delete a project; its tasks move to the Inbox. A failure puts it back in place. */
export const removeProject = mutationOptions({
  mutationKey: [...KEY, "remove"],
  mutationFn: (project: Project) => deleteProject(project.id),
  onMutate: async (project, { client }) => {
    // A list request already in flight may predate this write: drop its answer.
    await client.cancelQueries({ queryKey: projectsQuery.queryKey });
    const projects = cached(client);
    const index = projects.findIndex((p) => p.id === project.id);
    const removed = projects[index] ?? project;
    write(client, (list) => withoutId(list, project.id));
    // With an edit in flight, `removed` carries a patch that may yet fail.
    return { removed, index, edited: edits(client).inFlight(project.id) };
  },
  onSuccess: () => toast.success("Project deleted — its tasks moved to the Inbox"),
  onError: (err, project, ctx, { client }) => {
    if (ctx) {
      const back = (ctx.edited ? edits(client).shown(project.id) : undefined) ?? ctx.removed;
      write(client, (projects) => restoreAt(projects, back, ctx.index));
    }
    toast.error(errorMessage(err));
  },
  // The tasks still carry the project's id until reloaded. Here, not in the
  // screen: a callback passed to mutate() is skipped once the screen is left.
  onSettled: (_data, _err, _project, _ctx, { client }) => {
    void reloadTasks(client);
  },
});
