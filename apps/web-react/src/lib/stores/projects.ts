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
import { Store } from "./store";
import { toast } from "./toast";

export { PROJECT_STATUS_LABELS } from "@clock-compass/web-client/meta";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

/** Projects with optimistic updates + toast feedback. Mirrors projects.svelte.ts. */
export class ProjectsStore extends Store<ProjectsState> {
  constructor() {
    super({ projects: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      this.setState({ projects: await listProjects() });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load projects") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Silent reload — used when task changes shift the derived counts. */
  async refresh(): Promise<void> {
    try {
      this.setState({ projects: await listProjects() });
    } catch {
      /* keep current state; a later interaction will surface errors */
    }
  }

  byId(id: string | null): Project | undefined {
    return id ? this.state.projects.find((p) => p.id === id) : undefined;
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
    const prev = this.state.projects;
    this.setState({ projects: [temp, ...prev] });
    try {
      const created = await createProject(body);
      this.setState({
        projects: this.state.projects.map((p) => (p.id === temp.id ? created : p)),
      });
      toast.success("Project added");
    } catch (err) {
      this.setState({ projects: prev });
      toast.error(errorMessage(err));
    }
  }

  async #edit(id: string, optimistic: Partial<Project>, body: UpdateProjectBody): Promise<void> {
    const prev = this.state.projects;
    this.setState({ projects: prev.map((p) => (p.id === id ? { ...p, ...optimistic } : p)) });
    try {
      const updated = await updateProject(id, body);
      this.setState({
        projects: this.state.projects.map((p) => (p.id === updated.id ? updated : p)),
      });
    } catch (err) {
      this.setState({ projects: prev });
      toast.error(errorMessage(err));
    }
  }

  update(project: Project, body: UpdateProjectBody): Promise<void> {
    return this.#edit(project.id, body as Partial<Project>, body);
  }

  setStatus(project: Project, status: ProjectStatus): Promise<void> {
    return this.#edit(project.id, { status }, { status });
  }

  setGoal(project: Project, goalId: string | null): Promise<void> {
    return this.#edit(project.id, { goalId }, { goalId });
  }

  async remove(project: Project): Promise<void> {
    const prev = this.state.projects;
    this.setState({ projects: prev.filter((p) => p.id !== project.id) });
    try {
      await deleteProject(project.id);
      toast.success("Project deleted — its tasks moved to the Inbox");
    } catch (err) {
      this.setState({ projects: prev });
      toast.error(errorMessage(err));
    }
  }
}

export const projectsStore = new ProjectsStore();
