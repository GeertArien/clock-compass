import type { Prisma, Role } from "@prisma/client";
import type { RoleRepository } from "../repositories/role-repository.js";

export interface CreateRoleInput {
  name: string;
  mission?: string | null;
  order?: number;
}

export interface UpdateRoleInput {
  name?: string;
  mission?: string | null;
  order?: number;
}

/**
 * Business logic for roles (Habit 2). A role is a grouping above goals with an
 * optional per-role mission line; deleting one keeps its goals (unlinked).
 */
export class RoleService {
  constructor(private readonly roles: RoleRepository) {}

  async create(input: CreateRoleInput): Promise<Role> {
    const data: Prisma.RoleCreateInput = {
      name: input.name,
      mission: input.mission ?? null,
      ...(input.order !== undefined ? { order: input.order } : {}),
    };
    return this.roles.create(data);
  }

  get(id: string): Promise<Role | null> {
    return this.roles.findById(id);
  }

  list(): Promise<Role[]> {
    return this.roles.findMany();
  }

  async update(id: string, input: UpdateRoleInput): Promise<Role> {
    const data: Prisma.RoleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.mission !== undefined) data.mission = input.mission;
    if (input.order !== undefined) data.order = input.order;
    return this.roles.update(id, data);
  }

  /** Persist a manual order for the given roles. */
  async reorder(ids: string[]): Promise<void> {
    await this.roles.reorder(ids);
  }

  async remove(id: string): Promise<void> {
    await this.roles.delete(id);
  }
}
