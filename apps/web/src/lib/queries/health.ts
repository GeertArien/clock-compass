import { queryOptions } from "@tanstack/react-query";
import { getHealth } from "@clock-compass/web-client/api";

/** The server's liveness and version (#140), for Settings → About. */
export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => getHealth(),
});
