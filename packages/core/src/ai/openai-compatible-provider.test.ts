import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider, toChatMessages } from "./openai-compatible-provider.js";
import { MISSION_SYSTEM } from "./prompts.js";

function completionResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenAiCompatibleProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1/", // trailing slash on purpose
    model: "llama3.2",
  });

  it("calls /chat/completions with json_object mode and parses the classification", async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(
        JSON.stringify({
          title: "Call mom",
          important: true,
          urgent: false,
          proactivity: "INFLUENCE",
          dueDate: "2026-06-13",
          rationale: "Relationships are Q2.",
        }),
      ),
    );

    const result = await provider.classifyTask("call mom this weekend", "2026-06-10");
    expect(result).toMatchObject({
      title: "Call mom",
      important: true,
      urgent: false,
      proactivity: "INFLUENCE",
      dueDate: "2026-06-13",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("llama3.2");
    expect(body.response_format).toEqual({ type: "json_object" });
    // No Authorization header when no key is configured (local runtimes).
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("falls back to safe values when the model strays from the shape", async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(JSON.stringify({ important: "yes", dueDate: "soon" })),
    );
    const result = await provider.classifyTask("water the plants", "2026-06-10");
    expect(result).toMatchObject({
      title: "water the plants",
      important: false,
      urgent: false,
      proactivity: null,
      dueDate: null,
    });
  });

  it("sends a bearer token when a key is configured and surfaces HTTP errors", async () => {
    const keyed = new OpenAiCompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
    });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(keyed.refineMission("draft")).rejects.toThrow(/401/);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
  });

  it("returns prose jobs without response_format", async () => {
    fetchMock.mockResolvedValueOnce(completionResponse("A refined mission."));
    const refined = await provider.refineMission("my draft");
    expect(refined).toBe("A refined mission.");
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toBeUndefined();
  });

  it("sends the other jobs exactly as before #130: one system message, no stream_options", async () => {
    fetchMock.mockResolvedValue(completionResponse("A refined mission."));
    await provider.refineMission("my draft");
    await provider.weeklyReview({} as never).catch(() => undefined);
    const bodies = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as string);
    expect(bodies[0]).toBe(
      JSON.stringify({ model: "llama3.2", messages: [{ role: "system", content: MISSION_SYSTEM }, { role: "user", content: "my draft" }] }),
    );
    for (const body of bodies) {
      expect(body).not.toContain("stream_options");
      expect(JSON.parse(body).messages.filter((m: { role: string }) => m.role === "system")).toHaveLength(1);
    }
  });
});

describe("OpenAiCompatibleProvider.assistantTurn", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.2" });

  /** A chat-completions SSE stream, split at awkward places like a real network read. */
  function sseStream(chunks: unknown[], splitEvery = 17): Response {
    const text = chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
    const encoder = new TextEncoder();
    const pieces = text.match(new RegExp(`[\\s\\S]{1,${splitEvery}}`, "g")) ?? [];
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const piece of pieces) controller.enqueue(encoder.encode(piece));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  async function drain(iterable: AsyncIterable<unknown>) {
    const out: unknown[] = [];
    for await (const e of iterable) out.push(e);
    return out;
  }

  const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
    choices: [{ index: 0, delta: d, finish_reason: finish }],
  });

  it("streams text and assembles tool calls from fragments", async () => {
    fetchMock.mockResolvedValueOnce(
      sseStream([
        delta({ role: "assistant", content: "Let me " }),
        delta({ content: "look." }),
        delta({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "list_tasks", arguments: "" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"quadrant":' } }] }),
        delta({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "list_goals", arguments: "{}" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"Q2"}' } }] }),
        delta({}, "tool_calls"),
        "[DONE]",
      ]),
    );
    const events = await drain(
      provider.assistantTurn({
        system: "sys",
        messages: [{ role: "user", content: "Q2?" }],
        tools: [{ name: "list_tasks", description: "List tasks", inputSchema: { type: "object", properties: {} } }],
      }),
    );
    expect(events).toEqual([
      { type: "text", delta: "Let me " },
      { type: "text", delta: "look." },
      {
        type: "turn-end",
        stopReason: "tool_use",
        message: {
          role: "assistant",
          text: "Let me look.",
          toolCalls: [
            { id: "call_a", name: "list_tasks", args: { quadrant: "Q2" } },
            { id: "call_b", name: "list_goals", args: {} },
          ],
        },
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "llama3.2",
      stream: true,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "Q2?" },
      ],
      tools: [{ type: "function", function: { name: "list_tasks", description: "List tasks", parameters: { type: "object" } } }],
    });
  });

  it("maps finish reasons, and passes unparseable arguments on as text for the loop to reject", async () => {
    fetchMock.mockResolvedValueOnce(
      sseStream([
        delta({ tool_calls: [{ index: 0, id: "c", function: { name: "list_tasks", arguments: "{not json" } }] }),
        delta({}, "length"),
        "[DONE]",
      ]),
    );
    const events = await drain(provider.assistantTurn({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }));
    expect(events.at(-1)).toMatchObject({
      stopReason: "max_tokens",
      message: { toolCalls: [{ id: "c", name: "list_tasks", args: "{not json" }] },
    });
  });

  it("ends a plain answer with 'end' and leaves out tools when there are none", async () => {
    fetchMock.mockResolvedValueOnce(sseStream([delta({ content: "Hi." }), delta({}, "stop"), "[DONE]"]));
    const events = await drain(provider.assistantTurn({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }));
    expect(events.at(-1)).toMatchObject({ stopReason: "end", message: { text: "Hi.", toolCalls: [] } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty("tools");
  });

  it("throws on an error object inside the stream instead of ending as a finished answer", async () => {
    fetchMock.mockResolvedValueOnce(
      sseStream([delta({ content: "Hello" }), { error: { message: "upstream timed out", type: "server_error" } }, "[DONE]"]),
    );
    await expect(drain(provider.assistantTurn({ system: "s", messages: [], tools: [] }))).rejects.toThrow(
      "AI provider error: upstream timed out",
    );
  });

  it("keeps tool calls apart when the server leaves out `index`", async () => {
    fetchMock.mockResolvedValueOnce(
      sseStream([
        delta({ tool_calls: [{ id: "a", type: "function", function: { name: "list_tasks", arguments: '{"quadrant":' } }] }),
        delta({ tool_calls: [{ function: { arguments: '"Q2"}' } }] }),
        delta({ tool_calls: [{ id: "b", type: "function", function: { name: "list_goals", arguments: "{}" } }] }),
        delta({}, "tool_calls"),
        "[DONE]",
      ]),
    );
    const events = await drain(provider.assistantTurn({ system: "s", messages: [], tools: [] }));
    expect(events.at(-1)).toMatchObject({
      stopReason: "tool_use",
      message: {
        toolCalls: [
          { id: "a", name: "list_tasks", args: { quadrant: "Q2" } },
          { id: "b", name: "list_goals", args: {} },
        ],
      },
    });
  });

  it("sends no max_tokens unless the caller sets one", async () => {
    fetchMock.mockResolvedValueOnce(sseStream([delta({ content: "a" }), delta({}, "stop"), "[DONE]"]));
    await drain(provider.assistantTurn({ system: "s", messages: [], tools: [] }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty("max_tokens");
    fetchMock.mockResolvedValueOnce(sseStream([delta({ content: "a" }), delta({}, "stop"), "[DONE]"]));
    await drain(provider.assistantTurn({ system: "s", messages: [], tools: [], maxTokens: 2048 }));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ max_tokens: 2048 });
  });

  const ok = () => sseStream([delta({ content: "a" }), delta({}, "stop"), "[DONE]"]);
  const bodyOf = (call: number) => fetchMock.mock.calls[call]![1].body as string;

  it("sends exactly one system message (the fixed prompt) and opens the first user message with the context (#130)", async () => {
    const fresh = new OpenAiCompatibleProvider({ baseUrl: "http://gw/v1", model: "claude-sonnet" });
    fetchMock.mockResolvedValueOnce(ok());
    await drain(
      fresh.assistantTurn({
        system: "fixed",
        systemTail: "Today is 2026-11-25.\nThe user is looking at this screen: \"Clock · Week\".",
        messages: [
          { role: "user", content: "What is on Thursday?" },
          { role: "assistant", text: "Two tasks.", toolCalls: [] },
          { role: "user", content: "And Friday?" },
        ],
        tools: [{ name: "list_tasks", description: "List tasks", inputSchema: { type: "object" } }],
      }),
    );
    // The whole request, exactly: before #130 the first message was
    // {"role":"system","content":"fixed\nToday is …"} and there was no stream_options.
    expect(bodyOf(0)).toBe(
      JSON.stringify({
        model: "claude-sonnet",
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: "fixed" },
          {
            role: "user",
            content: '[Context from the app, not typed by the user: Today is 2026-11-25.\nThe user is looking at this screen: "Clock · Week".]\n\nWhat is on Thursday?',
          },
          { role: "assistant", content: "Two tasks." },
          { role: "user", content: "And Friday?" },
        ],
        tools: [{ type: "function", function: { name: "list_tasks", description: "List tasks", parameters: { type: "object" } } }],
      }),
    );
  });

  it("keeps the context in the system message when there is no user message", () => {
    expect(toChatMessages("fixed", [], "Today is 2026-11-25.")).toEqual([{ role: "system", content: "fixed\nToday is 2026-11-25." }]);
  });

  it("reports the token numbers of the stream's last chunk, and nothing when there are none (#130)", async () => {
    const seen: unknown[] = [];
    const fresh = new OpenAiCompatibleProvider({ baseUrl: "http://gw/v1", model: "claude-sonnet", onUsage: (u) => seen.push(u) });
    fetchMock.mockResolvedValueOnce(
      sseStream([
        delta({ content: "a" }),
        delta({}, "stop"),
        // LiteLLM's last chunk: no choices, the usage.
        { choices: [], usage: { prompt_tokens: 5210, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 4980 }, cache_creation_input_tokens: 0 } },
        "[DONE]",
      ]),
    );
    const events = await drain(fresh.assistantTurn({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] }));
    expect(events.at(-1)).toMatchObject({ type: "turn-end", stopReason: "end" });
    expect(seen).toEqual([{ promptTokens: 5210, cachedTokens: 4980, cacheWriteTokens: 0 }]);

    fetchMock.mockResolvedValueOnce(sseStream([delta({ content: "a" }), delta({}, "stop"), { choices: [], usage: { prompt_tokens: 40 } }, "[DONE]"]));
    await drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }));
    expect(seen.at(-1)).toEqual({ promptTokens: 40, cachedTokens: null, cacheWriteTokens: null });

    fetchMock.mockResolvedValueOnce(ok());
    await drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }));
    expect(seen).toHaveLength(2);
  });

  it("asks once more without stream_options on a 400 or 422, and not again (#130)", async () => {
    for (const status of [400, 422]) {
      fetchMock.mockReset();
      const fresh = new OpenAiCompatibleProvider({ baseUrl: "http://local/v1", model: "m" });
      fetchMock.mockResolvedValueOnce(new Response("Unrecognized request argument: stream_options", { status }));
      fetchMock.mockResolvedValueOnce(ok());
      const events = await drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }));
      expect(events.at(-1)).toMatchObject({ type: "turn-end" });
      expect(JSON.parse(bodyOf(0))).toHaveProperty("stream_options");
      expect(JSON.parse(bodyOf(1))).not.toHaveProperty("stream_options");
      fetchMock.mockResolvedValueOnce(ok());
      await drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(JSON.parse(bodyOf(2))).not.toHaveProperty("stream_options");
    }
  });

  it("does not retry on a 401, 429 or 5xx: those are not about the field", async () => {
    for (const status of [401, 429, 500, 503]) {
      fetchMock.mockReset();
      const fresh = new OpenAiCompatibleProvider({ baseUrl: "http://gw/v1", model: "m" });
      fetchMock.mockResolvedValueOnce(new Response("no", { status }));
      await expect(drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }))).rejects.toThrow(new RegExp(`${status}: no`));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("a second refusal after the retry is reported as the provider's own error", async () => {
    const fresh = new OpenAiCompatibleProvider({ baseUrl: "http://gw/v1", model: "m" });
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    fetchMock.mockResolvedValueOnce(new Response("model not allowed", { status: 400 }));
    await expect(drain(fresh.assistantTurn({ system: "s", messages: [], tools: [] }))).rejects.toThrow(/400: model not allowed/);
  });

  it("throws on an HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("model not found", { status: 404 }));
    await expect(drain(provider.assistantTurn({ system: "s", messages: [], tools: [] }))).rejects.toThrow(/404: model not found/);
  });

  it("maps the neutral conversation to chat messages with tool calls and tool results", () => {
    expect(
      toChatMessages("sys", [
        { role: "user", content: "hi" },
        { role: "assistant", text: "", toolCalls: [{ id: "a", name: "list_tasks", args: { quadrant: "Q2" } }] },
        { role: "tool", toolCallId: "a", name: "list_tasks", content: "[]" },
      ]),
    ).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "a", type: "function", function: { name: "list_tasks", arguments: '{"quadrant":"Q2"}' } }],
      },
      { role: "tool", tool_call_id: "a", content: "[]" },
    ]);
  });
});
