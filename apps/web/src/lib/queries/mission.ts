import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { getMission, setMission } from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { toast } from "@/lib/stores/toast";

/** The personal mission statement (Habit 2). */
export const missionQuery = queryOptions({
  queryKey: ["mission"],
  queryFn: getMission,
});

/**
 * Save a new version of the mission. Not optimistic: the editor keeps the
 * draft, the button shows "Saving…", and the saved version replaces the cache.
 */
export function saveMission(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["mission", "save"],
    mutationFn: (content: string) => setMission(content),
    onSuccess: (mission) => {
      queryClient.setQueryData(missionQuery.queryKey, mission);
      toast.success("Mission saved");
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to save mission")),
  });
}
