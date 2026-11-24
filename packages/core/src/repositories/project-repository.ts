import type { Prisma, PrismaClient, Project, TaskStatus } from "@prisma/client";

/** A project with just enough of its tasks to derive progress counts. */
export type ProjectWithTasks = Project & { tasks: { status: TaskStatus; showFrom?: Date | null }[] };

/**
 * The only place Prisma is touched for projects. Projects are returned with a
 * slim view of their tasks (status only) so the service can derive counts.
 */
export interface ProjectRepository {
  create(data: Prisma.ProjectCreateInput): Promise<ProjectWithTasks>;
  findById(id: string): Promise<ProjectWithTasks | null>;
  findMany(where?: Prisma.ProjectWhereInput): Promise<ProjectWithTasks[]>;
  update(id: string, data: Prisma.ProjectUpdateInput): Promise<ProjectWithTasks>;
  delete(id: string): Promise<void>;
}

const withTasks = {
  tasks: { select: { status: true, showFrom: true } },
} satisfies Prisma.ProjectInclude;

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.ProjectCreateInput): Promise<ProjectWithTasks> {
    return this.db.project.create({ data, include: withTasks });
  }

  findById(id: string): Promise<ProjectWithTasks | null> {
    return this.db.project.findUnique({ where: { id }, include: withTasks });
  }

  findMany(where?: Prisma.ProjectWhereInput): Promise<ProjectWithTasks[]> {
    return this.db.project.findMany({
      where,
      include: withTasks,
      orderBy: { createdAt: "desc" },
    });
  }

  update(id: string, data: Prisma.ProjectUpdateInput): Promise<ProjectWithTasks> {
    return this.db.project.update({ where: { id }, data, include: withTasks });
  }

  async delete(id: string): Promise<void> {
    // Tasks fall back to the Inbox; their projectId is set null (onDelete: SetNull).
    await this.db.project.delete({ where: { id } });
  }
}
