import {
  AgentHttpError,
  applyEvent,
  endOfRunNotice,
  startRun,
  streamRun,
  type AgentUnavailableReason,
  type RunRequest,
  type StreamOptions,
} from "@clock-compass/web-client/agent";
import {
  emptyConversation,
  toAguiMessages,
  type ChatItem,
  type Conversation,
  type ConversationStore,
} from "@clock-compass/web-client/conversation";
import { randomId } from "@clock-compass/web-client/random";
import { operation } from "@clock-compass/assistant-catalog";
import { Store } from "@/lib/stores/store";
import { executeAction, type ActionResult, type OperationPorts, type WriteAction } from "./actions";

/** Where a confirmed proposal stands, by action key. */
export type ActionState =
  | { status: "running" }
  | { status: "applied"; createdId?: string }
  | { status: "failed"; error: string };
const APPLIED: ActionState = Object.freeze({ status: "applied" });

export interface SessionState {
  conversation: Conversation;
  /** A run is streaming. */
  running: boolean;
  /** What the assistant is doing right now ("Reading your tasks…"), or null. */
  activity: string | null;
  /** Set when the server said the assistant cannot run (503). */
  unavailable: AgentUnavailableReason | null;
  /** Confirmed actions in progress or failed this session (applied ones live in the conversation). */
  actions: Record<string, ActionState>;
}

export interface SessionDeps {
  store: ConversationStore;
  stream?: (request: RunRequest, options: StreamOptions) => AsyncIterable<{ type: string }>;
  /** New ids (conversation, run, items) and new idempotency keys; random by default. */
  newId?: () => string;
  timeZone?: () => string;
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Items sent with a question. The server keeps the last 40 turns and reads
 * only the component names of a screen, so sending the whole stored
 * conversation (up to 200 items, screens included) is wasted upload, and
 * past the server's 1 MB body limit every question would fail with a 413.
 * Sixty leaves room for notices (never sent) and for consecutive items the
 * server merges. The device keeps them all.
 */
export const MAX_SENT_ITEMS = 60;

/**
 * The assistant conversation and its runs. Client-only state on the app's
 * small Store (React reads it with useStore; tests drive it directly). The
 * conversation is saved to the device after each question and each run.
 */
export class AssistantSession extends Store<SessionState> {
  readonly #store: ConversationStore;
  readonly #stream: NonNullable<SessionDeps["stream"]>;
  readonly #newId: () => string;
  readonly #timeZone: () => string;
  #abort: AbortController | null = null;

  constructor(deps: SessionDeps) {
    // Not crypto.randomUUID: it exists only over https or on localhost (#114).
    const newId = deps.newId ?? (() => randomId());
    super({
      conversation: deps.store.load() ?? emptyConversation(newId()),
      running: false,
      activity: null,
      unavailable: null,
      actions: {},
    });
    this.#store = deps.store;
    this.#stream = deps.stream ?? (streamRun as NonNullable<SessionDeps["stream"]>);
    this.#newId = newId;
    this.#timeZone = deps.timeZone ?? browserZone;
  }

  #setItems(items: ChatItem[]): void {
    this.setState({ conversation: { ...this.state.conversation, items } });
  }

  #save(): void {
    this.#store.save(this.state.conversation);
  }

  /** Ask the assistant. Ignored while a run is going or for blank text. */
  async send(text: string, view?: string): Promise<void> {
    const question = text.trim();
    if (!question || this.state.running) return;
    const items: ChatItem[] = [...this.state.conversation.items, { kind: "user", id: this.#newId(), text: question }];
    this.#setItems(items);
    this.setState({ running: true, activity: null });
    this.#save();

    const abort = new AbortController();
    this.#abort = abort;
    let run = startRun(items);
    let notice: { text: string; tone: "info" | "error" } | null = null;
    try {
      const events = this.#stream(
        {
          threadId: this.state.conversation.threadId,
          runId: this.#newId(),
          messages: toAguiMessages(items.slice(-MAX_SENT_ITEMS)),
          timeZone: this.#timeZone(),
          view,
        },
        { signal: abort.signal },
      );
      for await (const event of events) {
        run = applyEvent(run, event as never);
        this.#setItems(run.items);
        this.setState({ activity: run.activity });
      }
      notice = endOfRunNotice(run);
      this.setState({ unavailable: null });
    } catch (err) {
      notice = abort.signal.aborted ? { text: "Stopped.", tone: "info" } : failureNotice(err);
      if (err instanceof AgentHttpError && err.status === 503) this.setState({ unavailable: err.reason ?? "no-provider" });
    } finally {
      if (this.#abort === abort) this.#abort = null;
      const finalItems = notice
        ? [...run.items, { kind: "notice" as const, id: this.#newId(), ...notice }]
        : run.items;
      this.#setItems(finalItems);
      this.setState({ running: false, activity: null });
      this.#save();
    }
  }

  /** Where the proposal with this action key stands, if anywhere (a stable object per state). */
  actionState(key: string): ActionState | undefined {
    if (this.state.conversation.applied?.[key]) {
      const createdId = this.state.conversation.created?.[key];
      if (!createdId) return APPLIED;
      // One object per created id, so useSyncExternalStore sees a stable value.
      let state = this.#createdStates.get(createdId);
      if (!state) this.#createdStates.set(createdId, (state = Object.freeze({ status: "applied", createdId })));
      return state;
    }
    return this.state.actions[key];
  }

  readonly #createdStates = new Map<string, ActionState>();

  /**
   * Carry out a confirmed action, once per key: a key already applied (also
   * before a reload) or still running is not run again. The key is checked
   * here, when the action is pressed, whatever the stored screen says.
   */
  async confirm(action: WriteAction, ports: OperationPorts): Promise<ActionResult> {
    const current = this.actionState(action.key);
    if (current?.status === "applied") return { ok: true, changed: 0 };
    if (current?.status === "running") return { ok: false, error: "Already in progress." };
    this.#setAction(action.key, { status: "running" });
    const result = await executeAction(action, ports, this.#keyFor(action));
    if (result.ok) {
      const conversation = this.state.conversation;
      this.setState({
        conversation: {
          ...conversation,
          applied: { ...conversation.applied, [action.key]: new Date().toISOString() },
          ...(result.createdId ? { created: { ...conversation.created, [action.key]: result.createdId } } : {}),
        },
      });
      this.#setAction(action.key, undefined);
      this.#save();
    } else {
      this.#setAction(action.key, { status: "failed", error: result.error });
    }
    return result;
  }

  /**
   * The idempotency key of a create (#114): made at random the first time it
   * is confirmed and saved before the request goes out, so a retry after a
   * lost answer, and a Confirm after a reload, send the same key and the
   * server makes the item once. The stored conversation is asked first:
   * another tab showing the same conversation may have confirmed this
   * proposal already, and its key must be the one sent. Other operations are
   * target states and send none.
   */
  #keyFor(action: WriteAction): string | undefined {
    if (!operation(action.name).creates) return undefined;
    const conversation = this.state.conversation;
    const mine = conversation.keys?.[action.key];
    if (mine) return mine;
    const stored = this.#store.load();
    const key = (stored?.threadId === conversation.threadId ? stored.keys?.[action.key] : undefined) ?? this.#newId();
    this.setState({ conversation: { ...conversation, keys: { ...conversation.keys, [action.key]: key } } });
    this.#save();
    return key;
  }

  #setAction(key: string, state: ActionState | undefined): void {
    const { [key]: _old, ...rest } = this.state.actions;
    this.setState({ actions: state ? { ...rest, [key]: state } : rest });
  }

  /** Stop the answer being streamed (what arrived so far stays). */
  stop(): void {
    this.#abort?.abort();
  }

  /** Forget the conversation, here and on the device, and start a new thread. */
  clear(): void {
    this.stop();
    this.#store.clear();
    this.setState({ conversation: emptyConversation(this.#newId()), activity: null, actions: {} });
  }
}

/** What to tell the user when a run could not start or broke off. */
export function failureNotice(err: unknown): { text: string; tone: "error" } {
  if (err instanceof AgentHttpError) {
    if (err.status === 401) return { text: "The server did not accept the API token. Check it in Settings.", tone: "error" };
    if (err.status === 503) return { text: err.message || "The assistant is unavailable right now.", tone: "error" };
    return { text: `The assistant could not answer (${err.status}). Try again.`, tone: "error" };
  }
  return { text: "Could not reach the server. Check your connection and try again.", tone: "error" };
}
