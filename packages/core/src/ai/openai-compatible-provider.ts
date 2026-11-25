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
  /** Told the token numbers of each assistant answer, when the endpoint reports them (#130). */
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * The token numbers of one answer, as the endpoint reports them (#130).
 * `cachedTokens` is `usage.prompt_tokens_details.cached_tokens` (LiteLLM puts
 * Anthropic's cache reads there); `cacheWriteTokens` is LiteLLM's
 * `cache_creation_input_tokens`. Null where the endpoint says nothing.
 */
export interface TokenUsage {
  promptTokens: number;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
}

/**
 * The changing part of the assistant's prompt (the date, the screen, the zone
 * note) goes at the start of the first user message under this label, not
 * into the system message (#130). The system message is then the fixed
 * prompt alone, so a gateway can cache it (LiteLLM marks it with `index: 0`),
 * and every model sees one system message followed by user and assistant
 * turns. The fixed prompt already tells the model that [square brackets] are
 * notes from the app.
 */
export const CONTEXT_LABEL = "[Context from the app, not typed by the user:";

/** The token numbers in a stream's last chunk, if it has them. */
function usageOf(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as { prompt_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } | null; cache_creation_input_tokens?: unknown };
  if (typeof u.prompt_tokens !== "number") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    promptTokens: u.prompt_tokens,
    cachedTokens: num(u.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  };
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
  private readonly onUsage: ((usage: TokenUsage) => void) | undefined;
  /** False once a request went through only without `stream_options` (after a 400 or 422), until the settings reload. */
  private askUsage = true;

  constructor(options: OpenAiCompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.onUsage = options.onUsage;
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      // A redirect must not carry the key to another host (#94).
      redirect: "error",
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
    const post = (withUsage: boolean) =>
      fetch(`${this.baseUrl}/chat/completions`, {
        // A redirect must not carry the key to another host (#94).
        redirect: "error",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          // The token numbers come in the last chunk only when asked (#130).
          ...(withUsage ? { stream_options: { include_usage: true } } : {}),
          // No default cap: like the other jobs here, leave it to the server.
          // (Reasoning models refuse `max_tokens`; small local models refuse a
          // cap above their context.)
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          messages: toChatMessages(request.system, request.messages, request.systemTail),
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
    let response = await post(this.askUsage);
    // An endpoint that does not know `stream_options` refuses the request:
    // ask once more without it, and not again (#130). Only a 400 or 422; a
    // 401, 429 or 5xx is not about the field.
    if (this.askUsage && (response.status === 400 || response.status === 422)) {
      await response.text().catch(() => "");
      response = await post(false);
      // Stop asking only when the same request goes through without the
      // field: then the field was the reason. A 400 for anything else (a
      // context too long, a bad model name) must not switch the numbers off.
      if (response.ok) this.askUsage = false;
    }
    if (!response.ok || !response.body) {
      throw new Error(`AI provider error ${response.status}: ${await response.text()}`);
    }

    let text = "";
    let finish: string | null = null;
    let usage: TokenUsage | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as {
        error?: string | { message?: string };
        usage?: unknown;
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      // Gateways report a failure mid-stream as an error object, not an HTTP
      // status; a cut-off answer must not look finished.
      if (chunk.error) {
        const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
        throw new Error(`AI provider error: ${message ?? "the stream failed"}`);
      }
      usage = usageOf(chunk.usage) ?? usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        yield { type: "text", delta: delta.content };
      }
      for (const fragment of delta.tool_calls ?? []) {
        // Some servers leave out `index`: a fragment with a new id starts a
        // call, any other continues the latest one.
        const sameId = fragment.id ? [...calls].find(([, c]) => c.id === fragment.id)?.[0] : undefined;
        const index = fragment.index ?? sameId ?? (fragment.id ? calls.size : Math.max(calls.size - 1, 0));
        const call = calls.get(index) ?? { id: "", name: "", args: "" };
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name) call.name += fragment.function.name;
        if (fragment.function?.arguments) call.args += fragment.function.arguments;
        calls.set(index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    if (usage) this.onUsage?.(usage);
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

/**
 * The neutral conversation as chat-completions messages: one system message
 * (the fixed prompt), then the turns. The changing `context`, if any, opens
 * the first user message under `CONTEXT_LABEL` (#130); with no user message
 * at all it is added to the system message, as before.
 */
export function toChatMessages(system: string, messages: AgentMessage[], context?: string): unknown[] {
  const first = context ? messages.findIndex((m) => m.role === "user") : -1;
  const head = context && first < 0 ? `${system}\n${context}` : system;
  return [
    { role: "system", content: head },
    ...messages.map((message, index) => {
      if (message.role === "user") {
        return { role: "user", content: index === first ? `${CONTEXT_LABEL} ${context}]\n\n${message.content}` : message.content };
      }
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
