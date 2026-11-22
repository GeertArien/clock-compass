/**
 * The assistant sheet (issue #62, step 5): a bottom sheet on phones and a
 * dialog on desktop, reachable from every mode. Loaded with import() from the
 * app shell, so none of this is in the first load. Read-only: screens show
 * information; changes arrive in step 6 as confirmed actions.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, CircleAlert, LoaderCircle, Square, Trash2, WifiOff } from "lucide-react";
import { parseAction } from "@clock-compass/assistant-catalog";
import { getAgentStatus, type AgentStatus, type AgentUnavailableReason } from "@clock-compass/web-client/agent";
import { localConversationStore, type ChatItem } from "@clock-compass/web-client/conversation";
import { AppSheet } from "@/components/ui/app-sheet";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/stores/store";
import { toast } from "@/lib/stores/toast";
import { cn } from "@/lib/utils";
import { SurfaceView, type A2uiMessage, type ActionPayload } from "./a2ui/renderer";
import { AssistantSession } from "./session";

/** One conversation for the app's lifetime, restored from the device. */
const session = new AssistantSession({ store: localConversationStore() });

const MAX_QUESTION = 2000;

const SUGGESTIONS = [
  "What are my big rocks this week?",
  "Show my open tasks by quadrant",
  "Which relationship commitments are overdue?",
  "How are my habits going this week?",
];

const UNAVAILABLE: Record<AgentUnavailableReason, string> = {
  "no-provider":
    "The assistant needs an AI provider on the server: an Anthropic API key, or an OpenAI-compatible endpoint and model.",
  "unsupported-provider":
    "The assistant does not work with the ChatGPT subscription provider (Codex) yet. Use Anthropic or an OpenAI-compatible provider on the server.",
  "not-ready": "The AI provider is not connected yet. Connect it in Settings, then try again.",
};

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** "showMore" → "Show more": a screen's button sent back as the user's words. */
function actionWords(name: string): string {
  const words = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function AssistantSheet({
  open,
  onOpenChange,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The screen behind the sheet, e.g. "Clock · Today". */
  view: string;
}) {
  const state = useStore(session);
  const online = useOnline();
  const status = useQuery({
    queryKey: ["agent", "status"],
    queryFn: (): Promise<AgentStatus> => getAgentStatus(),
    enabled: open && online,
    refetchOnMount: "always",
  });
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const items = state.conversation.items;

  const unavailableReason =
    status.data && !status.data.available ? status.data.reason : (state.unavailable ?? null);
  const blocked = !online || unavailableReason !== null;

  // Keep the newest part of the answer in view while it streams.
  const last = items.at(-1);
  const lastSize = last?.kind === "assistant" ? last.text.length : 0;
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end" });
  }, [open, items.length, lastSize, state.activity]);

  function ask(question: string) {
    if (blocked) return;
    void session.send(question.slice(0, MAX_QUESTION), view);
    setText("");
  }

  function onAction(action: ActionPayload) {
    const parsed = parseAction({ name: action.name, surfaceId: action.surfaceId, context: action.context });
    if (parsed.kind === "message") ask(actionWords(parsed.name));
    else toast.info("Changes from the assistant arrive in a later update. Make this one in the app for now.");
  }

  const footer = (
    <div className="flex w-full flex-col gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <textarea
          aria-label="Ask the assistant"
          value={text}
          maxLength={MAX_QUESTION}
          rows={1}
          disabled={blocked}
          placeholder={blocked ? "The assistant is unavailable" : "Ask about your week, goals, people…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(text);
            }
          }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm field-sizing-content focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        />
        {state.running ? (
          <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={() => session.stop()}>
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send" disabled={blocked || !text.trim()}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
      <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
        <span>Kept on this device. It can read your data, not change it.</span>
        <button
          type="button"
          onClick={() => session.clear()}
          disabled={items.length === 0}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
        >
          <Trash2 className="size-3" />
          Clear
        </button>
      </div>
    </div>
  );

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Assistant"
      description="Answers from your own tasks, goals, people and habits."
      footer={footer}
      wide
    >
      <div className="flex min-h-[40dvh] flex-col gap-3 sm:min-h-[22rem]">
        {!online ? (
          <Banner icon={<WifiOff className="size-4" />}>
            You're offline. The assistant needs a connection; this conversation stays on your device.
          </Banner>
        ) : unavailableReason ? (
          <Banner icon={<CircleAlert className="size-4" />}>{UNAVAILABLE[unavailableReason]}</Banner>
        ) : null}

        {items.length === 0 && !blocked ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Ask about your week, or try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {items.map((item) => (
          <Item key={item.id} item={item} onAction={onAction} />
        ))}

        {state.running && (state.activity || last?.kind === "user") ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle className="size-3.5 animate-spin" />
            {state.activity ?? "Thinking…"}
          </p>
        ) : null}
        {/* Screen readers hear the finished answer once, not every streamed piece. */}
        <p className="sr-only" aria-live="polite">
          {!state.running ? spokenAnswer(items) : ""}
        </p>
        <div ref={end} />
      </div>
    </AppSheet>
  );
}

/** The latest answer's text and notices, for the screen-reader announcement. */
function spokenAnswer(items: ChatItem[]): string {
  const lastQuestion = items.map((i) => i.kind).lastIndexOf("user");
  if (lastQuestion === -1) return "";
  return items
    .slice(lastQuestion + 1)
    .map((i) => (i.kind === "assistant" || i.kind === "notice" ? i.text : i.kind === "surface" ? "A screen was shown." : ""))
    .filter(Boolean)
    .join(" ");
}

function Banner({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function Item({ item, onAction }: { item: ChatItem; onAction: (action: ActionPayload) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <p className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">
          {item.text}
        </p>
      );
    case "assistant":
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>;
    case "surface":
      return (
        <div className="min-w-0 rounded-xl border border-border bg-background p-3">
          <SurfaceView operations={item.operations as A2uiMessage[]} onAction={onAction} />
        </div>
      );
    case "notice":
      return (
        <p
          role={item.tone === "error" ? "alert" : undefined}
          className={cn(
            "flex items-start gap-1.5 text-xs",
            item.tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {item.tone === "error" ? <CircleAlert className="mt-px size-3.5 shrink-0" /> : null}
          {item.text}
        </p>
      );
  }
}
