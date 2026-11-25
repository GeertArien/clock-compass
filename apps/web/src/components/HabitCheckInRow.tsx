import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { HabitView } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { DIMENSION_META, toggleHabitToday } from "@/lib/queries/renewal";
import { useReadOnly } from "@/lib/read-only";

/**
 * One habit's check-in for today: tap to mark done (or undo). Shared by
 * Clock · Today and the assistant's HabitCheckIn.
 */
export function HabitCheckInRow({ habit }: { habit: HabitView }) {
  const toggleHabit = useMutation(toggleHabitToday);
  // In the MCP App page: today's state, with no check-off (#118).
  const readOnly = useReadOnly();
  const meta = habit.dimension ? DIMENSION_META[habit.dimension] : null;
  return (
    <div className="flex items-center gap-3 border-b border-dotted border-border py-2 last:border-b-0">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => toggleHabit.mutate(habit)}
        aria-label={readOnly ? (habit.markedToday ? "Done today" : "Not yet today") : habit.markedToday ? "Unmark today" : "Mark done today"}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          habit.markedToday
            ? "border-[var(--pine)] bg-[var(--pine)] text-white"
            : "border-input text-transparent hover:border-[var(--pine)]",
        )}
      >
        <Check className="size-3.5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">{habit.name}</span>
      {meta ? (
        <span
          className="rounded-full px-2 py-0.5 text-[0.625rem] font-semibold"
          style={{ color: meta.color, background: meta.soft }}
        >
          {meta.label}
        </span>
      ) : null}
      <span className="text-[0.6875rem] text-muted-foreground">
        {habit.doneThisWeek}/{habit.targetPerWeek} wk
      </span>
    </div>
  );
}
