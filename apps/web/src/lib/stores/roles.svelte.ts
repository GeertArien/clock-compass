import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  updateRole,
  type CreateRoleBody,
  type Role,
  type UpdateRoleBody,
} from "@/lib/api";
import { toast } from "@/lib/components/ui/toast";

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

/** Reactive roles store (Habit 2) with optimistic updates + toast feedback. */
class RolesStore {
  roles = $state<Role[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.roles = await listRoles();
    } catch (err) {
      this.error = message(err, "Failed to load roles");
    } finally {
      this.loading = false;
    }
  }

  byId(id: string | null): Role | undefined {
    return id ? this.roles.find((r) => r.id === id) : undefined;
  }

  async add(body: CreateRoleBody): Promise<void> {
    const now = new Date().toISOString();
    const temp: Role = {
      id: `temp_${now}`,
      name: body.name,
      mission: body.mission ?? null,
      order: body.order ?? this.roles.length,
      createdAt: now,
      updatedAt: now,
    };
    const prev = this.roles;
    this.roles = [...prev, temp];
    try {
      const created = await createRole(body);
      this.roles = this.roles.map((r) => (r.id === temp.id ? created : r));
      toast.success("Role added");
    } catch (err) {
      this.roles = prev;
      toast.error(message(err));
    }
  }

  async update(role: Role, body: UpdateRoleBody): Promise<void> {
    const prev = this.roles;
    this.roles = this.roles.map((r) => (r.id === role.id ? { ...r, ...body } as Role : r));
    try {
      const updated = await updateRole(role.id, body);
      this.roles = this.roles.map((r) => (r.id === updated.id ? updated : r));
    } catch (err) {
      this.roles = prev;
      toast.error(message(err));
    }
  }

  async remove(role: Role): Promise<void> {
    const prev = this.roles;
    this.roles = prev.filter((r) => r.id !== role.id);
    try {
      await deleteRole(role.id);
      toast.success("Role deleted — its goals are kept");
    } catch (err) {
      this.roles = prev;
      toast.error(message(err));
    }
  }

  /** Persist a new role order. `ids` are all roles in the desired order. */
  async reorder(ids: string[]): Promise<void> {
    const prev = this.roles;
    const ordered = ids
      .map((id, i) => {
        const role = prev.find((r) => r.id === id);
        return role ? ({ ...role, order: i } as Role) : undefined;
      })
      .filter((r): r is Role => r !== undefined);
    if (ordered.length !== prev.length) return; // stale — skip
    this.roles = ordered;
    try {
      await reorderRoles(ids);
    } catch (err) {
      this.roles = prev;
      toast.error(message(err));
    }
  }
}

export const rolesStore = new RolesStore();
