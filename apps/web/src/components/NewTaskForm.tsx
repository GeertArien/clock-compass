import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tasksStore } from "@/lib/stores/tasks";
import { chip } from "./chip";

const toggle = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";

/** Quick add with importance/urgency toggles, above the matrix. */
export function NewTaskForm() {
  const [title, setTitle] = useState("");
  const [important, setImportant] = useState(true);
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    await tasksStore.add({ title: trimmed, important, urgent });
    setTitle("");
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center"
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task…"
        aria-label="Task title"
        className="flex-1"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setImportant(!important)}
          aria-pressed={important}
          className={cn(toggle, chip(important))}
        >
          Important
        </button>
        <button
          type="button"
          onClick={() => setUrgent(!urgent)}
          aria-pressed={urgent}
          className={cn(toggle, chip(urgent))}
        >
          Urgent
        </button>
        <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}
