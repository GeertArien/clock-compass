import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  updateRole,
  type CreateRoleBody,
  type Role,
  type UpdateRoleBody,
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

interface RolesState {
  roles: Role[];
  loading: boolean;
  error: string | null;
}

/** Roles (Habit 2) with optimistic updates + toast feedback. Mirrors roles.svelte.ts. */
export class RolesStore extends Store<RolesState> {
  // In-flight edits per role: whatever order requests succeed or fail in, the
  // shown role is the server-confirmed one plus the edits still pending.
  readonly #edits = new OptimisticEdits<Role>();

  constructor() {
    super({ roles: [], loading: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const roles = await listRoles();
      this.#edits.reset();
      this.setState({ roles });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load roles") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Replace the role list outright (tests). */
  setRoles(roles: Role[]): void {
    this.#edits.reset();
    this.setState({ roles });
  }

  byId(id: string | null): Role | undefined {
    return id ? this.state.roles.find((r) => r.id === id) : undefined;
  }

  async add(body: CreateRoleBody): Promise<void> {
    const now = new Date().toISOString();
    const temp: Role = {
      id: `temp_${now}`,
      name: body.name,
      mission: body.mission ?? null,
      order: body.order ?? this.state.roles.length,
      createdAt: now,
      updatedAt: now,
    };
    this.setState({ roles: [...this.state.roles, temp] });
    try {
      const created = await createRole(body);
      this.setState({ roles: this.state.roles.map((r) => (r.id === temp.id ? created : r)) });
      toast.success("Role added");
    } catch (err) {
      this.setState({ roles: withoutId(this.state.roles, temp.id) });
      toast.error(errorMessage(err));
    }
  }

  async update(role: Role, body: UpdateRoleBody): Promise<void> {
    const current = this.state.roles.find((r) => r.id === role.id);
    if (!current) return;
    const { item, ticket } = this.#edits.apply(current, body as Partial<Role>);
    this.setState({ roles: replaceById(this.state.roles, item) });
    try {
      const updated = await updateRole(role.id, body);
      this.setState({
        roles: replaceById(this.state.roles, this.#edits.succeed(role.id, ticket, updated)),
      });
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.#edits.fail(role.id, ticket);
      if (shown) this.setState({ roles: replaceById(this.state.roles, shown) });
      toast.error(errorMessage(err));
    }
  }

  async remove(role: Role): Promise<void> {
    const index = this.state.roles.findIndex((r) => r.id === role.id);
    const removed = this.state.roles[index] ?? role;
    this.setState({ roles: withoutId(this.state.roles, role.id) });
    try {
      await deleteRole(role.id);
      toast.success("Role deleted — its goals are kept");
    } catch (err) {
      this.setState({ roles: restoreAt(this.state.roles, removed, index) });
      toast.error(errorMessage(err));
    }
  }

  /** Persist a new role order. `ids` are all roles in the desired order. */
  async reorder(ids: string[]): Promise<void> {
    const prev = this.state.roles;
    const ordered = ids
      .map((id, i) => {
        const role = prev.find((r) => r.id === id);
        return role ? ({ ...role, order: i } as Role) : undefined;
      })
      .filter((r): r is Role => r !== undefined);
    if (ordered.length !== prev.length) return; // stale — skip
    this.setState({ roles: ordered });
    try {
      await reorderRoles(ids);
    } catch (err) {
      // A reorder rewrites every role's order, so reload the server's order
      // rather than restoring a snapshot that could drop other edits.
      toast.error(errorMessage(err));
      try {
        const roles = await listRoles();
        this.#edits.reset();
        this.setState({ roles });
      } catch {
        /* keep current state; a later interaction will surface errors */
      }
    }
  }
}

export const rolesStore = new RolesStore();
