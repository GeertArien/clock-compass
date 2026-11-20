import { Check, Repeat } from "lucide-react";
import type { Goal, HabitView } from "@clock-compass/web-client/api";
import { momentumFor } from "@clock-compass/web-client/momentum";

const pct = (ratio: number): number => Math.round(ratio * 100);
const momentumPct = (m: { met: number; target: number }): number =>
  m.target ? Math.round((100 * m.met) / m.target) : 0;

/**
 * A goal's two facets: the share of its tasks done, and this week's momentum
 * of its linked habits. Shared by Compass · Goals and the assistant's GoalList.
 */
export function GoalProgress({ goal, habits }: { goal: Goal; habits: HabitView[] }) {
  // Habit momentum (the second goal facet): this-week cadence of linked habits.
  const m = momentumFor(habits, new Set([goal.id]));
  return (
    <>
      {/* Completion: the share of the goal's tasks done. */}
      <div className="flex items-center gap-2" title="Tasks completed">
        <Check className="size-3.5 shrink-0 text-[var(--pine)]" />
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-[var(--pine)]"
            style={{ width: `${pct(goal.progress.ratio)}%` }}
          />
        </div>
        <span className="w-24 text-right text-xs text-muted-foreground">
          {goal.progress.done}/{goal.progress.total} · {pct(goal.progress.ratio)}%
        </span>
      </div>

      {/* Momentum: this-week cadence of the goal's recurring habits. */}
      {m ? (
        <div
          className="flex items-center gap-2"
          title={`${m.habits} habit${m.habits === 1 ? "" : "s"} · kept this week vs weekly target`}
        >
          <Repeat className="size-3.5 shrink-0 text-[var(--gold)]" />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[var(--gold)]" style={{ width: `${momentumPct(m)}%` }} />
          </div>
          <span className="w-24 text-right text-xs text-muted-foreground">
            {m.met}/{m.target}
            {m.streak > 0 ? ` · ${m.streak}w 🔥` : ""}
          </span>
        </div>
      ) : null}
    </>
  );
}
