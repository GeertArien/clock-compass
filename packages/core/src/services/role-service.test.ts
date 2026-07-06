import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import type { RoleRepository } from "../repositories/role-repository.js";
import { RoleService } from "./role-service.js";

class FakeRoleRepository implements RoleRepository {
  private store = new Map<string, Role>();
  private seq = 0;

  async create(data: Prisma.RoleCreateInput): Promise<Role> {
    const id = `role_${++this.seq}`;
    const now = new Date();
    const role: Role = {
      id,
      name: data.name,
      mission: (data.mission as string | null) ?? null,
      order: (data.order as number | undefined) ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, role);
    return role;
  }

  async findById(id: string): Promise<Role | null> {
    return this.store.get(id) ?? null;
  }

  async findMany(): Promise<Role[]> {
    return [...this.store.values()].sort((a, b) => a.order - b.order);
  }

  async update(id: string, data: Prisma.RoleUpdateInput): Promise<Role> {
    const existing = this.store.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...data } as Role;
    this.store.set(id, updated);
    return updated;
  }

  async reorder(ids: string[]): Promise<void> {
    ids.forEach((id, index) => {
      const role = this.store.get(id);
      if (role) role.order = index;
    });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

describe("RoleService", () => {
  let repo: FakeRoleRepository;
  let service: RoleService;

  beforeEach(() => {
    repo = new FakeRoleRepository();
    service = new RoleService(repo);
  });

  it("creates a role with an optional mission line", async () => {
    const role = await service.create({ name: "Parent", mission: "Present, not just around." });
    expect(role.name).toBe("Parent");
    expect(role.mission).toBe("Present, not just around.");
  });

  it("lists roles ordered by their order field", async () => {
    await service.create({ name: "B", order: 2 });
    await service.create({ name: "A", order: 1 });
    const roles = await service.list();
    expect(roles.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("updates and clears the mission line", async () => {
    const role = await service.create({ name: "Self" });
    const updated = await service.update(role.id, { mission: "Keep the saw sharp." });
    expect(updated.mission).toBe("Keep the saw sharp.");
    const cleared = await service.update(role.id, { mission: null });
    expect(cleared.mission).toBeNull();
  });

  it("reorders roles by the given id sequence", async () => {
    const a = await service.create({ name: "A", order: 0 });
    const b = await service.create({ name: "B", order: 1 });
    const c = await service.create({ name: "C", order: 2 });
    await service.reorder([c.id, a.id, b.id]);
    const roles = await service.list();
    expect(roles.map((r) => r.name)).toEqual(["C", "A", "B"]);
  });

  it("removes a role", async () => {
    const role = await service.create({ name: "Friend" });
    await service.remove(role.id);
    expect(await service.get(role.id)).toBeNull();
  });
});
