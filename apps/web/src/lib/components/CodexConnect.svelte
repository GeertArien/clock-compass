<script lang="ts">
  import { onDestroy } from "svelte";
  import { Copy, ExternalLink } from "lucide-svelte";
  import { Button } from "@/lib/components/ui/button";
  import { toast } from "@/lib/components/ui/toast";
  import {
    codexDisconnect,
    getCodexLogin,
    getCodexStatus,
    startCodexDevice,
    type CodexStatus,
  } from "@/lib/api";
  import { aiStore } from "@/lib/stores/ai.svelte";

  let status = $state<CodexStatus | null>(null);
  let phase = $state<"idle" | "starting" | "pending" | "error">("idle");
  let userCode = $state("");
  let verificationUri = $state("");
  let errorMsg = $state("");
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Refresh the persisted connection state. Called by Settings on open. */
  export async function load(): Promise<void> {
    try {
      status = await getCodexStatus();
    } catch {
      status = null;
    }
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function connect(): Promise<void> {
    phase = "starting";
    errorMsg = "";
    try {
      const start = await startCodexDevice();
      userCode = start.userCode;
      verificationUri = start.verificationUri;
      phase = "pending";
      poll();
    } catch (err) {
      phase = "error";
      errorMsg = err instanceof Error ? err.message : "Couldn't start sign-in.";
    }
  }

  // The server waits for approval in the background; we poll its login state.
  function poll(): void {
    stopPolling();
    pollTimer = setTimeout(async () => {
      try {
        const login = await getCodexLogin();
        if (login.state === "connected") {
          phase = "idle";
          toast.success("ChatGPT connected");
          await load();
          await aiStore.check();
          return;
        }
        if (login.state === "error") {
          phase = "error";
          errorMsg = login.message;
          return;
        }
      } catch {
        // transient — keep waiting
      }
      poll();
    }, 3000);
  }

  async function disconnect(): Promise<void> {
    try {
      await codexDisconnect();
      stopPolling();
      phase = "idle";
      toast.success("ChatGPT disconnected");
      await load();
      await aiStore.check();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect");
    }
  }

  function copyCode(): void {
    navigator.clipboard.writeText(userCode).then(() => toast.success("Code copied"));
  }

  onDestroy(stopPolling);
</script>

<div class="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3">
  <div class="flex items-start justify-between gap-2">
    <div>
      <span class="text-sm font-medium">ChatGPT subscription</span>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Use your ChatGPT Plus/Pro plan as the AI backend, via Codex sign-in.
      </p>
    </div>
    {#if status?.connected}
      <span class="flex shrink-0 items-center gap-2 text-sm text-[var(--pine)]">
        <span class="size-2 rounded-full bg-[var(--pine)]"></span>
        Connected
      </span>
    {/if}
  </div>

  {#if phase === "pending"}
    <div class="flex flex-col gap-2 rounded-md bg-[var(--color-secondary)]/50 p-2.5">
      <p class="text-xs text-[var(--color-muted-foreground)]">
        Open the link, sign in to ChatGPT, and enter this code:
      </p>
      <div class="flex items-center gap-1.5">
        <code
          class="flex-1 rounded bg-[var(--color-card)] px-2 py-1 text-center font-mono text-base tracking-[0.3em]"
        >
          {userCode}
        </code>
        <Button variant="outline" size="sm" onclick={copyCode}>
          <Copy class="size-3" />
        </Button>
      </div>
      <a
        href={verificationUri}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-xs font-medium text-[var(--terra)] hover:underline"
      >
        <ExternalLink class="size-3" />
        {verificationUri}
      </a>
      <p class="text-[0.6875rem] text-[var(--color-muted-foreground)]">
        Waiting for approval…
      </p>
    </div>
  {/if}

  {#if phase === "error"}
    <p class="text-xs text-[var(--terra)]">{errorMsg}</p>
  {/if}

  <div class="flex gap-2">
    {#if status?.connected}
      <Button variant="outline" size="sm" onclick={disconnect}>Disconnect</Button>
      {#if phase !== "pending" && phase !== "starting"}
        <Button variant="ghost" size="sm" onclick={connect}>Reconnect</Button>
      {/if}
    {:else}
      <Button
        size="sm"
        onclick={connect}
        disabled={phase === "starting" || phase === "pending"}
      >
        {phase === "starting"
          ? "Starting…"
          : phase === "pending"
            ? "Waiting…"
            : "Sign in with ChatGPT"}
      </Button>
    {/if}
  </div>
</div>
