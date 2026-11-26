import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "@clock-compass/web-client/api";
import { Input } from "@/components/ui/input";
import { projectsQuery } from "@/lib/queries/projects";

const label = "text-[0.6875rem] font-medium text-muted-foreground";
const field = "h-8 rounded-md border border-border bg-transparent px-2 text-xs";
const plain = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * What a proposal card's pencil opens in the MCP App page (#159): the title,
 * the due date, the scheduled day and time, and the project, as in the app's
 * task form. Each change goes to the proposal at once (`set`), never to the
 * task: only Confirm writes.
 */
export function ProposalFields({ task, set }: { task: Task; set(patch: Record<string, unknown>): void }) {
  const id = useId();
  const projects = (useQuery(projectsQuery).data ?? []).filter((p) => p.status !== "DONE" || p.id === task.projectId);
  const day = plain(task.scheduledDay);
  return (
    <div role="group" aria-label="Edit the proposal" className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
      <label className="col-span-2 flex flex-col gap-1">
        <span className={label}>Title</span>
        <Input className="h-8 text-xs" value={task.title} onChange={(e) => set({ title: e.currentTarget.value })} />
      </label>
      <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <span className={label}>Due date</span>
        <Input type="date" className="h-8 text-xs" value={plain(task.dueDate)} onChange={(e) => set({ dueDate: e.currentTarget.value || null })} />
      </label>
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <span id={`${id}-day`} className={label}>
          On the Clock
        </span>
        <div className="flex gap-1.5">
          <Input
            type="date"
            aria-labelledby={`${id}-day`}
            className="h-8 min-w-0 flex-1 text-xs"
            value={day}
            onChange={(e) => {
              const next = e.currentTarget.value || null;
              set({ scheduledDay: next, scheduledTime: next ? task.scheduledTime : null });
            }}
          />
          <Input
            type="time"
            aria-label="Time"
            disabled={!day}
            className="h-8 w-24 text-xs"
            value={task.scheduledTime ?? ""}
            onChange={(e) => set({ scheduledDay: day, scheduledTime: e.currentTarget.value || null })}
          />
        </div>
      </div>
      {projects.length ? (
        <label className="col-span-2 flex flex-col gap-1">
          <span className={label}>Project</span>
          <select className={field} value={task.projectId ?? ""} onChange={(e) => set({ projectId: e.currentTarget.value || null })}>
            <option value="">No project (Inbox)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
