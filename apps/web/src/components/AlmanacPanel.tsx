import { useState } from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { aiReview } from "@clock-compass/web-client/api";
import { startOfIsoWeekIso } from "@clock-compass/web-client/week";
import { cn } from "@/lib/utils";
import { DIMENSION_META, cadenceText, useRenewalRecord } from "@/lib/queries/renewal";
import { useScreen } from "@/lib/use-nav";
import { useAiStatus } from "@/lib/queries/ai";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function heatLevel(count: number): string {
  if (count === 0) return "bg-muted";
  if (count === 1) return "bg-[#cbd9c6]";
  if (count <= 2) return "bg-[#8fb89f]";
  return "bg-[var(--pine)]";
}

function weekLabel(weeksAgo: number): string {
  const monday = new Date(new Date(startOfIsoWeekIso()).getTime() - weeksAgo * 7 * 86_400_000);
  return monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const card = "rounded-xl border border-border bg-card p-4 shadow-sm";
const row = "flex items-baseline gap-2 border-b border-dotted border-border py-2";

/**
 * Almanac · Review and · The Season. Read-only by design:
 * it only loads and renders the record. It stays mounted across both sub-tabs,
 * so a generated weekly review survives switching between them.
 */
export function AlmanacPanel() {
  const { sub } = useScreen();
  // Refetched each time the Almanac opens.
  const { habits, activities, summary, trends } = useRenewalRecord();
  const connected = useAiStatus().connected;
  // The one ✦ surface in the Almanac: the weekly review, generated on demand.
  const [review, setReview] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  async function generateReview() {
    if (reviewing) return;
    setReviewing(true);
    try {
      setReview((await aiReview()).summary);
    } catch {
      setReview(null);
    } finally {
      setReviewing(false);
    }
  }

  if (habits.length === 0 && activities.length === 0) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-card px-6 py-14 text-center shadow-sm">
        <BookOpen className="size-7 text-[var(--gold)]" />
        <h2 className="font-display text-lg font-semibold">The record will gather here.</h2>
        <p className="max-w-md font-display text-sm leading-relaxed text-muted-foreground italic">
          Define a habit in Compass · Renew, check it off in Clock · Today — the Almanac writes
          itself as you live the weeks.
        </p>
      </section>
    );
  }

  if (sub === "season") {
    return (
      <section className="flex flex-col gap-4">
        <div className={card}>
          <h3 className="font-display text-base font-semibold">Habit streaks</h3>
          <p className="text-xs text-muted-foreground">
            This week's marks · streaks count weeks the target was met — an unfinished week never
            breaks the chain.
          </p>
          <div className="mt-2">
            {habits.map((habit) => (
              <div
                key={habit.id}
                className="flex items-center gap-3 border-b border-dotted border-border py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">
                  {habit.name}
                </span>
                <span className="hidden text-[0.6875rem] text-muted-foreground sm:inline">
                  {cadenceText(habit.targetPerWeek)}
                </span>
                <span className="flex gap-1">
                  {habit.weekDays.map((on, i) => (
                    <span
                      key={i}
                      className={cn(
                        "flex size-5 items-center justify-center rounded-md border text-[0.5rem]",
                        on
                          ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                          : "border-border bg-background text-muted-foreground",
                      )}
                    >
                      {DOW[i]}
                    </span>
                  ))}
                </span>
                <span className="w-16 text-right text-[0.75rem] text-muted-foreground">
                  <b className="text-foreground">
                    {habit.streak} wk{habit.streak === 1 ? "" : "s"}
                  </b>
                  {habit.streak >= 3 ? " 🔥" : " "}
                </span>
              </div>
            ))}
          </div>
        </div>

        {trends ? (
          <div className={card}>
            <h3 className="font-display text-base font-semibold">Last 12 weeks</h3>
            <p className="text-xs text-muted-foreground">
              All habits and one-offs, intensity by daily completions.
            </p>
            <div className="mt-3 flex flex-col gap-1">
              {trends.heatmap.map((week, w) => (
                <div key={w} className="flex items-center gap-1">
                  <span className="w-12 text-[0.625rem] text-muted-foreground">
                    {weekLabel(11 - w)}
                  </span>
                  {week.map((count, d) => (
                    <span
                      key={d}
                      className={cn("size-3.5 rounded-[3px]", heatLevel(count))}
                      title={`${count}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const delta = trends ? trends.thisWeek - trends.lastWeek : 0;
  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((dim) => {
          const meta = DIMENSION_META[dim.dimension];
          const pct = dim.habitsTarget
            ? Math.min(100, Math.round((100 * dim.habitsDone) / dim.habitsTarget))
            : 0;
          return (
            <div
              key={dim.dimension}
              className="rounded-xl border border-border bg-card p-3 shadow-sm"
              style={{ borderTop: `3px solid ${meta.color}` }}
            >
              <p className="font-display text-[0.8125rem] font-semibold">{meta.label}</p>
              <p className="mt-1 font-display text-xl font-semibold">
                {dim.total}{" "}
                <span className="text-xs font-normal text-muted-foreground">this week</span>
              </p>
              <p className="text-[0.65625rem] text-muted-foreground">
                {dim.habitsDone}/{dim.habitsTarget} habit · {dim.oneOffs} one-off
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct >= 100 ? "bg-[var(--star)]" : "bg-[var(--pine)]",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {trends ? (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className={card}>
              <h3 className="font-display text-base font-semibold">This week vs last</h3>
              <p className="text-xs text-muted-foreground">Habits and one-offs combined</p>
              <div className="mt-2 flex flex-col">
                <div className={row}>
                  <span className="flex-1 text-[0.84375rem]">Completions this week</span>
                  <span className="font-display text-[0.9375rem] font-semibold">
                    {trends.thisWeek}
                  </span>
                  {delta !== 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
                        delta > 0
                          ? "bg-[var(--pine-soft)] text-[var(--pine)]"
                          : "bg-[var(--terra-soft)] text-[var(--terra)]",
                      )}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </span>
                  ) : null}
                </div>
                <div className={row}>
                  <span className="flex-1 text-[0.84375rem]">Completions last week</span>
                  <span className="font-display text-[0.9375rem] font-semibold">
                    {trends.lastWeek}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 py-2">
                  <span className="flex-1 text-[0.84375rem]">Longest active streak</span>
                  <span className="font-display text-[0.9375rem] font-semibold">
                    {trends.longestStreak.weeks} wks
                  </span>
                  {trends.longestStreak.habitName ? (
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {trends.longestStreak.habitName}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={card}>
              <h3 className="font-display text-base font-semibold">Goal momentum</h3>
              <p className="text-xs text-muted-foreground">Last 30 days, via linked habits</p>
              <div className="mt-2 flex flex-col">
                {trends.goalMomentum.length === 0 ? (
                  <p className="py-2 font-display text-sm text-muted-foreground italic">
                    Link a habit to a goal to see its momentum here.
                  </p>
                ) : (
                  trends.goalMomentum.map((goal) => (
                    <div key={goal.goalId} className={cn(row, "last:border-b-0")}>
                      <span className="min-w-0 flex-1 truncate text-[0.84375rem]">{goal.title}</span>
                      <span className="font-display text-[0.9375rem] font-semibold">
                        {goal.pct}%
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {connected ? (
            <div className="rounded-xl border border-l-[3px] border-border border-l-[var(--plum)] bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[var(--plum)]" />
                <h3 className="font-display text-base font-semibold">Weekly review</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-semibold text-muted-foreground">
                  AI
                </span>
              </div>
              {review ? (
                <p className="mt-2 font-display text-sm leading-relaxed text-foreground/80 italic">
                  “{review}”
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void generateReview()}
                  disabled={reviewing}
                  className="mt-2 text-sm font-semibold text-[var(--plum)] hover:underline disabled:opacity-50"
                >
                  {reviewing ? "Reading the week…" : "✦ Generate this week's review"}
                </button>
              )}
            </div>
          ) : null}

          {activities.length > 0 ? (
            <div className={card}>
              <h3 className="font-display text-base font-semibold">One-off renewal</h3>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
              <div className="mt-1">
                {activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center gap-2.5 border-b border-dotted border-border py-2 last:border-b-0"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: DIMENSION_META[activity.dimension].color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.84375rem]">
                      {activity.title}
                    </span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {new Date(activity.occurredAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
