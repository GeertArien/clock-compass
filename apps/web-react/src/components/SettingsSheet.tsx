import { useState } from "react";
import { getToken, setToken } from "@clock-compass/web-client/token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/stores/toast";

export type Health = "checking" | "ok" | "down";

const STATUS: Record<Health, { label: string; dot: string; text: string }> = {
  ok: { label: "Connected", dot: "bg-[var(--pine)]", text: "text-[var(--pine)]" },
  down: { label: "Unreachable", dot: "bg-[var(--terra)]", text: "text-[var(--terra)]" },
  checking: { label: "Checking…", dot: "bg-[var(--gold)]", text: "text-[var(--gold)]" },
};

/**
 * Settings, phase 0 slice (issue #64): backend health and the API token. Agent
 * keys, AI provider status, notifications and the Todoist import arrive with
 * phase 4, ported from apps/web's SettingsSheet.
 */
export function SettingsSheet({
  open,
  onOpenChange,
  health,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  health: Health;
  onSaved: () => void;
}) {
  // The parent remounts this sheet on each open, so this re-reads the stored token.
  const [tokenInput, setTokenInput] = useState(getToken);
  const status = STATUS[health];

  function save() {
    const value = tokenInput.trim();
    setToken(value);
    toast.success(value ? "Token saved" : "Token cleared");
    onOpenChange(false);
    onSaved();
  }

  function clear() {
    setTokenInput("");
    setToken("");
    toast.success("Token cleared");
    onSaved();
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Connection, API access, and agents."
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <span className="text-sm font-medium">Backend</span>
          <span className={cn("flex items-center gap-2 text-sm", status.text)}>
            <span className={cn("size-2 rounded-full", status.dot)} />
            {status.label}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="api-token" className="text-sm font-medium">
            API token
          </label>
          <p className="text-xs text-muted-foreground">
            Only needed if the server sets <code>API_AUTH_TOKEN</code>. Stored locally in this
            browser and sent as a bearer token.
          </p>
          <Input
            id="api-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="paste bearer token"
          />
        </div>
      </div>
    </AppSheet>
  );
}
