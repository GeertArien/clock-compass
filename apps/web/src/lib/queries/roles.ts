import { mutationOptions, queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
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
import { replaceById, restoreAt, withoutId } from "@clock-compass/web-client/rollback";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";

const edits = editsFor<Role>();
const KEY = ["roles"] as const;

/** Roles (Habit 2), in their order. */
export const rolesQuery = queryOptions({
  queryKey: KEY,
  queryFn: async ({ client }) => {
    const roles = await listRoles();
    // A full reload is the confirmed state: drop the in-flight bookkeeping.
    edits(client).reset();
    return roles;
  },
});

const NO_ROLES: Role[] = [];

/** The roles, or none until they've loaded (a stable empty list). */
export function useRoles(): Role[] {
  return useQuery(rolesQuery).data ?? NO_ROLES;
}

function cached(client: QueryClient): Role[] {
  return client.getQueryData(rolesQuery.queryKey) ?? [];
}

function write(client: QueryClient, update: (roles: Role[]) => Role[]): void {
  client.setQueryData(rolesQuery.queryKey, (roles) => update(roles ?? []));
}

/** Add a role: a placeholder shows at once, replaced by the created role. */
export const addRole = mutationOptions({
  mutationKey: [...KEY, "add"],
  mutationFn: (body: CreateRoleBody) => createRole(body),
  onMutate: (body, { client }) => {
    const now = new Date().toISOString();
    const temp: Role = {
      id: `temp_${now}`,
      name: body.name,
      mission: body.mission ?? null,
      order: body.order ?? cached(client).length,
      createdAt: now,
      updatedAt: now,
    };
    write(client, (roles) => [...roles, temp]);
    return { tempId: temp.id };
  },
  onSuccess: (created, _body, ctx, { client }) => {
    write(client, (roles) => roles.map((r) => (r.id === ctx.tempId ? created : r)));
    toast.success("Role added");
  },
  onError: (err, _body, ctx, { client }) => {
    if (ctx) write(client, (roles) => withoutId(roles, ctx.tempId));
    toast.error(errorMessage(err));
  },
});

/**
 * Edit a role. Overlapping edits settle in any order: a failure drops only its
 * own patch, so edits still in flight or already confirmed stay.
 */
export const editRole = mutationOptions({
  mutationKey: [...KEY, "update"],
  mutationFn: ({ role, body }: { role: Role; body: UpdateRoleBody }) => updateRole(role.id, body),
  onMutate: ({ role, body }, { client }) => {
    const current = cached(client).find((r) => r.id === role.id);
    if (!current) return undefined;
    const { item, ticket } = edits(client).apply(current, body as Partial<Role>);
    write(client, (roles) => replaceById(roles, item));
    return { ticket };
  },
  onSuccess: (updated, { role }, ctx, { client }) => {
    if (!ctx) return;
    const shown = edits(client).succeed(role.id, ctx.ticket, updated);
    write(client, (roles) => replaceById(roles, shown));
  },
  onError: (err, { role }, ctx, { client }) => {
    const shown = ctx ? edits(client).fail(role.id, ctx.ticket) : undefined;
    if (shown) write(client, (roles) => replaceById(roles, shown));
    toast.error(errorMessage(err));
  },
});

/** Delete a role (its goals are kept); a failure puts it back in place. */
export const removeRole = mutationOptions({
  mutationKey: [...KEY, "remove"],
  mutationFn: (role: Role) => deleteRole(role.id),
  onMutate: (role, { client }) => {
    const roles = cached(client);
    const index = roles.findIndex((r) => r.id === role.id);
    const removed = roles[index] ?? role;
    write(client, (list) => withoutId(list, role.id));
    return { removed, index };
  },
  onSuccess: () => toast.success("Role deleted — its goals are kept"),
  onError: (err, _role, ctx, { client }) => {
    if (ctx) write(client, (roles) => restoreAt(roles, ctx.removed, ctx.index));
    toast.error(errorMessage(err));
  },
});

/** Whether the cached roles are `ids`, in that order. */
function inOrder(client: QueryClient, ids: string[]): boolean {
  const roles = cached(client);
  return roles.length === ids.length && roles.every((r, i) => r.id === ids[i]);
}

/** Persist a new order; `ids` are all roles in the desired order. */
export const reorderRole = mutationOptions({
  mutationKey: [...KEY, "reorder"],
  mutationFn: async (ids: string[], { client }) => {
    // onMutate shows the new order unless `ids` is stale; send nothing then.
    if (!inOrder(client, ids)) return;
    await reorderRoles(ids);
  },
  onMutate: (ids, { client }) => {
    const roles = cached(client);
    if (ids.length !== roles.length || !roles.every((r) => ids.includes(r.id))) return; // stale
    write(client, () => ids.map((id, i) => ({ ...roles.find((r) => r.id === id)!, order: i })));
  },
  onError: (err, _ids, _ctx, { client }) => {
    // A reorder rewrites every role's order, so reload the server's order
    // rather than restoring a snapshot that could drop other edits.
    toast.error(errorMessage(err));
    void client.invalidateQueries({ queryKey: rolesQuery.queryKey });
  },
});
