import { useState, type FormEvent } from "react";
import type { Goal, GoalStatus } from "@clock-compass/web-client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { useStore } from "@/lib/stores/store";
import { GOAL_STATUS_LABELS, goalsStore } from "@/lib/stores/goals";
import { rolesStore } from "@/lib/stores/roles";

const statuses: GoalStatus[] = ["ACTIVE", "ON_HOLD", "ACHIEVED", "DROPPED"];
const label = "text-xs font-medium text-muted-foreground";

/** Create or edit a goal. Remounted on every open, so it seeds from `goal`. */
export function GoalFormSheet({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal | null;
}) {
  const roles = useStore(rolesStore, (s) => s.roles);
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "ACTIVE");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ? goal.targetDate.slice(0, 10) : "");
  const [roleId, setRoleId] = useState(goal?.roleId ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    const date = targetDate ? new Date(targetDate).toISOString() : null;
    if (goal) {
      await goalsStore.update(goal, {
        title: t,
        description: description.trim() || null,
        status,
        targetDate: date,
        roleId: roleId || null,
      });
    } else {
      await goalsStore.add({
        title: t,
        description: description.trim() || undefined,
        status,
        targetDate: date ?? undefined,
        roleId: roleId || undefined,
      });
    }
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? "Edit goal" : "New goal"}
      description="A durable outcome. Progress is derived from its tasks."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="goal-form" size="sm" disabled={submitting || !title.trim()}>
            {goal ? "Save" : "Add goal"}
          </Button>
        </div>
      }
    >
      <form id="goal-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={label}>Title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What outcome do you want?"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional context…"
            className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as GoalStatus)}
            className="rounded-md border border-border bg-transparent px-2 py-2 text-sm"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {GOAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Target date</span>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </label>

        {roles.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className={label}>Role</span>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-2 text-sm"
            >
              <option value="">— no role —</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </form>
    </AppSheet>
  );
}
