/**
 * The assistant's AG-UI client (issue #62, step 5): posts a RunAgentInput to
 * `POST /api/agent`, reads the server-sent events, and applies them to the
 * conversation. Our own small reader rather than `@ag-ui/client`'s HttpAgent,
 * which would add about 54 kB gzipped (rxjs, a protobuf decoder) to the
 * assistant chunk for a stream that is plain SSE. Only AG-UI types are
 * imported, so the protocol stays checked at compile time at no runtime cost.
 * Framework-neutral and React-free; tested in agent.test.ts.
 */
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";
import { getToken } from "./token";
import type { ChatItem } from "./conversation";

export type AgentUnavailableReason = "no-provider" | "unsupported-provider" | "not-ready";
export type AgentStatus = { available: true } | { available: false; reason: AgentUnavailableReason };

/** The server answered the run with an HTTP error before any stream. */
export class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** For 503: why the assistant cannot run. */
    readonly reason?: AgentUnavailableReason,
  ) {
    super(message);
    this.name = "AgentHttpError";
  }
}

export interface RunRequest {
  threadId: string;
  runId: string;
  messages: Message[];
  /** The browser's IANA time zone. */
  timeZone: string;
  /** The screen the user has open, e.g. "Clock · Today". */
  view?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  token?: string;
}

/** Whether the assistant can run (`GET /api/agent/status`). */
export async function getAgentStatus(options: StreamOptions = {}): Promise<AgentStatus> {
  const res = await (options.fetch ?? fetch)("/api/agent/status", {
    headers: authHeaders(options.token ?? getToken()),
    signal: options.signal,
  });
  if (!res.ok) throw new AgentHttpError(res.status, await errorText(res));
  return (await res.json()) as AgentStatus;
}

/** Runs the assistant and yields its AG-UI events as they arrive. */
export async function* streamRun(request: RunRequest, options: StreamOptions = {}): AsyncIterable<BaseEvent> {
  const body: RunAgentInput = {
    threadId: request.threadId,
    runId: request.runId,
    state: {},
    messages: request.messages,
    tools: [],
    context: [],
    forwardedProps: { timeZone: request.timeZone, ...(request.view ? { view: request.view } : {}) },
  };
  const res = await (options.fetch ?? fetch)("/api/agent", {
    method: "POST",
    headers: {
      ...authHeaders(options.token ?? getToken()),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let message = text || res.statusText;
    let reason: AgentUnavailableReason | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: string; reason?: AgentUnavailableReason };
      message = parsed.error ?? message;
      reason = parsed.reason;
    } catch {
      // Not JSON: keep the text.
    }
    throw new AgentHttpError(res.status, message, reason);
  }
  yield* parseSse(res.body);
}

/**
 * Server-sent events to AG-UI events: `data:` lines joined per event;
 * comments (the server's `: ping` heartbeat) and unparsable events skipped.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<BaseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string): BaseEvent | null => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n");
    if (!data) return null;
    try {
      const event = JSON.parse(data) as BaseEvent;
      return typeof event?.type === "string" ? event : null;
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : blocks.pop()!;
      for (const block of blocks) {
        const event = parse(block);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text || res.statusText;
  }
}

// --- Applying events to the conversation -----------------------------------

/** What the sheet shows while a tool runs. */
const STEP_LABELS: Record<string, string> = {
  list_tasks: "Reading your tasks…",
  big_rocks_this_week: "Looking at your big rocks…",
  list_goals: "Reading your goals…",
  list_projects: "Reading your projects…",
  list_roles: "Reading your roles…",
  get_mission: "Reading your mission…",
  list_people: "Looking at your people…",
  overdue_commitments: "Checking your commitments…",
  list_habits: "Reading your habits…",
  renewal_summary: "Looking at your renewal…",
  render_a2ui: "Preparing a screen…",
};

export function stepLabel(stepName: string): string {
  return STEP_LABELS[stepName] ?? "Working…";
}

/** A run in progress, as the sheet needs it. */
export interface RunState {
  items: ChatItem[];
  /** What the assistant is doing right now (a tool), or null. */
  activity: string | null;
  /** The run added text or a screen. */
  answered: boolean;
  /** Set once RUN_FINISHED or RUN_ERROR arrived. */
  ended: { kind: "finished"; reason?: string } | { kind: "error"; message: string } | null;
}

export function startRun(items: ChatItem[]): RunState {
  return { items, activity: null, answered: false, ended: null };
}

/** Applies one AG-UI event. Pure: returns a new state, never mutates. */
export function applyEvent(state: RunState, event: BaseEvent): RunState {
  const e = event as BaseEvent & Record<string, unknown>;
  switch (event.type) {
    case "TEXT_MESSAGE_START":
      return {
        ...state,
        activity: null,
        items: [...state.items, { kind: "assistant", id: String(e.messageId), text: "" }],
      };
    case "TEXT_MESSAGE_CONTENT": {
      const delta = typeof e.delta === "string" ? e.delta : "";
      if (!delta) return state;
      let index = state.items.length - 1;
      while (index >= 0 && !(state.items[index]!.kind === "assistant" && state.items[index]!.id === e.messageId)) index--;
      if (index === -1) {
        return { ...state, answered: true, items: [...state.items, { kind: "assistant", id: String(e.messageId), text: delta }] };
      }
      const items = [...state.items];
      const item = items[index] as Extract<ChatItem, { kind: "assistant" }>;
      items[index] = { ...item, text: item.text + delta };
      return { ...state, answered: true, items };
    }
    case "TEXT_MESSAGE_END":
      // A message that never got text leaves no empty bubble behind.
      return {
        ...state,
        items: state.items.filter((i) => !(i.kind === "assistant" && i.id === e.messageId && !i.text)),
      };
    case "STEP_STARTED":
      return { ...state, activity: stepLabel(String(e.stepName ?? "")) };
    case "STEP_FINISHED":
      return { ...state, activity: null };
    case "ACTIVITY_SNAPSHOT": {
      const operations = (e.content as Record<string, unknown> | undefined)?.a2ui_operations;
      if (e.activityType !== "a2ui-surface" || !Array.isArray(operations)) return state;
      const item: ChatItem = { kind: "surface", id: String(e.messageId), operations };
      const index = state.items.findIndex((i) => i.kind === "surface" && i.id === item.id);
      const items = index === -1 ? [...state.items, item] : state.items.map((i, n) => (n === index ? item : i));
      return { ...state, answered: true, activity: null, items };
    }
    case "RUN_FINISHED": {
      const reason = (e.result as { reason?: unknown } | undefined)?.reason;
      return { ...state, activity: null, ended: { kind: "finished", reason: typeof reason === "string" ? reason : undefined } };
    }
    case "RUN_ERROR":
      return {
        ...state,
        activity: null,
        ended: { kind: "error", message: typeof e.message === "string" ? e.message : "The assistant could not answer." },
      };
    default:
      return state;
  }
}

/**
 * What the app says when a run ends without an answer (the model hit the
 * step limit, was cut off or declined), so the user never sees nothing.
 * Null when the run answered.
 */
export function endOfRunNotice(state: RunState): { text: string; tone: "info" | "error" } | null {
  const ended = state.ended;
  if (ended?.kind === "error") return { text: ended.message, tone: "error" };
  if (state.answered) return null;
  switch (ended?.reason) {
    case "step-limit":
      return { text: "That took more steps than I can take in one answer. Try asking for something narrower.", tone: "info" };
    case "max_tokens":
      return { text: "The answer was cut off before anything could be shown. Try asking for a shorter answer.", tone: "info" };
    case "refusal":
      return { text: "The assistant declined to answer that one.", tone: "info" };
    default:
      return ended
        ? { text: "No answer came back. Try again.", tone: "info" }
        : { text: "The answer stopped before it finished. Try again.", tone: "error" };
  }
}
