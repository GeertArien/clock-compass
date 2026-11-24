import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Copy, Download, ExternalLink, KeyRound, Plus, Upload } from "lucide-react";
import { getToken, setToken } from "@clock-compass/web-client/token";
import {
  createApiKey,
  exportBackup,
  importTodoist,
  listApiKeys,
  revokeApiKey,
  type ApiKeyView,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { projectNameFromEntry, unzipCsvFiles } from "@clock-compass/web-client/zip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSheet } from "@/components/ui/app-sheet";
import { CodexConnect } from "@/components/CodexConnect";
import { NotificationSettings } from "@/components/NotificationSettings";
import { ThemeSetting } from "@/components/ThemeSetting";
import { copyText as copy } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useAiStatus } from "@/lib/queries/ai";
import { reloadTasks } from "@/lib/queries/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { refreshProjects } from "@/lib/queries/projects";
import { toast } from "@/lib/stores/toast";

export type Health = "checking" | "ok" | "down";

const STATUS: Record<Health, { label: string; dot: string; text: string }> = {
  ok: { label: "Connected", dot: "bg-[var(--pine)]", text: "text-[var(--pine)]" },
  down: { label: "Unreachable", dot: "bg-[var(--terra)]", text: "text-[var(--terra)]" },
  checking: { label: "Checking…", dot: "bg-[var(--gold)]", text: "text-[var(--gold)]" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isZip = (file: File) => /\.zip$/i.test(file.name);

/** Import a full-account backup: each CSV entry becomes its own project. */
async function importZip(file: File): Promise<string> {
  const entries = await unzipCsvFiles(file);
  if (entries.length === 0) throw new Error("No CSV files found in the zip");
  let imported = 0;
  let skipped = 0;
  let projects = 0;
  let failedFiles = 0;
  for (const entry of entries) {
    try {
      const result = await importTodoist(entry.text, projectNameFromEntry(entry.name) || undefined);
      imported += result.imported;
      skipped += result.skipped;
      if (result.imported > 0) projects++;
    } catch {
      // A CSV that isn't a Todoist export (or a failed request) shouldn't
      // abort the whole backup — count it and keep going.
      failedFiles++;
    }
  }
  if (imported === 0 && failedFiles === entries.length) {
    throw new Error("No importable Todoist CSVs in the zip");
  }
  return (
    `Imported ${plural(imported, "task")} across ${plural(projects, "project")}` +
    (skipped ? ` (${skipped} skipped)` : "") +
    (failedFiles ? ` — ${plural(failedFiles, "file")} ignored` : "")
  );
}

/**
 * Settings: connection, AI provider, API token, agent keys, notifications,
 * data export and the Todoist import. The parent remounts this sheet on each
 * open, so everything here (token, keys, push and Codex status) reloads then.
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
  const [tokenInput, setTokenInput] = useState(getToken);
  const status = STATUS[health];
  const ai = useAiStatus();
  const queryClient = useQueryClient();
  // The parent remounts this sheet on each open, so an instance created open
  // is the live one; it keeps its sections mounted through the exit animation
  // (and Codex polling running) after close. The initial closed instance
  // never opens, so it loads nothing.
  const [live] = useState(open);

  // --- Agent & service access ---------------------------------------------
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [keysError, setKeysError] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  /** Plaintext of a freshly created key — visible exactly once. */
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const loadKeys = () =>
    listApiKeys().then(
      (list) => {
        setKeys(list);
        setKeysError(false);
      },
      () => setKeysError(true),
    );

  useEffect(() => {
    if (open) void loadKeys();
  }, [open]);

  async function addKey() {
    const name = newKeyName.trim();
    if (!name) return;
    try {
      const created = await createApiKey(name);
      setFreshKey(created.key);
      setNewKeyName("");
      void loadKeys();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to create key"));
    }
  }

  async function revoke(key: ApiKeyView) {
    try {
      await revokeApiKey(key.id);
      toast.success(`“${key.name}” revoked`);
      void loadKeys();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to revoke key"));
    }
  }

  // --- Todoist import -------------------------------------------------------
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProject, setImportProject] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** A full-account backup: one CSV per project — no single project name. */
  const importIsZip = !!importFile && isZip(importFile);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0] ?? null;
    setImportFile(file);
    // Suggest the file name as the project (minus the " [id]" suffix Todoist
    // appends in backup zips); the user can edit or clear it. Zips carry their
    // own per-file project names, so no suggestion there.
    setImportProject(
      file && !isZip(file) ? file.name.replace(/\.csv$/i, "").replace(/ \[[^\]]+\]$/, "") : "",
    );
  }

  async function runImport() {
    if (!importFile || importing) return;
    setImporting(true);
    try {
      if (importIsZip) {
        toast.success(await importZip(importFile));
      } else {
        const csv = await importFile.text();
        const result = await importTodoist(csv, importProject.trim() || undefined);
        toast.success(
          `Imported ${plural(result.imported, "task")}` +
            (result.skipped ? ` (${result.skipped} skipped)` : ""),
        );
      }
      setImportFile(null);
      setImportProject("");
      // Clear the picker too, so it drops the old name and re-picking the
      // same (re-exported) file fires a change again.
      if (fileInput.current) fileInput.current.value = "";
      void reloadTasks();
      void refreshProjects(queryClient);
    } catch (err) {
      toast.error(errorMessage(err, "Import failed"));
    } finally {
      setImporting(false);
    }
  }

  // --- Data export (full JSON backup) --------------------------------------
  const [exporting, setExporting] = useState(false);

  async function downloadBackup() {
    if (exporting) return;
    setExporting(true);
    try {
      const bundle = await exportBackup();
      const date = bundle.exportedAt.slice(0, 10); // YYYY-MM-DD
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clock-compass-backup-${date}.json`;
      a.click();
      // Revoking synchronously can cancel the download (Safari / iOS PWA).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Backup downloaded");
    } catch (err) {
      toast.error(errorMessage(err, "Export failed"));
    } finally {
      setExporting(false);
    }
  }

  // AI badge: connected (any provider) reads green; a sign-in provider that
  // isn't connected yet points at the card below; otherwise prompt for a key.
  const aiBadge = ai.connected
    ? { label: "Connected", on: true }
    : ai.oauth
      ? { label: "Sign in below", on: false }
      : { label: "Set ANTHROPIC_API_KEY", on: false };

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
      description="Appearance, connection, API access, and agents."
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
        <ThemeSetting />

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <span className="text-sm font-medium">Backend</span>
          <span className={cn("flex items-center gap-2 text-sm", status.text)}>
            <span className={cn("size-2 rounded-full", status.dot)} />
            {status.label}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <span className="text-sm font-medium">AI assistant</span>
            <p className="text-xs text-muted-foreground">
              Capture preview, mission refine, weekly review.
            </p>
          </div>
          <span
            className={cn(
              "flex shrink-0 items-center gap-2 text-sm",
              aiBadge.on ? "text-[var(--pine)]" : "text-muted-foreground",
            )}
          >
            <span
              className={cn("size-2 rounded-full", aiBadge.on ? "bg-[var(--pine)]" : "bg-input")}
            />
            {aiBadge.label}
          </span>
        </div>

        {live && ai.oauth && <CodexConnect />}

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

        {/* Agent & service access */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Agent &amp; service access</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Named API keys for agents and services. The REST API is the source of truth; the MCP
            server wraps the same services.
          </p>

          {freshKey && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--pine)] bg-[var(--pine-soft)] p-2.5">
              <p className="text-xs font-semibold text-[var(--pine)]">
                Copy this key now — it won't be shown again.
              </p>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 font-mono text-[0.6875rem]">
                  {freshKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(freshKey, "Key")}
                  aria-label="Copy key"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {keysError ? (
            <p className="text-xs text-[var(--terra)]">Couldn't load keys — check the token above.</p>
          ) : (
            keys.map((key) => (
              <div
                key={key.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border px-2.5 py-2",
                  key.revokedAt && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[0.8125rem] font-medium",
                      key.revokedAt && "line-through",
                    )}
                  >
                    {key.name}
                  </p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {key.revokedAt
                      ? `revoked ${new Date(key.revokedAt).toLocaleDateString()}`
                      : key.lastUsedAt
                        ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                        : "never used"}
                  </p>
                </div>
                {!key.revokedAt && (
                  <Button variant="outline" size="sm" onClick={() => void revoke(key)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))
          )}

          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="key name — “Claude · planning agent”"
              onKeyDown={(e) => {
                if (e.key === "Enter") void addKey();
              }}
            />
            <Button size="sm" onClick={() => void addKey()} disabled={!newKeyName.trim()}>
              <Plus className="size-4" />
              Key
            </Button>
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open("/docs", "_blank")}>
              <ExternalLink className="size-4" />
              API docs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy("pnpm --filter @clock-compass/mcp start", "MCP command")}
            >
              <Copy className="size-4" />
              MCP command
            </Button>
          </div>
        </div>

        {live && <NotificationSettings />}

        {/* Data export: a full JSON backup of everything (no secrets). */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Download className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Export your data</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Download a full <b>JSON backup</b> of your tasks, goals, projects, people, habits and
            renewal. API keys and push subscriptions are never included.
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadBackup()}
              disabled={exporting}
            >
              <Download className="size-4" />
              {exporting ? "Preparing…" : "Download backup"}
            </Button>
          </div>
        </div>

        {/* Todoist import: a one-shot file upload, no credentials stored. */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Import from Todoist</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a Todoist <b>CSV export</b> (per-project) or a full-account <b>backup .zip</b> —
            each project CSV becomes its own project. p1–p4 seed importance/urgency; nothing
            Todoist-related is stored on the server.
          </p>
          <input
            type="file"
            accept=".csv,text/csv,.zip,application/zip"
            aria-label="Todoist export file"
            ref={fileInput}
            onChange={pickFile}
            className="rounded-lg border border-dashed border-input bg-secondary/40 p-3 text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground"
          />
          {importFile && (
            <div className="flex gap-2">
              {importIsZip ? (
                <p className="flex-1 self-center text-xs text-muted-foreground">
                  Backup zip — importing every project it contains.
                </p>
              ) : (
                <Input
                  value={importProject}
                  onChange={(e) => setImportProject(e.target.value)}
                  placeholder="project name (blank = Inbox)"
                />
              )}
              <Button size="sm" onClick={() => void runImport()} disabled={importing}>
                {importing ? "Importing…" : "Import"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppSheet>
  );
}
