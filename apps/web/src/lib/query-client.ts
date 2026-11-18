import { QueryClient, notifyManager } from "@tanstack/react-query";

// Deliver cache updates in a microtask instead of the library's setTimeout(0):
// an optimistic write then re-renders before the next frame, so a controlled
// <select> never paints its old value in between (review on #91). Wrapped:
// queueMicrotask called with another receiver throws "Illegal invocation".
notifyManager.setScheduler((cb) => queueMicrotask(cb));

/**
 * The app's query client, with defaults that keep the behaviour the
 * hand-written stores had (issue #77):
 * - networkMode "always": offline, a load fails into its error state (with
 *   Retry) and a write fails, rolls back and shows a toast, rather than
 *   pausing until the network returns (the library's default);
 * - no retries, so an error shows at once;
 * - data stays fresh until something invalidates it (a write, or Settings
 *   saving a new token), like the stores' explicit reloads; no refetch on
 *   window focus or reconnect.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

export const queryClient = createQueryClient();
