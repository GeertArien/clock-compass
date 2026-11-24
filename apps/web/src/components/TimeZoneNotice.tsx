import { useQuery } from "@tanstack/react-query";
import { timeZoneQuery } from "@/lib/queries/time-zone";

/**
 * LEGACY (#136, to remove in #137): one line in Settings while scheduled days
 * are still in their old form. They normally move by themselves; this shows
 * only when no zone is known yet, or when they fit no zone the server knows
 * (then the command is needed). Nothing shows otherwise, or on any error.
 */
export function TimeZoneNotice() {
  const { data } = useQuery(timeZoneQuery);
  const old = data?.oldScheduledDays;
  if (!old || old.count === 0) return null;
  const days = `${old.count} scheduled day${old.count === 1 ? "" : "s"}`;
  return (
    <div role="status" className="rounded-lg border border-[var(--gold)] p-3 text-xs">
      {old.reason === "refused" ? (
        <>
          <p className="font-medium">
            {days} could not be moved to the new date format by themselves: some were scheduled in another time zone than{" "}
            {data.reported ?? data.zone}.
          </p>
          <p className="mt-1 text-muted-foreground">
            They still show on the right day. To move them, run on the server, naming every zone they were scheduled in:{" "}
            <code>node apps/server/dist/days-migrate.js --from Europe/Brussels --dry-run</code> (one <code>--from</code> per
            zone), then again without <code>--dry-run</code>. The README explains it under “Time zone”.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">
          {days} wait for this device’s time zone to move to the new date format. They still show on the right day.
        </p>
      )}
    </div>
  );
}
