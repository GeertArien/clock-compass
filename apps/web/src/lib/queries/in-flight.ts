import type { QueryClient, QueryKey } from "@tanstack/react-query";

const dropped = new WeakMap<QueryClient, Map<string, QueryKey>>();

/**
 * Before an optimistic write: drop a list request already in flight, because
 * its answer may predate the write and would put the old value back. The
 * request is not lost: rerunDropped() sends it again once the resource's
 * writes have settled. That matters most for a first load, which would
 * otherwise never arrive and leave the list with only the new item, and for
 * reloads asked for on purpose (a new token, the tasks after a project
 * delete).
 */
export async function dropInFlight(client: QueryClient, queryKey: QueryKey): Promise<void> {
  if (client.isFetching({ queryKey, exact: true }) === 0) return;
  let keys = dropped.get(client);
  if (!keys) dropped.set(client, (keys = new Map()));
  keys.set(JSON.stringify(queryKey), queryKey);
  await client.cancelQueries({ queryKey, exact: true });
}

/** After a write settles: re-send the dropped requests whose resource has no write in flight. */
export function rerunDropped(client: QueryClient): void {
  const keys = dropped.get(client);
  if (!keys) return;
  for (const [id, queryKey] of keys) {
    if (client.isMutating({ mutationKey: [queryKey[0]] }) > 0) continue;
    keys.delete(id);
    // The query function's latestTicket check still decides the bookkeeping reset.
    void client.invalidateQueries({ queryKey, exact: true });
  }
}
