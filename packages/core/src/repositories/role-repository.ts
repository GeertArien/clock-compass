import type { Prisma, PrismaClient, Role } from "@prisma/client";

/** The only place Prisma is touched for roles. */
export interface RoleRepository {
  create(data: Prisma.RoleCreateInput): Promise<Role>;
  findById(id: string): Promise<Role | null>;
  findMany(): Promise<Role[]>;
  update(id: string, data: Prisma.RoleUpdateInput): Promise<Role>;
  reorder(ids: string[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.RoleCreateInput): Promise<Role> {
    return this.db.role.create({ data });
  }

  findById(id: string): Promise<Role | null> {
    return this.db.role.findUnique({ where: { id } });
  }

  findMany(): Promise<Role[]> {
    return this.db.role.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  }

  update(id: string, data: Prisma.RoleUpdateInput): Promise<Role> {
    return this.db.role.update({ where: { id }, data });
  }

  /** Persist a new sort order — the role at index i gets `order = i`. */
  async reorder(ids: string[]): Promise<void> {
    await this.db.$transaction(
      ids.map((id, index) =>
        this.db.role.update({ where: { id }, data: { order: index } }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    // Goals keep existing; their roleId is set null (schema onDelete: SetNull).
    await this.db.role.delete({ where: { id } });
  }
}
