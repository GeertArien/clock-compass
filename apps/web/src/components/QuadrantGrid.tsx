import type { Quadrant, Task } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { QUADRANT_META } from "@/lib/queries/tasks";
import { TaskCard } from "./TaskCard";

export const QUADRANT_ORDER: Quadrant[] = ["Q1", "Q2", "Q3", "Q4"];

/**
 * The four quadrants with their tasks (live cards). Shared by Compass · Matrix
 * and the assistant's QuadrantBoard; the caller picks the tasks.
 */
export function QuadrantGrid({ tasks }: { tasks: Task[] }) {
  return (
    <section aria-label="Quadrant matrix" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {QUADRANT_ORDER.map((q) => {
        const meta = QUADRANT_META[q];
        const items = tasks.filter((t) => t.quadrant === q);
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
  );
}
