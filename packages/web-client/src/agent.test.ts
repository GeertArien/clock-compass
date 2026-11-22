import { describe, expect, it } from "vitest";
import type { BaseEvent } from "@ag-ui/core";
import {
  AgentHttpError,
  applyEvent,
  endOfRunNotice,
  getAgentStatus,
  parseSse,
  startRun,
  streamRun,
  type RunState,
} from "./agent";

const encoder = new TextEncoder();

/** A body that delivers the given chunks one by one (split anywhere). */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

describe("parseSse", () => {
  it("reads events split across chunks, and skips heartbeat comments and garbage", async () => {
    const text = [
      ": ping\n\n",
      sse({ type: "RUN_STARTED", threadId: "t", runId: "r" }),
      "data: not json\n\n",
      sse({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "héllo" }),
      ": ping\r\n\r\n",
      sse({ type: "RUN_FINISHED", threadId: "t", runId: "r" }),
    ].join("");
    // Split in 7-byte pieces, cutting through events and a multi-byte character.
    const bytes = encoder.encode(text);
    const pieces: string[] = [];
    const decoder = new TextDecoder();
    for (let i = 0; i < bytes.length; i += 7) pieces.push(decoder.decode(bytes.slice(i, i + 7), { stream: true }));
    const events = await collect(parseSse(body(pieces)));
    expect(events.map((e) => e.type)).toEqual(["RUN_STARTED", "TEXT_MESSAGE_CONTENT", "RUN_FINISHED"]);
    expect((events[1] as unknown as { delta: string }).delta).toBe("héllo");
  });
});

describe("streamRun", () => {
  it("posts a RunAgentInput with the time zone and screen, and the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body([sse({ type: "RUN_STARTED", threadId: "t", runId: "r" })]), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;
    const events = await collect(
      streamRun(
        { threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "hi" }], timeZone: "Europe/Brussels", view: "Clock · Today" },
        { fetch: fetchStub, token: "secret" },
      ),
    );
    expect(events).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/agent");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer secret", Accept: "text/event-stream" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      threadId: "t",
      runId: "r",
      state: {},
      messages: [{ id: "u", role: "user", content: "hi" }],
      tools: [],
      context: [],
      forwardedProps: { timeZone: "Europe/Brussels", view: "Clock · Today" },
    });
  });

  it("throws the server's error and reason for an HTTP error", async () => {
    const fetchStub = (async () =>
      new Response(JSON.stringify({ error: "The assistant is unavailable with the configured AI provider.", reason: "unsupported-provider" }), {
        status: 503,
      })) as unknown as typeof fetch;
    const run = collect(streamRun({ threadId: "t", runId: "r", messages: [], timeZone: "UTC" }, { fetch: fetchStub }));
    await expect(run).rejects.toMatchObject({
      name: "AgentHttpError",
      status: 503,
      reason: "unsupported-provider",
      message: "The assistant is unavailable with the configured AI provider.",
    });
    await expect(run).rejects.toBeInstanceOf(AgentHttpError);
  });

  it("reads the status", async () => {
    const fetchStub = (async () => new Response(JSON.stringify({ available: false, reason: "no-provider" }))) as unknown as typeof fetch;
    expect(await getAgentStatus({ fetch: fetchStub })).toEqual({ available: false, reason: "no-provider" });
  });
});

const run = (events: object[], initial = startRun([{ kind: "user", id: "u", text: "hi" }])): RunState =>
  events.reduce<RunState>((state, event) => applyEvent(state, event as BaseEvent), initial);

describe("applyEvent", () => {
  it("builds the answer: text messages, a screen, the activity while a tool runs", () => {
    const mid = run([
      { type: "RUN_STARTED" },
      { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Let me " },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "look." },
      { type: "TEXT_MESSAGE_END", messageId: "m1" },
      { type: "STEP_STARTED", stepName: "list_tasks" },
    ]);
    expect(mid.activity).toBe("Reading your tasks…");
    const end = run(
      [
        { type: "STEP_FINISHED", stepName: "list_tasks" },
        { type: "ACTIVITY_SNAPSHOT", messageId: "a2ui-surface-r1", activityType: "a2ui-surface", content: { a2ui_operations: [{ version: "1.0" }] }, replace: true },
        { type: "ACTIVITY_SNAPSHOT", messageId: "other", activityType: "something-else", content: {} },
        { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" },
        { type: "TEXT_MESSAGE_END", messageId: "m2" },
        { type: "RUN_FINISHED", result: { reason: "end" } },
      ],
      mid,
    );
    expect(end.items).toEqual([
      { kind: "user", id: "u", text: "hi" },
      { kind: "assistant", id: "m1", text: "Let me look." },
      { kind: "surface", id: "a2ui-surface-r1", operations: [{ version: "1.0" }] },
    ]);
    expect(end).toMatchObject({ activity: null, answered: true, ended: { kind: "finished", reason: "end" } });
    expect(endOfRunNotice(end)).toBeNull();
  });

  it("does not change the state it was given", () => {
    const before = startRun([]);
    const frozen = JSON.stringify(before);
    applyEvent(before, { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x" } as BaseEvent);
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe("endOfRunNotice: a run never ends in silence", () => {
  it("says something for each way a run can end without an answer", () => {
    const ended = (reason?: string) => run([{ type: "RUN_FINISHED", ...(reason ? { result: { reason } } : {}) }]);
    expect(endOfRunNotice(ended("step-limit"))).toMatchObject({ tone: "info", text: expect.stringMatching(/more steps/) });
    expect(endOfRunNotice(ended("max_tokens"))).toMatchObject({ tone: "info", text: expect.stringMatching(/cut off/) });
    expect(endOfRunNotice(ended("refusal"))).toMatchObject({ tone: "info", text: expect.stringMatching(/declined/) });
    expect(endOfRunNotice(ended())).toMatchObject({ text: "No answer came back. Try again." });
    expect(endOfRunNotice(run([{ type: "RUN_STARTED" }]))).toMatchObject({ tone: "error", text: expect.stringMatching(/stopped/) });
    expect(endOfRunNotice(run([{ type: "RUN_ERROR", message: "The assistant could not answer. Try again in a moment." }]))).toEqual({
      tone: "error",
      text: "The assistant could not answer. Try again in a moment.",
    });
  });

  it("stays quiet when the run answered, even if cut off afterwards", () => {
    const answered = run([
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Partial answer" },
      { type: "RUN_FINISHED", result: { reason: "max_tokens" } },
    ]);
    expect(endOfRunNotice(answered)).toBeNull();
  });
});
