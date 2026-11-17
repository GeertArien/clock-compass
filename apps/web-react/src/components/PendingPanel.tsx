import { Hourglass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** Stand-in for a screen that has not been ported from apps/web yet (issue #64). */
export function PendingPanel({ label }: { label: string }) {
  return (
    <EmptyState
      icon={Hourglass}
      title={`${label} is still being ported`}
      hint="The React app is in progress. The Svelte app remains the default until every screen is here."
    />
  );
}
