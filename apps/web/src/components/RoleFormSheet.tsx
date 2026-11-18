import { useState, type FormEvent } from "react";
import type { Role } from "@clock-compass/web-client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { rolesStore } from "@/lib/stores/roles";

const label = "text-xs font-medium text-muted-foreground";

/** Edit a role's name and mission line. Remounted on every open. */
export function RoleFormSheet({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role | null;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [mission, setMission] = useState(role?.mission ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !role || submitting) return;
    setSubmitting(true);
    await rolesStore.update(role, { name: n, mission: mission.trim() || null });
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit role"
      description="A part you play in life, with an optional per-role mission line."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" size="sm" disabled={submitting || !name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <form id="role-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Parent, Professional, Self…"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Mission</span>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={2}
            placeholder="A short line for this role — “Present, not just around.”"
            className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
      </form>
    </AppSheet>
  );
}
