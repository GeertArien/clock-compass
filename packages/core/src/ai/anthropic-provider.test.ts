import { describe, expect, it } from "vitest";
import { AnthropicAiProvider, toAnthropicMessages } from "./anthropic-provider.js";
import type { AgentMessage, AssistantTurnEvent } from "./provider.js";

/** A recorded Messages API stream: text, then a tool call whose input arrives in pieces. */
const SSE_TOOL_TURN = [
  ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-4-8", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "check." } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "list_tasks", input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"quad' } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'rant": "Q2"}' } }],
  ["content_block_stop", { type: "content_block_stop", index: 1 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } }],
  ["message_stop", { type: "message_stop" }],
] as const;

function sseResponse(events: readonly (readonly [string, unknown])[]): Response {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function drain(iterable: AsyncIterable<AssistantTurnEvent>) {
  const events: AssistantTurnEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("AnthropicAiProvider.assistantTurn", () => {
  it("streams text deltas, then the tool call with its parsed input and the stop reason", async () => {
    const bodies: unknown[] = [];
    const fetchStub = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sseResponse(SSE_TOOL_TURN);
    }) as typeof fetch;
    const provider = new AnthropicAiProvider({ apiKey: "test", model: "claude-opus-4-8", fetch: fetchStub });

    const events = await drain(
      provider.assistantTurn({
        system: "sys",
        messages: [{ role: "user", content: "What are my Q2 tasks?" }],
        tools: [{ name: "list_tasks", description: "List tasks", inputSchema: { type: "object", properties: {} } }],
      }),
    );

    expect(events.slice(0, 2)).toEqual([
      { type: "text", delta: "Let me " },
      { type: "text", delta: "check." },
    ]);
    expect(events[2]).toMatchObject({
      type: "turn-end",
      stopReason: "tool_use",
      message: {
        role: "assistant",
        text: "Let me check.",
        toolCalls: [{ id: "toolu_1", name: "list_tasks", args: { quadrant: "Q2" } }],
      },
    });
    expect(events).toHaveLength(3);
    expect(bodies[0]).toMatchObject({
      model: "claude-opus-4-8",
      stream: true,
      cache_control: { type: "ephemeral" },
      system: "sys",
      tools: [{ name: "list_tasks", description: "List tasks", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "What are my Q2 tasks?" }],
    });
  });

  it("maps an end_turn to 'end' and keeps the content blocks to replay", async () => {
    const turn = [
      SSE_TOOL_TURN[0],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "All good." } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
      ["message_stop", { type: "message_stop" }],
    ] as const;
    const provider = new AnthropicAiProvider({ apiKey: "test", fetch: (async () => sseResponse(turn)) as typeof fetch });
    const events = await drain(provider.assistantTurn({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] }));
    expect(events.at(-1)).toMatchObject({
      type: "turn-end",
      stopReason: "end",
      message: { text: "All good.", toolCalls: [], providerData: [{ type: "text", text: "All good." }] },
    });
  });
});

describe("toAnthropicMessages", () => {
  it("replays an assistant turn's own blocks and groups consecutive tool results into one user message", () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "a", name: "list_tasks", args: {} },
          { id: "b", name: "list_goals", args: {} },
        ],
        providerData: [thinking, { type: "tool_use", id: "a", name: "list_tasks", input: {} }, { type: "tool_use", id: "b", name: "list_goals", input: {} }],
      },
      { role: "tool", toolCallId: "a", name: "list_tasks", content: "[]" },
      { role: "tool", toolCallId: "b", name: "list_goals", content: '{"error":"x"}', isError: true },
      { role: "assistant", text: "Nothing yet.", toolCalls: [] },
    ];
    expect(toAnthropicMessages(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: (messages[1] as { providerData: unknown }).providerData },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "[]" },
          { type: "tool_result", tool_use_id: "b", content: '{"error":"x"}', is_error: true },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Nothing yet." }] },
    ]);
  });
});
