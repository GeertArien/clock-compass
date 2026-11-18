import type { QueryClient } from "@tanstack/react-query";
import { OptimisticEdits } from "@clock-compass/web-client/rollback";

/**
 * The in-flight optimistic edits of one resource, per query client: the app
 * has one client, each test its own. Mutations write the cache from these
 * (never from a snapshot of the list, which would undo other edits that
 * landed meanwhile), and the resource's query function resets them when a
 * full reload arrives, as the stores' load() did.
 */
export function editsFor<T extends { id: string }>(
  derive?: (item: T) => T,
): (client: QueryClient) => OptimisticEdits<T> {
  const byClient = new WeakMap<QueryClient, OptimisticEdits<T>>();
  return (client) => {
    let edits = byClient.get(client);
    if (!edits) byClient.set(client, (edits = new OptimisticEdits<T>(derive)));
    return edits;
  };
}
