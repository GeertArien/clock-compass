import {
  QueryObserver,
  type QueryClient,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
} from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";

/**
 * A fresh query client with the app's defaults, for React-free tests: queries
 * and mutations are driven through the library's observers, as useQuery and
 * useMutation drive them in components.
 */
export function testQueryClient(): QueryClient {
  return createQueryClient();
}

/** Watch a query as a mounted component would. */
export function observe<TData, TKey extends QueryKey>(
  client: QueryClient,
  options: QueryObserverOptions<TData, Error, TData, TData, TKey>,
) {
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe };
}

/** Resolve once the observed query has stopped fetching. */
export async function settled<TData>(observer: {
  getCurrentResult(): QueryObserverResult<TData, Error>;
}): Promise<QueryObserverResult<TData, Error>> {
  for (;;) {
    const result = observer.getCurrentResult();
    if (!result.isFetching && !result.isPending) return result;
    await new Promise((r) => setTimeout(r, 0));
  }
}
