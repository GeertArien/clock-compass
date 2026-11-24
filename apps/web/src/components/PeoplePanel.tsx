import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Heart, Plus, Star, Trash2 } from "lucide-react";
import type {
  CadenceUnit,
  CommitmentStatus,
  PersonOverview,
} from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { loadError } from "@/lib/queries/load-error";
import {
  addCommitment as addCommitmentMutation,
  addEba as addEbaMutation,
  addPerson as addPersonMutation,
  cadenceLabel,
  logCommitment,
  peopleQuery,
  removeCommitment,
  removePerson,
} from "@/lib/queries/people";
import { currentTasks, taskWrites } from "@/lib/queries/tasks";
import { useSheet } from "./use-sheet";

const AVATAR_COLORS = ["var(--terra)", "var(--pine)", "var(--gold)", "var(--plum)"];
function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function worstStatus(person: PersonOverview): CommitmentStatus | null {
  if (person.commitments.length === 0) return null;
  if (person.commitments.some((c) => c.status === "OVERDUE")) return "OVERDUE";
  if (person.commitments.some((c) => c.status === "DUE_SOON")) return "DUE_SOON";
  return "ON_TRACK";
}

const STATUS_META: Record<CommitmentStatus, { label: string; cls: string }> = {
  ON_TRACK: { label: "on track", cls: "bg-[var(--pine-soft)] text-[var(--pine)]" },
  DUE_SOON: { label: "due soon", cls: "bg-[var(--gold-soft)] text-[var(--gold)]" },
  OVERDUE: { label: "overdue", cls: "bg-[var(--over,#a32d2d)] text-white" },
};

function relativeDays(iso: string | null): string {
  if (!iso) return "never logged";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

const field =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Habit 3 meets Habits 4–6: plan the commitment as a starred Q2 task. */
function planAsRock(person: PersonOverview, title: string) {
  const full = `${title} — ${person.name}`;
  void taskWrites.add({ title: full, important: true }).then(() => {
    const created = currentTasks().find((t) => t.title === full && !t.isBigRock);
    if (created) void taskWrites.toggleBigRock(created);
  });
}


const NO_PEOPLE: PersonOverview[] = [];

/** Compass · People: commitments on cadence + the emotional bank account. */
export function PeoplePanel() {
  const query = useQuery(peopleQuery);
  const people = query.data ?? NO_PEOPLE;
  // A failed reload after a write is a toast instead (see people.ts).
  const error = loadError(query, "Failed to load people");
  const ebaWrite = useMutation(addEbaMutation);
  const personAdd = useMutation(addPersonMutation);
  const personRemove = useMutation(removePerson);
  const commitmentAdd = useMutation(addCommitmentMutation);
  const commitmentRemove = useMutation(removeCommitment);
  const log = useMutation(logCommitment);

  /** An EBA entry, with the note asked for via window.prompt. */
  function addEba(person: PersonOverview, kind: "DEPOSIT" | "WITHDRAWAL") {
    const note = prompt(
      kind === "DEPOSIT" ? "What happened? (deposit)" : "What happened? (withdrawal)",
    );
    if (note !== null) ebaWrite.mutate({ personId: person.id, kind, note: note || undefined });
  }
  const removing = useSheet<PersonOverview>();
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] = useState("");
  // Per-person add-commitment mini-form state.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [cTitle, setCTitle] = useState("");
  const [cUnit, setCUnit] = useState<CadenceUnit>("WEEK");
  const [cValue, setCValue] = useState(1);

  const loadingFirst = query.isFetching && query.data === undefined;

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    await personAdd
      .mutateAsync({ name, relationship: newRelationship.trim() || undefined })
      .catch(() => {});
    setNewName("");
    setNewRelationship("");
  }

  async function addCommitment(person: PersonOverview) {
    const title = cTitle.trim();
    if (!title) return;
    await commitmentAdd
      .mutateAsync({ title, cadenceUnit: cUnit, cadenceValue: cValue, personIds: [person.id] })
      .catch(() => {});
    setAddingFor(null);
    setCTitle("");
    setCUnit("WEEK");
    setCValue(1);
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        {error ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        {loadingFirst ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : people.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="No one tracked yet"
            hint="Add the people who matter, then give each a recurring commitment — date night, the monthly one-on-one, the weekly call."
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
            {people.map((person) => {
              const status = worstStatus(person);
              return (
                <div
                  key={person.id}
                  className={cn(
                    "flex flex-col rounded-xl border bg-card p-3.5 shadow-sm",
                    status === "OVERDUE" ? "border-[var(--terra)]/40" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full font-display text-base font-semibold text-white"
                      style={{ background: avatarColor(person.name) }}
                    >
                      {person.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[0.9375rem] font-semibold">{person.name}</p>
                      {person.relationship ? (
                        <p className="text-xs text-muted-foreground">{person.relationship}</p>
                      ) : null}
                    </div>
                    {status ? (
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold",
                          STATUS_META[status].cls,
                        )}
                      >
                        {STATUS_META[status].label}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 font-display text-[0.8125rem] font-semibold",
                        person.balance >= 0
                          ? "bg-[var(--pine-soft)] text-[var(--pine)]"
                          : "bg-[var(--terra-soft)] text-[var(--terra)]",
                      )}
                      title="Emotional bank account balance"
                    >
                      {person.balance > 0 ? "+" : ""}
                      {person.balance}
                    </span>
                    <button
                      type="button"
                      onClick={() => removing.show(person)}
                      aria-label="Remove person"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {person.commitments.map((commitment) => (
                    <div
                      key={commitment.id}
                      className="mt-3 border-t border-dotted border-border pt-2.5"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-[0.8125rem] font-semibold">{commitment.title}</span>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {cadenceLabel(commitment.cadenceUnit, commitment.cadenceValue)}
                        </span>
                        <button
                          type="button"
                          onClick={() => commitmentRemove.mutate(commitment.id)}
                          aria-label="Remove commitment"
                          className="ml-auto text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        {commitment.history.map((hit, i) => (
                          <span
                            key={i}
                            className={cn(
                              "size-3.5 rounded-[4px] border",
                              hit
                                ? "border-[var(--pine)] bg-[var(--pine)]"
                                : "border-border bg-[var(--terra-soft)]",
                            )}
                          />
                        ))}
                        <span className="ml-auto text-[0.6875rem] text-muted-foreground">
                          last · {relativeDays(commitment.lastOccurredAt)}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => log.mutate({ commitmentId: commitment.id, personId: person.id })}
                        >
                          Log occurrence
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => planAsRock(person, commitment.title)}
                        >
                          <Star className="size-4" />
                          Plan as big rock
                        </Button>
                      </div>
                    </div>
                  ))}

                  {addingFor === person.id ? (
                    <div className="mt-3 flex flex-col gap-2 border-t border-dotted border-border pt-2.5">
                      <input
                        value={cTitle}
                        onChange={(e) => setCTitle(e.target.value)}
                        placeholder="A commitment — date night, one-on-one…"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addCommitment(person);
                        }}
                        className="rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">every</span>
                        <input
                          type="number"
                          value={cValue}
                          onChange={(e) => setCValue(Number(e.target.value))}
                          min={1}
                          max={12}
                          aria-label="Cadence"
                          className="w-14 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                        />
                        <select
                          value={cUnit}
                          onChange={(e) => setCUnit(e.target.value as CadenceUnit)}
                          aria-label="Cadence unit"
                          className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                        >
                          <option value="DAY">day(s)</option>
                          <option value="WEEK">week(s)</option>
                          <option value="MONTH">month(s)</option>
                          <option value="YEAR">year(s)</option>
                        </select>
                        <div className="ml-auto flex gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setAddingFor(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void addCommitment(person)}
                            disabled={!cTitle.trim()}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingFor(person.id);
                        setCTitle("");
                      }}
                      className="mt-3 self-start text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      ＋ commitment
                    </button>
                  )}

                  {/* Emotional bank account */}
                  <details className="mt-2.5 border-t border-dotted border-border pt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                      Bank account · {person.balance > 0 ? "+" : ""}
                      {person.balance}
                    </summary>
                    <div className="mt-2 flex flex-col gap-1">
                      {person.ledger.length === 0 ? (
                        <p className="font-display text-xs text-muted-foreground italic">
                          No entries yet.
                        </p>
                      ) : (
                        person.ledger.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex gap-2 border-b border-dotted border-border pb-1 text-xs last:border-b-0"
                          >
                            <span
                              className={cn(
                                "w-5 font-bold",
                                entry.kind === "DEPOSIT"
                                  ? "text-[var(--pine)]"
                                  : "text-[var(--terra)]",
                              )}
                            >
                              {entry.kind === "DEPOSIT" ? "+1" : "−1"}
                            </span>
                            <span className="flex-1 text-foreground/80">
                              {entry.note ?? "(no note)"}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(entry.occurredAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="mt-1.5 flex gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => addEba(person, "DEPOSIT")}>
                          + Deposit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addEba(person, "WITHDRAWAL")}
                        >
                          − Withdrawal
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        {/* Add a person */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a person who matters…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addPerson();
            }}
            className={cn("flex-1", field)}
          />
          <input
            value={newRelationship}
            onChange={(e) => setNewRelationship(e.target.value)}
            placeholder="relationship (kid, spouse…)"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addPerson();
            }}
            className={cn(field, "sm:w-48")}
          />
          <Button size="sm" onClick={() => void addPerson()} disabled={!newName.trim()}>
            <Plus className="size-4" />
            Person
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={removing.open}
        onOpenChange={removing.setOpen}
        title="Remove person?"
        description={
          removing.item
            ? `“${removing.item.name}” and their bank-account entries will be removed.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removing.item) personRemove.mutate(removing.item.id);
        }}
      />
    </>
  );
}
