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
import { fieldsBefore, restoreAt, revertPatch, withoutId } from "@clock-compass/web-client/rollback";

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
    this.roles = [...this.roles, temp];
    try {
      const created = await createRole(body);
      this.roles = this.roles.map((r) => (r.id === temp.id ? created : r));
      toast.success("Role added");
    } catch (err) {
      this.roles = withoutId(this.roles, temp.id);
      toast.error(message(err));
    }
  }

  async update(role: Role, body: UpdateRoleBody): Promise<void> {
    const optimistic = body as Partial<Role>;
    const before = fieldsBefore(this.roles.find((r) => r.id === role.id), optimistic);
    this.roles = this.roles.map((r) => (r.id === role.id ? { ...r, ...body } as Role : r));
    try {
      const updated = await updateRole(role.id, body);
      this.roles = this.roles.map((r) => (r.id === updated.id ? updated : r));
    } catch (err) {
      // Undo only this call's fields, so edits that landed meanwhile survive.
      this.roles = revertPatch(this.roles, role.id, optimistic, before);
      toast.error(message(err));
    }
  }

  async remove(role: Role): Promise<void> {
    const index = this.roles.findIndex((r) => r.id === role.id);
    const removed = this.roles[index] ?? role;
    this.roles = withoutId(this.roles, role.id);
    try {
      await deleteRole(role.id);
      toast.success("Role deleted — its goals are kept");
    } catch (err) {
      this.roles = restoreAt(this.roles, removed, index);
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
      // A reorder rewrites every role's order, so reload the server's order
      // rather than restoring a snapshot that could drop other edits.
      toast.error(message(err));
      try {
        this.roles = await listRoles();
      } catch {
        /* keep current state; a later interaction will surface errors */
      }
    }
  }
}

export const rolesStore = new RolesStore();
