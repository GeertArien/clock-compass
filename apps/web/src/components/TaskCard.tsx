import { memo } from "react";
import { Check, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import type { Proactivity, Task } from "@clock-compass/web-client/api";
import { recurrenceLabel } from "@clock-compass/web-client/meta";
import { cn } from "@/lib/utils";
import { taskWrites } from "@/lib/queries/tasks";
import { useGoals } from "@/lib/queries/goals";
import { useProject } from "@/lib/queries/projects";
import { taskActions } from "@/lib/stores/task-actions";
import { chip } from "./chip";

const pill =
  "rounded-full border px-2 py-0.5 text-[0.625rem] font-medium transition-colors";
/* Influence/Concern (Habit 1) read as one quiet choice, not two more pills.
   The transparent border and the pill's vertical padding keep the tap target
   exactly as tall as a pill. The unchosen grey is the foreground at 65%, not
   muted-foreground, so 10px text keeps 4.5:1 on the light paper (5.0:1; 6.7:1
   in dark). The pine underline is 6.7:1 (light) and 5.3:1 (dark). Between
   the two labels sit the slash and its padding, a gap that belongs to
   neither button, so a thumb near the middle does not land on the wrong one. */
const quiet =
  "rounded border border-transparent px-1.5 py-0.5 text-[0.625rem] underline-offset-[3px] transition-colors";
const quietOn =
  "font-semibold text-foreground underline decoration-[var(--pine)] decoration-2";
const quietOff = "font-medium text-foreground/65 hover:text-foreground";
const slash =
  "absolute top-1/2 left-1 -translate-y-1/2 text-[0.625rem] leading-none text-muted-foreground";
const proactivityOptions: {
  value: Proactivity;
  label: string;
  title: string;
}[] = [
  {
    value: "INFLUENCE",
    label: "Influence",
    title: "In your influence (actionable)",
  },
  {
    value: "CONCERN",
    label: "Concern",
    title: "A concern (not in your control)",
  },
];
const flagGroup =
  "relative flex flex-wrap items-center gap-1.5 pl-[0.8333rem] before:absolute before:top-1/2 before:left-[0.2222rem] before:h-3 before:w-px before:-translate-y-1/2 before:bg-border";

/**
 * One task with its quick actions. Memoised: the
 * store replaces only the changed task object, so toggling one task re-renders
 * just its own card.
 */
/** "11 Oct" for a plain date (stored at UTC midnight), read as that calendar day. */
export function plainDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const TaskCard = memo(function TaskCard({ task }: { task: Task }) {
  const done = task.status === "DONE";
  const repeats = task.recurrence?.active
    ? recurrenceLabel(task.recurrence)
    : null;
  const project = useProject(task.projectId);
  const goals = useGoals();

  // Clicking the active proactivity tag clears it; otherwise sets it.
  function setProactivity(value: Proactivity) {
    void taskWrites.setProactivity(
      task,
      task.proactivity === value ? null : value,
    );
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
        onClick={() => void taskWrites.toggleComplete(task)}
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
        <p className={cn("text-sm leading-snug", done && "line-through")}>
          {task.title}
          {repeats ? (
            <span
              role="img"
              aria-label={repeats}
              title={repeats}
              className="ml-1.5 text-xs text-muted-foreground no-underline"
            >
              ↻
            </span>
          ) : null}
        </p>
        {task.later && task.showFrom ? (
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            Shows from {plainDayLabel(task.showFrom)}
          </p>
        ) : null}
        {project ? (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
            ▤ {project.name}
          </p>
        ) : null}
        {/* Two groups of flags: Habit 3 (importance, urgency) and Habit 1
            (influence, concern). Each group draws its separator before it, and
            the row clips only its left edge, which hides the separator of
            whichever group starts a line, so a wrap never leaves a dangling
            divider. Pills still wrap one by one inside a narrow group, and the
            clip leaves 0.25rem around the row for focus outlines. Offsets are
            in rem so the spacing matches the old "|" at every root size. */}
        <div className="mt-1.5 [clip-path:inset(-0.25rem_-100vw_-0.25rem_-0.25rem)]">
          <div className="-ml-[0.8333rem] flex flex-wrap items-center gap-1.5">
            <div className={flagGroup}>
              <button
                type="button"
                onClick={() =>
                  void taskWrites.setFlags(task, { important: !task.important })
                }
                aria-pressed={task.important}
                className={cn(pill, chip(task.important))}
              >
                Important
              </button>
              <button
                type="button"
                onClick={() =>
                  void taskWrites.setFlags(task, { urgent: !task.urgent })
                }
                aria-pressed={task.urgent}
                className={cn(pill, chip(task.urgent))}
              >
                Urgent
              </button>
            </div>
            {/* Habit 1: influence vs concern, one choice with three states
                (influence, concern, not set); tapping the chosen side clears it.
                The slashes use the row's trick again: each option draws one
                before it, and the inner clip hides the slash of whichever
                option starts a line, so a narrow card shows "Influence" over
                "Concern" with no stray slash. */}
            <div
              className={flagGroup}
              role="group"
              aria-label="Influence or concern"
            >
              <div className="[clip-path:inset(-0.25rem_-100vw_-0.25rem_-0.25rem)]">
                <div className="-ml-3 flex flex-wrap items-center gap-y-1.5">
                  {proactivityOptions.map((option) => {
                    const on = task.proactivity === option.value;
                    return (
                      <span key={option.value} className="relative flex pl-3">
                        <span aria-hidden="true" className={slash}>
                          /
                        </span>
                        <button
                          type="button"
                          onClick={() => setProactivity(option.value)}
                          aria-pressed={on}
                          title={option.title}
                          className={cn(quiet, on ? quietOn : quietOff)}
                        >
                          {option.label}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Habit 2: link to a goal */}
        {goals.length > 0 ? (
          <select
            value={task.goalId ?? ""}
            onChange={(e) =>
              void taskWrites.setGoal(task, e.currentTarget.value || null)
            }
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
        {/* A "later" occurrence cannot be pinned yet (#105). */}
        {task.quadrant === "Q2" && !task.later ? (
          <button
            type="button"
            onClick={() => void taskWrites.toggleBigRock(task)}
            aria-label={
              task.isBigRock ? "Unpin big rock" : "Pin as this week's big rock"
            }
            title={task.isBigRock ? "Unpin big rock" : "Pin as big rock"}
            className={cn(
              "flex size-6 items-center justify-center rounded hover:bg-accent",
              task.isBigRock ? "text-[var(--star)]" : "text-muted-foreground",
            )}
          >
            <Star
              className="size-3.5"
              fill={task.isBigRock ? "currentColor" : "none"}
            />
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
