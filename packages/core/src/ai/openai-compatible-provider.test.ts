import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider, toChatMessages } from "./openai-compatible-provider.js";

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
