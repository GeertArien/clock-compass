import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CadenceUnit,
  Proactivity,
  RecurrenceBody,
  Task,
} from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { occurrencesQuery, taskWrites } from "@/lib/queries/tasks";
import { useGoals } from "@/lib/queries/goals";
import { chip } from "./chip";

const toggle =
  "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const label = "text-xs font-medium text-muted-foreground";
const field =
  "rounded-md border border-border bg-transparent px-2 py-2 text-sm";

const UNITS: { value: CadenceUnit; label: string; noun: string }[] = [
  { value: "DAY", label: "Every day", noun: "days" },
  { value: "WEEK", label: "Every week", noun: "weeks" },
  { value: "MONTH", label: "Every month", noun: "months" },
  { value: "YEAR", label: "Every year", noun: "years" },
];

/** The "show from" lead the form suggests: 3 weeks for yearly, 3 days for monthly, none otherwise. */
const SUGGESTED_LEAD: Partial<Record<CadenceUnit, number>> = {
  YEAR: 21,
  MONTH: 3,
};

const sameRule = (a: RecurrenceBody | null, b: RecurrenceBody | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** "Nov 26, 2026" for a plain date (stored at UTC midnight). */
const fullDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const STATUS_WORD = {
  DONE: "Done",
  ARCHIVED: "Skipped",
  TODO: "Open",
} as const;

/** A recurring task's earlier occurrences, newest first: "Done 1 Nov 2026", "Skipped 1 Nov 2025". */
function SeriesHistory({ task }: { task: Task }) {
  const occurrences = useQuery(occurrencesQuery(task.id)).data ?? [];
  const earlier = occurrences.filter((o) => o.id !== task.id).reverse();
  if (earlier.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className={label}>History</span>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {earlier.slice(0, 8).map((o) => {
          const day = o.slotDate ?? o.dueDate;
          return (
            <li key={o.id}>
              {STATUS_WORD[o.status]}
              {day ? ` · ${fullDay(day)}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
/**
 * Create or edit a task. The shell remounts it
 * on every open (keyed by taskActions.editSeq), so the fields seed from `task`.
 */
export function TaskFormSheet({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
}) {
  const goals = useGoals();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [important, setImportant] = useState(task?.important ?? false);
  const [urgent, setUrgent] = useState(task?.urgent ?? false);
  const [proactivity, setProactivity] = useState<Proactivity | "">(
    task?.proactivity ?? "",
  );
  const [goalId, setGoalId] = useState(task?.goalId ?? "");
  const [dueDate, setDueDate] = useState(
    task?.dueDate ? task.dueDate.slice(0, 10) : "",
  );
  // Recurrence (#105): an ended series reads as "does not repeat".
  const rule = task?.recurrence?.active ? task.recurrence : null;
  const [unit, setUnit] = useState<CadenceUnit | "">(rule?.unit ?? "");
  const [every, setEvery] = useState(String(rule?.every ?? 1));
  const [from, setFrom] = useState<"SCHEDULE" | "COMPLETION">(
    rule?.from ?? "SCHEDULE",
  );
  const [lead, setLead] = useState(
    rule?.leadDays != null ? String(rule.leadDays) : "",
  );
  const [submitting, setSubmitting] = useState(false);

  const repeating = unit !== "";
  // A repeating task needs a date to repeat: the due date, or a day it is scheduled on.
  const needsDate = repeating && !dueDate && !task?.scheduledDay;
  const everyN = Math.max(1, Math.min(999, Math.round(Number(every)) || 1));
  const plural = UNITS.find((u) => u.value === unit)?.noun ?? "";
  const unitNoun = everyN === 1 ? plural.slice(0, -1) : plural;
  const leadN =
    lead.trim() === ""
      ? null
      : Math.max(0, Math.min(365, Math.round(Number(lead)) || 0));
  const recurrence: RecurrenceBody | null = repeating
    ? { unit, every: everyN, from, leadDays: leadN }
    : null;
  const before: RecurrenceBody | null = rule
    ? {
        unit: rule.unit,
        every: rule.every,
        from: rule.from,
        leadDays: rule.leadDays,
      }
    : null;
  const ruleChanged = !sameRule(recurrence, before);
  const canSkip = !!task && task.status === "TODO" && !!rule;

  function chooseUnit(next: CadenceUnit | "") {
    // Suggest a lead when starting to repeat; never overwrite one already typed.
    if (next && !repeating && lead === "") {
      const suggested = SUGGESTED_LEAD[next];
      if (suggested !== undefined) setLead(String(suggested));
    }
    setUnit(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || submitting || needsDate) return;
    setSubmitting(true);
    const body = {
      title: t,
      notes: notes.trim() || null,
      important,
      urgent,
      proactivity: (proactivity || null) as Proactivity | null,
      goalId: goalId || null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    };
    if (task) {
      // Left out when unchanged: an edit then applies to this occurrence only.
      await taskWrites.update(
        task,
        ruleChanged ? { ...body, recurrence } : body,
      );
    } else {
      await taskWrites.add({
        title: t,
        notes: body.notes ?? undefined,
        important,
        urgent,
        proactivity: body.proactivity ?? undefined,
        goalId: body.goalId ?? undefined,
        dueDate: body.dueDate ?? undefined,
        ...(recurrence ? { recurrence } : {}),
      });
    }
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Edit task" : "New task"}
      description={
        rule
          ? "This repeats. Edits apply to this occurrence; a changed rule applies from this one on."
          : "Quadrant is derived from importance × urgency."
      }
      footer={
        <div className="flex justify-end gap-2">
          {canSkip ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                void taskWrites.skip(task);
                onOpenChange(false);
              }}
            >
              Skip this one
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="task-form"
            size="sm"
            disabled={submitting || !title.trim() || needsDate}
          >
            {task ? "Save" : "Add task"}
          </Button>
        </div>
      }
    >
      <form id="task-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={label}>Title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional details…"
            className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Priority</span>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={important}
              onClick={() => setImportant(!important)}
              className={cn(toggle, chip(important))}
            >
              Important
            </button>
            <button
              type="button"
              aria-pressed={urgent}
              onClick={() => setUrgent(!urgent)}
              className={cn(toggle, chip(urgent))}
            >
              Urgent
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Proactivity (Habit 1)</span>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={proactivity === "INFLUENCE"}
              onClick={() =>
                setProactivity(proactivity === "INFLUENCE" ? "" : "INFLUENCE")
              }
              className={cn(toggle, chip(proactivity === "INFLUENCE"))}
            >
              Influence
            </button>
            <button
              type="button"
              aria-pressed={proactivity === "CONCERN"}
              onClick={() =>
                setProactivity(proactivity === "CONCERN" ? "" : "CONCERN")
              }
              className={cn(toggle, chip(proactivity === "CONCERN"))}
            >
              Concern
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Goal (Habit 2)</span>
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-2 text-sm"
          >
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Due date</span>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Repeats</span>
            <select
              value={unit}
              onChange={(e) => chooseUnit(e.target.value as CadenceUnit | "")}
              className={field}
            >
              <option value="">Does not repeat</option>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          {repeating ? (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className={label}>Every</span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={999}
                      value={every}
                      onChange={(e) => setEvery(e.target.value)}
                      className="w-20"
                    />
                    {unitNoun}
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Counted from</span>
                  <select
                    value={from}
                    onChange={(e) =>
                      setFrom(e.target.value as "SCHEDULE" | "COMPLETION")
                    }
                    className={field}
                  >
                    <option value="SCHEDULE">the schedule</option>
                    <option value="COMPLETION">when I complete it</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className={label}>Show from (days before it is due)</span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    value={lead}
                    onChange={(e) => setLead(e.target.value)}
                    placeholder="—"
                    className="w-20"
                  />
                  {lead.trim() === ""
                    ? "shown as soon as it is created"
                    : "days before"}
                </span>
              </label>
              <p className="text-xs text-muted-foreground italic">
                Seasons aren’t dates: pick the day it usually starts.
              </p>
              {needsDate ? (
                <p role="alert" className="text-xs text-[var(--terra)]">
                  A repeating task needs a due date (or a day in the Week).
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {task?.seriesId ? <SeriesHistory task={task} /> : null}
      </form>
    </AppSheet>
  );
}
