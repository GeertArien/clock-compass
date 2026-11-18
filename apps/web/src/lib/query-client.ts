import {
  QueryCache,
  QueryClient,
  notifyManager,
  onlineManager,
  type Query,
} from "@tanstack/react-query";
import { errorMessage } from "@clock-compass/web-client/meta";
import { toast } from "@/lib/stores/toast";

// Deliver cache updates in a microtask instead of the library's setTimeout(0):
// an optimistic write then re-renders before the next frame, so a controlled
// <select> never paints its old value in between (review on #91). Wrapped:
// queueMicrotask called with another receiver throws "Illegal invocation".
notifyManager.setScheduler((cb) => queueMicrotask(cb));

/**
 * Data on screen older than this is refetched when the tab comes back into
 * focus or the device comes back online. Quick tab switches cost nothing.
 */
export const BACKGROUND_REFRESH_AFTER_MS = 30_000;

/** Failed background refreshes are reported at most this often. */
const REFRESH_TOAST_EVERY_MS = 10_000;

/**
 * Whether a shown query should refetch on focus or reconnect: only while
 * online, only once its data is old enough, and never while a write to the
 * same resource is in flight (a list sent before the write is processed could
 * otherwise put the old value back). "always" because nothing is ever stale
 * (staleTime: Infinity), so plain `true` would never refetch.
 */
function backgroundRefresh(client: QueryClient, query: Query): boolean | "always" {
  if (!onlineManager.isOnline()) return false;
  if (Date.now() - query.state.dataUpdatedAt < BACKGROUND_REFRESH_AFTER_MS) return false;
  if (client.isMutating({ mutationKey: [query.queryKey[0]] }) > 0) return false;
  return "always";
}

/**
 * The app's query client. Defaults keep the behaviour the hand-written stores
 * had (issue #77), plus background refresh:
 * - networkMode "always": offline, a load fails into its error state (with
 *   Retry) and a write fails, rolls back and shows a toast, rather than
 *   pausing until the network returns (the library's default);
 * - no retries, so an error shows at once;
 * - data stays fresh until something invalidates it (a write, Settings saving
 *   a new token), so navigating between screens refetches nothing;
 * - a tab coming back into focus, or the device coming back online, refetches
 *   the shown data older than BACKGROUND_REFRESH_AFTER_MS, picking up changes
 *   made elsewhere (another device, an agent through the API, an MCP client);
 * - a refresh that fails while data is on screen keeps that data and shows one
 *   toast; the screens' "Failed to load" banner is only for nothing to show
 *   (see loadError in queries/load-error.ts).
 */
export function createQueryClient(): QueryClient {
  let lastRefreshToast = 0;
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (query.state.data === undefined) return; // the screen's banner shows it
        const now = Date.now();
        if (now - lastRefreshToast < REFRESH_TOAST_EVERY_MS) return;
        lastRefreshToast = now;
        toast.error(errorMessage(err, "Couldn't refresh — showing what was loaded"));
      },
    }),
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: (query) => backgroundRefresh(client, query),
        refetchOnReconnect: (query) => backgroundRefresh(client, query),
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
  return client;
}

export const queryClient = createQueryClient();
