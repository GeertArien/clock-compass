import type { ProactivityTag } from "@prisma/client";
import type {
  AgentMessage,
  AiProvider,
  AssistantTurnEvent,
  AssistantTurnRequest,
  TaskClassification,
  ToolCall,
  TurnStopReason,
  WeeklyReviewContext,
} from "./provider.js";
import {
  CLASSIFY_JSON_SHAPE,
  CLASSIFY_SYSTEM,
  MISSION_SYSTEM,
  PROACTIVITY_JSON_SHAPE,
  REVIEW_SYSTEM,
} from "./prompts.js";
import { parseClassification, parseProactivity } from "./parse.js";

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  /** Optional — local runtimes usually need none. */
  apiKey?: string;
  /** Required: model name as the endpoint knows it (gpt-…, llama…, etc.). */
  model: string;
}

/**
 * A provider for ANY endpoint speaking the OpenAI-compatible chat-completions
 * protocol: OpenAI itself, local runtimes (Ollama, LM Studio, vLLM), and
 * gateways (OpenRouter, LiteLLM). Plain fetch — deliberately no framework;
 * the AiProvider interface is the app's abstraction layer.
 *
 * Structured replies use `response_format: {type: "json_object"}` (the widely
 * supported subset) with the shape spelled out in the prompt, then validated
 * here — strict json_schema mode isn't available on most local runtimes.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly available = true;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(options: OpenAiCompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`AI provider error ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new Error("AI returned no content");
    }
    return content.trim();
  }

  async classifyTask(text: string, today: string): Promise<TaskClassification> {
    // json_object mode doesn't enforce the schema — validate the essentials.
    const raw = JSON.parse(
      await this.chat(
        `${CLASSIFY_SYSTEM}\n\n${CLASSIFY_JSON_SHAPE}`,
        `Current date: ${today}\n\nTask sentence: ${text}`,
        true,
      ),
    );
    return parseClassification(raw, text);
  }

  async tagProactivity(title: string, notes?: string | null): Promise<ProactivityTag> {
    const raw = JSON.parse(
      await this.chat(
        `${CLASSIFY_SYSTEM}\n\n${PROACTIVITY_JSON_SHAPE}`,
        `Tag this task as INFLUENCE or CONCERN.\nTitle: ${title}${notes ? `\nNotes: ${notes}` : ""}`,
        true,
      ),
    );
    return parseProactivity(raw);
  }

  refineMission(draft: string): Promise<string> {
    return this.chat(MISSION_SYSTEM, draft, false);
  }

  weeklyReview(context: WeeklyReviewContext): Promise<string> {
    return this.chat(REVIEW_SYSTEM, JSON.stringify(context, null, 2), false);
  }

  /**
   * One streamed assistant turn with function calling, over the widely
   * supported chat-completions streaming format: `data:` lines carrying
   * `choices[0].delta` (text in `content`, tool calls as `tool_calls`
   * fragments keyed by `index`) and a `finish_reason`. Tool-call arguments
   * arrive as JSON text in pieces; they are parsed once complete, and text
   * that does not parse is passed on as-is for the agent loop to reject.
   */
  async *assistantTurn(request: AssistantTurnRequest): AsyncIterable<AssistantTurnEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        max_tokens: request.maxTokens ?? 16000,
        messages: toChatMessages(request.system, request.messages),
        ...(request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
              })),
            }
          : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`AI provider error ${response.status}: ${await response.text()}`);
    }

    let text = "";
    let finish: string | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        yield { type: "text", delta: delta.content };
      }
      for (const fragment of delta.tool_calls ?? []) {
        const call = calls.get(fragment.index) ?? { id: "", name: "", args: "" };
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name) call.name += fragment.function.name;
        if (fragment.function?.arguments) call.args += fragment.function.arguments;
        calls.set(fragment.index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        args: parseArgs(call.args),
      }));
    yield {
      type: "turn-end",
      message: { role: "assistant", text, toolCalls },
      stopReason: finishReasonOf(finish, toolCalls.length > 0),
    };
  }
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // not an object: the loop's validation reports it to the model
  }
}

function finishReasonOf(reason: string | null, hasToolCalls: boolean): TurnStopReason {
  switch (reason) {
    case "stop":
      return hasToolCalls ? "tool_use" : "end";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return hasToolCalls ? "tool_use" : reason === null ? "end" : "other";
  }
}

/** The `data:` payloads of a server-sent-events body, one per event. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trim();
}

/** The neutral conversation as chat-completions messages. */
export function toChatMessages(system: string, messages: AgentMessage[]): unknown[] {
  return [
    { role: "system", content: system },
    ...messages.map((message) => {
      if (message.role === "user") return { role: "user", content: message.content };
      if (message.role === "tool") {
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
      }
      return {
        role: "assistant",
        content: message.text || null,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
                },
              })),
            }
          : {}),
      };
    }),
  ];
}
