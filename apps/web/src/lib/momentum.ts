import type { HabitView } from "@/lib/api";

/**
 * Habit momentum — the second facet of a goal, alongside task completion.
 * Recurring habits never "complete", so momentum measures this-week cadence:
 * for each habit linked to the goal(s), how many of its target check-offs are
 * kept this week, summed. Each habit is capped at its own target so an
 * over-marked habit can't push the group past 100%.
 */
export type Momentum = { habits: number; met: number; target: number; streak: number };

/** Aggregate momentum for the habits linked to any goal in `goalIds`. */
export function momentumFor(
  habits: HabitView[],
  goalIds: Set<string>,
): Momentum | null {
  const linked = habits.filter((h) => h.goalId !== null && goalIds.has(h.goalId));
  if (linked.length === 0) return null;
  let met = 0;
  let target = 0;
  let streak = 0;
  for (const h of linked) {
    met += Math.min(h.doneThisWeek, h.targetPerWeek);
    target += h.targetPerWeek;
    streak = Math.max(streak, h.streak);
  }
  return { habits: linked.length, met, target, streak };
}
