import { memo } from "react";
import { Check, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import type { Proactivity, Task } from "@clock-compass/web-client/api";
import { plainDayLabel, recurrenceLabel } from "@clock-compass/web-client/meta";
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

/** What a proposal card marks as changed (#145). */
export type ProposedPart =
  | "title"
  | "done"
  | "important"
  | "urgent"
  | "proactivity"
  | "repeat"
  | "showFrom"
  | "due"
  | "scheduled"
  | "project"
  | "goal"
  | "bigRock";

/**
 * Inside an unconfirmed proposal the card is read-only (#145): no pill, star,
 * pencil or bin changes the task outside the confirm step. `changed` marks
 * the parts the proposal changes (option A); empty for option B.
 */
export interface CardProposal {
  changed: ReadonlySet<ProposedPart>;
}

/** A small pine dot before a changed part; `corner` sits it on an icon button's corner. */
function Dot({ on, corner = false }: { on: boolean; corner?: boolean }) {
  if (!on) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full bg-[var(--pine)]",
        corner ? "absolute -top-0.5 -right-0.5" : "mr-1 align-middle",
      )}
    />
  );
}
/** The same mark for a screen reader, after the part's own name. */
function Changed({ on }: { on: boolean }) {
  return on ? <span className="sr-only"> (changed)</span> : null;
}

/**
 * One task with its quick actions. Memoised: the
 * store replaces only the changed task object, so toggling one task re-renders
 * just its own card.
 */
export const TaskCard = memo(function TaskCard({ task, proposal }: { task: Task; proposal?: CardProposal }) {
  const done = task.status === "DONE";
  const readOnly = proposal !== undefined;
  const is = (part: ProposedPart) => proposal?.changed.has(part) ?? false;
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
        disabled={readOnly}
        onClick={() => void taskWrites.toggleComplete(task)}
        aria-label={
          readOnly
            ? `${done ? "Done" : "Not done"}${is("done") ? " (changed)" : ""}`
            : done
              ? "Reopen task"
              : "Complete task"
        }
        title={done ? "Reopen" : "Complete"}
        className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent disabled:hover:bg-transparent"
      >
        <Dot on={is("done")} corner />
        {done ? (
          <RotateCcw className="size-3" />
        ) : (
          <Check className="size-3 opacity-0 hover:opacity-100" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", done && "line-through")}>
          <Dot on={is("title") || is("done")} />
          {task.title}
          <Changed on={is("title") || is("done")} />
          {repeats ? (
            <span
              role="img"
              aria-label={is("repeat") ? `${repeats} (changed)` : repeats}
              title={repeats}
              className="ml-1.5 text-xs text-muted-foreground no-underline"
            >
              <Dot on={is("repeat")} />↻
            </span>
          ) : null}
        </p>
        {/* A proposal names the dates it changes; the live card shows none. */}
        {is("due") ? (
          <p className="mt-0.5 text-[0.6875rem] text-foreground">
            <Dot on />
            {task.dueDate ? `Due ${plainDayLabel(task.dueDate)}` : "No due date"}
            <Changed on />
          </p>
        ) : null}
        {is("scheduled") ? (
          <p className="mt-0.5 text-[0.6875rem] text-foreground">
            <Dot on />
            {task.scheduledDay
              ? `On ${plainDayLabel(task.scheduledDay)}${task.scheduledTime ? ` at ${task.scheduledTime}` : ""}`
              : "Not on the Clock"}
            <Changed on />
          </p>
        ) : null}
        {(task.later || is("showFrom")) && task.showFrom ? (
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            <Dot on={is("showFrom")} />
            Shows from {plainDayLabel(task.showFrom)}
            <Changed on={is("showFrom")} />
          </p>
        ) : null}
        {project ? (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
            <Dot on={is("project")} />▤ {project.name}
            <Changed on={is("project")} />
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
                disabled={readOnly}
                onClick={() =>
                  void taskWrites.setFlags(task, { important: !task.important })
                }
                aria-pressed={task.important}
                className={cn(pill, chip(task.important))}
              >
                <Dot on={is("important")} />
                Important
                <Changed on={is("important")} />
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() =>
                  void taskWrites.setFlags(task, { urgent: !task.urgent })
                }
                aria-pressed={task.urgent}
                className={cn(pill, chip(task.urgent))}
              >
                <Dot on={is("urgent")} />
                Urgent
                <Changed on={is("urgent")} />
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
                          disabled={readOnly}
                          onClick={() => setProactivity(option.value)}
                          aria-pressed={on}
                          title={option.title}
                          className={cn(quiet, on ? quietOn : quietOff)}
                        >
                          <Dot on={on && is("proactivity")} />
                          {option.label}
                          <Changed on={on && is("proactivity")} />
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
          <span className="mt-1.5 flex items-center">
          <Dot on={is("goal")} />
          <select
            disabled={readOnly}
            value={task.goalId ?? ""}
            onChange={(e) =>
              void taskWrites.setGoal(task, e.currentTarget.value || null)
            }
            aria-label={is("goal") ? "Goal (changed)" : "Link to goal"}
            className="max-w-[12rem] truncate rounded-md border border-border bg-transparent px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground"
          >
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* A "later" occurrence cannot be pinned yet (#105). */}
        {(task.quadrant === "Q2" && !task.later) || is("bigRock") ? (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => void taskWrites.toggleBigRock(task)}
            aria-label={
              readOnly
                ? `${task.isBigRock ? "Big rock" : "Not a big rock"}${is("bigRock") ? " (changed)" : ""}`
                : task.isBigRock
                  ? "Unpin big rock"
                  : "Pin as this week's big rock"
            }
            title={task.isBigRock ? "Unpin big rock" : "Pin as big rock"}
            className={cn(
              "relative flex size-6 items-center justify-center rounded hover:bg-accent disabled:hover:bg-transparent",
              task.isBigRock ? "text-[var(--star)]" : "text-muted-foreground",
            )}
          >
            <Dot on={is("bigRock")} corner />
            <Star
              className="size-3.5"
              fill={task.isBigRock ? "currentColor" : "none"}
            />
          </button>
        ) : null}
        {readOnly ? null : (
        <>
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
        </>
        )}
      </div>
    </div>
  );
});
