import type { Prisma, Project, ProjectStatus } from "@prisma/client";
import type {
  ProjectRepository,
  ProjectWithTasks,
} from "../repositories/project-repository.js";
import { progressCounts } from "./task-service.js";

export interface CreateProjectInput {
  /** Chosen by the caller (an idempotent create, #109); left out = generated. */
  id?: string;
  name: string;
  description?: string;
  goalId?: string | null;
  status?: ProjectStatus;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  goalId?: string | null;
  status?: ProjectStatus;
}

/** Derived task counts for a project. */
export interface ProjectProgress {
  total: number;
  done: number;
  /** 0..1; 0 when the project has no tasks. */
  ratio: number;
}

/** A project plus its derived counts — the shape the API/UI consume. */
export type ProjectWithProgress = Project & { progress: ProjectProgress };

function deriveProgress(project: ProjectWithTasks): ProjectWithProgress {
  // Skipped and "later" occurrences of a recurring task do not count (#105).
  const { tasks: _tasks, ...rest } = project;
  return { ...rest, progress: progressCounts(project.tasks) };
}

/**
 * Business logic for projects: the layer between goals and tasks. A project
 * optionally serves a goal — unlinked projects are surfaced, never blocked.
 * Counts are always derived from its tasks, never stored.
 */
export class ProjectService {
  constructor(private readonly projects: ProjectRepository) {}

  async create(input: CreateProjectInput): Promise<ProjectWithProgress> {
    const data: Prisma.ProjectCreateInput = {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      description: input.description,
      ...(input.status ? { status: input.status } : {}),
      ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
    };
    return deriveProgress(await this.projects.create(data));
  }

  async get(id: string): Promise<ProjectWithProgress | null> {
    const project = await this.projects.findById(id);
    return project ? deriveProgress(project) : null;
  }

  async list(status?: ProjectStatus): Promise<ProjectWithProgress[]> {
    const where = status ? { status } : undefined;
    return (await this.projects.findMany(where)).map(deriveProgress);
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectWithProgress> {
    const data: Prisma.ProjectUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.goalId !== undefined) {
      data.goal = input.goalId
        ? { connect: { id: input.goalId } }
        : { disconnect: true };
    }
    return deriveProgress(await this.projects.update(id, data));
  }

  /** Delete a project. Its tasks return to the Inbox (kept, unlinked). */
  async remove(id: string): Promise<void> {
    await this.projects.delete(id);
  }
}
