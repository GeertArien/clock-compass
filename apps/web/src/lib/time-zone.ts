import { browserTimeZone, reportTimeZone } from "@clock-compass/web-client/api";
import { onVisible, startZoneReporting } from "@clock-compass/web-client/time-zone";
import { queryClient } from "@/lib/query-client";
import { timeZoneQuery } from "@/lib/queries/time-zone";

/**
 * The app reports this device's zone to the server (#136): at start, when it
 * comes back to the foreground in another zone, and after a new token is
 * saved. The server uses it where no device asks (MCP, scripts, push hours).
 */
const reporter = startZoneReporting({
  zone: browserTimeZone,
  report: async (zone) => queryClient.setQueryData(timeZoneQuery.queryKey, await reportTimeZone(zone)),
  onForeground: onVisible,
});

/** Report now (a new token was saved, so the last try may have been refused). */
export const reportZoneNow = reporter.retry;
