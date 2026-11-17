import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
  type CreateProjectBody,
  type Project,
  type ProjectStatus,
  type UpdateProjectBody,
} from "@/lib/api";
import { toast } from "@/lib/components/ui/toast";
import { fieldsBefore, restoreAt, revertPatch, withoutId } from "@clock-compass/web-client/rollback";

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

/** Reactive projects store with optimistic updates + toast feedback. */
class ProjectsStore {
  projects = $state<Project[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.projects = await listProjects();
    } catch (err) {
      this.error = message(err, "Failed to load projects");
    } finally {
      this.loading = false;
    }
  }

  /** Silent reload — used when task changes shift the derived counts. */
  async refresh(): Promise<void> {
    try {
      this.projects = await listProjects();
    } catch {
      /* keep current state; a later interaction will surface errors */
    }
  }

  byId(id: string | null): Project | undefined {
    return id ? this.projects.find((p) => p.id === id) : undefined;
  }

  async add(body: CreateProjectBody): Promise<void> {
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
    this.projects = [temp, ...this.projects];
    try {
      const created = await createProject(body);
      this.projects = this.projects.map((p) => (p.id === temp.id ? created : p));
      toast.success("Project added");
    } catch (err) {
      this.projects = withoutId(this.projects, temp.id);
      toast.error(message(err));
    }
  }

  private async edit(
    id: string,
    optimistic: Partial<Project>,
    body: UpdateProjectBody,
  ): Promise<void> {
    const before = fieldsBefore(this.projects.find((p) => p.id === id), optimistic);
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, ...optimistic } : p));
    try {
      const updated = await updateProject(id, body);
      this.projects = this.projects.map((p) => (p.id === updated.id ? updated : p));
    } catch (err) {
      // Undo only this call's fields, so edits that landed meanwhile survive.
      this.projects = revertPatch(this.projects, id, optimistic, before);
      toast.error(message(err));
    }
  }

  update(project: Project, body: UpdateProjectBody): Promise<void> {
    return this.edit(project.id, body as Partial<Project>, body);
  }

  setStatus(project: Project, status: ProjectStatus): Promise<void> {
    return this.edit(project.id, { status }, { status });
  }

  setGoal(project: Project, goalId: string | null): Promise<void> {
    return this.edit(project.id, { goalId }, { goalId });
  }

  async remove(project: Project): Promise<void> {
    const index = this.projects.findIndex((p) => p.id === project.id);
    const removed = this.projects[index] ?? project;
    this.projects = withoutId(this.projects, project.id);
    try {
      await deleteProject(project.id);
      toast.success("Project deleted — its tasks moved to the Inbox");
    } catch (err) {
      this.projects = restoreAt(this.projects, removed, index);
      toast.error(message(err));
    }
  }
}

// Shared with the React app (issue #64): one definition in @clock-compass/web-client.
export { PROJECT_STATUS_LABELS } from "@clock-compass/web-client/meta";

export const projectsStore = new ProjectsStore();
