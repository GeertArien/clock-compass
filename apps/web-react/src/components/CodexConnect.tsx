import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import {
  codexDisconnect,
  getCodexLogin,
  getCodexStatus,
  startCodexDevice,
  type CodexStatus,
} from "@clock-compass/web-client/api";
import { Button } from "@/components/ui/button";
import { aiStore } from "@/lib/stores/ai";
import { toast } from "@/lib/stores/toast";

type Phase = "idle" | "starting" | "pending" | "error";

const POLL_MS = 3000;

/**
 * ChatGPT subscription sign-in (Codex device code). Mounted by Settings only
 * when the server's provider signs in; the sheet remounts on each open, so the
 * status loads on mount. Mirrors CodexConnect.svelte.
 */
export function CodexConnect() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const load = (): Promise<void> =>
    getCodexStatus().then(
      (next) => {
        if (mounted.current) setStatus(next);
      },
      () => {
        if (mounted.current) setStatus(null);
      },
    );

  function stopPolling(): void {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, []);

  // The server waits for approval in the background; we poll its login state.
  function poll(): void {
    stopPolling();
    pollTimer.current = setTimeout(async () => {
      pollTimer.current = null;
      try {
        const login = await getCodexLogin();
        if (!mounted.current) return;
        if (login.state === "connected") {
          setPhase("idle");
          toast.success("ChatGPT connected");
          await load();
          await aiStore.check();
          return;
        }
        if (login.state === "error") {
          setPhase("error");
          setErrorMsg(login.message);
          return;
        }
      } catch {
        // transient — keep waiting
      }
      if (mounted.current) poll();
    }, POLL_MS);
  }

  async function connect(): Promise<void> {
    setPhase("starting");
    setErrorMsg("");
    try {
      const start = await startCodexDevice();
      if (!mounted.current) return;
      setUserCode(start.userCode);
      setVerificationUri(start.verificationUri);
      setPhase("pending");
      poll();
    } catch (err) {
      if (!mounted.current) return;
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Couldn't start sign-in.");
    }
  }

  async function disconnect(): Promise<void> {
    try {
      await codexDisconnect();
      stopPolling();
      if (mounted.current) setPhase("idle");
      toast.success("ChatGPT disconnected");
      await load();
      await aiStore.check();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect");
    }
  }

  function copyCode(): void {
    void navigator.clipboard.writeText(userCode).then(() => toast.success("Code copied"));
  }

  const busy = phase === "starting" || phase === "pending";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-sm font-medium">ChatGPT subscription</span>
          <p className="text-xs text-muted-foreground">
            Use your ChatGPT Plus/Pro plan as the AI backend, via Codex sign-in.
          </p>
        </div>
        {status?.connected && (
          <span className="flex shrink-0 items-center gap-2 text-sm text-[var(--pine)]">
            <span className="size-2 rounded-full bg-[var(--pine)]" />
            Connected
          </span>
        )}
      </div>

      {phase === "pending" && (
        <div className="flex flex-col gap-2 rounded-md bg-secondary/50 p-2.5">
          <p className="text-xs text-muted-foreground">
            Open the link, sign in to ChatGPT, and enter this code:
          </p>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 rounded bg-card px-2 py-1 text-center font-mono text-base tracking-[0.3em]">
              {userCode}
            </code>
            <Button variant="outline" size="sm" onClick={copyCode} aria-label="Copy code">
              <Copy className="size-4" />
            </Button>
          </div>
          <a
            href={verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--terra)] hover:underline"
          >
            <ExternalLink className="size-3" />
            {verificationUri}
          </a>
          <p className="text-[0.6875rem] text-muted-foreground">Waiting for approval…</p>
        </div>
      )}

      {phase === "error" && <p className="text-xs text-[var(--terra)]">{errorMsg}</p>}

      <div className="flex gap-2">
        {status?.connected ? (
          <>
            <Button variant="outline" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
            {!busy && (
              <Button variant="ghost" size="sm" onClick={() => void connect()}>
                Reconnect
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" onClick={() => void connect()} disabled={busy}>
            {phase === "starting"
              ? "Starting…"
              : phase === "pending"
                ? "Waiting…"
                : "Sign in with ChatGPT"}
          </Button>
        )}
      </div>
    </div>
  );
}
