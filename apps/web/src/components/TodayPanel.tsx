import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Star } from "lucide-react";
import { formatTime, isSameLocalDay } from "@clock-compass/web-client/week";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { taskWrites, useTasksQuery } from "@/lib/queries/tasks";
import { useProjects } from "@/lib/queries/projects";
import { usePeople, worstOverdue } from "@/lib/queries/people";
import { DIMENSION_META, toggleHabitToday, useHabits } from "@/lib/queries/renewal";
import { useGo } from "@/lib/use-nav";
import { TaskCard } from "./TaskCard";
import { crumb } from "./crumb";

function isDueByToday(due: string | null): boolean {
  if (!due) return false;
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return due.slice(0, 10) <= today;
}

/** Clock · Today: rocks jar, one nudge, today's agenda, check-ins. */
export function TodayPanel() {
  const go = useGo();
  const { tasks, loading, error, retry } = useTasksQuery();
  const projects = useProjects();
  const people = usePeople();
  const habits = useHabits();
  const toggleHabit = useMutation(toggleHabitToday);

  const loadingFirst = loading && tasks.length === 0;

  const { rocks, rocksDone, meterPct, scheduledToday, dueToday } = useMemo(() => {
    const now = new Date();
    const rocks = tasks.filter((t) => t.isBigRock);
    const rocksDone = rocks.filter((t) => t.status === "DONE").length;
    return {
      rocks,
      rocksDone,
      meterPct: rocks.length ? Math.round((rocksDone / rocks.length) * 100) : 0,
      // Scheduled for today (the Clock lens), in time order.
      scheduledToday: tasks
        .filter((t) => isSameLocalDay(t.scheduledDay, now))
        .sort((a, b) => (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99")),
      // Plus open tasks due today or earlier that aren't already on today's schedule.
      dueToday: tasks.filter(
        (t) =>
          t.status !== "DONE" && isDueByToday(t.dueDate) && !isSameLocalDay(t.scheduledDay, now),
      ),
    };
  }, [tasks]);
  const nudge = useMemo(() => worstOverdue(people), [people]);

  return (
    <section className="flex flex-col gap-4">
      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}

      {loadingFirst ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
      ) : (
        <>
          {/* The jar: this week's big rocks, placed before anything else fills it. */}
          <div
            className="flex flex-col gap-3 rounded-xl p-4 text-[#f0ead9] shadow-sm"
            style={{ background: "linear-gradient(135deg, #2c2820 0%, #3a3326 100%)" }}
          >
            <div className="flex items-center gap-2">
              <Star className="size-4 text-[var(--star)]" fill="currentColor" />
              <h2 className="font-display text-base font-semibold text-[#f7f2e4]">
                This week's big rocks
              </h2>
              <button
                type="button"
                onClick={() => go("clock", "week")}
                className="ml-auto text-xs font-semibold text-[#d8b96a] hover:underline"
              >
                Week view →
              </button>
            </div>

            {rocks.length === 0 ? (
              <p className="font-display text-sm text-[#b8ad92] italic">
                The jar is empty — pin Q2 tasks as big rocks in the Week view.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {rocks.map((rock) => {
                    const done = rock.status === "DONE";
                    return (
                      <button
                        key={rock.id}
                        type="button"
                        onClick={() => void taskWrites.toggleComplete(rock)}
                        title={done ? "Reopen" : "Complete"}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                          done
                            ? "border-[#5e9e8673] bg-[#5e9e8638] text-[#ece5d2]"
                            : "border-[#fffdf724] bg-[#fffdf714] text-[#ece5d2] hover:border-[#fffdf748]",
                        )}
                      >
                        {done ? (
                          <>
                            <Check className="size-3.5" />
                            <span className="line-through opacity-75">{rock.title}</span>
                          </>
                        ) : (
                          <>
                            <Star className="size-3 text-[var(--star)]" fill="currentColor" />
                            <span>{rock.title}</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#fffdf724]">
                    <div
                      className="h-full rounded-full bg-[var(--star)] transition-all"
                      style={{ width: `${meterPct}%` }}
                    />
                  </div>
                  <span className="font-display text-sm">
                    {rocksDone} / {rocks.length}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* The single nudge: the worst overdue relationship commitment. */}
          {nudge ? (
            <div className="flex items-center gap-3 rounded-xl border border-[#e5c4b8] bg-[var(--terra-soft)] px-3.5 py-2.5 text-[0.8125rem] text-[#6e2a18]">
              <span className="min-w-0 flex-1">
                No <b>{nudge.title.toLowerCase()}</b> with <b>{nudge.personName}</b> logged on
                cadence.
              </span>
              <Button size="sm" onClick={() => go("compass", "people")}>
                People →
              </Button>
            </div>
          ) : null}

          {/* Today's agenda: scheduled slots, then due-today items. */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-base font-semibold">Today's agenda</h2>
            <p className="-mt-1 text-xs text-muted-foreground">
              Scheduled for today, then anything due.
            </p>

            {scheduledToday.length > 0 ? (
              <div className="flex flex-col">
                {scheduledToday.map((task) => {
                  const done = task.status === "DONE";
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2.5 border-b border-dotted border-border py-2 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => void taskWrites.toggleComplete(task)}
                        aria-label={done ? "Reopen task" : "Complete task"}
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          done
                            ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                            : "border-input text-transparent",
                        )}
                      >
                        <Check className="size-3" />
                      </button>
                      <span
                        className={cn(
                          "w-14 shrink-0 text-xs font-semibold",
                          task.scheduledTime ? "text-[var(--terra)]" : "text-input",
                        )}
                      >
                        {formatTime(task.scheduledTime) ?? "—"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm",
                            done && "text-muted-foreground line-through",
                          )}
                        >
                          {task.isBigRock ? (
                            <>
                              <span className="text-[var(--star)]">★</span>{" "}
                            </>
                          ) : null}
                          {task.title}
                        </p>
                        <p className="text-[0.6875rem] text-muted-foreground">
                          {crumb(projects, task.projectId)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {dueToday.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              {dueToday.length === 0 && scheduledToday.length === 0 ? (
                <p className="py-2 text-center font-display text-sm text-muted-foreground italic">
                  Nothing scheduled or due — a good day to place a rock.
                </p>
              ) : null}
            </div>
          </div>

          {/* Check-ins: today's habits (defined in Compass · Renew). */}
          {habits.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="font-display text-base font-semibold">Check-ins</h2>
              <p className="text-xs text-muted-foreground">
                Today's habits — defined in Compass · Renew.
              </p>
              <div className="mt-1 flex flex-col">
                {habits.map((habit) => {
                  const meta = habit.dimension ? DIMENSION_META[habit.dimension] : null;
                  return (
                    <div
                      key={habit.id}
                      className="flex items-center gap-3 border-b border-dotted border-border py-2 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => toggleHabit.mutate(habit)}
                        aria-label={habit.markedToday ? "Unmark today" : "Mark done today"}
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          habit.markedToday
                            ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                            : "border-input text-transparent hover:border-[var(--pine)]",
                        )}
                      >
                        <Check className="size-3.5" />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">
                        {habit.name}
                      </span>
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
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
