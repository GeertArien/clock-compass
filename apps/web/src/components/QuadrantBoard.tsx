import { SlidersHorizontal } from "lucide-react";
import { OpenSettingsLink } from "@/components/OpenSettingsLink";
import { sectionForMessage } from "@/lib/stores/settings";
import { Button } from "@/components/ui/button";
import { useTasksQuery } from "@/lib/queries/tasks";
import { taskActions } from "@/lib/stores/task-actions";
import { NewTaskForm } from "./NewTaskForm";
import { QUADRANT_ORDER, QuadrantGrid } from "./QuadrantGrid";

/** Compass · Matrix: every open task by importance × urgency. */
export function QuadrantBoard() {
  const { tasks, loading, error, retry } = useTasksQuery();
  // Only show active (not done) tasks on the matrix.
  const active = tasks.filter((t) => t.status !== "DONE");
  const loadingFirst = loading && tasks.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <NewTaskForm />
        </div>
        <Button variant="outline" size="sm" onClick={() => taskActions.create()}>
          <SlidersHorizontal className="size-4" />
          Details
        </Button>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
          <span>
            {error}
            {sectionForMessage(error) === "connection" ? (
              <>
                {" "}
                Set your API token in <OpenSettingsLink section="connection" />.
              </>
            ) : null}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}

      {loadingFirst ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {QUADRANT_ORDER.map((q) => (
            <div key={q} className="h-40 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <QuadrantGrid tasks={active} />
      )}
    </div>
  );
}
