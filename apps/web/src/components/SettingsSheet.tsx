import { Suspense, lazy, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Plus, Upload } from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NotificationSettings } from "@/components/NotificationSettings";
import { AboutVersion } from "@/components/AboutVersion";
import { ThemeSetting } from "@/components/ThemeSetting";
import { reportZoneNow } from "@/lib/time-zone";
import { copyText as copy } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useAiStatus } from "@/lib/queries/ai";
import { reloadTasks } from "@/lib/queries/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { refreshProjects } from "@/lib/queries/projects";
import { toast } from "@/lib/stores/toast";
import { useStore } from "@/lib/stores/store";
import {
  SETTINGS_SECTIONS,
  isSettingsSection,
  settingsStore,
  stepSection,
  type SettingsSection,
} from "@/lib/stores/settings";
import { themeStore, type ThemeChoice } from "@/lib/theme";
import { useHistoryLayer } from "@/lib/use-history-layer";
import { useMediaQuery } from "@/lib/use-media-query";

// Loaded with the Settings sheet's first open, not with the app.
const AiSettingsSection = lazy(() => import("@/components/AiSettingsSection").then((m) => ({ default: m.AiSettingsSection })));

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
 * Settings in six sections (#141): General, Connection, AI, Agents,
 * Notifications, Data. On a phone, a list that opens one section at a time
 * (back goes to the list); on desktop, the list beside the open section.
 * Every form saves by itself; closing with typing not saved asks once.
 * Opened with `openSettings(section?)` (lib/stores/settings). The parent
 * remounts the sheet on each open, so everything here (token, keys, push and
 * Codex status) reloads then.
 */
export function SettingsSheet({ health, onSaved }: { health: Health; onSaved: () => void }) {
  const open = useStore(settingsStore).open;
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

  const state = useStore(settingsStore);
  const wide = useMediaQuery("(min-width: 640px)");
  const { choice: themeChoice } = useStore(themeStore);
  /** The section shown: on a phone null is the list; on desktop the first section. */
  const current: SettingsSection | null = state.section ?? (wide ? "general" : null);

  // On a phone an open section is one more history layer: back goes to the list.
  useHistoryLayer(state.open && !wide && state.section !== null, () => settingsStore.show(null));

  // --- Closing with typing not saved asks once --------------------------------
  const [askLeave, setAskLeave] = useState(false);
  const [layerKey, setLayerKey] = useState(0);
  function requestClose(viaBack: boolean) {
    if (settingsStore.requestClose() === "closed") return;
    setAskLeave(true);
    // Back has used the sheet's history entry: put it back, so Keep editing
    // leaves the next back working.
    if (viaBack) setLayerKey((k) => k + 1);
  }

  // --- API token: its own Save and Clear (the sheet's footer is gone) ----------
  const [savedToken, setSavedToken] = useState(getToken);
  useEffect(() => settingsStore.setDirty("token", tokenInput.trim() !== savedToken), [tokenInput, savedToken]);
  useEffect(() => settingsStore.setDirty("key", newKeyName.trim() !== ""), [newKeyName]);
  useEffect(() => settingsStore.setDirty("import", importFile !== null), [importFile]);

  function saveToken() {
    const value = tokenInput.trim();
    setToken(value);
    setSavedToken(value);
    setTokenInput(value);
    if (value) reportZoneNow();
    toast.success(value ? "Token saved" : "Token cleared");
    onSaved();
  }

  function clearToken() {
    setTokenInput("");
    setToken("");
    setSavedToken("");
    toast.success("Token cleared");
    onSaved();
  }

  // --- Status: on the list, and in one box at the top of a section ------------
  const activeKeys = keys.filter((k) => !k.revokedAt).length;
  const aiState = ai.connected ? "On" : "Off";
  const rows: { id: SettingsSection; name: string; hint: string; state?: { label: string; tone: Tone }; note?: string }[] = [
    { id: "general", name: "General", hint: "Appearance, about this version", note: THEME_LABELS[themeChoice] },
    {
      id: "connection",
      name: "Connection",
      hint: "Server, API token",
      state: { label: status.label, tone: health === "ok" ? "on" : health === "down" ? "bad" : "wait" },
    },
    { id: "ai", name: "AI", hint: "Providers, models, what AI may use", state: { label: aiState, tone: ai.connected ? "on" : "off" } },
    // A count is not a state: plain text, no dot.
    { id: "agents", name: "Agents", hint: "API keys, MCP", note: keysError ? undefined : plural(activeKeys, "key") },
    {
      id: "notifications",
      name: "Notifications",
      hint: "Reminders on this device",
      ...(state.pushOn === null ? {} : { state: { label: state.pushOn ? "On" : "Off", tone: (state.pushOn ? "on" : "off") as Tone } }),
    },
    { id: "data", name: "Data", hint: "Export, import from Todoist" },
  ];
  const rowOf = (id: SettingsSection) => rows.find((r) => r.id === id)!;

  // Focus moves to a section's heading when it opens (the list keeps focus on desktop's first open).
  const headings = useRef<Partial<Record<SettingsSection, HTMLHeadingElement | null>>>({});
  const firstShown = useRef(true);
  useEffect(() => {
    if (firstShown.current) {
      firstShown.current = false;
      if (wide && state.section === null) return;
    }
    if (current) headings.current[current]?.focus();
  }, [current, wide, state.section]);

  /** Up and down move through the list; Enter or Space opens a section (the buttons do). */
  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-section]")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const from = isSettingsSection(buttons[at]?.dataset.section) ? (buttons[at]!.dataset.section as SettingsSection) : "general";
    const next = stepSection(from, e.key === "ArrowDown" ? 1 : -1);
    e.preventDefault();
    buttons.find((b) => b.dataset.section === next)?.focus();
  }

  const list = (
    <nav aria-label="Settings sections" onKeyDown={onListKey} className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          data-section={row.id}
          aria-current={wide && row.id === current ? "page" : undefined}
          onClick={() => settingsStore.show(row.id)}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent",
            wide && row.id === current && "bg-accent",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{row.name}</span>
            {!wide && <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>}
          </span>
          {!wide && row.state ? <StateMark {...row.state} /> : null}
          {!wide && !row.state && row.note ? <span className="shrink-0 text-xs text-muted-foreground">{row.note}</span> : null}
          {!wide && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );

  const content: Record<SettingsSection, ReactNode> = {
    general: (
      <>
        <ThemeSetting />
        <AboutVersion />
      </>
    ),
    connection: (
      <>
        <StatusBox label="Server" state={rowOf("connection").state!} />
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={clearToken} disabled={!savedToken && !tokenInput}>
              Clear
            </Button>
            <Button size="sm" onClick={saveToken} disabled={tokenInput.trim() === savedToken}>
              Save token
            </Button>
          </div>
        </div>
      </>
    ),
    ai: (
      <>
        <StatusBox
          label="Assistant"
          state={{ label: ai.connected ? "On" : ai.oauth ? "Sign in on the ChatGPT card below" : "Off: add a provider", tone: ai.connected ? "on" : "off" }}
          hint="Capture preview, mission refine, weekly review and the assistant."
        />
        {/* Providers, a model per job and the data switches (#94); the ChatGPT
            sign-in sits on its provider's card. */}
        {live && (
          <Suspense fallback={<p className="text-xs text-muted-foreground">Loading the AI settings…</p>}>
            <AiSettingsSection />
          </Suspense>
        )}
      </>
    ),
    agents: (
      <>
        {/* Agent & service access */}
        <div className="flex flex-col gap-2">
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
            <p className="text-xs text-[var(--terra)]">Couldn't load keys. Check the API token in Connection.</p>
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

      </>
    ),
    notifications: <>{live && <NotificationSettings />}</>,
    data: (
      <>
        {/* Data export: a full JSON backup of everything (no secrets). */}
        <div className="flex flex-col gap-2">
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

        {/* Which version this device and the server run (#140). */}
        {live && <AboutVersion />}
      </>
    ),
  };

  // Every section stays mounted while Settings is open, shown or not, so a
  // draft survives going to another section and back.
  const sections = SETTINGS_SECTIONS.map((id) => (
    <section key={id} hidden={id !== current} aria-labelledby={`settings-${id}`} className="flex min-w-0 flex-col gap-5">
      <h3
        id={`settings-${id}`}
        tabIndex={-1}
        ref={(el) => {
          headings.current[id] = el;
        }}
        className="font-display text-lg leading-tight outline-none"
      >
        {rowOf(id).name}
      </h3>
      {content[id]}
    </section>
  ));

  return (
    <>
      <AppSheet
        open={state.open}
        onOpenChange={(open) => {
          if (!open) requestClose(false);
        }}
        onBack={() => requestClose(true)}
        layerKey={layerKey}
        title="Settings"
        wide
        fill
      >
        {wide ? (
          <div className="grid h-full grid-cols-[12.5rem_1fr]">
            <div className="overflow-y-auto border-r border-border p-3">{list}</div>
            <div className="overflow-y-auto p-5">{sections}</div>
          </div>
        ) : (
          <>
            {current === null ? list : (
              <button
                type="button"
                onClick={() => settingsStore.show(null)}
                className="-ml-1 mb-2 flex items-center gap-1 text-sm text-muted-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden="true" /> All settings
              </button>
            )}
            {sections}
          </>
        )}
      </AppSheet>
      <ConfirmDialog
        open={askLeave}
        onOpenChange={setAskLeave}
        title="Leave without saving?"
        description="What you typed in Settings and did not save will be lost."
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => settingsStore.close()}
      />
    </>
  );
}

type Tone = "on" | "off" | "bad" | "wait";
const TONE: Record<Tone, { dot: string; text: string }> = {
  on: { dot: "bg-[var(--pine)]", text: "text-[var(--pine)]" },
  off: { dot: "bg-input", text: "text-muted-foreground" },
  bad: { dot: "bg-[var(--terra)]", text: "text-[var(--terra)]" },
  wait: { dot: "bg-[var(--gold)]", text: "text-[var(--gold)]" },
};

const THEME_LABELS: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "Follow the device" };

/** A state as a dot and a word: shown, never a control. */
function StateMark({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", TONE[tone].text)}>
      <span className={cn("size-2 rounded-full", TONE[tone].dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** The one status box at the top of a section: shaded, labelled, not a setting. */
function StatusBox({ label, state, hint }: { label: string; state: { label: string; tone: Tone }; hint?: string }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="min-w-0">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <StateMark {...state} />
    </div>
  );
}
