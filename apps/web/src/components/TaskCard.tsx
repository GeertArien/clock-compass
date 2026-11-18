import { memo } from "react";
import { Check, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import type { Proactivity, Task } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/stores/store";
import { tasksStore } from "@/lib/stores/tasks";
import { useGoals } from "@/lib/queries/goals";
import { projectsStore } from "@/lib/stores/projects";
import { taskActions } from "@/lib/stores/task-actions";
import { chip } from "./chip";

const pill = "rounded-full border px-2 py-0.5 text-[0.625rem] font-medium transition-colors";

/**
 * One task with its quick actions. Memoised: the
 * store replaces only the changed task object, so toggling one task re-renders
 * just its own card.
 */
export const TaskCard = memo(function TaskCard({ task }: { task: Task }) {
  const done = task.status === "DONE";
  const project = useStore(projectsStore, (s) =>
    task.projectId ? s.projects.find((p) => p.id === task.projectId) : undefined,
  );
  const goals = useGoals();

  // Clicking the active proactivity tag clears it; otherwise sets it.
  function setProactivity(value: Proactivity) {
    void tasksStore.setProactivity(task, task.proactivity === value ? null : value);
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-background p-2.5",
        done && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => void tasksStore.toggleComplete(task)}
        aria-label={done ? "Reopen task" : "Complete task"}
        title={done ? "Reopen" : "Complete"}
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent"
      >
        {done ? (
          <RotateCcw className="size-3" />
        ) : (
          <Check className="size-3 opacity-0 hover:opacity-100" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", done && "line-through")}>{task.title}</p>
        {project ? (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">▤ {project.name}</p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void tasksStore.setFlags(task, { important: !task.important })}
            aria-pressed={task.important}
            className={cn(pill, chip(task.important))}
          >
            Important
          </button>
          <button
            type="button"
            onClick={() => void tasksStore.setFlags(task, { urgent: !task.urgent })}
            aria-pressed={task.urgent}
            className={cn(pill, chip(task.urgent))}
          >
            Urgent
          </button>
          <span className="mx-0.5 text-[0.625rem] text-border">|</span>
          {/* Habit 1: influence vs concern */}
          <button
            type="button"
            onClick={() => setProactivity("INFLUENCE")}
            aria-pressed={task.proactivity === "INFLUENCE"}
            title="In your influence (actionable)"
            className={cn(pill, chip(task.proactivity === "INFLUENCE"))}
          >
            Influence
          </button>
          <button
            type="button"
            onClick={() => setProactivity("CONCERN")}
            aria-pressed={task.proactivity === "CONCERN"}
            title="A concern (not in your control)"
            className={cn(pill, chip(task.proactivity === "CONCERN"))}
          >
            Concern
          </button>
        </div>

        {/* Habit 2: link to a goal */}
        {goals.length > 0 ? (
          <select
            value={task.goalId ?? ""}
            onChange={(e) => void tasksStore.setGoal(task, e.currentTarget.value || null)}
            aria-label="Link to goal"
            className="mt-1.5 max-w-[12rem] truncate rounded-md border border-border bg-transparent px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground"
          >
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {task.quadrant === "Q2" ? (
          <button
            type="button"
            onClick={() => void tasksStore.toggleBigRock(task)}
            aria-label={task.isBigRock ? "Unpin big rock" : "Pin as this week's big rock"}
            title={task.isBigRock ? "Unpin big rock" : "Pin as big rock"}
            className={cn(
              "flex size-6 items-center justify-center rounded hover:bg-accent",
              task.isBigRock ? "text-[var(--star)]" : "text-muted-foreground",
            )}
          >
            <Star className="size-3.5" fill={task.isBigRock ? "currentColor" : "none"} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => taskActions.edit(task)}
          aria-label="Edit task"
          title="Edit"
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => taskActions.askDelete(task)}
          aria-label="Delete task"
          title="Delete"
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-red-600"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
});
