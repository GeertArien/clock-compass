import { describe, expect, it, vi } from "vitest";
import { AgentHttpError, type RunRequest, type StreamOptions } from "@clock-compass/web-client/agent";
import type { Conversation, ConversationStore } from "@clock-compass/web-client/conversation";
import { parseAction } from "@clock-compass/assistant-catalog";
import type { Task } from "@clock-compass/web-client/api";
import type { OperationPorts, WriteAction } from "./actions";
import { AssistantSession, MAX_SENT_ITEMS } from "./session";

/** A store that records what was saved. */
function memoryStore(initial: Conversation | null = null) {
  let saved = initial;
  const store: ConversationStore & { saved: () => Conversation | null; clears: number } = {
    clears: 0,
    load: () => saved,
    save: (c) => void (saved = structuredClone(c)),
    clear() {
      saved = null;
      store.clears++;
    },
    saved: () => saved,
  };
  return store;
}

let seq = 0;
const newId = () => `id${++seq}`;

function scriptedStream(events: object[], options: { fail?: unknown; hang?: boolean } = {}) {
  const requests: RunRequest[] = [];
  const stream = async function* (request: RunRequest, opts: StreamOptions) {
    requests.push(request);
    if (options.fail) throw options.fail;
    for (const event of events) yield event as { type: string };
    if (options.hang) {
      await new Promise<void>((_, reject) => {
        const stop = () => reject(new DOMException("aborted", "AbortError"));
        if (opts.signal?.aborted) stop();
        else opts.signal?.addEventListener("abort", stop);
      });
    }
  };
  return { stream, requests };
}

const answer = [
  { type: "RUN_STARTED" },
  { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Your one Q2 task is the garden." },
  { type: "TEXT_MESSAGE_END", messageId: "m1" },
  { type: "RUN_FINISHED", result: { reason: "end" } },
];

describe("AssistantSession", () => {
  it("sends the question with the history, the time zone and the screen, and keeps the answer on the device", async () => {
    const store = memoryStore();
    const { stream, requests } = scriptedStream(answer);
    const session = new AssistantSession({ store, stream, newId, timeZone: () => "Europe/Brussels" });
    await session.send("  What are my Q2 tasks? ", "Clock · Today");

    expect(requests[0]).toMatchObject({
      threadId: session.state.conversation.threadId,
      timeZone: "Europe/Brussels",
      view: "Clock · Today",
      messages: [{ role: "user", content: "What are my Q2 tasks?" }],
    });
    expect(session.state.conversation.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(session.state).toMatchObject({ running: false, activity: null });
    expect(store.saved()).toEqual(session.state.conversation);
  });

  it("restores the conversation from the device, and sends it back with the next question", async () => {
    const store = memoryStore();
    await new AssistantSession({ store, stream: scriptedStream(answer).stream, newId }).send("First");
    const { stream, requests } = scriptedStream(answer);
    const reopened = new AssistantSession({ store, stream, newId });
    expect(reopened.state.conversation.items).toHaveLength(2);
    await reopened.send("Second");
    expect(requests[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("sends only the newest items with a question, while the device keeps them all", async () => {
    const stored: Conversation = {
      version: 1,
      threadId: "t",
      items: Array.from({ length: 150 }, (_, i) =>
        i % 2 === 0 ? { kind: "user" as const, id: `u${i}`, text: `q${i}` } : { kind: "assistant" as const, id: `a${i}`, text: `a${i}` },
      ),
    };
    const store = memoryStore(stored);
    const { stream, requests } = scriptedStream(answer);
    await new AssistantSession({ store, stream, newId }).send("Newest question");
    expect(requests[0]!.messages).toHaveLength(MAX_SENT_ITEMS);
    expect(requests[0]!.messages.at(-1)).toMatchObject({ role: "user", content: "Newest question" });
    expect(store.saved()!.items).toHaveLength(152);
  });

  it("adds a notice when a run ends without an answer, and never sends notices back", async () => {
    const store = memoryStore();
    const first = scriptedStream([{ type: "RUN_FINISHED", result: { reason: "step-limit" } }]);
    const session = new AssistantSession({ store, stream: first.stream, newId });
    await session.send("Plan everything");
    expect(session.state.conversation.items.at(-1)).toMatchObject({ kind: "notice", tone: "info", text: expect.stringMatching(/more steps/) });

    const second = scriptedStream(answer);
    const next = new AssistantSession({ store, stream: second.stream, newId });
    await next.send("Try again");
    expect(second.requests[0]!.messages.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("turns failures into notices: unavailable (and remembers why), a refused token, no network", async () => {
    const unavailable = new AssistantSession({
      store: memoryStore(),
      newId,
      stream: scriptedStream([], { fail: new AgentHttpError(503, "The assistant is unavailable with the configured AI provider.", "unsupported-provider") }).stream,
    });
    await unavailable.send("hi");
    expect(unavailable.state.unavailable).toBe("unsupported-provider");
    expect(unavailable.state.conversation.items.at(-1)).toMatchObject({ kind: "notice", tone: "error", text: "The assistant is unavailable with the configured AI provider." });

    const refused = new AssistantSession({ store: memoryStore(), newId, stream: scriptedStream([], { fail: new AgentHttpError(401, "Unauthorized") }).stream });
    await refused.send("hi");
    expect(refused.state.conversation.items.at(-1)).toMatchObject({ text: expect.stringMatching(/API token/) });

    const offline = new AssistantSession({ store: memoryStore(), newId, stream: scriptedStream([], { fail: new TypeError("Failed to fetch") }).stream });
    await offline.send("hi");
    expect(offline.state.conversation.items.at(-1)).toMatchObject({ text: expect.stringMatching(/reach the server/) });
    expect(offline.state.running).toBe(false);
  });

  it("stops a running answer, keeping what arrived", async () => {
    const { stream } = scriptedStream(answer.slice(0, 3), { hang: true });
    const session = new AssistantSession({ store: memoryStore(), stream, newId });
    const sending = session.send("Long question");
    await new Promise((r) => setTimeout(r, 0));
    expect(session.state.running).toBe(true);
    session.stop();
    await sending;
    expect(session.state.conversation.items.map((i) => i.kind)).toEqual(["user", "assistant", "notice"]);
    expect(session.state.conversation.items.at(-1)).toMatchObject({ text: "Stopped.", tone: "info" });
  });

  it("ignores blank text and a second question while one is running", async () => {
    const { stream, requests } = scriptedStream(answer.slice(0, 1), { hang: true });
    const session = new AssistantSession({ store: memoryStore(), stream, newId });
    await session.send("   ");
    const first = session.send("One");
    await session.send("Two");
    session.stop();
    await first;
    expect(requests).toHaveLength(1);
  });

  it("clears the conversation here and on the device, with a new thread", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    await session.send("hi");
    const thread = session.state.conversation.threadId;
    session.clear();
    expect(session.state.conversation.items).toEqual([]);
    expect(session.state.conversation.threadId).not.toBe(thread);
    expect(store.saved()).toBeNull();
    expect(store.clears).toBe(1);
  });
});

describe("confirmed actions", () => {
  const plan = (surfaceId = "plan-1"): WriteAction => {
    const parsed = parseAction({ name: "setTaskDone", surfaceId, context: { taskId: "t1", done: true } });
    if (parsed.kind !== "write") throw new Error("not a write");
    return parsed;
  };
  const openTask = { id: "t1", title: "Plan the garden", status: "TODO", important: true, urgent: false, isBigRock: false } as Task;

  function fakePorts(options: { fail?: boolean } = {}) {
    const writes: string[] = [];
    let gate: () => void = () => {};
    const ports: OperationPorts = {
      data: () => ({ tasks: [openTask] }),
      run: async (_name, input) => {
        await new Promise<void>((resolve) => (gate = resolve));
        if (options.fail) throw new Error("Internal Server Error");
        writes.push(String(input.taskId));
        return { changed: 1 };
      },
      refresh: async () => {},
    };
    return { ports, writes, release: () => gate() };
  }

  it("carries out an action once per key, and remembers it on the device", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    const { ports, writes, release } = fakePorts();
    const first = session.confirm(plan(), ports);
    await new Promise((r) => setTimeout(r, 0));
    expect(session.actionState(plan().key)).toEqual({ status: "running" });
    expect(await session.confirm(plan(), ports)).toEqual({ ok: false, error: "Already in progress." });
    release();
    expect(await first).toEqual({ ok: true, changed: 1 });
    expect(session.actionState(plan().key)).toEqual({ status: "applied" });
    expect(writes).toEqual(["t1"]);

    // After a reload the same proposal is still applied and is not run again.
    const reopened = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    expect(reopened.actionState(plan().key)).toEqual({ status: "applied" });
    expect(await reopened.confirm(plan(), fakePorts().ports)).toEqual({ ok: true, changed: 0 });
    // Another proposal (another surface) with the same arguments is its own action.
    expect(reopened.actionState(plan("plan-2").key)).toBeUndefined();
  });

  it("remembers “Not now” on the device, after a reload too, and never over an applied proposal (#145)", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    session.dismiss(plan().key);
    expect(session.actionState(plan().key)).toEqual({ status: "dismissed" });
    expect(store.saved()!.dismissed).toEqual({ [plan().key]: expect.any(String) });
    const reopened = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    expect(reopened.actionState(plan().key)).toEqual({ status: "dismissed" });
    expect(reopened.actionState(plan("plan-2").key)).toBeUndefined();

    // An applied proposal stays applied.
    const { ports, release } = fakePorts();
    const done = session.confirm(plan("plan-3"), ports);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await done;
    session.dismiss(plan("plan-3").key);
    expect(session.actionState(plan("plan-3").key)).toEqual({ status: "applied" });
  });

  it("reports a failure and lets the user confirm again", async () => {
    const session = new AssistantSession({ store: memoryStore(), stream: scriptedStream(answer).stream, newId });
    const failing = fakePorts({ fail: true });
    const attempt = session.confirm(plan(), failing.ports);
    await new Promise((r) => setTimeout(r, 0));
    failing.release();
    expect(await attempt).toEqual({ ok: false, error: "This was not done: Internal Server Error." });
    expect(session.actionState(plan().key)).toEqual({ status: "failed", error: "This was not done: Internal Server Error." });

    const working = fakePorts();
    const retry = session.confirm(plan(), working.ports);
    await new Promise((r) => setTimeout(r, 0));
    working.release();
    expect(await retry).toEqual({ ok: true, changed: 1 });
  });

  it("remembers the id of the task a confirmed create made, after a reload too (#109)", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    const parsed = parseAction({ name: "createTask", surfaceId: "new-1", context: { title: "Call mum" } });
    if (parsed.kind !== "write") throw new Error("not a write");
    let runs = 0;
    const ports: OperationPorts = {
      data: () => undefined,
      run: async () => (runs++, { changed: 1, id: "kmade" }),
      refresh: async () => {},
    };
    expect(await session.confirm(parsed, ports)).toEqual({ ok: true, changed: 1, createdId: "kmade" });
    expect(session.actionState(parsed.key)).toEqual({ status: "applied", createdId: "kmade" });
    expect(session.actionState(parsed.key)).toBe(session.actionState(parsed.key));
    const reopened = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    expect(reopened.actionState(parsed.key)).toEqual({ status: "applied", createdId: "kmade" });
    expect(await reopened.confirm(parsed, ports)).toEqual({ ok: true, changed: 0 });
    expect(runs).toBe(1);
  });

  it("forgets applied actions with Clear, together with the conversation", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    const { ports, release } = fakePorts();
    const done = session.confirm(plan(), ports);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await done;
    session.clear();
    expect(session.actionState(plan().key)).toBeUndefined();
    expect(store.saved()).toBeNull();
  });
});

describe("over plain http on a home network (#114)", () => {
  const create = (): WriteAction => {
    const parsed = parseAction({ name: "createTask", surfaceId: "new-9", context: { title: "Call mum" } });
    if (parsed.kind !== "write") throw new Error("not a write");
    return parsed;
  };

  it("starts, and makes its ids, with a crypto that has only getRandomValues (no randomUUID, no subtle)", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    try {
      const store = memoryStore();
      const { stream, requests } = scriptedStream(answer);
      const session = new AssistantSession({ store, stream });
      expect(session.state.conversation.threadId).toMatch(/^[0-9a-f]{32}$/);
      await session.send("Hello");
      expect(requests[0]?.runId).toMatch(/^[0-9a-f]{32}$/);
      // A create gets a key the same way.
      const sent: (string | undefined)[] = [];
      const ports: OperationPorts = { data: () => undefined, run: async (_n, _i, key) => (sent.push(key), { changed: 1, id: "k1" }), refresh: async () => {} };
      expect(await session.confirm(create(), ports)).toMatchObject({ ok: true });
      expect(sent[0]).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends a create's key on a retry after a lost answer and after a reload; stores it before sending", async () => {
    const store = memoryStore();
    const session = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    const sent: (string | undefined)[] = [];
    const savedKeyAtSend: (string | undefined)[] = [];
    const lost: OperationPorts = {
      data: () => undefined,
      run: async (_n, _i, key) => {
        sent.push(key);
        savedKeyAtSend.push(store.saved()?.keys?.[create().key]);
        throw new TypeError("Failed to fetch"); // the answer never arrived
      },
      refresh: async () => {},
    };
    expect(await session.confirm(create(), lost)).toMatchObject({ ok: false });
    // The page is reloaded before the second Confirm.
    const reopened = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    await reopened.confirm(create(), lost);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBeTruthy();
    expect(sent[1]).toBe(sent[0]);
    expect(savedKeyAtSend).toEqual([sent[0], sent[0]]);
  });

  it("sends the key another tab stored for the same proposal, so two tabs make one item", async () => {
    // Both tabs opened the stored conversation, with the proposal in it.
    const store = memoryStore({ version: 1, threadId: "t", items: [] });
    const first = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    // The second tab opened before the first one confirmed.
    const second = new AssistantSession({ store, stream: scriptedStream(answer).stream, newId });
    const sent: (string | undefined)[] = [];
    const ports: OperationPorts = { data: () => undefined, run: async (_n, _i, key) => (sent.push(key), { changed: 1, id: "k1" }), refresh: async () => {} };
    await first.confirm(create(), ports);
    await second.confirm(create(), ports);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  it("sends no key for an operation that does not create", async () => {
    const session = new AssistantSession({ store: memoryStore(), stream: scriptedStream(answer).stream, newId });
    const parsed = parseAction({ name: "setTaskDone", surfaceId: "s-9", context: { taskId: "t1", done: true } });
    if (parsed.kind !== "write") throw new Error("not a write");
    const sent: (string | undefined)[] = [];
    await session.confirm(parsed, { data: () => undefined, run: async (_n, _i, key) => (sent.push(key), { changed: 1 }), refresh: async () => {} });
    expect(sent).toEqual([undefined]);
    expect(session.state.conversation.keys).toBeUndefined();
  });
});
