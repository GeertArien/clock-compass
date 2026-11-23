/**
 * The AG-UI side of the assistant (issue #62, step 4): turns the client's
 * AG-UI conversation into the agent loop's history, and the loop's events
 * into AG-UI events. Protocol only: the loop, the tools and the A2UI
 * validation live in @clock-compass/core.
 *
 * A2UI surfaces travel the way the AG-UI A2UI middleware sends them: an
 * ACTIVITY_SNAPSHOT of activity type "a2ui-surface" whose content holds the
 * A2UI messages under "a2ui_operations". A client written for the middleware
 * reads ours unchanged.
 */
import { randomUUID } from "node:crypto";
import { EventType, contentToText, type BaseEvent, type Message } from "@ag-ui/core";
import type { AgentEvent, AgentMessage, AssistantMessage } from "@clock-compass/core";

export const A2UI_ACTIVITY_TYPE = "a2ui-surface";
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** Messages of history kept per run, and characters per message. */
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8_000;

/**
 * The client's AG-UI messages as the loop's history. The client keeps the
 * conversation (decision C: on the device), so everything here is untrusted:
 * - only user and assistant text is kept; system and developer messages are
 *   dropped (the client cannot change the system prompt), and so are tool
 *   calls and tool results (tools always run again on the server, on the
 *   user's current data);
 * - a screen shown earlier becomes a short note on the assistant's message,
 *   so the model knows what the user saw;
 * - the history is trimmed to the last MAX_HISTORY_MESSAGES, starts with a
 *   user message, and alternates roles.
 * Returns undefined when it does not end with a user message.
 */
export function toAgentHistory(messages: Message[]): AgentMessage[] | undefined {
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  const add = (role: "user" | "assistant", text: string) => {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!trimmed) return;
    const last = turns.at(-1);
    if (last?.role === role) last.text = `${last.text}\n\n${trimmed}`.slice(0, MAX_MESSAGE_CHARS);
    else turns.push({ role, text: trimmed });
  };
  for (const message of messages) {
    if (message.role === "user") add("user", contentToText(message.content as never) ?? "");
    else if (message.role === "assistant") add("assistant", typeof message.content === "string" ? message.content : "");
    else if (message.role === "activity" && message.activityType === A2UI_ACTIVITY_TYPE) {
      add("assistant", screenNote(message.content));
    }
  }
  if (turns.at(-1)?.role !== "user") return undefined;
  let kept = turns.slice(-MAX_HISTORY_MESSAGES);
  while (kept[0]?.role === "assistant") kept = kept.slice(1);
  return kept.map((t): AgentMessage =>
    t.role === "user"
      ? { role: "user", content: t.text }
      : ({ role: "assistant", text: t.text, toolCalls: [] } satisfies AssistantMessage),
  );
}

/** "[Screen shown: "matrix" with QuadrantBoard, Text]" from a surface's operations. */
function screenNote(content: unknown): string {
  const operations = (content as Record<string, unknown> | null)?.[A2UI_OPERATIONS_KEY];
  if (!Array.isArray(operations)) return "";
  let surfaceId: unknown;
  const components = new Set<string>();
  for (const op of operations as Record<string, unknown>[]) {
    const update = op?.updateComponents as { surfaceId?: unknown; components?: unknown } | undefined;
    if (!update || !Array.isArray(update.components)) continue;
    surfaceId ??= update.surfaceId;
    for (const c of update.components) {
      const name = (c as { component?: unknown })?.component;
      if (typeof name === "string" && /^[A-Za-z]{1,32}$/.test(name)) components.add(name);
    }
  }
  const id = typeof surfaceId === "string" ? surfaceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : "";
  return `[Screen shown to the user${id ? `: "${id}"` : ""}${components.size ? ` with ${[...components].join(", ")}` : ""}]`;
}

export interface RunIds {
  threadId: string;
  runId: string;
}

/** Why a run ended with an error, as the client is told it. */
export type RunErrorCode = "provider-error" | "unavailable";

/**
 * The loop's events as AG-UI events: RUN_STARTED; per assistant turn, a text
 * message (START, CONTENT…, END); a STEP_STARTED/STEP_FINISHED pair per tool
 * call; an ACTIVITY_SNAPSHOT per validated screen; then RUN_FINISHED, or
 * RUN_ERROR when the loop fails (`onError` gets the cause; the client only a
 * generic message).
 */
export async function* toAguiEvents(
  events: AsyncIterable<AgentEvent>,
  ids: RunIds,
  onError: (error: unknown) => RunErrorCode,
  newId: () => string = randomUUID,
): AsyncIterable<BaseEvent> {
  yield { type: EventType.RUN_STARTED, threadId: ids.threadId, runId: ids.runId } as BaseEvent;
  let open: string | undefined;
  const close = function* () {
    if (open) yield { type: EventType.TEXT_MESSAGE_END, messageId: open } as BaseEvent;
    open = undefined;
  };
  try {
    for await (const event of events) {
      switch (event.type) {
        case "text":
          if (!event.delta) break;
          if (!open) {
            open = newId();
            yield { type: EventType.TEXT_MESSAGE_START, messageId: open, role: "assistant" } as BaseEvent;
          }
          yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: open, delta: event.delta } as BaseEvent;
          break;
        case "message":
          if (event.message.role === "assistant") yield* close();
          break;
        case "tool-call":
          yield* close();
          yield { type: EventType.STEP_STARTED, stepName: event.name } as BaseEvent;
          break;
        case "tool-result":
          yield { type: EventType.STEP_FINISHED, stepName: event.name } as BaseEvent;
          break;
        case "surface":
          yield* close();
          yield {
            type: EventType.ACTIVITY_SNAPSHOT,
            // The server-issued surface id, unique per screen. The tool-call id
            // is not: some OpenAI-compatible servers only make it unique within
            // one response (and the provider falls back to call_<index>), and
            // with replace: true a later screen would overwrite an earlier one.
            messageId: `a2ui-surface-${event.surfaceId}`,
            activityType: A2UI_ACTIVITY_TYPE,
            content: { [A2UI_OPERATIONS_KEY]: event.messages },
            replace: true,
          } as BaseEvent;
          break;
        case "done":
          yield* close();
          yield {
            type: EventType.RUN_FINISHED,
            threadId: ids.threadId,
            runId: ids.runId,
            result: { reason: event.reason },
          } as BaseEvent;
          return;
      }
    }
    yield* close();
    yield { type: EventType.RUN_FINISHED, threadId: ids.threadId, runId: ids.runId } as BaseEvent;
  } catch (error) {
    yield* close();
    const code = onError(error);
    yield {
      type: EventType.RUN_ERROR,
      code,
      message:
        code === "unavailable"
          ? "The assistant is unavailable right now."
          : "The assistant could not answer. Try again in a moment.",
    } as BaseEvent;
  }
}

/** One AG-UI event as a server-sent event (what @ag-ui/encoder writes for SSE). */
export function sse(event: BaseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
