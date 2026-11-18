import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import {
  codexFlowQuery,
  codexStatusQuery,
  connectCodex,
  disconnectCodex,
} from "@/lib/queries/ai";

/**
 * ChatGPT subscription card in Settings. The sign-in flow itself lives in
 * the query cache and is polled from the app shell (useCodexPolling), so it
 * keeps polling after the sheet closes and a reopened sheet shows the same
 * pending code.
 */
export function CodexConnect() {
  // Settings remounts on each open; the status query refetches then.
  const status = useQuery(codexStatusQuery).data;
  const { phase, userCode, verificationUri, errorMsg } = useQuery(codexFlowQuery).data;
  const connect = useMutation(connectCodex);
  const disconnect = useMutation(disconnectCodex);
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyText(userCode, "Code")}
              aria-label="Copy code"
            >
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
            <Button variant="outline" size="sm" onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
            {!busy && (
              <Button variant="ghost" size="sm" onClick={() => connect.mutate()}>
                Reconnect
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" onClick={() => connect.mutate()} disabled={busy}>
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
