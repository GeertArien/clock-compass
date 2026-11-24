import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import type { Task, TaskPreview } from "@clock-compass/web-client/api";
import { recurrenceLabel } from "@clock-compass/web-client/meta";
import {
  calendarDay,
  formatTime,
  isSameLocalDay,
  localDay,
  weekDays,
} from "@clock-compass/web-client/week";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  previewsQuery,
  taskWrites,
  useAllTasks,
  useTasks,
} from "@/lib/queries/tasks";
import { useProjects } from "@/lib/queries/projects";
import { plainDayLabel, TaskCard } from "./TaskCard";
import { crumb } from "./crumb";

const NO_PREVIEWS: TaskPreview[] = [];
const byTime = (
  a: { scheduledTime: string | null },
  b: { scheduledTime: string | null },
) => (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99");

/**
 * An upcoming occurrence of a recurring task (#105 step 2): drawn lightly,
 * with nothing to press. It is not a task: no tick, no edit, no pin, and it
 * is not a stop for the keyboard. A screen reader hears "Upcoming".
 */
function PreviewRow({ preview }: { preview: TaskPreview }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-dotted border-border py-2 last:border-b-0">
      <span
        aria-hidden="true"
        className="size-5 shrink-0 rounded-full border border-dashed border-input"
      />
      <span className="w-14 shrink-0 text-xs text-muted-foreground">
        {formatTime(preview.scheduledTime) ?? ""}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muted-foreground italic">
          <span className="sr-only">
            Upcoming{preview.approximate ? ", approximate date" : ""}:{" "}
          </span>
          {preview.title} <span aria-hidden="true">↻</span>
        </p>
        <p className="text-[0.6875rem] text-muted-foreground">
          {preview.approximate
            ? "≈ upcoming, if the current one is done on time"
            : "upcoming"}
        </p>
      </div>
    </div>
  );
}

const shortDay: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

/** Clock · Week: rocks-to-place tray + Monday–Sunday agenda. */
export function WeekPanel() {
  // Shown tasks for the tray; every task (a "later" occurrence too) for the calendar.
  const tasks = useTasks();
  const allTasks = useAllTasks();
  const projects = useProjects();
  const [offset, setOffset] = useState(0);
  const [rocksOnly, setRocksOnly] = useState(true);

  const days = useMemo(() => weekDays(offset), [offset]);
  // Previews come from the server for the displayed week (they are never rocks).
  const previews =
    useQuery({
      ...previewsQuery(localDay(days[0]!), localDay(days[6]!)),
      enabled: !rocksOnly,
    }).data ?? NO_PREVIEWS;
  const today = new Date();
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const rangeLabel = `${fmt(days[0]!)} – ${fmt(days[6]!)}`;

  // The tray: starred rocks with no day yet. Schedule these first.
  const unplacedRocks = tasks.filter(
    (t) => t.isBigRock && t.status !== "DONE" && !calendarDay(t),
  );
  // Q2 tasks that could still be starred into the week.
  const candidates = tasks.filter(
    (t) => t.quadrant === "Q2" && !t.isBigRock && t.status !== "DONE",
  );

  // A task sits on its scheduled day; a recurring one with no scheduled day on its due date.
  function slotsFor(day: Date): Task[] {
    const name = localDay(day);
    return allTasks
      .filter((t) => calendarDay(t) === name)
      .filter((t) => !rocksOnly || t.isBigRock)
      .sort(byTime);
  }

  function previewsFor(day: Date): TaskPreview[] {
    if (rocksOnly) return NO_PREVIEWS;
    const name = localDay(day);
    return previews.filter((p) => p.day === name).sort(byTime);
  }

  function place(task: Task, dayIso: string) {
    if (dayIso)
      void taskWrites.setScheduledDay(task, new Date(dayIso).toISOString());
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Week navigation + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-input bg-card p-0.5">
          <button
            type="button"
            onClick={() => setOffset(offset - 1)}
            aria-label="Previous week"
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-28 px-1 text-center font-display text-sm font-semibold">
            {rangeLabel}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + 1)}
            aria-label="Next week"
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {offset !== 0 ? (
          <Button variant="outline" size="sm" onClick={() => setOffset(0)}>
            Today
          </Button>
        ) : null}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-input bg-card">
          <button
            type="button"
            aria-pressed={rocksOnly}
            onClick={() => setRocksOnly(true)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold",
              rocksOnly
                ? "bg-[var(--mode)] text-white"
                : "text-muted-foreground",
            )}
          >
            ★ Big rocks
          </button>
          <button
            type="button"
            aria-pressed={!rocksOnly}
            onClick={() => setRocksOnly(false)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold",
              !rocksOnly
                ? "bg-[var(--mode)] text-white"
                : "text-muted-foreground",
            )}
          >
            All scheduled
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[16rem_1fr]">
        {/* Rocks to place */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Star className="size-4 text-[var(--star)]" fill="currentColor" />
            <h2 className="font-display text-[0.9375rem] font-semibold">
              Rocks to place
            </h2>
            <span className="text-xs text-muted-foreground">
              {unplacedRocks.length}
            </span>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            Schedule these into the week first — the small stuff fills the gaps.
          </p>
          {unplacedRocks.length === 0 ? (
            <p className="py-1 font-display text-sm text-muted-foreground italic">
              Nothing waiting — every rock has its day.
            </p>
          ) : (
            unplacedRocks.map((rock) => (
              <div
                key={rock.id}
                className="rounded-lg border border-border bg-background p-2.5"
              >
                <p className="text-sm leading-snug font-medium">{rock.title}</p>
                <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                  {crumb(projects, rock.projectId)}
                </p>
                <select
                  value=""
                  onChange={(e) => place(rock, e.currentTarget.value)}
                  aria-label="Place on a day"
                  className="mt-1.5 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground"
                >
                  <option value="">place on…</option>
                  {days.map((day) => (
                    <option key={day.toISOString()} value={day.toISOString()}>
                      {day.toLocaleDateString(undefined, shortDay)}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}

          {candidates.length > 0 ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                Q2 candidates to star ({candidates.length})
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {candidates.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </details>
          ) : null}
        </div>

        {/* The week, Monday–Sunday */}
        <div className="flex flex-col gap-2.5">
          {days.map((day) => {
            const isToday = isSameLocalDay(today.toISOString(), day);
            const slots = slotsFor(day);
            const upcoming = previewsFor(day);
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "rounded-xl border bg-card shadow-sm",
                  isToday
                    ? "border-[var(--terra)] ring-1 ring-[var(--terra)]"
                    : "border-border",
                )}
              >
                <div className="flex items-baseline gap-2 border-b border-border bg-secondary/50 px-3.5 py-1.5">
                  <span className="font-display text-sm font-semibold">
                    {day.toLocaleDateString(undefined, { weekday: "long" })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {day.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {isToday ? (
                    <span className="ml-auto text-[0.625rem] font-bold tracking-widest text-[var(--terra)]">
                      TODAY
                    </span>
                  ) : null}
                </div>
                <div className="px-3.5 py-1">
                  {slots.length === 0 && upcoming.length === 0 ? (
                    <p className="py-1.5 font-display text-sm text-input italic">
                      —
                    </p>
                  ) : (
                    <>
                      {slots.map((task) => {
                        const done = task.status === "DONE";
                        const repeats = task.recurrence?.active
                          ? recurrenceLabel(task.recurrence)
                          : null;
                        // On its due date only (no scheduled day): nothing to time or unschedule.
                        const onDueDate = !task.scheduledDay;
                        return (
                          <div
                            key={task.id}
                            className="flex items-center gap-2.5 border-b border-dotted border-border py-2 last:border-b-0"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                void taskWrites.toggleComplete(task)
                              }
                              aria-label={
                                done ? "Reopen task" : "Complete task"
                              }
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                                done
                                  ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                                  : "border-input text-transparent hover:text-muted-foreground",
                              )}
                            >
                              {done ? (
                                <Check className="size-3" />
                              ) : (
                                <RotateCcw className="size-3 opacity-0" />
                              )}
                            </button>
                            <span
                              className={cn(
                                "w-14 shrink-0 text-xs font-semibold",
                                task.scheduledTime
                                  ? "text-[var(--terra)]"
                                  : onDueDate
                                    ? "text-muted-foreground"
                                    : "text-input",
                              )}
                            >
                              {onDueDate
                                ? "due"
                                : (formatTime(task.scheduledTime) ?? "—")}
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
                                    <span className="text-[var(--star)]">
                                      ★
                                    </span>{" "}
                                  </>
                                ) : null}
                                {task.title}
                                {repeats ? (
                                  <span
                                    role="img"
                                    aria-label={repeats}
                                    title={repeats}
                                    className="ml-1.5 text-xs text-muted-foreground"
                                  >
                                    ↻
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[0.6875rem] text-muted-foreground">
                                {crumb(projects, task.projectId)}
                                {task.later && task.showFrom
                                  ? ` · later: shows from ${plainDayLabel(task.showFrom)}`
                                  : ""}
                              </p>
                            </div>
                            {onDueDate ? null : (
                              <>
                                <input
                                  type="time"
                                  value={task.scheduledTime ?? ""}
                                  onChange={(e) =>
                                    void taskWrites.setScheduledTime(
                                      task,
                                      e.currentTarget.value || null,
                                    )
                                  }
                                  aria-label="Set a time"
                                  className="w-[4.7rem] shrink-0 rounded-md border border-input bg-transparent px-1 py-0.5 text-[0.6875rem] text-muted-foreground"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void taskWrites.setScheduledDay(task, null)
                                  }
                                  aria-label="Unschedule"
                                  title="Unschedule (back to the tray)"
                                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                      {upcoming.map((preview) => (
                        <PreviewRow
                          key={`${preview.seriesId}-${preview.day}`}
                          preview={preview}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
