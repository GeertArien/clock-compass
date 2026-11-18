import { errorMessage } from "@clock-compass/web-client/meta";

/**
 * The screens' "Failed to load" banner, with Retry: only when the load failed
 * with nothing to show, and not while Retry is running. A failed refresh with
 * data already on screen keeps that data and is a toast instead (see
 * query-client.ts), so a tab returning while the server is unreachable doesn't
 * turn every screen into an error.
 */
export function loadError(
  query: { isError: boolean; isFetching: boolean; data: unknown; error: unknown },
  fallback: string,
): string | null {
  return query.isError && !query.isFetching && query.data === undefined
    ? errorMessage(query.error, fallback)
    : null;
}
