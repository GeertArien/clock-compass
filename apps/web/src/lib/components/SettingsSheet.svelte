<script lang="ts">
  import { Copy, Download, ExternalLink, KeyRound, Plus, Upload } from "lucide-svelte";
  import { Sheet } from "@/lib/components/ui/sheet";
  import { Button } from "@/lib/components/ui/button";
  import { Input } from "@/lib/components/ui/input";
  import { toast } from "@/lib/components/ui/toast";
  import { getToken, setToken } from "@/lib/token";
  import NotificationSettings from "./NotificationSettings.svelte";
  import { aiStore } from "@/lib/stores/ai.svelte";
  import {
    createApiKey,
    exportBackup,
    importTodoist,
    listApiKeys,
    revokeApiKey,
    type ApiKeyView,
  } from "@/lib/api";
  import { tasksStore } from "@/lib/stores/tasks.svelte";
  import { projectsStore } from "@/lib/stores/projects.svelte";

  type Health = "checking" | "ok" | "down";
  type Props = { open: boolean; health: Health; onSaved: () => void };
  let { open = $bindable(), health, onSaved }: Props = $props();

  let tokenInput = $state(getToken());

  // --- Agent & service access ---------------------------------------------
  let keys = $state<ApiKeyView[]>([]);
  let keysError = $state(false);
  let newKeyName = $state("");
  /** Plaintext of a freshly created key — visible exactly once. */
  let freshKey = $state<string | null>(null);

  let notifications = $state<NotificationSettings | null>(null);

  let lastOpen = $state(false);
  $effect(() => {
    if (open && !lastOpen) {
      tokenInput = getToken();
      freshKey = null;
      loadKeys();
      notifications?.load();
    }
    lastOpen = open;
  });

  async function loadKeys() {
    try {
      keys = await listApiKeys();
      keysError = false;
    } catch {
      keysError = true;
    }
  }

  async function addKey() {
    const name = newKeyName.trim();
    if (!name) return;
    try {
      const created = await createApiKey(name);
      freshKey = created.key;
      newKeyName = "";
      loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    }
  }

  async function revoke(key: ApiKeyView) {
    try {
      await revokeApiKey(key.id);
      toast.success(`“${key.name}” revoked`);
      loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  }

  // --- Todoist import -------------------------------------------------------
  let importFile = $state<File | null>(null);
  let importProject = $state("");
  let importing = $state(false);

  function pickFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
    importFile = file;
    // Suggest the file name as the project (minus the " [id]" suffix Todoist
    // appends in backup zips); the user can edit or clear it.
    if (file) {
      importProject = file.name.replace(/\.csv$/i, "").replace(/ \[[^\]]+\]$/, "");
    }
  }

  async function runImport() {
    if (!importFile || importing) return;
    importing = true;
    try {
      const csv = await importFile.text();
      const result = await importTodoist(csv, importProject.trim() || undefined);
      toast.success(
        `Imported ${result.imported} task${result.imported === 1 ? "" : "s"}` +
          (result.skipped ? ` (${result.skipped} skipped)` : ""),
      );
      importFile = null;
      importProject = "";
      tasksStore.load();
      projectsStore.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      importing = false;
    }
  }

  // --- Data export (full JSON backup) --------------------------------------
  let exporting = $state(false);

  async function downloadBackup() {
    if (exporting) return;
    exporting = true;
    try {
      const bundle = await exportBackup();
      const date = bundle.exportedAt.slice(0, 10); // YYYY-MM-DD
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clock-compass-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      exporting = false;
    }
  }

  const statusMeta = $derived(
    health === "ok"
      ? { label: "Connected", dot: "bg-[var(--pine)]", text: "text-[var(--pine)]" }
      : health === "down"
        ? { label: "Unreachable", dot: "bg-[var(--terra)]", text: "text-[var(--terra)]" }
        : { label: "Checking…", dot: "bg-[var(--gold)]", text: "text-[var(--gold)]" },
  );

  function save() {
    setToken(tokenInput.trim());
    toast.success(tokenInput.trim() ? "Token saved" : "Token cleared");
    open = false;
    onSaved();
  }

  function clear() {
    tokenInput = "";
    setToken("");
    toast.success("Token cleared");
    onSaved();
  }
</script>

<Sheet bind:open title="Settings" description="Connection, API access, and agents.">
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
      <span class="text-sm font-medium">Backend</span>
      <span class="flex items-center gap-2 text-sm {statusMeta.text}">
        <span class="size-2 rounded-full {statusMeta.dot}"></span>
        {statusMeta.label}
      </span>
    </div>

    <div class="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
      <div>
        <span class="text-sm font-medium">AI assistant</span>
        <p class="text-xs text-[var(--color-muted-foreground)]">
          Capture preview, mission refine, weekly review.
        </p>
      </div>
      <span class="flex items-center gap-2 text-sm {aiStore.available ? 'text-[var(--pine)]' : 'text-[var(--color-muted-foreground)]'}">
        <span class="size-2 rounded-full {aiStore.available ? 'bg-[var(--pine)]' : 'bg-[var(--color-input)]'}"></span>
        {aiStore.available ? "Configured" : "Set ANTHROPIC_API_KEY"}
      </span>
    </div>

    <div class="flex flex-col gap-2">
      <label for="api-token" class="text-sm font-medium">API token</label>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Only needed if the server sets <code>API_AUTH_TOKEN</code>. Stored locally
        in this browser and sent as a bearer token.
      </p>
      <Input id="api-token" type="password" bind:value={tokenInput} placeholder="paste bearer token" />
    </div>

    <!-- Agent & service access -->
    <div class="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
      <div class="flex items-center gap-2">
        <KeyRound class="size-4 text-[var(--color-muted-foreground)]" />
        <span class="text-sm font-medium">Agent &amp; service access</span>
      </div>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Named API keys for agents and services. The REST API is the source of
        truth; the MCP server wraps the same services.
      </p>

      {#if freshKey}
        <div class="flex flex-col gap-1.5 rounded-lg border border-[var(--pine)] bg-[var(--pine-soft)] p-2.5">
          <p class="text-xs font-semibold text-[var(--pine)]">
            Copy this key now — it won't be shown again.
          </p>
          <div class="flex items-center gap-1.5">
            <code class="min-w-0 flex-1 truncate rounded bg-[var(--color-card)] px-2 py-1 font-mono text-[0.6875rem]">
              {freshKey}
            </code>
            <Button variant="outline" size="sm" onclick={() => copy(freshKey!, "Key")}>
              <Copy class="size-3" />
            </Button>
          </div>
        </div>
      {/if}

      {#if keysError}
        <p class="text-xs text-[var(--terra)]">
          Couldn't load keys — check the token above.
        </p>
      {:else}
        {#each keys as key (key.id)}
          <div
            class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-2.5 py-2"
            class:opacity-50={key.revokedAt}
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-[0.8125rem] font-medium" class:line-through={key.revokedAt}>
                {key.name}
              </p>
              <p class="text-[0.6875rem] text-[var(--color-muted-foreground)]">
                {key.revokedAt
                  ? `revoked ${new Date(key.revokedAt).toLocaleDateString()}`
                  : key.lastUsedAt
                    ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
              </p>
            </div>
            {#if !key.revokedAt}
              <Button variant="outline" size="sm" onclick={() => revoke(key)}>Revoke</Button>
            {/if}
          </div>
        {/each}
      {/if}

      <div class="flex gap-2">
        <Input
          bind:value={newKeyName}
          placeholder="key name — “Claude · planning agent”"
          onkeydown={(e: KeyboardEvent) => e.key === "Enter" && addKey()}
        />
        <Button size="sm" onclick={addKey} disabled={!newKeyName.trim()}>
          <Plus class="size-4" />
          Key
        </Button>
      </div>

      <div class="mt-1 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onclick={() => window.open("/docs", "_blank")}>
          <ExternalLink class="size-3" />
          API docs
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={() =>
            copy("pnpm --filter @clock-compass/mcp start", "MCP command")}
        >
          <Copy class="size-3" />
          MCP command
        </Button>
      </div>
    </div>

    <NotificationSettings bind:this={notifications} />

    <!-- Data export: a full JSON backup of everything (no secrets). -->
    <div class="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
      <div class="flex items-center gap-2">
        <Download class="size-4 text-[var(--color-muted-foreground)]" />
        <span class="text-sm font-medium">Export your data</span>
      </div>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Download a full <b>JSON backup</b> of your tasks, goals, projects, people,
        habits and renewal. API keys and push subscriptions are never included.
      </p>
      <div>
        <Button variant="outline" size="sm" onclick={downloadBackup} disabled={exporting}>
          <Download class="size-3" />
          {exporting ? "Preparing…" : "Download backup"}
        </Button>
      </div>
    </div>

    <!-- Todoist import: a one-shot file upload, no credentials stored. -->
    <div class="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
      <div class="flex items-center gap-2">
        <Upload class="size-4 text-[var(--color-muted-foreground)]" />
        <span class="text-sm font-medium">Import from Todoist</span>
      </div>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Upload a Todoist <b>CSV export</b> (per-project). p1–p4 seed
        importance/urgency; nothing Todoist-related is stored on the server.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onchange={pickFile}
        class="rounded-lg border border-dashed border-[var(--color-input)] bg-[var(--color-secondary)]/40 p-3 text-xs text-[var(--color-muted-foreground)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-primary)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--color-primary-foreground)]"
      />
      {#if importFile}
        <div class="flex gap-2">
          <Input
            bind:value={importProject}
            placeholder="project name (blank = Inbox)"
          />
          <Button size="sm" onclick={runImport} disabled={importing}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </div>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <div class="flex justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={clear}>Clear</Button>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
        <Button size="sm" onclick={save}>Save</Button>
      </div>
    </div>
  {/snippet}
</Sheet>
