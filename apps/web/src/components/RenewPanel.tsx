import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { HabitView, RenewalDimension } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/stores/store";
import { DIMENSIONS, DIMENSION_META, cadenceText, renewalStore } from "@/lib/stores/renewal";
import { goalsStore } from "@/lib/stores/goals";

const inputCls =
  "rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const linkCls = "text-xs font-semibold text-muted-foreground hover:text-foreground";

function HabitRow({ habit }: { habit: HabitView }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-dotted border-border py-2">
      <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">{habit.name}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-foreground/70">
        {cadenceText(habit.targetPerWeek)}
      </span>
      {habit.goalTitle ? (
        <span className="hidden truncate text-[0.6875rem] text-muted-foreground sm:inline">
          ↳ {habit.goalTitle}
        </span>
      ) : null}
      <span className="text-[0.6875rem] text-muted-foreground">
        {habit.doneThisWeek}/{habit.targetPerWeek} wk
      </span>
      <button
        type="button"
        onClick={() => void renewalStore.remove(habit)}
        aria-label="Delete habit"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

/** Compass · Renew: habits defined per dimension, intentions, one-offs. */
export function RenewPanel() {
  const { habits, intentions, loading, error } = useStore(renewalStore);
  const goals = useStore(goalsStore, (s) => s.goals);
  // Per-dimension add-habit mini form.
  const [addingFor, setAddingFor] = useState<RenewalDimension | "NONE" | null>(null);
  const [hName, setHName] = useState("");
  const [hTarget, setHTarget] = useState(7);
  const [hGoalId, setHGoalId] = useState("");
  // One-off activity mini form.
  const [loggingFor, setLoggingFor] = useState<RenewalDimension | null>(null);
  const [aTitle, setATitle] = useState("");
  // Weekly intention inline editor.
  const [editingIntention, setEditingIntention] = useState<RenewalDimension | null>(null);
  const [iText, setIText] = useState("");

  const loadingFirst = loading && habits.length === 0;
  const habitsOf = (dimension: RenewalDimension | null) =>
    habits.filter((h) => h.dimension === dimension);
  const untagged = habitsOf(null);

  function saveIntention(dimension: RenewalDimension) {
    void renewalStore.setIntention(dimension, iText);
    setEditingIntention(null);
  }

  async function addHabit(dimension: RenewalDimension | null) {
    const name = hName.trim();
    if (!name) return;
    await renewalStore.add({
      name,
      dimension: dimension ?? undefined,
      targetPerWeek: hTarget,
      goalId: hGoalId || undefined,
    });
    setAddingFor(null);
    setHName("");
    setHTarget(7);
    setHGoalId("");
  }

  async function logActivity(dimension: RenewalDimension) {
    const title = aTitle.trim();
    if (!title) return;
    await renewalStore.logActivity({ dimension, title });
    setLoggingFor(null);
    setATitle("");
  }

  const addForm = (dimension: RenewalDimension | null) => (
    <div className="flex flex-col gap-2 border-t border-dotted border-border pt-2">
      <input
        value={hName}
        onChange={(e) => setHName(e.target.value)}
        placeholder="A recurring practice that renews you…"
        onKeyDown={(e) => {
          if (e.key === "Enter") void addHabit(dimension);
        }}
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={hTarget}
          onChange={(e) => setHTarget(Number(e.target.value))}
          aria-label="Target per week"
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        >
          <option value={7}>daily</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}×/week
            </option>
          ))}
        </select>
        {goals.length > 0 ? (
          <select
            value={hGoalId}
            onChange={(e) => setHGoalId(e.target.value)}
            aria-label="Link to goal"
            className="max-w-36 truncate rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground"
          >
            <option value="">— no goal —</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setAddingFor(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void addHabit(dimension)} disabled={!hName.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void renewalStore.load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loadingFirst ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
            {DIMENSIONS.map((dimension) => {
              const meta = DIMENSION_META[dimension];
              const own = habitsOf(dimension);
              const intention = intentions[dimension];
              return (
                <div
                  key={dimension}
                  className="flex flex-col rounded-xl border border-border bg-card p-3.5 shadow-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="size-3 rounded-full" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[0.9375rem] font-semibold">{meta.label}</p>
                      <p className="text-[0.6875rem] text-muted-foreground">{meta.sub}</p>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    {own.length === 0 ? (
                      <p className="border-t border-dotted border-border py-2 font-display text-xs text-muted-foreground italic">
                        No habits tagged here yet.
                      </p>
                    ) : (
                      own.map((habit) => <HabitRow key={habit.id} habit={habit} />)
                    )}
                  </div>

                  {/* This week's intention: intent, never scored. */}
                  {editingIntention === dimension ? (
                    <div className="flex gap-2 border-t border-dotted border-border pt-2">
                      <input
                        value={iText}
                        onChange={(e) => setIText(e.target.value)}
                        placeholder="How will you renew here this week?"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveIntention(dimension);
                        }}
                        className="flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-display text-sm italic focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      />
                      <Button size="sm" onClick={() => saveIntention(dimension)}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIntention(dimension);
                        setIText(intention ?? "");
                      }}
                      className={cn(
                        "border-t border-dotted border-border pt-2 text-left font-display text-[0.78125rem] italic hover:text-foreground",
                        intention ? "text-muted-foreground" : "text-input",
                      )}
                    >
                      {intention ? `This week: ${intention}` : "Set this week's intention…"}
                    </button>
                  )}

                  {addingFor === dimension ? (
                    addForm(dimension)
                  ) : loggingFor === dimension ? (
                    <div className="flex gap-2 border-t border-dotted border-border pt-2">
                      <input
                        value={aTitle}
                        onChange={(e) => setATitle(e.target.value)}
                        placeholder="A one-off — a retreat, a long hike…"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void logActivity(dimension);
                        }}
                        className={cn("flex-1", inputCls)}
                      />
                      <Button variant="outline" size="sm" onClick={() => setLoggingFor(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void logActivity(dimension)}
                        disabled={!aTitle.trim()}
                      >
                        Log
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingFor(dimension);
                          setHName("");
                        }}
                        className={linkCls}
                      >
                        ＋ habit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLoggingFor(dimension);
                          setATitle("");
                        }}
                        className={linkCls}
                      >
                        ＋ one-off
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {untagged.length > 0 || addingFor === "NONE" ? (
            <div className="rounded-xl border border-dashed border-input bg-secondary/40 p-3.5">
              <p className="font-display text-[0.875rem] font-semibold">Untagged habits</p>
              <p className="text-[0.6875rem] text-muted-foreground">
                Fine as they are — they simply don't count toward a dimension.
              </p>
              <div className="mt-1">
                {untagged.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} />
                ))}
              </div>
              {addingFor === "NONE" ? addForm(null) : null}
            </div>
          ) : null}

          {addingFor !== "NONE" ? (
            <button
              type="button"
              onClick={() => {
                setAddingFor("NONE");
                setHName("");
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4" />
              Habit without a dimension
            </button>
          ) : null}

          <p className="font-display text-xs text-muted-foreground italic">
            Habits are defined here; check them off in Clock · Today, and the Almanac keeps the
            record.
          </p>
        </>
      )}
    </section>
  );
}
