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
import {
  OptimisticEdits,
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";
import { Store } from "./store";
import { toast } from "./toast";

export { PROJECT_STATUS_LABELS } from "@clock-compass/web-client/meta";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

/** Projects with optimistic updates + toast feedback. */
export class ProjectsStore extends Store<ProjectsState> {
  // In-flight edits per item: whatever order requests succeed or fail in, the
  // shown item is the server-confirmed one plus the edits still pending.
  readonly #edits = new OptimisticEdits<Project>();

  constructor() {
    super({ projects: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const projects = await listProjects();
      this.#edits.reset();
      this.setState({ projects });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load projects") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Silent reload — used when task changes shift the derived counts. */
  async refresh(): Promise<void> {
    try {
      const projects = await listProjects();
      this.#edits.reset();
      this.setState({ projects });
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
    this.setState({ projects: [temp, ...this.state.projects] });
    try {
      const created = await createProject(body);
      this.setState({
        projects: this.state.projects.map((p) => (p.id === temp.id ? created : p)),
      });
      toast.success("Project added");
    } catch (err) {
      this.setState({ projects: withoutId(this.state.projects, temp.id) });
      toast.error(errorMessage(err));
    }
  }

  async #edit(id: string, optimistic: Partial<Project>, body: UpdateProjectBody): Promise<void> {
    const current = this.state.projects.find((x) => x.id === id);
    if (!current) return;
    const { item, ticket } = this.#edits.apply(current, optimistic);
    this.setState({ projects: replaceById(this.state.projects, item) });
    try {
      const updated = await updateProject(id, body);
      this.setState({ projects: replaceById(this.state.projects, this.#edits.succeed(id, ticket, updated)) });
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.#edits.fail(id, ticket);
      if (shown) this.setState({ projects: replaceById(this.state.projects, shown) });
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
    const index = this.state.projects.findIndex((p) => p.id === project.id);
    const removed = this.state.projects[index] ?? project;
    this.setState({ projects: withoutId(this.state.projects, project.id) });
    try {
      await deleteProject(project.id);
      toast.success("Project deleted — its tasks moved to the Inbox");
    } catch (err) {
      this.setState({ projects: restoreAt(this.state.projects, removed, index) });
      toast.error(errorMessage(err));
    }
  }
}

export const projectsStore = new ProjectsStore();
