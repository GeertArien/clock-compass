import { SlidersHorizontal } from "lucide-react";
import type { Quadrant } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QUADRANT_META, useTasksQuery } from "@/lib/queries/tasks";
import { taskActions } from "@/lib/stores/task-actions";
import { NewTaskForm } from "./NewTaskForm";
import { TaskCard } from "./TaskCard";

const order: Quadrant[] = ["Q1", "Q2", "Q3", "Q4"];

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
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>
            {error}
            {error.includes("401") ? " — set your API token in Settings." : ""}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}

      {loadingFirst ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {order.map((q) => (
            <div key={q} className="h-40 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <section aria-label="Quadrant matrix" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {order.map((q) => {
            const meta = QUADRANT_META[q];
            const items = active.filter((t) => t.quadrant === q);
            return (
              <div
                key={q}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm",
                  q === "Q2" && "ring-1 ring-[var(--pine)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", meta.dot)} />
                    <span className="text-xs font-medium text-muted-foreground">{q}</span>
                    <h2 className="text-sm font-semibold">{meta.title}</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <p className="-mt-1 text-xs text-muted-foreground">{meta.hint}</p>

                <div className="flex flex-col gap-2">
                  {items.length === 0 ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">Nothing here.</p>
                  ) : (
                    items.map((task) => <TaskCard key={task.id} task={task} />)
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
