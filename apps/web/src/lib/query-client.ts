import { QueryClient } from "@tanstack/react-query";

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
