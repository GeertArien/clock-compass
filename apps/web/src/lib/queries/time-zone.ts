import { queryOptions } from "@tanstack/react-query";
import { getTimeZoneSettings } from "@clock-compass/web-client/api";

/** The zone the server uses where no device asks, and (legacy, #137) old scheduled days still waiting (#136). */
export const timeZoneQuery = queryOptions({
  queryKey: ["time-zone"],
  queryFn: () => getTimeZoneSettings(),
});
