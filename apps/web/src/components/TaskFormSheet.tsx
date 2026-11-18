import { useState, type FormEvent } from "react";
import type { Proactivity, Task } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { taskWrites } from "@/lib/queries/tasks";
import { useGoals } from "@/lib/queries/goals";
import { chip } from "./chip";

const toggle = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const label = "text-xs font-medium text-muted-foreground";

/**
 * Create or edit a task. The shell remounts it
 * on every open (keyed by taskActions.editSeq), so the fields seed from `task`.
 */
export function TaskFormSheet({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
}) {
  const goals = useGoals();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [important, setImportant] = useState(task?.important ?? false);
  const [urgent, setUrgent] = useState(task?.urgent ?? false);
  const [proactivity, setProactivity] = useState<Proactivity | "">(task?.proactivity ?? "");
  const [goalId, setGoalId] = useState(task?.goalId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.slice(0, 10) : "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    const body = {
      title: t,
      notes: notes.trim() || null,
      important,
      urgent,
      proactivity: (proactivity || null) as Proactivity | null,
      goalId: goalId || null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    };
    if (task) {
      await taskWrites.update(task, body);
    } else {
      await taskWrites.add({
        title: t,
        notes: body.notes ?? undefined,
        important,
        urgent,
        proactivity: body.proactivity ?? undefined,
        goalId: body.goalId ?? undefined,
        dueDate: body.dueDate ?? undefined,
      });
    }
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Edit task" : "New task"}
      description="Quadrant is derived from importance × urgency."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" size="sm" disabled={submitting || !title.trim()}>
            {task ? "Save" : "Add task"}
          </Button>
        </div>
      }
    >
      <form id="task-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={label}>Title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional details…"
            className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Priority</span>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={important}
              onClick={() => setImportant(!important)}
              className={cn(toggle, chip(important))}
            >
              Important
            </button>
            <button
              type="button"
              aria-pressed={urgent}
              onClick={() => setUrgent(!urgent)}
              className={cn(toggle, chip(urgent))}
            >
              Urgent
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Proactivity (Habit 1)</span>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={proactivity === "INFLUENCE"}
              onClick={() => setProactivity(proactivity === "INFLUENCE" ? "" : "INFLUENCE")}
              className={cn(toggle, chip(proactivity === "INFLUENCE"))}
            >
              Influence
            </button>
            <button
              type="button"
              aria-pressed={proactivity === "CONCERN"}
              onClick={() => setProactivity(proactivity === "CONCERN" ? "" : "CONCERN")}
              className={cn(toggle, chip(proactivity === "CONCERN"))}
            >
              Concern
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Goal (Habit 2)</span>
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-2 text-sm"
          >
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Due date</span>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </form>
    </AppSheet>
  );
}
